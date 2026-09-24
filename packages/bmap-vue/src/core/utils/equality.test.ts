/**
 * 视野相等判定单测（M4-STATE / issue #27）
 *
 * 这些函数是「受控写入」与「SDK 事件回写」之间唯一的回环抑制手段，因此断言的重点
 * 不是「差不多相等」，而是**两种方向的误判各自的代价**：
 *
 * - 判得**松**（该不等却相等）→ 用户的合法操作被忽略（地图不动）；
 * - 判得**紧**（该相等却不等）→ 每次回写都产生一条新命令，形成往返抖动。
 */
import { describe, it, expect } from 'vitest'
import {
  ANGLE_EPSILON,
  NUMBER_EPSILON,
  POINT_EPSILON,
  anglesEqual,
  centerEquals,
  centerKey,
  normalizeAngle,
  numbersEqual,
  pointEquals,
} from './equality'

describe('numbersEqual', () => {
  it('严格相等的数值直接判等（含 0 / -0 / Infinity 自身）', () => {
    expect(numbersEqual(14, 14)).toBe(true)
    expect(numbersEqual(0, 0)).toBe(true)
    expect(numbersEqual(-0, 0)).toBe(true)
    expect(numbersEqual(Infinity, Infinity)).toBe(true)
  })

  it('容差内判等（抑制 SLD 回读带来的浮点抖动）', () => {
    expect(numbersEqual(14, 14 + 1e-9)).toBe(true)
    expect(numbersEqual(14, 14 - NUMBER_EPSILON)).toBe(true)
  })

  it('超出容差判不等', () => {
    expect(numbersEqual(14, 14.0001)).toBe(false)
    expect(numbersEqual(14, 15)).toBe(false)
  })

  it('NaN 与 Infinity 不参与容差比较（只有严格相等才算等）', () => {
    expect(numbersEqual(Number.NaN, Number.NaN)).toBe(false)
    expect(numbersEqual(Number.NaN, 0)).toBe(false)
    expect(numbersEqual(Infinity, -Infinity)).toBe(false)
    expect(numbersEqual(0, Infinity)).toBe(false)
  })

  it('容差可覆盖', () => {
    expect(numbersEqual(14, 14.5, 1)).toBe(true)
    expect(numbersEqual(14, 14.5)).toBe(false)
  })
})

describe('pointEquals', () => {
  it('两侧都缺省时按严格相等处理', () => {
    expect(pointEquals(null, null)).toBe(true)
    expect(pointEquals(undefined, undefined)).toBe(true)
    expect(pointEquals(null, undefined)).toBe(false)
  })

  it('只有一侧缺省时不等', () => {
    expect(pointEquals({ lng: 1, lat: 2 }, null)).toBe(false)
    expect(pointEquals(null, { lng: 1, lat: 2 })).toBe(false)
    expect(pointEquals(undefined, { lng: 0, lat: 0 })).toBe(false)
  })

  it('0 是合法坐标，不能被当成缺省（0/0 与空值必须判不等）', () => {
    expect(pointEquals({ lng: 0, lat: 0 }, { lng: 0, lat: 0 })).toBe(true)
    expect(pointEquals({ lng: 0, lat: 0 }, { lng: 1e-9, lat: -1e-9 })).toBe(true)
    expect(pointEquals({ lng: 1, lat: 2 }, { lng: 0, lat: 2 })).toBe(false)
    expect(pointEquals({ lng: 1, lat: 2 }, { lng: 1, lat: 0 })).toBe(false)
  })

  it('容差为 POINT_EPSILON（度）', () => {
    expect(POINT_EPSILON).toBe(1e-7)
    expect(pointEquals({ lng: 116.4, lat: 39.9 }, { lng: 116.4 + POINT_EPSILON, lat: 39.9 })).toBe(
      true,
    )
    expect(pointEquals({ lng: 116.4, lat: 39.9 }, { lng: 116.4001, lat: 39.9 })).toBe(false)
  })
})

