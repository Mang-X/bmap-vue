/**
 * BMapClientContext
 *
 * SDK Client 层的响应式注入上下文。服务类 composable 默认只依赖 Client Context,
 * 无需 Map 即可使用 geocoder/convertor 等能力。
 *
 * M3A3-REMOVE-LEGACY（#26）：`definition` 在这里**直接**交给 `createBMapClient`
 * （后者缺省注入 jsapi-v4 的 Driver 工厂）。迁移期的 `withMigrationDriver` 归一已随
 * webgl-v1 删除，因此同一份 definition 在 `<Map>` / `<BMapProvider>` /
 * `resolveMapContext` / 插件默认 definition 上仍然行为一致，但不再有「宽松 Provider →
 * legacy Driver」这条隐式分派。
 *
 * ## 任务所有权与取消口径（#186）
 *
 * 这个 context 是**共享的**：`<BMapProvider>` 一次 provide，子树里每个 `<Map>`、每个服务
 * composable 都会调同一个 `load()`。因此必须把两件事拆开：
 *
 * - **共享生产任务归 context 所有**（`sharedLoad`）——它不对应任何单个调用者；
 * - **每次 `load()` 只是 caller-owned 的等待**，自己的 `signal` 只取消自己的等待。
 *
 * 分开之前有三个真实缺陷（`core/context/client.test.ts` 的「共享任务的取消隔离」一节用
 * 可控延迟 Provider 逐条复现，摘掉新实现即翻红）：① 第一个调用者的 signal 直接进了共享
 * 任务，它取消时未取消的后来者一并被拒；② `dispose()` 之后的迟到成功/失败仍把 `disposed`
 * 改写成 `ready` / `error`；③ 正常完成时等待者的 abort 监听器没解绑。
 *
 * 底层任务**不可取消**（`createBMapClient` 拿不到共享 signal，`Signal` 也不跨共享任务
 * 转发取消）：取消是**逻辑**取消——丢弃回包，不假装终止了网络请求，也不重置上游
 * `window.BMap`。
 */
import { inject, readonly, shallowRef, type InjectionKey, type ShallowRef } from "vue";
import type { BMapClient, CreateBMapClientOptions } from "../../client/types";
import { createBMapClient } from "../../client/createBMapClient";
import { createConsumerAbortError } from "../loader/SdkRegistry";
import { BMapError } from "../errors/BMapError";

export type ClientStatus = "idle" | "loading" | "ready" | "error" | "disposed";

export interface BMapClientContext {
  readonly status: Readonly<ShallowRef<ClientStatus>>;
  readonly client: Readonly<ShallowRef<BMapClient | null>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  load(signal?: AbortSignal): Promise<BMapClient>;
  retry(signal?: AbortSignal): Promise<BMapClient>;
  dispose(): void;
}

export const bmapClientContextKey: InjectionKey<BMapClientContext> = Symbol(
  "bmap-client-context",
);

/** app.use() 提供的默认 Client Definition(可被 <BMapProvider> 覆盖) */
export const defaultClientDefinitionKey: InjectionKey<CreateBMapClientOptions | undefined> = Symbol(
  "bmap-default-client-definition",
);

export interface CreateClientContextOptions {
  definition?: CreateBMapClientOptions;
  client?: BMapClient;
}

function toBMapError(err: unknown, fallback: string): BMapError {
  if (err instanceof BMapError) return err;
  return new BMapError("BMAP_SDK_LOAD_FAILED", `${fallback}: ${(err as Error)?.message ?? err}`, {
    cause: err,
  });
}

/**
 * 等一个**已启动**的共享任务，但允许本次等待被自己的 `signal` 取消。
 *
 * 这是 caller-owned 的那一半：任务本身不受影响（它已经启动、也不接受取消），abort 只让
 * 本次调用立刻以自己的理由 reject；任务结算时**先**清掉监听器再结算，因此正常完成后
 * 不残留 abort 监听器，abort 也不会去动已经结算的 promise。
 */
function waitShared(task: Promise<BMapClient>, signal: AbortSignal): Promise<BMapClient> {
  return new Promise<BMapClient>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    function onAbort() {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createConsumerAbortError());
    }
    signal.addEventListener("abort", onAbort, { once: true });
    task.then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

