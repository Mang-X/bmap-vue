/**
 * BezierCurve 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["bezier-curve"]`） |
 * | --- | --- | --- | --- |
 * | `points` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `controlPoints` | `options` | `setControlPoints`（`value: "point-groups"`） | `mutateBy("setControlPoints", …)` |
 * | `pathVersion` / `controlPointsVersion` | `version` | 两个大数组各自的版本令牌 | 不是 SDK 属性 |
 * | 描边 | `options` | 各自的 setter | 描述符逐个列出（BezierCurve **没有** `PATH_STYLE` 的编辑开关） |
 * | `enableMassClear` | `options` | 成对开关 | 描述符 |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * 两处与 Polyline 的差异，都来自上游：
 *
 * 1. BezierCurve **没有** `enableEditing`（描述符里没有，事件矩阵也把编辑六件套 Omit 掉了），
 *    因此本组件不暴露 `enableEditing`——收了再忽略就是假支持；
 * 2. `controlPoints` 是**二维点数组**（每段一组控制点），归一化方式 `"point-groups"`，
 *    因此它需要一个独立的版本令牌（`controlPointsVersion`）。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { BezierCurveProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_DASH_ARRAY_FIELD,
  PATH_STROKE_FIELDS,
  PATH_ZINDEX_FIELD,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const BEZIER_CURVE_FIELDS: OverlayFieldMap<BezierCurveProps> = {
  points: "options",
  pathVersion: "version",
  controlPoints: "options",
  controlPointsVersion: "version",
  ...PATH_STROKE_FIELDS,
  enableMassClear: "options",
  ...PATH_ZINDEX_FIELD,
  // ↓ issue #165 图形族补齐：`BezierCurveOptions` 此前只缺这两项。
  //
  // ⚠️ **刻意不加** `coordType` / `strokeLineCap` / `strokeLineJoin` / `linkRight`——
  // 官方 `BezierCurveOptions` 里一个都没有（8 个键，其余 6 个已覆盖）。
  // 加了就是「本库声称支持、官方没承诺」的假支持。
  ...PATH_CLICKING_FIELD,
  ...PATH_DASH_ARRAY_FIELD,
  ...VISIBILITY_FIELD,
};

export const BEZIER_CURVE_WATCH_SOURCES = {
  points: { source: "versioned", versionProp: "pathVersion" },
  controlPoints: { source: "versioned", versionProp: "controlPointsVersion" },
} as const;

export const BEZIER_CURVE_DESCRIPTOR_KEYS = {
  points: "path",
  pathVersion: null,
  controlPoints: "controlPoints",
  controlPointsVersion: null,
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * 构造期选项的袋（issue #165 图形族补齐）。
 *
 * ⚠️ `enableClicking` 的官方 `@default` 是 `true`，而 `BezierCurve.vue` 此前**没有**在
 * `withDefaults` 里写它——`Boolean` prop 未给时是 `false`，与官方默认**相反**。
 * 组件侧已同时补上 `enableClicking: undefined`，这里配合条件展开 ⇒ 未给时键不存在，
 * SDK 沿用它自己的 `true`。详见 `BezierCurve.vue` 的注释。
 */
function ctorOptions(p: Readonly<BezierCurveProps>): Record<string, unknown> {
  return {
    strokeColor: p.strokeColor,
    strokeWeight: p.strokeWeight,
    strokeOpacity: p.strokeOpacity,
    strokeStyle: p.strokeStyle,
    zIndex: p.zIndex,
    enableMassClear: p.enableMassClear,
    ...(p.enableClicking === undefined ? {} : { enableClicking: p.enableClicking }),
    ...(p.dashArray === undefined ? {} : { dashArray: p.dashArray }),
  };
}

export function createBezierCurveSpec(): OverlaySpec<BezierCurveProps, OverlayHandle> {
  return {
    type: "bezier-curve",
    kind: "bezier-curve",
    fields: BEZIER_CURVE_FIELDS,
    descriptorKeys: BEZIER_CURVE_DESCRIPTOR_KEYS,
    watchSources: BEZIER_CURVE_WATCH_SOURCES,
    create: (context, p) =>
      context.client.driver.overlays.createBezierCurve(p.points, p.controlPoints, ctorOptions(p)),
  };
}
