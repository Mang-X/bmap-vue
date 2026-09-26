/**
 * `<PolygonLayer>` / `<PolylineLayer>` 的**类型面**契约（issue #166）
 *
 * ## 为什么落在 `tests/type-contracts/` 而不是 `*.test.ts`
 *
 * 这些断言里有 `@ts-expect-error`。放进普通 `.test.ts` 时它在 **`vitest` 运行期
 * 完全不生效**（类型被擦除），只有 `vue-tsc` 才看得见——而 `tsconfig.build.json`
 * 排除了 `src/` 下的 `*.test.ts`，于是那份断言变成**恒真**的装饰。
 * `tsconfig.type-contracts.json` 专门收这类文件（理由见
 * `geocoder-surface.type-test.ts` 的同款说明）。
 *
 * **判别力是双向的**：错误消失时 `@ts-expect-error` 变成 TS2578（unused）而翻红；
 * 末尾的正控保证断言不是「类型退化成什么都能收」的前提下恒绿。
 */
import type {
  FillLayerProps,
  FillLayerStyle,
  LineLayerProps,
  LineLayerStyle,
  PolygonLayerProps,
  PolygonLayerStyle,
  PolylineLayerProps,
  PolylineLayerStyle,
  VisualizationPickOptions,
} from "../../packages/bmap-vue/src/types/components";

declare const polygon: PolygonLayerProps;
declare const polyline: PolylineLayerProps;
declare const polygonStyle: PolygonLayerStyle;
declare const polylineStyle: PolylineLayerStyle;
declare const pick: VisualizationPickOptions;

/* ---------------------------------------------- 正控：合法用法必须被接受（不是恒真） */

const _okData = polygon.data;
const _okVisible = polygon.visible;
const _okZIndex = polygon.zIndex;
const _okMinZoom = polygon.minZoom;
const _okIdKey = polygon.idKey;
const _okStyle = polygon.style;

// `setOptions` 整袋语义：只写要改的键，其余键可省
const _okPartialStyle: PolygonLayerStyle = { strokeWeight: 2 };
const _okPartialLine: PolylineLayerStyle = { strokeStyle: "dashed", dashArray: [8, 4] };
// 数据驱动样式（官方 `StyleValue<T>`，`visualization/common.d.ts:10`）
const _okDataDriven: PolygonLayerStyle = { fillColor: (properties) => String(properties.name) };

/* ------------------------------------------------ `data` 三态：`null` ≠ `undefined` */

const _okDataNull: PolygonLayerProps["data"] = null;
const _okDataAbsent: PolygonLayerProps["data"] = undefined;

// @ts-expect-error `data` 只收对象 / `null` / `undefined`；字符串不是合法 GeoJSON 载荷
polygon.data = "not-geojson";

/* ------------------------------------------------ 不声明的能力：官方没有就是没有 */

// @ts-expect-error 官方**声明**里没有 `setOpacity`（live 实测运行时有，但本库不把未声明
// 成员当契约，见 docs/zh-CN/contributing/166-visualization-alignment-audit.md §三）。
// 声明成 prop 会让组件每次都走「该 kind 没有这个入口」的告警分支。
polygon.opacity = 0.5;

// @ts-expect-error 同上，`PolylineLayerOptions.opacity` 只能经 `style` 袋经 `setOptions` 整袋下发
polyline.opacity = 0.5;

/* ---------------------------- 拾取：两族官方选项表里**没有**的那七项（`layer/` 家族才有） */

// @ts-expect-error `visualization/PolygonLayerOptions` 没有 `crs`（`layer/` 家族的 `LineLayerOptions` 才有）
polygon.crs = "BD09MC";
// @ts-expect-error 没有 `pickWidth`（等价物是 `pickTolerance`，官方默认 4）
polygon.pickWidth = 30;
// @ts-expect-error 没有 `pickHeight`
polygon.pickHeight = 30;
// @ts-expect-error 没有 `autoSelect`
polygon.autoSelect = true;
// @ts-expect-error 没有 `selectedColor` / `selectedIndex`（这两族**没有要素状态 API**）
polygon.selectedColor = "#fff";
// @ts-expect-error 没有 `popEvent`（拾取是否向下层派发由构造选项 `pickThrough` 控制）
polygon.popEvent = false;

