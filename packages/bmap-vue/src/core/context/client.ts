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
 * 底层任务拿到的 signal 是 **owner**（context 自己的身份），不是调用者的：
 * `dispose()` 中止它，于是可取消的 Provider（`customScriptV4Provider` 走 `SdkRegistry`
 * 默认 `cancellable: true`）按既有语义释放 script / timer / callback；官方 Provider 声明
 * `cancellable: false`，registry 只结算消费者、保留真实底层任务与全局状态。
 * 调用者取消**仍是逻辑取消**——丢弃回包，不假装终止了它没权处置的那条请求，也不重置上游
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

/** `dispose()` 之后一切入口与等待的统一拒绝值（终态口径只有这一处）。 */
function disposedError(suffix: string): BMapError {
  return new BMapError("BMAP_RESOURCE_DISPOSED", `BMapClientContext ${suffix}`);
}

/**
 * 等一个**已启动**的共享任务，但允许本次等待被取消。
 *
 * 这是 caller-owned 的那一半：取消只让**本次调用**立刻以自己的理由 reject，不改变底层
 * 任务的所有权（底层是否被释放由 `owner` 那条链决定，见下）。**两个**中止来源共用这一处
 * 实现：
 *
 * - `signal`：调用方自己的取消（`BMAP_PROVIDER_ABORTED`）；
 * - `owner`：context 被 `dispose()`（`BMAP_RESOURCE_DISPOSED`）——`dispose()` 是终态，
 *   它必须结算**已经发出**的等待，否则底层 Provider 一直 pending 时这些 Promise 永久悬挂
 *   （`<BMapProvider>` 的 `ensureLoad()` 正是无 signal 的这一条；#186 评审 P1）。
 *
 * 等待一定结算；**底层任务是否继续，由 Provider / Registry 的 `cancellable` 语义决定**：
 * `owner` 同时也是传给 `createBMapClient` 的消费者身份，`dispose()` abort 它之后，可取消的
 * Provider 会释放底层资源，`cancellable: false` 的（官方 Loader）则保留任务继续跑，
 * 结果由 `startSharedLoad` 的终态守卫丢弃——两种情况下这里都不再关心它。
 *
 * `owner` 用 `AbortSignal` 表达而不是在每次等待里各挂一个回调：登记与解绑都只有一处，
 * 且「已 dispose」和「等待期间 dispose」自然由同一个信号的 `aborted` 覆盖。
 */
function waitShared(
  task: Promise<BMapClient>,
  owner: AbortSignal,
  signal?: AbortSignal,
): Promise<BMapClient> {
  return new Promise<BMapClient>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      owner.removeEventListener("abort", onOwnerAbort);
      signal?.removeEventListener("abort", onCallerAbort);
    };
    const settle = (reason: BMapError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(reason);
    };
    function onOwnerAbort() {
      settle(disposedError("has been disposed"));
    }
    function onCallerAbort() {
      settle(createConsumerAbortError());
    }
    // 已 abort 的 owner / signal 立即拒绝，且不登记任何监听器。
    if (owner.aborted) return onOwnerAbort();
    if (signal?.aborted) return onCallerAbort();
    owner.addEventListener("abort", onOwnerAbort, { once: true });
    signal?.addEventListener("abort", onCallerAbort, { once: true });
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
  /**
   * 「本 context 已 dispose」的信号：`dispose()` abort 它，于是**所有**已发出的等待
   * （含无 signal 的那条）当场以 `BMAP_RESOURCE_DISPOSED` 结算，而不是被一个永不结算的
   * 底层 Provider 永久悬住。
   */
  const owner = new AbortController();

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
      //
      // 传**owner** signal（不是调用者的）：它是 context 作为 registry consumer 的身份，
      // `dispose()` 时中止它，于是：
      // - 可取消的 Provider（`customScriptV4Provider` 走 `SdkRegistry` 默认
      //   `cancellable: true`）能按既有语义释放 script / timer / callback，
      //   兑现「context 销毁时处理其自有资源」（#186 评审 P1）；
      // - 官方 Provider 声明 `cancellable: false`，registry 只结算消费者、保留真实底层
      //   任务与全局状态 —— 本库不宣称终止了那条网络请求。
      // 调用者的 signal **永远**不进这里，否则「谁先来」又决定了「谁取消能拖垮别人」。
      source = createBMapClient(definition, owner.signal);
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
        // 失败值**先归一，再同时用于两处**：写 `ctx.error` 与作为拒绝值。
        // `toBMapError` 对已有 `BMapError` 原样返回（不丢 `code` / `cause`），只归一普通
        // `Error`。这一步是必需的：`BMapProviderLike` 是**公共扩展点**，用户 Provider 抛普通
        // `Error` 完全合法；不归一的话，`<Map>` 的 `MapRuntime.doMount` 会把它包成
        // `BMAP_RESOURCE_CREATE_FAILED`（不可重试），而 `<BMapProvider>` 会包成
        // `BMAP_SDK_LOAD_FAILED`（可重试）——同一份 Provider 失败因入口不同而分叉，
        // 与 docs/zh-CN/guide/errors.md 的分类相反（#186 评审 P1）。
        const bmapErr = toBMapError(err, "Map client load failed");
        // 迟到的失败不得把终态改写成 `error`（拒绝值仍归一，口径只有一处）。
        if (!disposed) {
          status.value = "error";
          error.value = bmapErr;
        }
        throw bmapErr;
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
    // 等待包装**总是**走：`dispose()` 也是等待的取消来源，不只是调用方自己的 signal。
    return waitShared(task, owner.signal, signal);
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
    // 1. abort owner，一次性做两件事：
    //    - 结算**所有已发出**的等待（它们拿到 disposed 口径）；
    //    - 交还 context 的 registry consumer 身份 —— 可取消的 Provider 据此释放
    //      script / timer / callback，`cancellable: false` 的（官方 Loader）保留底层任务。
    //    顺序很重要——先 abort owner，再置终态，等待者拿到的就一定是 disposed 口径。
    owner.abort(disposedError("has been disposed"));
    // 2. 共享任务不再被本 context 追踪：它的结果由 `startSharedLoad` 的终态守卫丢弃，
    //    既不改写终态、也不写 `client`。是否仍在飞取决于上一步的 cancellable 裁决。
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
