/**
 * 视野相等判定与浮点抖动抑制（M4-STATE / issue #27）
 *
 * `Map` 的 `center` / `zoom` / `heading` / `tilt` 是**受控/非受控双模**的：外部值变化要写
 * SDK，SDK 的用户交互事件要回写 model。这两条路径一旦用 `===` 判等就会互相激发：
 *
 * ```
 * setCenter(A) → SDK 回读 A + ε（浮点/SLD 抖动）→ 判定「不一致」→ setCenter(A) → …
 * ```
 *
 * 因此相等判定必须**容忍抖动**（本条右侧容差），并且对角度还要**容忍环绕**：
 * v4 的 `setHeading(270)` 会让 `getHeading()` 返回 `-90`（Driver 文档已记录该行为），
 * 只做数值容差的实现会永远认为「当前 -90 ≠ 期望 270」，与 `headingchange` 形成不收敛的往返。
 *
 * 三档容差的取值依据：
 *
 * | 常量 | 取值 | 覆盖的量 | 依据 |
 * | --- | --- | --- | --- |
 * | `POINT_EPSILON` | `1e-7` 度 | 经纬度 | 约 1.1cm，远小于任何真实视野差，又明显大于 double 往返误差 |
 * | `NUMBER_EPSILON` | `1e-6` | `zoom` | 官方支持小数级别；用户可见的级别差至少 1e-3 |
 * | `ANGLE_EPSILON` | `0.01` 度 | `heading` / `tilt` | 官方参考实现 `huiyan-fe/react-bmap` 对这两个字段用的就是 0.01 |
 *
 * 与参考实现的**差异（有意为之）**：`react-bmap` 对 heading / tilt 只做 `|Δ| > 0.01` 的线性
 * 比较，因此 270 与 -90 被判为不同（它靠别处的 `internalUpdateRef` 抑制那次往返）；本库没有
 * 「来源标记」这类隐式状态，判等必须自己收敛，所以额外引入环绕语义（`anglesEqual`）。
 *
 * 非数值（`NaN` / `±Infinity`）**不参与容差比较**：只有严格相等才算等。否则
 * `numbersEqual(NaN, NaN)` 会返回 true，把「引擎读不出值」伪装成「值一致」。
 */
import type { Bounds, Pixel, Point } from "../../driver/types/geometry";

/** 经纬度容差（度）：约 1.1cm。 */
export const POINT_EPSILON = 1e-7

/** 连续数值（`zoom`）容差。 */
export const NUMBER_EPSILON = 1e-6

/** 角度（`heading` / `tilt`）容差，与官方参考实现 `huiyan-fe/react-bmap` 取同一量级。 */
export const ANGLE_EPSILON = 0.01

/** `center` 的两种输入形态：点，或 v2 兼容的「城市名 / 地址」字符串。 */
export type CenterLike = Point | string

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 数值相等（默认容差 `NUMBER_EPSILON`）。非有限值只有严格相等才算等。 */
export function numbersEqual(a: number, b: number, epsilon: number = NUMBER_EPSILON): boolean {
  if (a === b) return true
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false
  return Math.abs(a - b) <= epsilon
}

/**
 * 点相等（默认容差 `POINT_EPSILON`）。
 *
 * 缺省语义与参考实现一致：任一侧为 `null` / `undefined` 时退化为严格相等。注意
 * **`{ lng: 0, lat: 0 }` 不是缺省值**——它是合法坐标，只与「同为 0/0」或容差内的点相等。
 */
export function pointEquals(
  a: Point | null | undefined,
  b: Point | null | undefined,
  epsilon: number = POINT_EPSILON,
): boolean {
  if (a == null || b == null) return a === b
  return numbersEqual(a.lng, b.lng, epsilon) && numbersEqual(a.lat, b.lat, epsilon)
}

/**
 * `center` 相等：字符串按整串比较，点按 `pointEquals`，**跨形态永不相等**。
 *
 * 跨形态判等会掩盖一次真实的语义变化：`"116.4,39.9"` 这类字符串在 SDK 侧要么是城市名、
 * 要么需要地理编码，把它与同数字的点当成「没变」会让受控写入静默失效。
 */
export function centerEquals(
  a: CenterLike | null | undefined,
  b: CenterLike | null | undefined,
  epsilon: number = POINT_EPSILON,
): boolean {
  if (a == null || b == null) return a === b
  const aIsString = typeof a === 'string'
  const bIsString = typeof b === 'string'
  if (aIsString || bIsString) return aIsString && bIsString && a === b
  return pointEquals(a as Point, b as Point, epsilon)
}

