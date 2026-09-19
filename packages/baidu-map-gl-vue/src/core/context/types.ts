/**
 * MapContext 类型与 InjectionKey
 *
 * 父子依赖用 typed provide/inject 表达;ready 用状态 + Promise(可回放),
 * 而不是瞬时事件广播。
 *
 * MapReadyContext 持有 `client + mapHandle`，
 * 不再暴露 `api/map: unknown`。raw SDK 只从 `./advanced` 提供逃生口。
 */
import type { InjectionKey, ShallowRef } from "vue";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";
import type { OverlayRegistry } from "../overlays/OverlayRegistry";
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { MapEventBus } from "../events/MapEventBus";
import type { LayerRegistry } from "../layers/LayerRegistry";
import type { FrameScheduler } from "../scheduler/FrameScheduler";

export type MapStatus =
  | "idle"
  | "waiting-client"
  | "creating"
  | "initializing"
  | "ready"
  | "error"
  | "disposing"
  | "disposed";

/** 向后兼容:旧 "loading" 视为 "waiting-client" 别名 */
export type MapRuntimeStatus = MapStatus | "loading";

export interface MapReadyContext {
  readonly client: BMapClient;
  readonly map: MapHandle;
}

export interface MapRuntimeShape {
  readonly id: symbol;
  readonly status: ShallowRef<MapRuntimeStatus>;
  readonly client: ShallowRef<BMapClient | null>;
  readonly map: ShallowRef<MapHandle | null>;
  /** Spec 别名:handle === map */
  readonly handle?: ShallowRef<MapHandle | null>;
  readonly error: ShallowRef<unknown>;
  readonly resources: ResourceScope;
  /** Spec 别名:scope === resources */
  readonly scope?: ResourceScope;
  readonly events: MapEventBus;
  readonly scheduler: FrameScheduler;

  whenReady(signal?: AbortSignal): Promise<MapReadyContext>;
  /**
   * 注册「地图对象已创建」的回调（M4-EVENTS / #28）：时机是 `create()` 之后、首次
   * `initializeView()` **之前**，因此官方 `load` 这类初始化期事件也订阅得上。
   *
   * 已经在有地图时立即同步回调；返回注销用的 disposer。由 `MapRuntime` 实现；
   * 自定义 Context（如 client 适配器）可以不提供 —— 此时 `useMapEvent` 退化为「等到句柄可见再订阅」，
   * 代价是可能错过 `load`。
   */
  whenMapCreated?(callback: (ready: MapReadyContext) => void): () => void;
  /**
   * 承载这张地图的组件是否**已经开始卸载**（M4-EVENTS / #28）。
   *
   * `<BMap>` 在 `onBeforeUnmount` 里置位 —— 那一刻早于子树卸载（Vue 的顺序：父 `beforeUnmount` →
   * 父作用域 stop → 卸载子树 → 父 `unmounted`，地图销毁在最后一步）。
   * `useMapEvent` 用它区分两种「订阅方消失」：
   *
   * - **整图 teardown**：地图马上要被销毁 ⇒ 生命周期结束事件（`destroy`）的订阅要活到那一刻；
   * - **子组件自行卸载**（条件渲染 / Tab / 路由）：地图还在 ⇒ 订阅照常释放，不能残留。
   */
  isTearingDown?(): boolean;
  retry?(): Promise<MapReadyContext>;
  dispose(): void;
}

/** 供注入使用的 context 接口 */
export interface MapContext extends MapRuntimeShape {
  /**
   * 这张地图的覆盖物注册表（M5-SPEC-MARKER / #30）。
   *
   * 类型此前是 `unknown`：注册表虽然由 `MapRuntime` 创建并挂在这里，但**没有任何组件往里登记**
   * （`register` 只有测试消费者），因此没人需要它的类型。现在 `useOverlaySpec` 把每个覆盖物实例
   * 登记进来（registration 与实例 child scope 绑定），调用方可以据此按类型清点当前存活的覆盖物。
   */
  readonly overlays: OverlayRegistry;
  /**
   * 图层账本（M7-LAYERS / issue #40）。
   *
   * 由 `MapRuntime` 持有、随地图一起释放：`MapRuntime.dispose()` 在 `map.destroy()` **之前**
   * 调 `layers.disposeAll()`，把每个图层的 SDK 资源摘掉并释放它的 child scope。
   *
   * 它的读数是「这张地图**拥有**几个存活的图层实例」——**不是**「地图上此刻挂着几个」：
   * `visible=false` 的实例仍在账本里，只是被 `removeLayer` 临时摘下来了。要 attached count
   * 请读 SDK 侧（见 `LayerRegistry.size`）。
   *
   * 可选：自定义 Context（只实现 `MapRuntimeShape` 的适配器）可以不提供，图层组件会退化为
   * 组件自持的账本（见 `useLayerResource`）。
   */
  readonly layers?: LayerRegistry;
  readonly controls?: unknown;
  readonly plugins: unknown;
}

export const mapContextKey: InjectionKey<MapContext> = Symbol("baidu-map-gl-vue:map-context");
