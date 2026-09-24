/**
 * 点坐标的读取与校验（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 数据组件（`MarkerList` / `MarkerCluster` / `BPointShapeLayer`）都从业务数据里读坐标，
 * 三处必须用**同一份**判定，否则「什么样的坐标算坏数据」会有三个版本。因此校验收在这里，
 * 组件只负责「跳过 + 报告」。
 *
 * ## 三条判定（都有明确理由，不是「顺手校验一下」）
 *
 * | 情形 | 判定 | 理由 |
 * | --- | --- | --- |
 * | `null` / `undefined` / 不是对象 / 两个字段都不是数 | `missing` | 调用方的 `getPosition` 没给可用的值 |
 * | 非有限数（`NaN` / `±Infinity` / 字符串 / 缺一个字段） | `not-finite` | 传给 SDK 会得到一张画不出来的图，或更糟：一个语法上合法但位置错误的覆盖物 |
 * | `|lng| > 180` 或 `|lat| > 90` | `out-of-range` | 越界值几乎一定是数据错误（列顺序颠倒、把像素当经纬度） |
 *
 * ## 刻意**不**做的判定
 *
 * - **(0, 0) 是合法坐标**（几内亚湾），**不**当作「缺失 / 未设置」的哨兵。把 0 当缺失是猜测：
 *   真实数据里确实可能出现 0，静默丢掉它比画出来更糟。需要这种语义的调用方应当在
 *   `getPosition` 里自己返回 `null`（那是显式的「这一项没有位置」）。
 * - **不做投影 / 坐标系转换**：`crs` 是图层构造项，转换由 SDK 按 `crs` 完成（本库不复制一份
 *   坐标系实现——那是第二份事实源）。
 * - **不判断「两个点是否重合」**：重合是业务语义，不是数据缺陷。
 */

/** 只读的点。**复用** `core/utils/geometry` 的 `PointLike`（同一个项目里不该有两个同形 PointLike）。 */
import type { PointLike } from "../utils/geometry";

/** 点形状在本模块与消费方之间复用（唯一实现仍在 `core/utils/geometry`）。 */
export type { PointLike };
export type PointProblemReason = "missing" | "not-finite" | "out-of-range";

export type PointReadResult =
  | { readonly ok: true; readonly point: PointLike }
  | { readonly ok: false; readonly reason: PointProblemReason; readonly detail: string };

/** 经纬度合法区间（含端点）。 */
export const LNG_RANGE = [-180, 180] as const;
export const LAT_RANGE = [-90, 90] as const;

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 读取并校验一个点。
 *
 * 返回判别联合（而不是 `Point | null`）：调用方需要知道**为什么**不合格才能给出可操作的
 * 诊断（「缺坐标」与「坐标越界」对数据源的处理方式完全不同）。
 */
export function readValidPoint(value: unknown): PointReadResult {
  if (value === null || typeof value !== "object") {
    return { ok: false, reason: "missing", detail: `期望 { lng, lat }，实际收到 ${describe(value)}` };
  }
  const rawLng = (value as { lng?: unknown }).lng;
  const rawLat = (value as { lat?: unknown }).lat;
  // 「两个坐标都没给」与「给了一个非法值」是两类不同的问题：前者是数据源漏了位置，
  // 后者是值本身有错（`null` / 字符串 / 缺一半）。诊断口径不同，处置方式也不同。
  if (rawLng === undefined && rawLat === undefined) {
    return { ok: false, reason: "missing", detail: "对象里没有 lng / lat" };
  }
  const lng = readNumber(rawLng);
  const lat = readNumber(rawLat);
  if (lng === null || lat === null) {
    return {
      ok: false,
      reason: "not-finite",
      detail: `lng / lat 必须是有限数，实际 lng=${describe(rawLng)} lat=${describe(rawLat)}`,
    };
  }
  if (lng < LNG_RANGE[0] || lng > LNG_RANGE[1] || lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
    return {
      ok: false,
      reason: "out-of-range",
      detail: `超出经纬度范围：lng=${lng} 应在 [${LNG_RANGE[0]}, ${LNG_RANGE[1]}]，lat=${lat} 应在 [${LAT_RANGE[0]}, ${LAT_RANGE[1]}]`,
    };
  }
  return { ok: true, point: { lng, lat } };
}

/** 人类可读的取值描述（诊断文案用；不打日志，只拼字符串）。 */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}

/**
 * 从**SDK 回传的载荷**里读一个坐标：拿到合法形状就给出 `{ lng, lat }`，否则 `null`。
 *
 * 与 `readValidPoint` 的区别是**用途而不是严格度**：那个函数校验**业务数据**（错了要跳过该项
 * 并告警，见 `itemScan`），这个只是把 SDK 事件里的 `latLng` / `point` 读成领域形状——
 * 读不到就如实给 `null`（调用方按「本次没有坐标」处理），不编造、也不告警（事件来自 SDK，
 * 不是用户输入）。
 *
 * 放在这里是因为它被两条路径共用：点图层内核（`useNativePointLayer`）与原生聚合引擎
 * （`nativeClusterEngine`）。共用的理由与 `layerDataIdentity` 一样：两份实现会在
 * 「什么样的值算坐标」上分叉。
 */
export function readPayloadPointLike(value: unknown): PointLike | null {
  if (value === null || typeof value !== "object") return null;
  const { lng, lat } = value as { lng?: unknown; lat?: unknown };
  return typeof lng === "number" && typeof lat === "number" ? { lng, lat } : null;
}

/** 从 SDK 回传的载荷里读一个像素坐标；形状不对时 `null`。 */
export function readPayloadPixel(value: unknown): { x: number; y: number } | null {
  if (value === null || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}
