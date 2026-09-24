/**
 * 几何归一化工具：对外统一 Point 形状
 */
import type { Point, PointInput } from "../types/geometry";

export function toPoint(input: PointInput): Point {
  if (Array.isArray(input)) return { lng: input[0], lat: input[1] };
  const p = input as Point;
  return { lng: p.lng, lat: p.lat };
}

export function isPointLike(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.lng === "number" && typeof v.lat === "number";
}
