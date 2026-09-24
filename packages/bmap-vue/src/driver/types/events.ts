/**
 * EventDriver 与归一化事件
 *
 * 组件不再把 raw SDK event 直接作为主参数；事件在 Driver 边界归一化。
 *
 * `DriverEvent` 是 v4 EventDriver 交付的项目 payload：**已知的语义字段**（坐标、像素、
 * 尺寸、缩放）被归一化为项目值对象，未覆盖的字段通过 `raw` 逃生口访问。
 * `MapMouseEvent` 是它在指针类事件上的特化（`point` 必有）。
 *
 * 注意：迁移期的 `webgl-v1` EventDriver 仍直接透传 raw event，因此
 * `EventDriver.on` 的默认泛型保持 `unknown`；v4 调用方按需写成
 * `events.on<DriverEvent>(map, "click", ...)`，不要假设引擎无关的 payload 形状。
 */
import type { SdkHandle } from "./handles";
import type { Pixel, Point, Size } from "./geometry";

export interface DriverEvent {
  /** 事件类型名（订阅时给定的名字优先，缺失时回退到 raw event 的 `type`）。 */
  type?: string;
  /** 地理坐标（经纬度）；非指针事件、或 raw 中坐标残缺时为 `undefined`。 */
  point?: Point;
  /** 画面像素坐标。 */
  pixel?: Pixel;
  /** 容器尺寸（`resize` / `beforeresize`）。 */
  size?: Size;
  /** 地图初始化缩放级别（`load`）。 */
  zoom?: number;
  /** 本次操作试图到达的缩放级别（`zoomexceeded`）。 */
  targetZoom?: number;
  /** 滚轮方向（`mousewheel`）：`true` = 向上滚（放大）。 */
  trend?: boolean;
  /**
   * 变化后的地图类型实例（`maptypechange`）。
   *
   * **原样透传**：它是 SDK 自己造的 `MapType` 实例（与全局 `BMAP_NORMAL_MAP` 同源），本库
   * 没有可验证的等价表示，因此不做归一化、也不假装成 `MapType` 字符串（那是另一回事：
   * `driver.map.setMapType()` 收的是本库的语义枚举）。
   */
  mapType?: unknown;
  /** 变化前的地图类型实例（`maptypechange`），同 `mapType` 原样透传。 */
  exMapType?: unknown;
  /** 变化后的缩放级别（`maptypechange`）；raw 缺失时由 Driver 读回 `getZoom()` 补齐。 */
  zoomLevel?: number;
  /** 原始 DOM 事件；部分合成事件没有对应 DOM 事件。 */
  domEvent?: Event;
  /**
   * raw escape hatch：SDK 原始事件对象，只在需要访问未归一化字段时使用。
   *
   * **一个例外**：`destroy` 是库在销毁边界**合成派发**的生命周期事件（官方在我们摘掉订阅之后才
   * 派发它），此时 `raw` 是**即将被销毁的 SDK Map 实例**，而不是 event object —— 形状与其它事件不同，
   * 需要访问时请先按事件名区分。
   */
  raw: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MapMouseEvent extends DriverEvent {
  point: Point;
}

/**
 * `load`（首次视野确定后派发一次）：`point` / `zoom` 必填。
 *
 * 依据：上游 `MapLoadEvent` 把两者声明为必填。**必填是可兑现的**——raw 里缺了（或引擎给了残缺值）
 * 时由 Driver 读回 `getCenter()` / `getZoom()` 补齐（`MAP_EVENT_READBACK_FIELDS`），
 * 而不是把字段留在 `undefined` 让类型说谎。
 */
export interface MapLoadEvent extends DriverEvent {
  point: Point;
  zoom: number;
}

/** `resize`（容器可视区域变化）：`size` 必填（raw 缺失时读回 `getSize()`）。 */
export interface MapResizeEvent extends DriverEvent {
  size: Size;
}

/**
 * `maptypechange`：`zoomLevel` 必填（raw 缺失时读回 `getZoom()`）。
 *
 * `mapType` / `exMapType` 仍是 `unknown`：它们是 SDK 自己造的实例，原样透传（见字段注释）。
 */
export interface MapTypeChangeEvent extends DriverEvent {
  zoomLevel: number;
}

/* ------------------------------------------------------------------ 覆盖物事件载荷
 *
 * M5-VECTORS / issue #31：覆盖物事件的公共载荷按**上游声明的必填程度**分三档，而不是
 * 「一律给一份形状相同的对象」。判据全部来自 `@baidumap/jsapi-v4-types@4.0.4` 的
 * `overlay/OverlayEvent.d.ts`：
 *
 * | 上游声明 | 本库载荷 | 归一化 |
 * | --- | --- | --- |
 * | `OverlayMouseEvent.point` **必填**（Marker / Label / 图形族 / **`CustomOverlayEventMap`**） | `OverlayPointerEvent`（`point` 必填） | raw 缺坐标时补 `{lng:0,lat:0}` |
 * | `GraphMouseOutEvent` = base & **Partial**`<OverlayMouseEvent>`（图形族 `mouseout`）、`GroundOverlayMouseEvent` 各字段可缺、**`ContextMenuEvent.point` 是 `Point \| null`** | `OverlayPartialPointerEvent`（`point` 可缺） | **不补**——「没有坐标」是上游允许的事实，补成 `(0,0)` 会把它伪装成一个真实坐标 |
 * | `OverlayBaseEvent` 与其余图形事件（`remove` / `lineupdate` / 编辑类） | `OverlayEventPayload` | 不做坐标兜底 |
 *
 * 「可为 `null`」与「可缺」在本库收成同一条路径：归一化的 `isPairLike` 闸门对 `null` 返回
 * `false`，字段因此是 `undefined`，调用方不必区分「SDK 给了 null」与「SDK 没给」。
 *
 * 哪些事件属于哪一档由 `core/overlays/overlayEventCatalog.ts` 的矩阵声明（单一事实源），
 * 由 `driver/jsapi-v4/events.ts` 在**订阅时**按目标句柄的种类翻译成归一化策略。
 * 这份契约与 `<BMap>` 的 map 事件共用同一套 `DriverEvent` 底座：字段名不因目标而变。
 */

/** 覆盖物事件的公共底座：Driver 归一化后的领域事件 + **恒有的 `type`**（订阅名）。 */
export interface OverlayEventPayload extends DriverEvent {
  type: string;
}

/**
 * 上游把 `point` 声明为必填的覆盖物指针事件（`OverlayMouseEvent`）。
 *
 * 「必填」是可兑现的：raw 里坐标残缺时由 Driver 补 `{lng:0,lat:0}`（与 map 事件的
 * `POINTER_EVENT_NAMES` 同口径），因此调用方不需要判空。
 */
export interface OverlayPointerEvent extends OverlayEventPayload {
  point: Point;
}

/**
 * 上游把 `point` 声明为**可缺**或**可为 `null`** 的覆盖物指针事件。
 *
 * 三类来源：图形族 `mouseout`（`GraphMouseOutEvent`）、GroundOverlay 家族
 * （`GroundOverlayMouseEvent` 各字段可缺）、以及 `ContextMenuEvent`（`point: Point | null`）。
 *
 * Driver **不做兜底**：图形族 `mouseout` 可能由内部命中切换合成（上游 `GraphMouseOutEvent`），
 * 菜单事件则可能在「没有触发位置」的路径上派发——这些情形下坐标本来就不存在。把「不存在」
 * 补成 `(0,0)` 等于凭空造一个坐标，调用方无法区分「真的在原点」与「这次没有坐标」。
 */
export interface OverlayPartialPointerEvent extends OverlayEventPayload {
  /** 仅当 SDK 真的给了坐标时存在（上游给的 `null` 也收成 `undefined`）。 */
  point?: Point;
}

export interface EventDriver {
  on<TEvent = unknown>(
    target: SdkHandle<string>,
    type: string,
    listener: (event: TEvent) => void,
  ): () => void;
}
