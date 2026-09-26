/**
 * MapDriver
 *
 * 只纳入组件和高频业务真正需要的能力；高级能力(动画/截图/室内)
 * 不直接膨胀 MapDriver，后续按需分子 facet。
 */
import type { MapHandle } from "./handles";
import type { Bounds, Pixel, Point, Size } from "./geometry";
import type { ViewportOptions } from "./services";

/**
 * 语义地图类型。
 *
 * `hybrid` 对应官方 `BMAP_HYBRID_MAP`（卫星与路网混合）；它在 4.0 之前**没有**进入这张表，
 * 于是 `<Map map-type>` 传混合图时被静默画成普通图（#165 Class 1 修掉的静默错值）。
 *
 * ⚠️ 官方 `MapTypeId` 还声明了 `BMAP_NONE_MAP`（无底图模式），但真实 4.0 运行时的
 * `BMap.MapTypeId` 上**没有**对应成员（见 `driver/jsapi-v4/map.ts` 的
 * `MAP_TYPE_CONSTANT_CANDIDATES` 与其注释）。本库**不**给它一个语义值——那样等于编一个上游
 * 没有的表示。它因此走 `resolveMapTypeConstant` 的「缺常量」分支，**显式抛错**而不是回退。
 */
export type MapType = "normal" | "satellite" | "hybrid" | "earth";

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

/**
 * 最佳视野（官方 `BMap.Viewport` 的领域投影，`core/Viewport.d.ts`）。
 *
 * 官方就两个成员（`center` / `zoom`），因此这里**逐字段投影**成纯数据：官方返回的
 * `center` 是 `BMap.Point` 实例，直接把它递出去就等于把 raw SDK 对象漏进领域层
 * （与 `getCenter()` / `getBounds()` 同一口径）。
 */
export interface Viewport {
  /** 视野中心点（领域 `Point`） */
  center: Point;
  /** 视野级别 */
  zoom: number;
}

/**
 * `flyTo` 的官方选项（`core/Map.d.ts:634` 的第三个参数）。
 *
 * 官方只声明 `noAnimation` 与 `callback` 两个成员，本库**不接收**声明之外的键
 * （#165 §3.8「接收后忽略」是假支持）。注意它与 `ViewportOptions.enableAnimation`
 * 是**两个不同形状**：后者管视野调整，前者管飞行定位，不要互相套用。
 */
export interface FlyToOptions {
  /** 是否禁用动画效果 */
  noAnimation?: boolean;
  /** 飞行结束后的回调（按引用原样透传，Driver 不包装） */
  callback?: () => void;
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
  setViewport(map: MapHandle, points: readonly Point[], options?: ViewportOptions): void;
  /**
   * 读出「若把这些点/范围装进视野，应该是什么中心与级别」（官方 `Map#getViewport`）。
   *
   * **只读，不施加**：官方明确「仅返回视野信息，不会将新的中心点和级别做用到当前地图上」，
   * 因此它与 `setViewport` 是一对读写，不是一对命令的两种模式。
   *
   * `view` 对齐官方的两个分支：点数组（`Array<Point>`）或 `Bounds`。返回领域 `Viewport`
   * （`center` 是纯数据 `Point`，不是 `BMap.Point`）。
   */
  getViewport(
    map: MapHandle,
    view: readonly Point[] | Bounds,
    options?: ViewportOptions,
  ): Viewport;
  /**
   * 平滑飞行到目标中心与级别（官方 `Map#flyTo`）。
   *
   * 与 `panTo` 是**两个不同的成员**：官方 `flyTo` 带一段飞行动画，`panTo` 是瞬移。
   * 早期 Capability Catalog 的 `map.fly-to` 条目探测的是 `panTo`（张冠李戴），已修正。
   */
  flyTo(map: MapHandle, center: Point, zoom: number, options?: FlyToOptions): void;
  /**
   * 取地图当前画布的截图数据 URL（官方 `Map#getScreenshot`）。
   *
   * ⚠️ **官方声明的两条限制**（`core/Map.d.ts:1022`，本库不隐瞒）：
   * - **地球模式不支持**（`map-type="earth"` 下没有可用结果）；
   * - 建图时**必须**带 `preserveDrawingBuffer: true`，否则返回**全黑图**。
   *   该键不在官方 `MapOptions` 声明里，因此本库**不**默认开启（默认开启会给每张地图
   *   常驻一块额外画布内存），而是在 `InitialMapOptions` 的索引签名上原样透传给 SDK。
   *
   * 缺成员 / 返回非字符串一律抛错 —— 静默返回一张黑图比报错更难排查。
   */
  getScreenshot(map: MapHandle): string;
  checkResize(map: MapHandle): void;

  setMapType(map: MapHandle, type: MapType): void;
  setMapStyle(map: MapHandle, style: MapStyleInput): void;
  setInteraction(map: MapHandle, name: MapInteraction, enabled: boolean): void;
  setTraffic(map: MapHandle, enabled: boolean): void;

  startViewAnimation(map: MapHandle, animation: unknown): void;
  /**
   * 取消**这一个**视角动画实例（官方 `Map#cancelViewAnimation(viewAnimation)` 本来就是按实例的命令）。
   *
   * 这是本 Facet **唯一**的取消入口：4.0 没有「停掉这张地图上的视角动画」这种命令，取消必须先有
   * 实例。于是「重试自己发起的这一次取消」与「不牵连同一张图上别人的动画」可以同时成立 ——
   * 整图语义做不到这一点（#105 评审第三、六轮各打中过一次），因此审计（#104）没有保留整图命令。
   *
   * SDK 取消失败时抛错并保留记录 ⇒ 下一次调用或 `destroy` 仍可重试。
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
