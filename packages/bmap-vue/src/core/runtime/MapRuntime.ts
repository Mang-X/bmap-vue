/**
 * MapRuntime v2
 *
 * 每个地图实例的运行时容器:
 * - 状态机 idle/waiting-client/creating/initializing/ready/error/disposing/disposed
 * - Runtime 只管理 Map,不再加载 Plugin(PluginRegistry 的 map-scope 实例属于 Runtime)
 * - mount 去重经 mountPromise;retry 清错重入;suspend/resume 供 KeepAlive
 * - **暂停按原因集合记账**（M4-HANDLE-UX / #29，见下）
 * - dispose 顺序:disposing → reject waiters → child registries/scopes → destroy map
 *   → clear handle → scheduler/events → root scope → disposed
 *
 * ## 暂停原因集合（issue #29）
 *
 * 旧实现是**一个布尔位**：任何一处 `suspend()` 都会让整个地图暂停，任何一处 `resume()`
 * 都会无条件恢复。这在「页面前后台」和「用户手动暂停」重叠时必然出错 —— 用户手动暂停后切走
 * 再切回页面，`document.visibilitychange` 那次 `resume()` 会把用户的手动暂停一起抹掉。
 *
 * 因此暂停状态是**原因集合**：`suspend(reason)` 加一个原因、`resume(reason)` 只减一个，
 * 只有集合变空才真正恢复（并补偿一次 `checkResize()`）。`disposed` 是**终态原因**：它
 * **不可被 `resume()` 摘除**（`resume` 里显式短路），于是「卸载后不再调用 SDK」不再依赖
 * `status` 守卫这一处巧合，也不依赖「调用方记得别 resume」。
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
import { createInfoWindowManager, type InfoWindowManager } from "../overlays/InfoWindowManager";
import { createLayerRegistry, type LayerRegistry } from "../layers/LayerRegistry";
import { createPluginRegistry, type PluginRegistry } from "../plugins/PluginRegistry";
import type { BMapClientContext } from "../context/client";
import type { MapReadyContext, MapStatus } from "../context/types";
import { MAP_SUSPEND_REASONS, type MapSuspendReason } from "./suspension";

export type { MapSuspendReason };

/** 合帧调度用的 key（同一帧内多次容器尺寸变化只下发一次 `checkResize`）。 */
const RESIZE_TASK_KEY: unique symbol = Symbol("map-runtime.resize");

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
  /**
   * 建图前的**最后一个等待点**（可选）：在 `driver.map.create()` 之前 `await` 它。
   *
   * `<Map>` 用它把「容器当前是否有可用尺寸」这条**异步门禁**放到这里 —— 只「在启动之前判一次」
   * 会有 TOCTOU 窗口：`doMount()` 中途要 `await` SDK 加载，慢网络下加载完成时容器可能已经被
   * 收起成 0×0，于是仍会在零尺寸容器上建出一张 0×0 的画布（#29 三轮复审 P1）。
   *
   * 约定：实现应当「等到可以建图」再 resolve（例如等到容器重新可用）；抛错则按建图失败处理。
   */
  beforeCreateMap?: () => Promise<void> | void;
  /** 新规范:经 ClientContext 加载 */
  clientContext: BMapClientContext;
  /** 创建 map 的容器（mount 时回填） */
  container: HTMLElement;
  initialView?: MapView;
  mapOptions?: InitialMapOptions;
}

export type KeepAliveBehavior = "suspend" | "dispose";

