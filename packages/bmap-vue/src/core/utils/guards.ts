/**
 * v3 类型守卫工具
 *
 * 类型化版本(不含 any),替代 v2 utils/is.ts 的宽松实现。
 */

export const isClient = typeof window !== 'undefined'

/** 判断值是否已定义(非 undefined),类型收窄 */
export function isDef<T = unknown>(val?: T): val is T {
  return typeof val !== 'undefined'
}

/** 判断是否非空(非 null/undefined) */
export function isObjDef<T = unknown>(val: T | null | undefined): val is T {
  return val !== null && typeof val !== 'undefined'
}

export function isString(value: unknown): value is string {
  return Object.prototype.toString.call(value) === '[object String]'
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** 判断是否为合法坐标(含 lng/lat 数字) */
export function isPointLike(value: unknown): value is { lng: number; lat: number } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { lng?: unknown; lat?: unknown }
  return typeof v.lng === 'number' && typeof v.lat === 'number'
}
