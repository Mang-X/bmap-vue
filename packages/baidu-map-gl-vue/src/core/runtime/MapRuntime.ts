/**
 * MapRuntime v2
 *
 * 每个地图实例的运行时容器:
 * - 状态机 idle/waiting-client/creating/initializing/ready/error/disposing/disposed
 *   ("loading" 保留为 waiting-client 别名,向后兼容)
 * - Runtime 只管理 Map,不再加载 Plugin(PluginRegistry 的 map-scope 实例属于 Runtime)
 * - mount 去重经 mountPromise;retry 清错重入;suspend/resume 供 KeepAlive
 * - dispose 顺序:disposing → reject waiters → child registries/scopes → destroy map
 *   → clear handle → scheduler/events → root scope → disposed
 */
import { shallowRef, type ShallowRef } from "vue";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";
import type { InitialMapOptions, MapView } from "../../driver/types/map";
import { BMapError } from "../errors/BMapError";
import { logger } from "../logger";
import { ResourceScope } from "../lifecycle/ResourceScope";
import { createMapEventBus, type MapEventBus, type InternalMapEvents } from "../events/MapEventBus";
import { createFrameScheduler, type FrameScheduler } from "../scheduler/FrameScheduler";
import { createOverlayRegistry, type OverlayRegistry } from "../overlays/OverlayRegistry";
import { createPluginRegistry, type PluginRegistry } from "../plugins/PluginRegistry";
import type { BMapClientContext } from "../context/client";
import type { MapReadyContext, MapRuntimeStatus } from "../context/types";

interface Waiter {
  resolve: (ctx: MapReadyContext) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function createAbortError(reason?: unknown): BMapError {
  return new BMapError(
    "BMAP_PROVIDER_ABORTED",
    typeof reason === "string" ? reason : "waitForReady aborted",
    reason !== undefined ? { cause: reason } : undefined,
  );
}

export interface MapRuntimeOptions {
  /** 新规范:经 ClientContext 加载(推荐) */
  clientContext?: BMapClientContext;
  /** 向后兼容:直接工厂(测试/旧调用) */
  clientFactory?: (signal?: AbortSignal) => Promise<BMapClient>;
  /** 创建 map 的容器（mount 时回填） */
  container: HTMLElement;
  initialView?: MapView;
  mapOptions?: InitialMapOptions;
}

export type KeepAliveBehavior = "suspend" | "dispose";

export class MapRuntime {
  readonly id = Symbol("map-runtime");
  readonly status: ShallowRef<MapRuntimeStatus> = shallowRef("idle");
  readonly client: ShallowRef<BMapClient | null> = shallowRef(null);
  readonly map: ShallowRef<MapHandle | null> = shallowRef(null);
  readonly error: ShallowRef<unknown> = shallowRef(null);
  /** Spec 别名:handle === map,scope === resources */
  readonly handle: ShallowRef<MapHandle | null>;
  readonly scope: ResourceScope;
  readonly resources: ResourceScope;
  readonly events: MapEventBus = createMapEventBus();
  readonly scheduler: FrameScheduler = createFrameScheduler();
  readonly overlays: OverlayRegistry = createOverlayRegistry();
  readonly layers: OverlayRegistry = createOverlayRegistry();
  readonly controls: OverlayRegistry = createOverlayRegistry();
  readonly plugins: PluginRegistry;

  private waiters = new Set<Waiter>();
  /**
   * `whenMapCreated()` 注册的回调。
   *
   * **不在建图后清空**（M4-EVENTS / #28 评审第三轮 P2）：每个注册存活到它自己的 disposer 或
   * `dispose()`。理由是「建图成功但 `initializeView()` 失败 → `retry()` 重建第二张 map」这条路径——
   * 那时只能靠同一个注册再放行一次 `load`。
   */
  private mapCreatedCallbacks = new Set<(ready: MapReadyContext) => void>();
  private options: MapRuntimeOptions;
  private mountPromise: Promise<MapReadyContext> | null = null;
  private suspended = false;
  private suspendReason: unknown = null;

  /** 可供外部在 setup 后回填的容器引用 */
  container: HTMLElement;

