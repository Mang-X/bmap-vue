/**
 * 全景底座：Context、取用入口与资源所有权（M7-CONTROL-PANORAMA / issue #41）
 *
 * 全景与地图是**两条独立的生命周期**，因此刻意不复用 `MapContext`（issue 的非目标：
 * 「不把 Panorama 内部 Map 当成普通 MapContext」）：
 *
 * - 查看器有自己的容器，创建在**独立 DOM** 上（`new BMap.Panorama(container)`），既不挂在
 *   Map 上、也不受地图的 ready / retry / 暂停策略管辖；
 * - 把两者合成一个 context 会让「在 `<BMap>` 子树里放一个 `<BPanorama>`」这种合法而常见的
 *   组合出现两个互相矛盾的 `whenReady()`（一个等地图、一个等查看器）。
 *
 * 因此 `BPanorama` 提供一个**独立**的 `PanoramaContext`：`<BPanoramaLabel>` 从它拿查看器，
 * 组件可以从 `<BMap>` 或 `<BMapProvider>` 子树里取 Client —— 全景只依赖 Client，不需要地图。
 *
 * 两处收窄与所有权：
 * - `BMapDriver.panorama` 是共享面（只有 `supported`），占位/投影面按 `#23` 的分层决策只挂在
 *   `JsapiV4Driver` 上，所以取用时经 `jsapiV4PanoramaOf()` **可检查地**收窄（与
 *   `jsapiV4ServicesOf` 同一手法），而不是无条件的 `as`；
 * - 查看器、业务监听都登记在 `resources` 里：`dispose()` 先释放监听再由 Driver 销毁查看器
 *   （与 Map / Control 的「先解绑、再销毁」同源）。
 */
import { inject, shallowRef, type InjectionKey, type ShallowRef } from "vue";
import type { BMapClient } from "../../client/types";
import type { MapContext } from "../context/types";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import type {
  PanoramaHandle,
  PanoramaOptions,
  PanoramaViewerDriver,
} from "../../driver/types/panorama";

export type PanoramaStatus =
  | "idle"
  | "waiting-client"
  | "creating"
  | "ready"
  | "error"
  | "disposing"
  | "disposed";

/** 查看器就绪后的上下文（Client + 句柄）。 */
export interface PanoramaReadyContext {
  readonly client: BMapClient;
  readonly viewer: PanoramaHandle;
}

export interface PanoramaContext {
  readonly status: Readonly<ShallowRef<PanoramaStatus>>;
  readonly viewer: Readonly<ShallowRef<PanoramaHandle | null>>;
  readonly error: Readonly<ShallowRef<BMapError | null>>;
  /**
   * 查看器作用域：查看器自身的 SDK 事件订阅、Observer、timer 都必须登记在这里。
   * `dispose()` 会先释放它、再销毁查看器。
   */
  readonly resources: ResourceScope;

  /** 在容器里创建（或复用）查看器；幂等，并发调用共享同一次创建。 */
  mount(container: HTMLElement, options?: PanoramaOptions): Promise<PanoramaReadyContext>;
  /** 等待查看器就绪（可回放：已就绪时立即 resolve）。 */
  whenReady(signal?: AbortSignal): Promise<PanoramaReadyContext>;
  /** 幂等销毁：释放监听 + 销毁查看器。 */
  dispose(): void;
}

export const panoramaContextKey: InjectionKey<PanoramaContext> = Symbol(
  "bmap-vue:panorama-context",
);

/**
 * 取用 v4 的全景面。
 *
 * `BMapClient.driver` 的类型是共享契约 `BMapDriver`，它只承诺全景的**共享面**
 * （`PanoramaDriver`：`supported`）；占位/投影面（`create` / `setId` / 标签…）按 `#23` 的分层
 * 决策只挂在 `JsapiV4Driver.panorama` 上。这里按运行时成员探测收窄，失败时给一条能读懂的错误，
 * 而不是 `as` 之后再在某个 click 里炸出「create is not a function」。
 */
export function jsapiV4PanoramaOf(client: BMapClient): PanoramaViewerDriver {
  const panorama = client.driver.panorama as Partial<PanoramaViewerDriver> | undefined;
  if (!panorama || typeof panorama.create !== "function") {
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `当前 engine(${client.engine}) 的 Driver 没有全景查看器面：` +
        "`<BPanorama>` 依赖 `PanoramaViewerDriver`（JSAPI 4.0 Driver 提供）",
      { engine: client.engine },
    );
  }
  return panorama as PanoramaViewerDriver;
}

function toBMapError(error: unknown, code: "BMAP_RESOURCE_CREATE_FAILED" | "BMAP_RESOURCE_DISPOSED") {
  return error instanceof BMapError
    ? error
    : new BMapError(code, String(error), { cause: error });
}

/**
 * 创建 `PanoramaContext`。**由 `BPanorama` 在 setup 里调用并提供给子树**；其它组件用
 * `useOptionalPanoramaContext()` / `useRequiredPanoramaContext()` 取。
 *
 * `mapContext` 只是**取 Client 的通道**（`resolveMapContext()` 的结果：`<BMap>` 子树里是地图
 * context，`<BMapProvider>` 子树里是 client-only 适配器）。全景不读它的 `map`。
 */
