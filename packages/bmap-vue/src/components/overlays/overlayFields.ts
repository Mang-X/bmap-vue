/**
 * 图形类覆盖物共有的字段策略表（M5-VECTORS / issue #31）
 *
 * 迁移前每个 SFC 各自手写「描边 / 填充 / 开关」三个字段的 watcher，写法还不一致
 * （有的 `if (v !== undefined)`、有的不看）。这里把**共有的部分**收成常量表，各 spec 展开它，
 * 于是「同类字段用同一条更新路径」是结构上的事实而不是约定。
 *
 * 只有在**多个** kind 真的同形时才放进本文件：单个 kind 独有的字段留在它自己的 spec 里
 * （例如 `isBoundary` 只有 polygon / prism 有，但不是同一条理由，因此各写各的）。
 */
import type { OverlayFieldUpdate } from "../../core/overlays/OverlaySpec";

/** 描边四件套（Polyline / Polygon / Rectangle / Circle / BezierCurve 同形，描述符为 `mutable`）。 */
export const PATH_STROKE_FIELDS = {
  strokeColor: "options",
  strokeWeight: "options",
  strokeOpacity: "options",
  strokeStyle: "options",
} as const satisfies Record<string, OverlayFieldUpdate>;

/** 填充两件套（Polygon / Rectangle / Circle 同形；**Polyline 没有填充**）。 */
export const PATH_FILL_FIELDS = {
  fillColor: "options",
  fillOpacity: "options",
} as const satisfies Record<string, OverlayFieldUpdate>;

/** 图形类共有的成对开关（描述符为 `mutable` + toggle）。 */
export const PATH_TOGGLE_FIELDS = {
  enableMassClear: "options",
  enableEditing: "options",
} as const satisfies Record<string, OverlayFieldUpdate>;

/**
 * `enableClicking`：**构造期属性**（官方 4.0 的图形族只有构造选项，没有成对开关）。
 *
 * 单独一张表而不是并进 `PATH_TOGGLE_FIELDS`：它走的是 `recreate` 这条完全不同的路径，
 * 放在一起会让人以为它也是就地更新。
 */
export const PATH_CLICKING_FIELD = { enableClicking: "recreate" } as const satisfies Record<
  string,
  OverlayFieldUpdate
>;

/**
 * 显隐字段。
 *
 * 所有覆盖物同形：`visible` 走 `"visibility"` 策略（不是 SDK 属性），且必须写成
 * 「不经描述符」——两者的一致性由 `assertOverlayFieldDeclarations` 在构造期强制。
 */
export const VISIBILITY_FIELD = { visible: "visibility" } as const satisfies Record<
  string,
  OverlayFieldUpdate
>;

/** 显隐字段的「不经描述符」声明（与 `VISIBILITY_FIELD` 成对，缺一即构造期抛错）。 */
export const VISIBILITY_DESCRIPTOR_KEY = { visible: null } as const;
