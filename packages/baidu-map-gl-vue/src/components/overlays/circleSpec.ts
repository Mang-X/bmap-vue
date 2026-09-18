/**
 * BCircle 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.circle`） |
 * | --- | --- | --- | --- |
 * | `center` | `position` | `driver.overlays.setPosition` → 描述符的 `center` 键 | `mutateBy("setCenter", { value: "point" })`，且 `POSITION_KEY.circle = "center"` |
 * | `radius` | `options` | `setRadius` | `mutable` |
 * | 描边 / 填充 | `options` | 各自的 setter | `PATH_STYLE` + `FILL_STYLE` |
 * | `enableMassClear` / `enableEditing` | `options` | 成对开关 | `PATH_STYLE` |
 * | `enableClicking` | `recreate` | 构造期选项 | 官方 4.0 没有 `setEnableClicking` |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * `center` 用 `"position"` 策略（而不是普通 `options`）的依据：圆心的语义就是「这个覆盖物的位置」，
 * 因此它走 `setPosition` 专用入口（Driver 内部按 `POSITION_KEY` 映射到 `setCenter`），
 * 与 Marker / Label 的 `position` 是同一条路径——「位置字段」在本库只有一套实现。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { CircleHandle } from "../../driver/types/handles";
import type { BCircleProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_FILL_FIELDS,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const CIRCLE_FIELDS: OverlayFieldMap<BCircleProps> = {
  center: "position",
  radius: "options",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_CLICKING_FIELD,
  ...VISIBILITY_FIELD,
};

export const CIRCLE_DESCRIPTOR_KEYS = {
  center: "center",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createCircleSpec(): OverlaySpec<BCircleProps, CircleHandle> {
  return {
    type: "circle",
    kind: "circle",
    fields: CIRCLE_FIELDS,
    descriptorKeys: CIRCLE_DESCRIPTOR_KEYS,
    create: (context, p) =>
      context.client.driver.overlays.createCircle(p.center, p.radius, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
        enableClicking: p.enableClicking,
      }),
  };
}