describe('centerEquals', () => {
  it('两侧同为字符串时按整串比较（v2 城市名形态）', () => {
    expect(centerEquals('北京', '北京')).toBe(true)
    expect(centerEquals('北京', '上海')).toBe(false)
  })

  it('点按 pointEquals 比较', () => {
    expect(centerEquals({ lng: 116.4, lat: 39.9 }, { lng: 116.4 + 1e-9, lat: 39.9 })).toBe(true)
    expect(centerEquals({ lng: 116.4, lat: 39.9 }, { lng: 116.5, lat: 39.9 })).toBe(false)
  })

  it('字符串与点永不相等（形态不同即语义不同）', () => {
    expect(centerEquals('北京', { lng: 116.4, lat: 39.9 })).toBe(false)
    expect(centerEquals({ lng: 116.4, lat: 39.9 }, '116.4,39.9')).toBe(false)
  })

  it('缺省只与缺省相等', () => {
    expect(centerEquals(undefined, undefined)).toBe(true)
    expect(centerEquals(null, null)).toBe(true)
    expect(centerEquals(undefined, { lng: 0, lat: 0 })).toBe(false)
  })
})

describe('centerKey', () => {
  it('缺省只有一种键（`undefined` 与 `null` 都表示「没有受控值」）', () => {
    expect(centerKey(undefined)).toBe('')
    expect(centerKey(null)).toBe('')
  })

  it('字符串与点带各自的前缀（同数字的不同形态不得撞键）', () => {
    expect(centerKey('北京')).toBe('s:北京')
    expect(centerKey({ lng: 116.4, lat: 39.9 })).toBe('p:116.4,39.9')
    expect(centerKey({ lng: 116.4, lat: 39.9 })).not.toBe(centerKey('116.4,39.9'))
  })

  it('键比 centerEquals 细：抖动范围内的不同取值是不同键（写入与否交给容差判定）', () => {
    const a = { lng: 116.4, lat: 39.9 }
    const b = { lng: 116.4 + 1e-9, lat: 39.9 }
    expect(centerEquals(a, b)).toBe(true)
    expect(centerKey(a)).not.toBe(centerKey(b))
  })

  it('0/0 是合法键（不被当成缺省）', () => {
    expect(centerKey({ lng: 0, lat: 0 })).toBe('p:0,0')
    expect(centerKey({ lng: 0, lat: 0 })).not.toBe('')
  })
})

describe('normalizeAngle', () => {
  it('归一化到 [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0)
    expect(normalizeAngle(270)).toBe(270)
    expect(normalizeAngle(360)).toBe(0)
    expect(normalizeAngle(720)).toBe(0)
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(-450)).toBe(270)
    expect(normalizeAngle(359.5)).toBe(359.5)
  })
})

describe('anglesEqual', () => {
  it('-90 与 270 是同一个朝向（v4 getHeading 返回带符号角）', () => {
    // 这是本模块存在的主要原因：initializeView 写入 270，SDK 回读 -90。
    // 没有环绕判等时，受控写入会一直「发现不一致」并再次 setHeading(270)，
    // 与 headingchange 事件形成永不收敛的往返。
    expect(anglesEqual(270, -90)).toBe(true)
    expect(anglesEqual(-90, 270)).toBe(true)
    expect(anglesEqual(0, 360)).toBe(true)
    expect(anglesEqual(350, -10)).toBe(true)
  })

  it('容差为 ANGLE_EPSILON（度）', () => {
    expect(ANGLE_EPSILON).toBe(0.01)
    expect(anglesEqual(0, 0.009)).toBe(true)
    expect(anglesEqual(0, 0.02)).toBe(false)
    expect(anglesEqual(180, 180.005)).toBe(true)
  })

  it('跨越 0/360 的容差按环绕取最小差', () => {
    expect(anglesEqual(359.995, 0.005)).toBe(true)
    expect(anglesEqual(359.9, 0.2)).toBe(false)
  })

  it('相差 180 度判不等（不能把朝向反向当成同一个角）', () => {
    expect(anglesEqual(0, 180)).toBe(false)
    expect(anglesEqual(90, 270)).toBe(false)
  })

  it('NaN 不参与容差比较', () => {
    expect(anglesEqual(Number.NaN, Number.NaN)).toBe(false)
    expect(anglesEqual(Number.NaN, 0)).toBe(false)
  })
})
