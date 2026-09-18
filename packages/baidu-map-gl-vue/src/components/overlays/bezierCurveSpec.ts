/**
 * BBezierCurve 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS["bezier-curve"]`） |
 * | --- | --- | --- | --- |
 * | `path` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
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
import type { BBezierCurveProps } from "../../types/components";
import { PATH_STROKE_FIELDS, VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

export const BEZIER_CURVE_FIELDS: OverlayFieldMap<BBezierCurveProps> = {
  path: "options",
  pathVersion: "version",
  controlPoints: "options",
  controlPointsVersion: "version",
  ...PATH_STROKE_FIELDS,
  enableMassClear: "options",
  ...VISIBILITY_FIELD,
};

export const BEZIER_CURVE_WATCH_SOURCES = {
  path: { source: "versioned", versionProp: "pathVersion" },
  controlPoints: { source: "versioned", versionProp: "controlPointsVersion" },
} as const;

export const BEZIER_CURVE_DESCRIPTOR_KEYS = {
  path: "path",
  pathVersion: null,
  controlPoints: "controlPoints",
  controlPointsVersion: null,
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createBezierCurveSpec(): OverlaySpec<BBezierCurveProps, OverlayHandle> {
  return {
    type: "bezier-curve",
    kind: "bezier-curve",
    fields: BEZIER_CURVE_FIELDS,
    descriptorKeys: BEZIER_CURVE_DESCRIPTOR_KEYS,
    watchSources: BEZIER_CURVE_WATCH_SOURCES,
    create: (context, p) =>
      context.client.driver.overlays.createBezierCurve(p.path, p.controlPoints, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        enableMassClear: p.enableMassClear,
      }),
  };
}