export class MapRuntime {
  readonly id = Symbol("map-runtime");
  readonly status: ShallowRef<MapStatus> = shallowRef("idle");
  readonly client: ShallowRef<BMapClient | null> = shallowRef(null);
  readonly map: ShallowRef<MapHandle | null> = shallowRef(null);
  readonly error: ShallowRef<unknown> = shallowRef(null);
  /** Spec 别名:handle === map */
  readonly handle: ShallowRef<MapHandle | null>;
  readonly resources: ResourceScope;
  readonly events: MapEventBus = createMapEventBus();
  readonly scheduler: FrameScheduler = createFrameScheduler();
  readonly overlays: OverlayRegistry = createOverlayRegistry();
  /**
   * 图层账本（M7-LAYERS / #40）：`dispose()` 在 `map.destroy()` 之前把每个图层摘掉。
   *
   * 与 `overlays` / `controls` 的 `OverlayRegistry` 不同（它们只释放 owner scope，摘除由
   * 组件自己负责）——图层的「先摘子资源、再销毁 Map」是一条跨 Facet 不变式（见
   * `core/layers/LayerRegistry.ts` 的文件头）。
   */
  readonly layers: LayerRegistry = createLayerRegistry();
  readonly controls: OverlayRegistry = createOverlayRegistry();
  /** 气泡账本（M5-INFOWINDOW / #32）：每张地图一份，用于气泡之间「被顶掉」的通知。 */
  readonly infoWindows: InfoWindowManager = createInfoWindowManager();
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
  /**
   * 当前生效的暂停原因（M4-HANDLE-UX / #29）。
   *
   * 用 shallow ref 存**数组快照**而不是可变 Set：`<Map>` 的状态插槽要按它渲染，
   * 而 `suspend` / `resume` 本来就该逐次替换（同 `status` / `error` 的写法）。
   * 刻意**不**按运行时状态短路：地图还没 ready 时「页面前后台」这类环境事实已经成立，
   * 丢掉它会让首次恢复的补偿动作（`checkResize`）与后续优先级判断都失去依据；
   * 真正的效果（下发 SDK 命令 / 提交合帧任务）由 `checkResize()` 与调度器的暂停承担。
   */
  readonly suspension: ShallowRef<readonly MapSuspendReason[]> = shallowRef<
    readonly MapSuspendReason[]
  >([]);

  /** 可供外部在 setup 后回填的容器引用 */
  container: HTMLElement;

