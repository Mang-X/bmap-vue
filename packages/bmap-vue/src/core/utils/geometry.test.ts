/**
 * 工具函数单测
 */
import { describe, it, expect } from 'vitest'
import { toSdkPoints, toSdkPoint, toSdkSize, toSdkXYSize } from './geometry'
import { isDef, isObjDef, isString, isArray, isPointLike } from './guards'

describe('geometry utils', () => {
  const api = {
    Point: class {
      constructor(public lng: number, public lat: number) {}
    },
    Size: class {
      constructor(public w: number, public h: number) {}
    },
  }

  it('toSdkPoints converts path to SDK Point instances', () => {
    const pts = toSdkPoints(api, [{ lng: 1, lat: 2 }, { lng: 3, lat: 4 }]) as {
      lng: number
      lat: number
    }[]
    expect(pts.length).toBe(2)
    expect(pts[0]!.lng).toBe(1)
    expect(pts[1]!.lat).toBe(4)
  })

  it('toSdkPoint converts single point', () => {
    const pt = toSdkPoint(api, { lng: 116.4, lat: 39.9 }) as { lng: number; lat: number }
    expect(pt.lng).toBe(116.4)
  })

  it('toSdkSize / toSdkXYSize use correct constructors', () => {
    const s = toSdkSize(api, { width: 10, height: 20 }) as { w: number; h: number }
    expect(s.w).toBe(10)
    const xy = toSdkXYSize(api, { x: 3, y: 4 }) as { w: number; h: number }
    expect(xy.w).toBe(3)
    expect(xy.h).toBe(4)
  })
})

describe('guards', () => {
  it('isDef/isObjDef', () => {
    expect(isDef('x')).toBe(true)
    expect(isDef(undefined)).toBe(false)
    expect(isObjDef(null)).toBe(false)
    expect(isObjDef(0)).toBe(true)
  })

  it('isString/isArray', () => {
    expect(isString('a')).toBe(true)
    expect(isString(1)).toBe(false)
    expect(isArray([1])).toBe(true)
    expect(isArray('a')).toBe(false)
  })

  it('isPointLike', () => {
    expect(isPointLike({ lng: 1, lat: 2 })).toBe(true)
    expect(isPointLike({ lng: 'a', lat: 2 })).toBe(false)
    expect(isPointLike(null)).toBe(false)
  })
})
