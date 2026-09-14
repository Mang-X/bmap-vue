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
import type { ResourceScope } from "../lifecycle/ResourceScope";
import type { MapEventBus } from "../events/MapEventBus";
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
  retry?(): Promise<MapReadyContext>;
  dispose(): void;
}

/** 供注入使用的 context 接口 */
export interface MapContext extends MapRuntimeShape {
  readonly overlays: unknown;
  readonly layers?: unknown;
  readonly controls?: unknown;
  readonly plugins: unknown;
}

export const mapContextKey: InjectionKey<MapContext> = Symbol("baidu-map-gl-vue:map-context");
export const overlayContextKey: InjectionKey<unknown> = Symbol("baidu-map-gl-vue:overlay-context");