/* ------------------------------------------------ 样式：只投影官方声明过的键 */

// @ts-expect-error `FillLayerStyle` 的 `patternUrl` 在 `visualization/PolygonLayerOptions`
// 里**不存在**（官方那一族叫 `fillTextureUrl`）。弃用替代**不是字段改名**。
polygonStyle.patternUrl = "/texture.png";
// @ts-expect-error 同上：`borderWeight` / `borderCovered` 属 `layer/FillLayer` 的 `FillLayerStyle`
polygonStyle.borderWeight = 2;
// @ts-expect-error `LineLayerStyle` 的字段在 `PolylineLayerStyle` 里同样不存在
polylineStyle.patternUrl = "/texture.png";
// @ts-expect-error 官方 `PolygonLayerOptions` 没有 `patternMask`
polygonStyle.patternMask = true;

/* ---------------------------------- 线型 / 线帽 / 线接：官方是**字面量联合**，不是 string */

// @ts-expect-error 官方 `strokeStyle` 只收这三个（`visualization/PolylineLayer.d.ts:58`）
polylineStyle.strokeStyle = "wavy";
// @ts-expect-error 官方 `strokeLineCap` 只收 `butt` / `round` / `square`（`:52`）
polylineStyle.strokeLineCap = "arrow";
// @ts-expect-error 官方 `strokeLineJoin` 只收 `miter` / `bevel` / `round`（`:47`）
polylineStyle.strokeLineJoin = "sharp";

/* -------------------------------------------- 缩放范围：官方默认 3 / 21（构造选项） */

const _okMin: PolylineLayerProps["minZoom"] = 3;
const _okMax: PolylineLayerProps["maxZoom"] = 21;

/* ------------------------------------------------ 拾取选项：官方只有那五项 */

const _okPick: VisualizationPickOptions = {
  idKey: "id",
  enablePicked: true,
  mouseStyleChange: false,
  pickTolerance: 4,
  pickThrough: false,
};

// @ts-expect-error `VisualizationPickOptions` 只收上面那五项（`VisualLayerPropsLike` 的并集
// 是内核内部用的，**不**等于公共面——否则 `layer/` 家族那七项会泄漏到两族的类型上）
pick.pickWidth = 30;

/* ------------------------------ 弃用替代：两套 style **不兼容**（不能整袋互赋） */

// 判据用**整袋互赋**，而不是「逐字段断言」——两套 style 都是全可选接口，空袋之间**本可以**
// 互赋（TS 的可选属性兼容规则），而它们**不可**互赋恰恰是「弃用替代不是改名」的类型层证据：
// `LineLayerStyle` 的 `strokeColor` 是 `string | StyleExpression`（`StyleExpression` 还含
// `Record<string, unknown>`），而 `PolylineLayerStyle.strokeColor` 是官方 `StyleValue<string>`
// ——官方**不**接受任意对象当线色（`visualization/common.d.ts:10`）。
// @ts-expect-error 正向不成立：`LineLayerStyle` 的取值域比官方 `StyleValue<string>` 宽
const _noCompat: PolylineLayerStyle = {} as LineLayerStyle;
// @ts-expect-error 反向同样不成立
const _noCompat2: LineLayerStyle = {} as PolylineLayerStyle;
// @ts-expect-error `FillLayerStyle.patternUrl` 在 `PolygonLayerStyle` 里不存在（字段族不同）——
// 「弃用替代不是改名」的类型层证据
const _noCompat3: PolygonLayerStyle = { patternUrl: "/t.png" } as FillLayerStyle;

/* --------------------------------------------------------------- 旧组件仍在（#165 §3.6） */

declare const legacyFill: FillLayerProps;
declare const legacyLineProps: LineLayerProps;
const _legacyStillWorks: FillLayerProps = { data: null, border: true };
const _legacyStillWorks2: LineLayerProps = { data: undefined, idKey: "id" };