/**
 * `center` 的**字段级变化键**：点取 `lng,lat` 两个标量，字符串取整串。
 *
 * 用途是给 `watch` 当源（相对 `src/components/map/Map.vue` 的 `centerKey(props.center)`）：
 * 直接 watch 对象会让「父级传内联字面量」（引用每次都新）每次都触发，受控写入因此空跑。
 *
 * 两种形态加 `p:` / `s:` 前缀，避免「点 `116.4,39.9`」与「字符串 `"116.4,39.9"`」撞成同一个键
 * ——那会把一次真实的形态切换判成「没变」，丢掉该下发的写入。
 *
 * **刻意比 `centerEquals` 细**：键只回答「可能要变」，容差判定留给 `centerEquals`。
 * 反过来（键带容差）会让抖动范围内的**真实改动**被 watch 层直接吃掉。两者共用同一条
 * 「点 vs 字符串」判别规则，必须一起改。
 */
export function centerKey(value: CenterLike | null | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return `s:${value}`
  return `p:${value.lng},${value.lat}`
}

/* ----------------------------------------------------------------------------------
 * 定形几何的标量键（#138）
 *
 * 用途与 `centerKey` 相同——给 `watch` 当源——但覆盖的是**定形**（字段固定、浅层）的值：
 * `Point` / `Pixel` / `Bounds`。这三类此前走 `stableKeyOf` 的通用稳定序列化
 * （`core/utils/stableKey.ts`：排序 key + `JSON.stringify`），对 2~4 个标量的对象是**纯浪费**：
 * 每次读都要建中间对象、排序、再序列化一遍，而 watch 源每个字段每轮都要读。
 *
 * 为什么不并进 `stableKeyOf`：通用序列化是给**开放形状**（`style` / `icon` / `properties`，
 * 字段随 SDK 版本增减）用的；定形值的键可以手写成本文件这样一条直线，且**可读**——
 * 读数里能直接看出比的是哪几个分量。
 *
 * 与 `centerKey` 一致的取舍：键只回答「**可能要变**」，**不带容差**。容差判定交给 `*Equals`
 * 那一族（`pointEquals` 等）。反过来（键带容差）会让抖动范围内的**真实改动**在 watch 层被直接吃掉。
 * 前缀（`p:` / `px:` / `b:`）是防形态撞键：不同字段的键会进同一批待办，
 * 两个同值的键撞成同一个会让一次真实变更被判成「没变」。
 *
 * **`size` 档的现实形态是 Pixel 而不是 Size**：`MarkerProps.offset` / `LabelProps.offset` 公开的
 * 都是 `{ x, y }`（`types/components.ts`），尽管描述符把它们登记为 `value: "size"`
 * （上游 `MarkerOptions.offset` 确实吃 `Size` 对象，本库对外用 Pixel 这一约定保持历史面）。
 * 因此 `size` 档的实际键是 `px:` —— 组件侧的 `{x,y}` 与 `Size` 的 `{width,height}` 必须不同键，
 * 否则一次真实变更会被判成「没变」（`setOffset` 用例一度因此空跑）。
 * 顺带一条结论：**没有** `sizeKey` —— `Size` 形态在本库没有对外字段，留着就是
 * 「以后可能有用」的扩展面（与 `2026-09-14-service-lifecycle-and-local-search` 的判据一致）。
 * -------------------------------------------------------------------------------- */

/** `Point` 的标量键（经纬度）。 */
export function pointKey(value: Point | null | undefined): string {
  if (value == null) return ''
  return `p:${value.lng},${value.lat}`
}

/** `Pixel`（`{x, y}`）的标量键。 */
export function pixelKey(value: Pixel | null | undefined): string {
  if (value == null) return ''
  return `px:${value.x},${value.y}`
}

/** `Bounds`（`{southwest, northeast}`）的标量键：两个点摊平成四个标量。 */
export function boundsKey(value: Bounds | null | undefined): string {
  if (value == null) return ''
  return `b:${value.southwest.lng},${value.southwest.lat},${value.northeast.lng},${value.northeast.lat}`
}

/** 把角度归一化到 `[0, 360)`（`-90 → 270`、`360 → 0`）。非有限值原样返回。 */
export function normalizeAngle(degrees: number): number {
  if (!Number.isFinite(degrees)) return degrees
  const normalized = degrees % 360
  // 显式归一 -0：`Object.is(-0, 0)` 为 false，会让以它为源的判等与日志出现反直觉结果
  if (normalized === 0) return 0
  return normalized < 0 ? normalized + 360 : normalized
}

/**
 * 角度相等（默认容差 `ANGLE_EPSILON`）：按 **360 环绕**取最小差。
 *
 * 这是 heading 的判等入口。**不适用于 tilt**：倾斜角合法范围是 0..90，没有环绕语义，
 * 用环绕判等会把 `tilt: 0` 与 `tilt: 90`（俯仰到地平线）之外的取值关系算错。
 */
export function anglesEqual(a: number, b: number, epsilon: number = ANGLE_EPSILON): boolean {
  if (a === b) return true
  if (!isFiniteNumber(a) || !isFiniteNumber(b)) return false
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b))
  return Math.min(diff, 360 - diff) <= epsilon
}