  constructor(options: MapRuntimeOptions) {
    if (!options.clientContext && !options.clientFactory) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        "MapRuntime requires clientContext or clientFactory",
      );
    }
    this.options = options;
    this.container = options.container;
    this.resources = new ResourceScope({ label: "map-runtime" });
    this.scope = this.resources;
    this.handle = this.map;
    this.plugins = createPluginRegistry(
      // plugin context 动态读取当前 client/map,注册在 runtime 时已就绪
      () => ({
        client: this.client.value,
        map: this.map.value,
        api: this.client.value?.rawSdk ?? null,
      }),
      {
        emit: (type: string, payload: unknown) =>
          this.events.emit(
            type as keyof InternalMapEvents,
            payload as InternalMapEvents[keyof InternalMapEvents],
          ),
      },
      this.resources,
    );
  }

  /**
   * 注册「地图对象已创建」的回调（M4-EVENTS / #28 评审）。
   *
   * 时机是 `driver.map.create()` 之后、**首次 `initializeView()` 之前**：官方 `load` 就在
   * `initializeView()` 内部那次 `centerAndZoom` 之后派发，而句柄要等 `mount()` resolve 才对外可见 ——
   * 没有这个挂载点，`load` 这类「初始化期事件」在 `useMapEvent` 路径上永远收不到。
   *
   * 已经有地图时**立即同步调用**；返回取消注册的 disposer。回调抛错只告警，不阻断建图。
   * 订阅者（如 `useMapEvent`）负责在自己的作用域里调用返回的 disposer。
   */
  whenMapCreated(callback: (ready: MapReadyContext) => void): () => void {
    const currentMap = this.map.value;
    const currentClient = this.client.value;
    if (currentMap && currentClient) {
      this.invokeMapCreated(callback, { client: currentClient, map: currentMap });
      return () => {};
    }
    this.mapCreatedCallbacks.add(callback);
    return () => {
      this.mapCreatedCallbacks.delete(callback);
    };
  }

  /** 单个回调的调用点：抛错只告警（它只用来挂订阅，不是初始化的一部分）。 */
  private invokeMapCreated(
    callback: (ready: MapReadyContext) => void,
    ready: MapReadyContext,
  ): void {
    try {
      callback(ready);
    } catch (error) {
      logger.warn(
        `MapRuntime: whenMapCreated 回调抛错（不阻断建图）: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  }

  /**
   * 放行 `whenMapCreated` 的注册。
   *
   * **刻意不清空**：注册活到各自的 disposer 或 `dispose()`。理由是「建图成功但 `initializeView()`
   * 失败」这条路径 —— 那时回调已经跑过一次，而 `retry()` 会创建**第二张** map，`load` 只能靠同一个
   * 注册再放行一次（评审第二轮 P2）。清空会让第二张图的 `load` 永远收不到。
   */
  private flushMapCreated(ready: MapReadyContext): void {
    for (const callback of [...this.mapCreatedCallbacks]) {
      this.invokeMapCreated(callback, ready);
    }
  }

  async mount(): Promise<MapReadyContext> {
    if (this.status.value === "ready") {
      return this.handle.value!
        ? { client: this.client.value!, map: this.handle.value! }
        : this.whenReady();
    }
    if (
      this.status.value === "loading" ||
      this.status.value === "waiting-client" ||
      this.status.value === "creating" ||
      this.status.value === "initializing"
    ) {
      if (this.mountPromise) return this.mountPromise;
      return this.whenReady();
    }
    if (this.status.value === "disposed" || this.status.value === "disposing") {
      throw new BMapError(
        "BMAP_RUNTIME_DISPOSED",
        "MapRuntime has been disposed and cannot mount again",
      );
    }

    this.mountPromise = this.doMount();
    try {
      return await this.mountPromise;
    } finally {
      this.mountPromise = null;
    }
  }

  private async doMount(): Promise<MapReadyContext> {
    this.status.value = "waiting-client";
    try {
      const client = this.options.clientContext
        ? await this.options.clientContext.load(this.resources.signal)
        : await this.options.clientFactory!(this.resources.signal);
      if (this.resources.isDisposed) {
        throw new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed during SDK load");
      }
      this.client.value = client;
      this.status.value = "creating";
      const map = client.driver.map.create(this.container, this.options.mapOptions);
      if (this.resources.isDisposed) {
        try {
          client.driver.map.destroy(map);
        } catch {
          /* ignore */
        }
        throw new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed during map create");
      }
      this.status.value = "initializing";
      // 初始化视野之前先放行订阅（`load` 就在 initializeView 的首次 centerAndZoom 之后派发）
      this.flushMapCreated({ client, map });
      if (this.options.initialView) {
        try {
          client.driver.map.initializeView(map, this.options.initialView);
        } catch (e) {
          // 视野初始化失败时 map 尚未写入 this.map.value，外层 catch 的「部分创建资源」
          // 分支拿不到它（见下方注释），因此在抛错前就地销毁，否则会泄漏一个已创建的
          // WebGL Map（#20 的能力守卫在 throw 策略下就会走到这里）。
          try {
            client.driver.map.destroy(map);
          } catch {
            /* ignore */
          }
          throw e instanceof BMapError
            ? e
            : new BMapError("BMAP_RESOURCE_CREATE_FAILED", `initializeView failed: ${(e as Error)?.message ?? e}`, { cause: e });
        }
      }
      // 失败后确认旧部分创建资源已销毁:此处 create 成功才赋值,异常路径无残留
      this.map.value = map;
      this.status.value = "ready";
      const ctx: MapReadyContext = { client, map };
      this.flushWaiters(ctx);
      return ctx;
    } catch (err) {
      if ((err as BMapError)?.code === "BMAP_RUNTIME_DISPOSED") {
        const cur = this.status.value as string;
        this.status.value =
          cur === "disposing" || cur === "disposed"
            ? (cur as MapRuntimeStatus)
            : "error";
        this.error.value = err;
        this.flushWaitersError(err);
        throw err;
      }
      const bmapErr =
        err instanceof BMapError
          ? err
          : new BMapError(
              "BMAP_RESOURCE_CREATE_FAILED",
              `MapRuntime failed: ${(err as Error)?.message ?? err}`,
              { cause: err },
            );
      // 部分创建的 map 若已挂载需销毁,避免泄漏
      const partialMap = this.map.value;
      const partialClient = this.client.value;
      if (partialMap && partialClient && this.status.value === "initializing") {
        try {
          partialClient.driver.map.destroy(partialMap);
        } catch {
          /* ignore */
        }
        this.map.value = null;
      }
      this.status.value = "error";
      this.error.value = bmapErr;
      this.flushWaitersError(bmapErr);
      throw bmapErr;
    }
  }

  async retry(): Promise<MapReadyContext> {
    if (this.status.value !== "error") {
      return this.mount();
    }
    this.error.value = null;
    return this.mount();
  }

  /** KeepAlive:暂停高频计算/动画/polling,不移除 Overlay 或销毁 Map */
  suspend(reason: unknown = "keep-alive"): void {
    if (this.status.value !== "ready") return;
    this.suspended = true;
    this.suspendReason = reason;
  }

  resume(reason: unknown = "keep-alive"): void {
    void reason;
    if (!this.suspended) return;
    this.suspended = false;
    this.suspendReason = null;
    this.checkResize();
  }

  get isSuspended(): boolean {
    return this.suspended;
  }

  checkResize(): void {
    const map = this.map.value;
    const client = this.client.value;
    if (!map || !client || this.status.value !== "ready") return;
    try {
      client.driver.map.checkResize?.(map);
    } catch {
      /* 忽略 resize 错误 */
    }
  }

  whenReady(signal?: AbortSignal): Promise<MapReadyContext> {
    if (this.status.value === "ready") {
      return Promise.resolve({ client: this.client.value!, map: this.map.value! });
    }
    if (this.status.value === "error") {
      return Promise.reject(this.error.value);
    }
    if (this.status.value === "disposed" || this.status.value === "disposing") {
      return Promise.reject(new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed"));
    }
    // 已 abort 的 signal 立即拒绝，不先加入 Set
    if (signal?.aborted) {
      return Promise.reject(createAbortError((signal as AbortSignal).reason));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      waiter.onAbort = () => {
        this.settleWaiter(waiter, { ok: false, error: createAbortError(signal?.reason) });
      };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
    });
  }

  private settleWaiter(
    waiter: Waiter,
    outcome: { ok: true; value: MapReadyContext } | { ok: false; error: unknown },
  ) {
    if (!this.waiters.has(waiter)) return;
    this.waiters.delete(waiter);
    if (waiter.signal && waiter.onAbort) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
    }
    if (outcome.ok) waiter.resolve(outcome.value);
    else waiter.reject(outcome.error);
  }

  private flushWaiters(ctx: MapReadyContext) {
    for (const w of [...this.waiters]) {
      this.settleWaiter(w, { ok: true, value: ctx });
    }
  }

  private flushWaitersError(err: unknown) {
    for (const w of [...this.waiters]) {
      this.settleWaiter(w, { ok: false, error: err });
    }
  }

  dispose() {
    if (this.status.value === "disposed" || this.status.value === "disposing") return;
    // 1. status = disposing
    this.status.value = "disposing";
    // 2. reject waiters
    this.flushWaitersError(new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed"));
    // 3. dispose child registries / child scopes (逆序:插件 → controls → layers → overlays)
    try {
      this.plugins.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.controls.dispose();
    } catch {
      /* ignore */
    }
    try {
      this.layers.dispose();
    } catch {
      /* ignore */
    }
    this.overlays.dispose();
    // 4. destroy map
    const currentClient = this.client.value;
    const currentMap = this.map.value;
    if (currentMap && currentClient) {
      try {
        currentClient.driver.map.destroy(currentMap);
      } catch (error) {
        // destroy 会把「订阅释放 / 动画取消 / SDK 销毁」里失败的项汇总抛出（#20 评审 P2）。
        // 这里不能静默吞掉：资源可能部分未释放，至少要让它可观测。
        logger.warn(
          `MapRuntime: map.destroy 未完全成功（部分资源可能未释放）: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    }
    // 5. clear handle
    this.map.value = null;
    this.client.value = null;
    // 6. dispose scheduler/event diagnostics
    this.scheduler.dispose();
    this.events.clear();
    // 7. dispose root scope
    this.mapCreatedCallbacks.clear();
    this.resources.dispose();
    // 8. status = disposed
    this.suspended = false;
    this.status.value = "disposed";
  }
}
