/**
 * 服务结果归一化：SDK 返回的坐标统一为 Point。
 */
import type { Point } from "../types/geometry";

export function toPlainPoint(raw: { lng: number; lat: number }): Point {
  return { lng: raw.lng, lat: raw.lat };
}

export function toPlainPoints(raw: readonly { lng: number; lat: number }[]): Point[] {
  return raw.map(toPlainPoint);
}
