/**
 * 事件归一化：把 raw SDK 事件转为组件库事件形状。
 * 不修改原始 SDK event 对象。
 *
 * 两个入口：
 * - `normalizeMapMouseEvent`：指针类事件 → `MapMouseEvent`（`point` 必有，历史行为保留）；
 * - `normalizeDriverEvent`：任意 map/overlay/layer 事件 → `DriverEvent`（缺失字段留空 +
 *   `raw` 逃生口），供 v4 EventDriver 在派发前统一调用。
 *
 * 容错口径：事件链路由 SDK 驱动，归一化**不允许**把异常抛回 SDK 的 dispatch——那会中断
 * 同一次事件里其它监听器，甚至影响整张地图。因此这里用 `isPairLike` 作为**唯一**前置闸门：
 * 只有具备有限 `lng/lat`（或 `x/y` / `width/height`）形状的 raw 值才会交给 `GeometryDriver`，
 * 而驱动只拒绝非有限数 / 缺分量，所以调用点不会抛错——既不依赖 try/catch，也不吞掉真正的
 * 实现缺陷。raw 里坐标残缺或类型不对时字段缺失，需要原始数据走 `raw`。
 */
import type { GeometryDriver } from "../types/geometry";
import type { DriverEvent, MapMouseEvent } from "../types/events";
import type { Pixel, Point, Size } from "../types/geometry";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * raw 是否「看起来」是一个二维数值对象。
 *
 * 这是事件路径的归一化闸门：形状不对就直接跳过 `GeometryDriver`，避免把
 * 「raw 事件字段残缺」升级成「异常打断 SDK 事件派发」。
 */
function isPairLike(value: unknown, keys: readonly [string, string]): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return isFiniteNumber(record[keys[0]]) && isFiniteNumber(record[keys[1]]);
}

function convertPoint(value: unknown, geometry: GeometryDriver): Point | undefined {
  return isPairLike(value, ["lng", "lat"]) ? geometry.fromRawPoint(value) : undefined;
}

function convertPixel(value: unknown, geometry: GeometryDriver): Pixel | undefined {
  return isPairLike(value, ["x", "y"]) ? geometry.fromRawPixel(value) : undefined;
}

function convertSize(value: unknown, geometry: GeometryDriver): Size | undefined {
  return isPairLike(value, ["width", "height"]) ? geometry.fromRawSize(value) : undefined;
}

interface EventBase {
  raw: unknown;
  domEvent?: Event;
  preventDefault(): void;
  stopPropagation(): void;
}

/** 共用基座：raw + DOM 事件代理（不修改原始 event 对象）。 */
function eventBase(raw: unknown): EventBase {
  const domEvent = (raw as { domEvent?: Event } | null | undefined)?.domEvent;
  return {
    raw,
    domEvent,
    preventDefault: () => domEvent?.preventDefault?.(),
    stopPropagation: () => domEvent?.stopPropagation?.(),
  };
}

/**
 * 事件坐标的**统一取值顺序**：`point` → `latLng` → 顶层 `lng` / `lat`。
 *
 * 两个入口（`normalizeMapMouseEvent` 与 `normalizeDriverEvent`）必须给出同一个答案，否则同一份 raw
 * 经不同路径会得到不同坐标（#28 自审抓到的实际不一致：前者认顶层 `lng/lat`、后者只认 `latLng`，
 * 于是 `<Map @click>` 换到新路径后，raw 只有顶层坐标时会把真实点变成兜底的 `{lng:0,lat:0}`）。
 */
function readEventPoint(shape: Record<string, unknown>, geometry: GeometryDriver): Point | undefined {
  return (
    convertPoint(shape.point, geometry) ??
    convertPoint(shape.latLng, geometry) ??
    (isFiniteNumber(shape.lng) && isFiniteNumber(shape.lat)
      ? geometry.fromRawPoint({ lng: shape.lng, lat: shape.lat })
      : undefined)
  );
}