  constructor(options: MapRuntimeOptions) {
    if (!options.clientContext) {
      throw new BMapError(
        "BMAP_INVALID_ARGUMENT",
        "MapRuntime requires clientContext",
      );
    }
    this.options = options;
    this.container = options.container;
    this.resources = new ResourceScope({ label: "map-runtime" });
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
      const client = await this.options.clientContext.load(this.resources.signal);
      if (this.resources.isDisposed) {
        throw new BMapError("BMAP_RUNTIME_DISPOSED", "MapRuntime disposed during SDK load");
      }
      this.client.value = client;
      this.status.value = "creating";
      // 最后一个异步边界：把「等容器可用」这类门禁放在 create() **之前**（#29 三轮复审 P1）。
      // 它必须在**这个位置**，而不是启动之前 —— 见 `beforeCreateMap` 的文档。
      await this.options.beforeCreateMap?.();
      if (this.resources.isDisposed) {
        throw new BMapError(
          "BMAP_RUNTIME_DISPOSED",
          "MapRuntime disposed while waiting for the map container",
        );
      }
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
            ? (cur as MapStatus)
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

  /**
   * 暂停高频计算 / 动画 / polling，不移除 Overlay 或销毁 Map。
   *
   * 幂等：同一个原因重复 `suspend()` 只记一次（因此重复调用不会让 `resume()` 需要调用两次）。
   *
   * `disposed` 是**终态原因**，只能由 `dispose()` 添加。`MAP_SUSPEND_REASONS` 是公开导出，
   * 若 `suspend("disposed")` 也生效，调用方就能把一张**正常运行**的地图永久锁死
   * （`resume("disposed")` 按设计是 no-op）—— 这里显式拒绝并告警（#29 评审 P2）。
   */
  suspend(reason: MapSuspendReason = MAP_SUSPEND_REASONS.keepAlive): void {
    if (reason === MAP_SUSPEND_REASONS.disposed) {
      logger.warn(
        'MapRuntime.suspend("disposed") 被忽略：disposed 是终态原因，只能由 dispose() 添加',
      );
      return;
    }
    if (this.suspension.value.includes(reason)) return;
    this.suspension.value = [...this.suspension.value, reason];
    // 暂停期间不排帧、也不执行已排的帧（`FrameScheduler.pause()` 保留各 key 的最后一次任务）
    this.scheduler.pause();
  }

  /**
   * 解除**一个**暂停原因。
   *
   * 只有集合变空才真正恢复：那时才提交暂停期间合并下来的帧任务，并**恰好补偿一次**
   * `checkResize()` —— 后台 / 视口外发生的容器尺寸变化没有下发过 SDK 命令，回到前台必须补上。
   * 这也正是「页面恢复可见只能移除 `document` 原因」的落点（issue 评论的硬要求）。
   *
   * 两个细节都是门禁要求的：
   * - 恢复前先**撤掉队列里那份尺寸任务**（`RESIZE_TASK_KEY`）：它是暂停之前排进来、还没提交的，
   *   不撤就会出现「残留任务 + 补偿」两条命令（本轮评审实测）；
   * - `disposed` 是**终态**，不能被 `resume()` 摘掉 —— 否则「卸载后不再调 SDK」这条不变量
   *   会退化成「只要有人记得别 resume」。
   */
  resume(reason: MapSuspendReason = MAP_SUSPEND_REASONS.keepAlive): void {
    if (reason === MAP_SUSPEND_REASONS.disposed) return;
    if (!this.suspension.value.includes(reason)) return;
    const next = this.suspension.value.filter((current) => current !== reason);
    this.suspension.value = next;
    if (next.length > 0) return;
    this.scheduler.cancel(RESIZE_TASK_KEY);
    this.scheduler.resume();
    this.checkResize();
  }

  /** 当前是否处于暂停（任一原因存在即为真）。 */
  get isSuspended(): boolean {
    return this.suspension.value.length > 0;
  }

  /** 当前生效的暂停原因（诊断 / 状态插槽读数；返回的就是那份只读快照）。 */
  suspendReasons(): readonly MapSuspendReason[] {
    return this.suspension.value;
  }

  /**
   * 暂停期间 `checkResize()` 是 no-op：容器在后台 / 视口外变化时下发 SDK 命令既是浪费、
   * 也可能在 WebGL 上下文被浏览器回收后抛错。补偿路径是「最后一个原因被移除时的一次
   * `checkResize()`」（见 `resume`），因此不会丢掉最终的尺寸。
   */
  checkResize(): void {
    if (this.isSuspended) return;
    const map = this.map.value;
    const client = this.client.value;
    if (!map || !client || this.status.value !== "ready") return;
    try {
      client.driver.map.checkResize?.(map);
    } catch {
      /* 忽略 resize 错误 */
    }
  }

  /**
   * 合帧地请求一次尺寸校正（容器尺寸变化 → 一帧最多下发一次 `checkResize`）。
   *
   * 暂停期间**不排帧**：`FrameScheduler.pause()` 本身会拦掉提交，但连帧都不排才能满足
   * 「暂停时不占 RAF」这条门禁（`manual-frames` 的 `pending()` 归零）。
   */
  requestResize(): void {
    if (this.isSuspended) return;
    if (this.status.value !== "ready" || this.map.value === null) return;
    this.scheduler.schedule(RESIZE_TASK_KEY, () => this.checkResize());
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
      this.layers.disposeAll();
    } catch {
      /* ignore */
    }
    this.overlays.dispose();
    // 气泡账本先清记账：真正的关闭由每个 InfoWindow 自己的释放路径完成（组件先于 Map 卸载）
    this.infoWindows.dispose();
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
    //    `disposed` 是**终态原因**（#29）：此后任何 `resume(reason)` 都不会让集合变空，
    //    于是「卸载之后不再调用 SDK」由暂停集合本身保证，而不是靠 `status` 守卫的巧合。
    this.suspension.value = [...this.suspension.value, MAP_SUSPEND_REASONS.disposed];
    this.status.value = "disposed";
  }
}
