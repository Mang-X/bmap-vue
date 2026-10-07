/**
 * `<Map>` 旋转 / 倾斜四个交互开关的**类型面**契约（issue #167 第一批）
 *
 * ## 钉住什么
 *
 * 官方 `@baidumap/jsapi-v4-types@4.0.5` 的 `core/MapOptions.d.ts` 声明了这四个键
 * （`enableRotate` / `enableRotateGestures` / `enableTilt` / `enableTiltGestures`，
 * **全部** `@default true`）。在 #167 之前它们**不在 `MapProps` 上**，因此
 * 「调用方写了但这四个字不认识」在类型层与运行时**都**是静默的：Vue 把它们收进 `$attrs`，
 * 再落到根元素上变成两个莫名其妙的 DOM attribute，而 SDK 从未收到任何值。
 *
 * 这类缺口的危险之处是**它不报错**。所以这里两条都钉：
 *
 * 1. **正控** —— 四个键可命名、类型是 `boolean`（不是 `any` / `unknown`）；
 * 2. **反控** —— `@ts-expect-error` 证明类型**没有**退化成带索引签名的宽松形状：
 *    若哪天 `MapProps` 上冒出 `[key: string]: unknown`，下面那两条会变成 TS2578 而翻红。
 *
 * ## 为什么需要独立文件
 *
 * 同 `service-task-tiers.type-test.ts`：`src/` 下的 `*.test.ts` 不在任何 typecheck 的编译
 * 范围里，写在那里的 `@ts-expect-error` 是**恒真**的。本文件由
 * `tsconfig.type-contracts.json` + `pnpm typecheck:type-contracts` 编译，CI 有对应步骤。
 *
 * ⚠️ 这里只钉**类型面**。「不传时不写、传值时落到官方实例方法」是行为口径，
 * 由 `tests/behavior/map.test.ts` 的 #167 两条用例负责——两者缺一不可：
 * 类型对而链路没接上，与链路接上而类型叫不出名字，都是本票要修的缺陷。
 */
import type { MapProps } from "../../packages/bmap-vue/src/types/components";

declare const props: MapProps;

/* ── 1. 四个键存在且是 `boolean`（正控：类型没有退化成 `any`） ───────────── */

export const rotate: boolean | undefined = props.enableRotate;
export const rotateGestures: boolean | undefined = props.enableRotateGestures;
export const tilt: boolean | undefined = props.enableTilt;
export const tiltGestures: boolean | undefined = props.enableTiltGestures;

/**
 * 反向：值必须真的是 `boolean`。
 *
 * 写 `const _: string = props.enableRotate` 会报 TS2322 —— 但那是**另一条**断言，
 * 用 `@ts-expect-error` 写出来才在「类型退化成 `any`」时翻红（赋给 `string` 会通过，
 * 于是 expect-error 变成 unused）。
 */
// @ts-expect-error `enableRotate` 是 `boolean`，不是 `string`
export const wrongRotate: string = props.enableRotate;
// @ts-expect-error `enableTiltGestures` 是 `boolean`，不是 `string`
export const wrongTiltGestures: string = props.enableTiltGestures;

/* ── 2. `MapProps` 不得有字符串索引签名 ───────────────────────────────────── */

/**
 * 若 `MapProps` 带 `[key: string]: unknown`（那会让「拼错的 prop 名」不报错、
 * 静默落进 `$attrs`），下面两条 `@ts-expect-error` 会变成 TS2578。
 *
 * 这正是 `fixtures/consumer/strict/probe.ts` 的 `HasStringIndex` 判据在**库内**的对应物：
 * 本库的类型面自己也不许靠索引签名接纳任意键。
 */
// @ts-expect-error 不存在的键必须报错（`MapProps` 无字符串索引签名）
export const typo = props.enableRotateGesture;
// @ts-expect-error 同上
export const typo2 = props.enableMapClickTypo;