export function createClientContext(options: CreateClientContextOptions = {}): BMapClientContext {
  const status = shallowRef<ClientStatus>(options.client ? "ready" : "idle");
  const client = shallowRef<BMapClient | null>(options.client ?? null);
  const error = shallowRef<BMapError | null>(null);
  /** **context-owned** 的共享生产任务（不是任何单个调用者的等待）。 */
  let sharedLoad: Promise<BMapClient> | null = null;
  let disposed = false;

  function disposedError(suffix: string): BMapError {
    return new BMapError("BMAP_RESOURCE_DISPOSED", `BMapClientContext ${suffix}`);
  }

  /**
   * 启动共享生产任务。**不接受 `signal`**：它的结果归 context，不归第一个调用者
   * ——否则「谁先来」就决定了「谁取消能拖垮别人」。已 dispose 时不启动。
   */
  function startSharedLoad(): Promise<BMapClient> {
    if (disposed) return Promise.reject(disposedError("has been disposed"));
    if (sharedLoad) return sharedLoad;
    const definition = options.definition;
    // 缺 definition 是**启动前**的失败，但它必须走下面同一处状态写入：`<BMapProvider>` 的
    // `#error` 插槽与 `<Map>` 的错误面都读 `status === "error"` / `ctx.error`，在这里直接
    // reject 等于让「缺配置」退化成静默的 `idle`（#186 评审 P1）。因此它照旧走共享任务的
    // 失败分支，只是不经过 `loading`（与旧实现一致：旧 `doLoad` 也在置 loading 之前就抛）。
    let source: Promise<BMapClient>;
    if (definition) {
      status.value = "loading";
      error.value = null;
      // 定义直接交给 `createBMapClient`（缺省注入 jsapi-v4 的 Driver 工厂）。
      // 这里是**唯一收口点**——`<Map>` / `<BMapProvider>` / 插件默认 definition /
      // `resolveMapContext` 全部经此创建 Client，因此「同一份 definition 换一个入口就报
      // BMAP_SDK_ENGINE_MISMATCH」不会发生。显式传入的 `driver` 仍然优先。
      source = createBMapClient(definition);
    } else {
      source = Promise.reject(
        new BMapError(
          "BMAP_PARENT_CONTEXT_MISSING",
          "No Map client definition. Provide <BMapProvider> or app.use(createBMapPlugin(...)).",
        ),
      );
    }
    const task = source.then(
      (loaded) => {
        // `dispose()` 是终态：迟到的成功不得复活 context，也不得让这个 Client 进入
        // 任何活着的资源的视野（无人接收的 Client 不额外释放——本库没有公开的
        // Client 销毁入口，见 ADR 2026-10-03）。
        if (disposed) throw disposedError("disposed during load");
        client.value = loaded;
        status.value = "ready";
        return loaded;
      },
      (err: unknown) => {
        // 同理，迟到的失败不得把终态改写成 `error`。
        if (!disposed) {
          status.value = "error";
          error.value = toBMapError(err, "Map client load failed");
        }
        // 拒绝**原错误**：它已带 `cause` / `code`（Provider 与 createBMapClient 的产出），
        // 再包一层会把它藏进 `unsupported` 字段而丢掉 `code`。
        throw err;
      },
    );
    sharedLoad = task;
    // 一个结算分支管两件事：① 失败不是「共享任务仍在飞」（清掉它，`retry()` 才能重新启动）；
    // ② 消费者可能已全部离开（各自 abort / dispose），避免无人观察的 rejection 冒泡为 unhandled。
    void task.then(
      () => {
        if (sharedLoad === task) sharedLoad = null;
      },
      () => {
        if (sharedLoad === task) sharedLoad = null;
      },
    );
    return task;
  }

  function load(signal?: AbortSignal): Promise<BMapClient> {
    if (disposed || status.value === "disposed") {
      return Promise.reject(disposedError("has been disposed"));
    }
    if (client.value) return Promise.resolve(client.value);
    // 已取消的 signal 连任务都不启动——不该为一次没人要的等待去拉 SDK。
    if (signal?.aborted) return Promise.reject(createConsumerAbortError());
    const task = startSharedLoad();
    return signal ? waitShared(task, signal) : task;
  }

  function retry(signal?: AbortSignal): Promise<BMapClient> {
    if (disposed || status.value === "disposed") {
      return Promise.reject(disposedError("has been disposed"));
    }
    error.value = null;
    if (status.value === "error") status.value = "idle";
    return load(signal);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    // 共享任务照样跑完（不可取消）；终态由 `startSharedLoad` 的写入前守卫保证。
    sharedLoad = null;
    error.value = null;
    client.value = null;
    status.value = "disposed";
  }

  return {
    status: readonly(status),
    client: readonly(client),
    error: readonly(error),
    load,
    retry,
    dispose,
  };
}

export function useOptionalClientContext(): BMapClientContext | undefined {
  return inject(bmapClientContextKey, undefined);
}

export function useRequiredClientContext(): BMapClientContext {
  const ctx = inject(bmapClientContextKey, undefined);
  if (!ctx) {
    throw new BMapError(
      "BMAP_PARENT_CONTEXT_MISSING",
      "Component must be a descendant of <BMapProvider> or <Map>. " +
        "Add <BMapProvider> at the root or call app.use(createBMapPlugin(...)).",
    );
  }
  return ctx;
}
