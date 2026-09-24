/**
 * v3 几何/坐标工具
 *
 * 与 v2 utils 的区别:
 * - 不依赖全局 BMapGL(api 通过参数注入,遵守「SDK 只能从 runtime/context 获取」)
 * - 仅为 SDK 对象转换的最小封装,公开形状为组件库抽象(PointLike/SizeLike)
 */

/** 组件库级点抽象(与 SDK Point 解耦,不暴露 BMapGL 私有类型) */
export interface PointLike {
  lng: number
  lat: number
}

/** 组件库级尺寸抽象 */
export interface SizeLike {
  width: number
  height: number
}

export interface XYLike {
  x: number
  y: number
}

type PointCtor = new (lng: number, lat: number) => unknown
type SizeCtor = new (w: number, h: number) => unknown

/** 批量点 → SDK Point 实例(api 参数化,无全局 BMapGL) */
export function toSdkPoints(api: unknown, path: PointLike[]): unknown[] {
  const Point = (api as { Point: PointCtor }).Point
  return path.map(({ lng, lat }) => new Point(lng, lat))
}

/** 单点 → SDK Point 实例 */
export function toSdkPoint(api: unknown, p: PointLike): unknown {
  const Point = (api as { Point: PointCtor }).Point
  return new Point(p.lng, p.lat)
}

/** width/height → SDK Size 实例 */
export function toSdkSize(api: unknown, size: SizeLike): unknown {
  const Size = (api as { Size: SizeCtor }).Size
  return new Size(size.width, size.height)
}

/** x/y → SDK Size 实例(anchor/offset 用) */
export function toSdkXYSize(api: unknown, xy: XYLike): unknown {
  const Size = (api as { Size: SizeCtor }).Size
  return new Size(xy.x, xy.y)
}
