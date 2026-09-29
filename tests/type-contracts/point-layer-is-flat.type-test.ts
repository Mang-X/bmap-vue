/**
 * `<PointLayer>.isFlat` 的**类型面**契约（issue #165，家族内一致性）
 *
 * ## 为什么这个 prop 值得一份独立契约
 *
 * `isFlat` 是官方 `visualization/PointLayerOptions` 上**已声明**的成员
 * （`@baidumap/jsapi-v4-types@4.0.5`，commit `5ba67f4`，`visualization/PointLayer.d.ts:123`），
 * 而本库的 `<PointLayer>` **曾经整个丢掉它**——同时它的两个兄弟
 * `<PointCollection>` / `<PointIconLayer>` **都投影了**（`PointCollection.vue:162`、
 * `PointIconLayer.vue:134`）。文件里没有任何写下的理由 ⇒ 属于「已有但缺失」，不是刻意的收窄。
 *
 * 判别力是**双向**的（理由同 `visualization-layers.type-test.ts` 的文件头）：
 * 错误消失时 `@ts-expect-error` 翻成 TS2578 而变红；末尾的正控保证断言不是
 * 「类型退化成什么都能收」的前提下恒绿。
 */
import type {
  PointCollectionProps,
  PointIconLayerProps,
  PointLayerProps,
} from "../../packages/bmap-vue/src/types/components";

declare const point: PointLayerProps<unknown>;
declare const collection: PointCollectionProps<unknown>;
declare const iconLayer: PointIconLayerProps<unknown>;

/* ---------------------------------------------- 正控：合法用法必须被接受（不是恒真） */

const _okFlat: boolean | undefined = point.isFlat;

/**
 * 三族同形：`isFlat?: boolean`。
 *
 * ⚠️ 一条**刻意不做**的断言：官方三处的 `@default` 并不一致
 * （`visualization/PointLayer.d.ts:121` 与 `visualization/TextLayer.d.ts:117` 写 `false`，
 * `layer/PointIconLayer.d.ts:15` 与 `layer/PointShapeLayer.d.ts:15` 写 `true`），
 * 因此本库**不给** `isFlat` 任何默认值、**不**把官方默认值写进 prop 类型或注释结论。
 * 「没传 = 不表态 = SDK 自己的默认」这条口径对三族一致，也让我们不必在上游默认值
 * 互相矛盾时替它选一个。默认值差异见 `docs/zh-CN/components/data.md`。
 */
const _okFlatTrue: boolean | undefined = point.isFlat;
const _okSiblingFlat: boolean | undefined = collection.isFlat;
const _okSiblingIconFlat: boolean | undefined = iconLayer.isFlat;

/* ------------------------------------------------ `isFlat` 是布尔，不是任意值 */

// @ts-expect-error 官方 `PointLayerOptions.isFlat` 是 `boolean`（`visualization/PointLayer.d.ts:123`），
// 不是字符串（"true"/"1" 都不是）；官方没有运行时字符串解析，收到会静默当 falsy
point.isFlat = "true";

// @ts-expect-error 同上：数字也不是合法取值
point.isFlat = 1;

/**
 * 家族内一致性不是巧合，是被这条钉住的**契约**。
 *
 * `<PointShapeLayer>` / `<PointCollection>` / `<PointIconLayer>` 都收同一个成员；
 * `<PointLayer>` 一旦再丢掉它，就是同一个缺陷复发——@ts-expect-error 会在那一刻变红。
 */
const _familyAligned: boolean | undefined = point.isFlat;
const _familyAlignedSibling: boolean | undefined = collection.isFlat;
