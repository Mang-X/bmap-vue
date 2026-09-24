/**
 * Polygon 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.polygon`） |
 * | --- | --- | --- | --- |
 * | `path` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `pathVersion` | `version` | 版本令牌（`path` 的 watch 源之一） | 不是 SDK 属性 |
 * | `isBoundary` | `recreate` | 构造期选项（`"北京市"` 这类 SDK 原生边界名路径） | `recreate`：路径解析方式只在构造期读取 |
 * | 描边 / 填充 | `options` | 各自的 setter | `PATH_STYLE` + `FILL_STYLE` |
 * | `enableMassClear` / `enableEditing` | `options` | 成对开关 | `PATH_STYLE` |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * 与 Polyline 的两处差异：多边形有**填充**（Polyline 上游没有 `setFillColor`），
 * 且多一个构造期的 `isBoundary`。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { PolygonHandle } from "../../driver/types/handles";
import type { PolygonProps } from "../../types/components";
import {
  PATH_FILL_FIELDS,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const POLYGON_FIELDS: OverlayFieldMap<PolygonProps> = {
  path: "options",
  pathVersion: "version",
  isBoundary: "recreate",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...VISIBILITY_FIELD,
};

export const POLYGON_WATCH_SOURCES = {
  path: { source: "versioned", versionProp: "pathVersion" },
} as const;

export const POLYGON_DESCRIPTOR_KEYS = {
  path: "path",
  pathVersion: null,
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createPolygonSpec(): OverlaySpec<PolygonProps, PolygonHandle> {
  return {
    type: "polygon",
    kind: "polygon",
    fields: POLYGON_FIELDS,
    descriptorKeys: POLYGON_DESCRIPTOR_KEYS,
    watchSources: POLYGON_WATCH_SOURCES,
    create: (context, p) =>
      context.client.driver.overlays.createPolygon(p.path, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        isBoundary: p.isBoundary,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
      }),
  };
}
