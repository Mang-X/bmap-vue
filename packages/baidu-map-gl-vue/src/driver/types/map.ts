/**
 * MapDriver
 *
 * 只纳入组件和高频业务真正需要的能力；高级能力(动画/截图/室内)
 * 不直接膨胀 MapDriver，后续按需分子 facet。
 */
import type { MapHandle } from "./handles";
import type { Bounds, Pixel, Point, Size } from "./geometry";

export type MapType = "normal" | "satellite" | "earth";

export type MapInteraction =
  | "dragging"
  | "scroll-zoom"
  | "inertial-dragging"
  | "pinch-zoom"
  | "keyboard"
  | "double-click-zoom"
  | "continuous-zoom"
  | "resize-on-center"
  | "rotate"
  | "rotate-gestures"
  | "tilt"
  | "tilt-gestures";

export type MapStyleInput = { styleId: string } | Record<string, unknown>;

export interface InitialMapOptions {
  minZoom?: number;
  maxZoom?: number;
  backgroundColor?: number[];
  restrictCenter?: boolean;
  displayOptions?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapView {
  center: Point | string;
  zoom: number;
  heading?: number;
  tilt?: number;
}

export interface MapDriver {
  create(container: HTMLElement, options?: InitialMapOptions): MapHandle;
  /**
   * 销毁地图并释放 Driver 侧业务资源（订阅分组、动画引用）。
   *
   * 契约要求：
   * - **幂等**：对同一 Handle 重复调用不抛错、不重复释放；
   * - 销毁后对该 map 的其它命令应被拒绝（`BMAP_RESOURCE_DISPOSED`）。
   *
   * v4 实现（`driver/jsapi-v4/map.ts`）遵守以上两条；迁移期 `webgl-v1` 实现只保证幂等，
   * 未校验销毁后的命令（属待删除实现，见 ADR 2026-09-11-jsapi-v4-map-facet）。
   */
  destroy(map: MapHandle): void;

  initializeView(map: MapHandle, view: MapView): void;

  setCenter(map: MapHandle, center: Point | string): void;
  getCenter(map: MapHandle): Point;

  setZoom(map: MapHandle, zoom: number): void;
  getZoom(map: MapHandle): number;

  setHeading(map: MapHandle, heading: number): void;
  getHeading(map: MapHandle): number;

  setTilt(map: MapHandle, tilt: number): void;
  getTilt(map: MapHandle): number;

  getBounds(map: MapHandle): Bounds;
  getSize(map: MapHandle): Size;

  /** 经纬度 → 屏幕像素（v4 `pointToPixel`；不传 options，按当前地图状态换算） */
  pointToPixel(map: MapHandle, point: Point): Pixel;
  /** 屏幕像素 → 经纬度（v4 `pixelToPoint`；不传 options，按当前地图状态换算） */
  pixelToPoint(map: MapHandle, pixel: Pixel): Point;

  panTo(map: MapHandle, point: Point): void;
  panBy(map: MapHandle, pixel: Pixel): void;
  fitBounds(map: MapHandle, bounds: Bounds): void;
  /** 按若干点设置视口（getViewport/setViewport；缺失时退化为中心点 centerAndZoom） */
  setViewport(map: MapHandle, points: readonly Point[], options?: Record<string, unknown>): void;
  checkResize(map: MapHandle): void;

  setMapType(map: MapHandle, type: MapType): void;
  setMapStyle(map: MapHandle, style: MapStyleInput): void;
  setInteraction(map: MapHandle, name: MapInteraction, enabled: boolean): void;
  setTraffic(map: MapHandle, enabled: boolean): void;

  startViewAnimation(map: MapHandle, animation: unknown): void;
  stopViewAnimation(map: MapHandle): void;
  /**
   * 取消**这一个**视角动画实例（官方 `Map#cancelViewAnimation(viewAnimation)` 本来就是按实例的命令）。
   *
   * 与 `stopViewAnimation(map)` 的差别只在范围：本方法只处理该实例对应的那一条记录，同一张图上
   * 别的动画一律不碰。因此调用方可以反复重试自己发起的那一次取消，而不会停掉别人的动画。
   * SDK 取消失败时抛错并保留记录（下一次调用或 `destroy` 仍可重试），语义与 `stopViewAnimation` 一致。
   *
   * 返回值说的是**本库这一侧的交付状态**，不是 SDK 的终态（那条只能靠公开事件）：
   * `"deferred"` 也允许调用方据此保留重试入口。
   */
  cancelViewAnimation(map: MapHandle, animation: unknown): ViewAnimationCancelOutcome;
}

/** `MapDriver.cancelViewAnimation` 的交付状态，全部来自本库自己的记录，不含任何 SDK 回包推断。 */
export type ViewAnimationCancelOutcome =
  /** 已起播 ⇒ 本次就调用了 SDK 的取消并且没抛错；记录已结算。 */
  | "canceled"
  /** 还没起播 ⇒ 只登记了取消请求，真正取消要等启动安全窗口（**这条不是「已停止」**）。 */
  | "deferred"
  /** 本 Driver 已没有该实例的记录：早已结算 / 从未由它起播 ⇒ 没有可取消的东西。 */
  | "already-settled";