export function createPanoramaContext(input: { mapContext: MapContext }): PanoramaContext {
  const { mapContext } = input;
  const resources = new ResourceScope({ label: "panorama-context" });
  const status = shallowRef<PanoramaStatus>("idle");
  const viewer = shallowRef<PanoramaHandle | null>(null);
  const error = shallowRef<BMapError | null>(null);

  let ready: PanoramaReadyContext | null = null;
  let mountTask: Promise<PanoramaReadyContext> | null = null;
  let disposed = false;
  /** 等待者（`MapRuntime` 的同一套：signal 只取消**本次等待**，不影响本次创建）。 */
  let waiters: Array<{
    resolve: (value: PanoramaReadyContext) => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }> = [];

  /** 取消本次等待的错误（与 `MapRuntime.whenReady` 的同一口径：`BMAP_PROVIDER_ABORTED`）。 */
  const abortError = (reason?: unknown) =>
    new BMapError(
      "BMAP_PROVIDER_ABORTED",
      typeof reason === "string" ? reason : "panorama whenReady aborted",
      reason !== undefined ? { cause: reason } : undefined,
    );

  /** 单个等待者结算（`value` 为空表示失败）。从等待集合摘除并解绑 signal，再 resolve/reject。 */
  function settleWaiter(
    waiter: (typeof waiters)[number],
    value: PanoramaReadyContext | null,
    failure?: unknown,
  ): void {
    const index = waiters.indexOf(waiter);
    if (index < 0) return;
    waiters.splice(index, 1);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    if (value) waiter.resolve(value);
    else waiter.reject(failure);
  }

  /** 一次性结算全部等待者（成功时 `value` 必为就绪上下文）。 */
  function settle(value: PanoramaReadyContext | null, failure?: unknown): void {
    const pending = waiters;
    waiters = [];
    for (const waiter of pending) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      if (value) waiter.resolve(value);
      else waiter.reject(failure);
    }
  }

  const disposedError = () =>
    new BMapError("BMAP_RESOURCE_DISPOSED", "PanoramaContext has been disposed");

  async function mount(container: HTMLElement, options?: PanoramaOptions): Promise<PanoramaReadyContext> {
    if (disposed) throw disposedError();
    if (ready) return ready;
    if (mountTask) return mountTask;

    mountTask = (async (): Promise<PanoramaReadyContext> => {
      status.value = "waiting-client";
      const mapReady = await mapContext.whenReady(resources.signal);
      if (disposed) throw disposedError();
      const client = mapReady.client;
      const driver = jsapiV4PanoramaOf(client);
      status.value = "creating";
      // 能力守卫留在 Driver 的 `create()` 里（`capabilities.require`）：这样
      // `unsupported: "warn" / "silent"` 三种策略的行为与其它 Facet 完全一致，
      // 不在组件层再写一份「支持判定」。
      const handle = driver.create(container, options);
      if (disposed || resources.isDisposed) {
        try {
          driver.destroy(handle);
        } catch {
          /* 已被卸载：尽力而为 */
        }
        throw disposedError();
      }
      viewer.value = handle;
      ready = { client, viewer: handle };
      status.value = "ready";
      settle(ready);
      return ready;
    })();

    try {
      return await mountTask;
    } catch (caught) {
      mountTask = null;
      if (disposed) throw caught;
      const bmapError = toBMapError(caught, "BMAP_RESOURCE_CREATE_FAILED");
      status.value = "error";
      error.value = bmapError;
      settle(null, bmapError);
      throw bmapError;
    }
  }

  function whenReady(signal?: AbortSignal): Promise<PanoramaReadyContext> {
    if (ready) return Promise.resolve(ready);
    if (status.value === "error" && error.value) return Promise.reject(error.value);
    if (disposed) return Promise.reject(disposedError());
    // 已 abort 的 signal 立即拒绝，不先加入等待集合
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));

    return new Promise<PanoramaReadyContext>((resolve, reject) => {
      const waiter: (typeof waiters)[number] = { resolve, reject, signal };
      if (signal) {
        // 与 `MapRuntime.whenReady` 同一口径：signal 只取消**本次等待**，不取消创建本身
        // （其它等待者与 `mount()` 的发起方继续）。
        waiter.onAbort = () => settleWaiter(waiter, null, abortError(signal.reason));
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      waiters.push(waiter);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    status.value = "disposing";
    // 先释放业务监听（SDK 在 destroy 期间派发的事件不得打到已拆解的回调上），再销毁查看器
    try {
      resources.dispose("panorama-context-disposed");
    } catch {
      /* 释放失败不阻断销毁 */
    }
    const current = viewer.value;
    const client = ready?.client ?? null;
    viewer.value = null;
    ready = null;
    mountTask = null;
    settle(null, disposedError());
    if (current && client) {
      try {
        jsapiV4PanoramaOf(client).destroy(current);
      } catch (caught) {
        // 未加载任何场景的查看器 `destroy()` 会抛（官方 4.0 的真实行为，见 ADR 2026-09-12
        // 的真实 AK smoke 记录）。组件卸载路径**不能**因此抛错——那只会在 Vue 的卸载流程里
        // 制造一个没人处理的异常。这里告警一次：诊断可见，卸载继续。
        logger.warn(
          "BPanorama 销毁查看器失败（未加载场景的实例在官方 4.0 上会抛错；组件仍会释放本库资源）：" +
            `${(caught as Error)?.message ?? String(caught)}`,
        );
      }
    }
    status.value = "disposed";
  }

  return {
    status: status as Readonly<ShallowRef<PanoramaStatus>>,
    viewer: viewer as Readonly<ShallowRef<PanoramaHandle | null>>,
    error: error as Readonly<ShallowRef<BMapError | null>>,
    resources,
    mount,
    whenReady,
    dispose,
  };
}

export function useOptionalPanoramaContext(): PanoramaContext | undefined {
  return inject(panoramaContextKey, undefined);
}

export function useRequiredPanoramaContext(): PanoramaContext {
  const context = useOptionalPanoramaContext();
  if (!context) {
    throw new BMapError(
      "BMAP_PARENT_CONTEXT_MISSING",
      "Component must be a descendant of <BPanorama>.",
    );
  }
  return context;
}