export function normalizeMapMouseEvent(
  raw: unknown,
  geometry: GeometryDriver,
): MapMouseEvent {
  const shape = (raw ?? {}) as Record<string, unknown>;
  // `MapMouseEvent.point` 是必填：读不到真实坐标时仍给 `{lng:0,lat:0}`（历史契约，见文件头注释）
  const point: Point = readEventPoint(shape, geometry) ?? geometry.fromRawPoint({ lng: 0, lat: 0 });
  return {
    ...eventBase(raw),
    point,
    pixel: convertPixel(shape.pixel, geometry),
  };
}

/**
 * 指针 / 拖拽类事件名（SDK 拼写）：这些事件上游**声明的载荷里 `point` 是必填的**，
 * 因此归一化必须给出 `point`——raw 里坐标残缺时补 `{lng:0,lat:0}`。
 *
 * 这条兜底不是新发明：`normalizeMapMouseEvent`（公开 helper，`<Map @click>` 的既有契约）
 * 一直这么做。放在这里是为了让公开的 `MapEventMap` 里 `click` 等条目的 `point: Point`（必填）
 * 成为**可验证的事实**而不是类型谎话——raw 真带了坐标时用的就是那个坐标。
 *
 * 导出它是为了让事件 Catalog 的 `pointer` 标记与这份清单**逐项比对**（两处必须一致，
 * 否则「哪些事件必有 point」就有了两个事实源）。
 */
export const POINTER_EVENT_NAMES: readonly string[] = Object.freeze([
  "click",
  "dblclick",
  "rightclick",
  "rightdblclick",
  "mousemove",
  "mousedown",
  "mouseup",
  "mouseover",
  "mouseout",
  "touchstart",
  "touchmove",
  "touchend",
  "mousewheel",
  "dragstart",
  "dragging",
  "dragend",
]);

const POINTER_EVENT_NAME_SET: ReadonlySet<string> = new Set(POINTER_EVENT_NAMES);

/**
 * 任意 map / overlay / layer 事件的归一化。
 *
 * `point` 走 `readEventPoint` 的统一顺序；指针 / 拖拽类事件在 raw 完全没有坐标时补
 * `{lng:0,lat:0}`（与 `normalizeMapMouseEvent` 同口径，见 `POINTER_EVENT_NAMES`）。
 *
 * `options.pointerFallback = "never"` 关掉这次兜底：**覆盖物**里上游把坐标声明为可缺的事件
 * （图形族 `mouseout` 的 `GraphMouseOutEvent`、GroundOverlay 家族）用它——那类事件「没有坐标」
 * 是上游允许的事实，补成 `(0,0)` 会把它伪装成一个真实坐标（M5-VECTORS / #31）。
 * 判据来自事件矩阵（`core/overlays/overlayEventCatalog.ts`），不是调用点的临时判断。
 */
export function normalizeDriverEvent(
  type: string,
  raw: unknown,
  geometry: GeometryDriver,
  options?: { readonly pointerFallback?: "default" | "never" },
): DriverEvent {
  const shape = (raw ?? {}) as Record<string, unknown>;
  const rawType = typeof shape.type === "string" && shape.type ? shape.type : undefined;
  const fallback =
    options?.pointerFallback === "never" ? undefined : fallbackPoint(type, geometry);
  return {
    ...eventBase(raw),
    type: type || rawType,
    point: readEventPoint(shape, geometry) ?? fallback,
    pixel: convertPixel(shape.pixel, geometry),
    size: convertSize(shape.size, geometry),
    zoom: isFiniteNumber(shape.zoom) ? shape.zoom : undefined,
    targetZoom: isFiniteNumber(shape.targetZoom) ? shape.targetZoom : undefined,
    trend: typeof shape.trend === "boolean" ? shape.trend : undefined,
    mapType: shape.mapType,
    exMapType: shape.exMapType,
  };
}

/** 指针类事件在 raw 缺坐标时的兜底（`{lng:0,lat:0}`）；其余事件保持 `undefined`。 */
function fallbackPoint(type: string, geometry: GeometryDriver): Point | undefined {
  if (!POINTER_EVENT_NAME_SET.has(type)) return undefined;
  return geometry.fromRawPoint({ lng: 0, lat: 0 });
}
