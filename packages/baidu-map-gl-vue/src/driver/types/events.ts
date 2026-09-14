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
  /** 原始 DOM 事件；部分合成事件没有对应 DOM 事件。 */
  domEvent?: Event;
  /** raw escape hatch：SDK 原始事件对象，只在需要访问未归一化字段时使用。 */
  raw: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface MapMouseEvent extends DriverEvent {
  point: Point;
}

export interface EventDriver {
  on<TEvent = unknown>(
    target: SdkHandle<string>,
    type: string,
    listener: (event: TEvent) => void,
  ): () => void;
}
