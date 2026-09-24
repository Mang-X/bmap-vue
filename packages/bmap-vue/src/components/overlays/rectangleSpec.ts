/**
 * Rectangle 的 `OverlaySpec` 声明（M5-VECTORS / issue #31：v4 新增的矩形覆盖物）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.rectangle`） |
 * | --- | --- | --- | --- |
 * | `bounds` | `options` | `setBounds`（`value: "bounds"`） | `mutateBy("setBounds", { ctorKey: null })`（构造期是第一个位置参数） |
 * | 描边 / 填充 | `options` | 各自的 setter | `PATH_STYLE` + `FILL_STYLE` |
 * | `enableMassClear` / `enableEditing` | `options` | 成对开关 | `PATH_STYLE` |
 * | `enableClicking` | `recreate` | 构造期选项 | 4.0 的图形族都没有 `setEnableClicking` |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * ## 为什么 `bounds` 用内容指纹而不是版本令牌
 *
 * 矩形由**对角两点**定义，`bounds` 永远是 4 个数字的小对象；父级传内联字面量时引用每次都变，
 * 因此需要按内容判等（`"fingerprint"`，即缺省策略）。「大数组用根引用 + 版本」那条只适用于
 * `path` / `controlPoints`（见 `polygonSpec.ts` 的说明）。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { OverlayHandle } from "../../driver/types/handles";
import type { RectangleProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_FILL_FIELDS,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const RECTANGLE_FIELDS: OverlayFieldMap<RectangleProps> = {
  bounds: "options",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_CLICKING_FIELD,
  ...VISIBILITY_FIELD,
};

export const RECTANGLE_DESCRIPTOR_KEYS = {
  bounds: "bounds",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createRectangleSpec(): OverlaySpec<RectangleProps, OverlayHandle> {
  return {
    type: "rectangle",
    kind: "rectangle",
    fields: RECTANGLE_FIELDS,
    descriptorKeys: RECTANGLE_DESCRIPTOR_KEYS,
    create: (context, p) =>
      context.client.driver.overlays.createRectangle(p.bounds, {
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
