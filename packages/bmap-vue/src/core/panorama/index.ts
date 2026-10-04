/**
 * 全景底座：Context、取用入口与资源所有权（M7-CONTROL-PANORAMA / issue #41）
 *
 * 全景与地图是**两条独立的生命周期**，因此刻意不复用 `MapContext`（issue 的非目标：
 * 「不把 Panorama 内部 Map 当成普通 MapContext」）：
 *
 * - 查看器有自己的容器，创建在**独立 DOM** 上（`new BMap.Panorama(container)`），既不挂在
 *   Map 上、也不受地图的 ready / retry / 暂停策略管辖；
 * - 把两者合成一个 context 会让「在 `<Map>` 子树里放一个 `<Panorama>`」这种合法而常见的
 *   组合出现两个互相矛盾的 `whenReady()`（一个等地图、一个等查看器）。
 *
 * 因此 `Panorama` 提供一个**独立**的 `PanoramaContext`：`<PanoramaLabel>` 从它拿查看器，
 * 组件可以从 `<Map>` 或 `<BMapProvider>` 子树里取 Client —— 全景只依赖 Client，不需要地图。
 *
 * 两处收窄与所有权：
 * - `BMapDriver.panorama` 是共享面（只有 `supported`），占位/投影面按 `` 的分层决策只挂在
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
  PanoramaLabelHandle,
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

  /**
   * **本库管理的**标注名册（`<PanoramaLabel>` 挂上来时登记、摘掉时销账）。
   *
   * 它存在的唯一理由是官方 `Panorama#clearOverlays()`（`panorama/Panorama.d.ts:115`）——
   * 那条命令会把**全部**覆盖物清掉，而官方**没有**任何枚举接口（只有 `addOverlay` /
   * `removeOverlay` / `clearOverlays` 三个方法），所以「只清本库管不到的」在官方面上
   * **写不出来**。能写的只有一条：清完把名册里的标注**重新挂回去**（`clearOverlays` 的实现
   * 见 `<Panorama>` 的 expose 面）。逐条取舍见该组件上 `clearOverlays` 的注释。
   *
   * 名册只存**句柄**、不存回调：重新挂回走的是 `PanoramaViewerDriver.addLabel`，
   * 与首次挂载是**同一条**路径，因此标注那一侧的组件状态（「我还挂着」）不会与画面分叉。
   */
  registerLabel(label: PanoramaLabelHandle): void;
  /** 销账（`<PanoramaLabel>` 释放时调用）。重复销账是 no-op。 */
  unregisterLabel(label: PanoramaLabelHandle): void;
  /** 当前名册的快照（按登记顺序）。`clearOverlays` 重新挂回时按这个顺序遍历。 */
  managedLabels(): readonly PanoramaLabelHandle[];

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
 * （`PanoramaDriver`：`supported`）；占位/投影面（`create` / `setId` / 标签…）按 `` 的分层
 * 决策只挂在 `JsapiV4Driver.panorama` 上。这里按运行时成员探测收窄，失败时给一条能读懂的错误，
 * 而不是 `as` 之后再在某个 click 里炸出「create is not a function」。
 */
export function jsapiV4PanoramaOf(client: BMapClient): PanoramaViewerDriver {
  const panorama = client.driver.panorama as Partial<PanoramaViewerDriver> | undefined;
  if (!panorama || typeof panorama.create !== "function") {
    throw new BMapError(
      "BMAP_CAPABILITY_UNSUPPORTED",
      `当前 engine(${client.engine}) 的 Driver 没有全景查看器面：` +
        "`<Panorama>` 依赖 `PanoramaViewerDriver`（JSAPI 4.0 Driver 提供）",
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
 * 创建 `PanoramaContext`。**由 `Panorama` 在 setup 里调用并提供给子树**；其它组件用
 * `useOptionalPanoramaContext()` / `useRequiredPanoramaContext()` 取。
 *
 * `mapContext` 只是**取 Client 的通道**（`resolveMapContext()` 的结果：`<Map>` 子树里是地图
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
  /**
   * 本库管理的标注（`<PanoramaLabel>`）——见 `PanoramaContext.managedLabels` 的注释。
   *
   * 用 `Set` 而不是数组：销账要**幂等**（`<PanoramaLabel>` 的释放路径可能被走到两次：
   * `onScopeDispose` 与 `destroyLabel()` 都碰得到），而数组的 `indexOf/splice` 在
   * 「同一个句柄登记两次」时会留下重复项，重新挂回就会把同一个标注挂两遍。
   * 登记顺序由 `managedLabels()` 单独保（`Set` 在 JS 里保持插入序）。
   */
  const managedLabels = new Set<PanoramaLabelHandle>();
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
    // 名册**先**清空：查看器马上就要被销毁，之后不会有任何 `clearOverlays` 来重新挂回它们。
    // 不清的话，一次「销毁后仍有人调 clearOverlays」会把已经销毁的标注重新挂到一个死查看器上。
    managedLabels.clear();
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
          "Panorama 销毁查看器失败（未加载场景的实例在官方 4.0 上会抛错；组件仍会释放本库资源）：" +
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
    registerLabel: (label: PanoramaLabelHandle): void => {
      managedLabels.add(label);
    },
    unregisterLabel: (label: PanoramaLabelHandle): void => {
      managedLabels.delete(label);
    },
    managedLabels: (): readonly PanoramaLabelHandle[] => [...managedLabels],
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
      "Component must be a descendant of <Panorama>.",
    );
  }
  return context;
}
