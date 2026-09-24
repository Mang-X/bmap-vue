/**
 * Geometry 值对象与 GeometryDriver
 *
 * 对外统一使用纯数据(Point/Pixel/Size/Bounds)，与 SDK 构造器
 * (BMapGL.Point/Size/Bounds) 解耦。Driver 负责双向转换。
 */

export interface Point {
  lng: number;
  lat: number;
}

/** 兼容输入：Point 或 [lng, lat] 元组；所有输出统一返回 Point */
export type PointInput = Point | readonly [lng: number, lat: number];

export interface Pixel {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Bounds {
  southwest: Point;
  northeast: Point;
}

export interface GeometryDriver {
  toRawPoint(point: Point): unknown;
  fromRawPoint(raw: unknown): Point;

  toRawPoints(points: readonly Point[]): unknown[];
  fromRawPoints(raws: readonly unknown[]): Point[];

  toRawPixel(pixel: Pixel): unknown;
  fromRawPixel(raw: unknown): Pixel;

  toRawSize(size: Size): unknown;
  fromRawSize(raw: unknown): Size;

  toRawBounds(bounds: Bounds): unknown;
  fromRawBounds(raw: unknown): Bounds;
}
