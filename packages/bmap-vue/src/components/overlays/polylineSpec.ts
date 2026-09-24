/**
 * BPolyline 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.polyline`） |
 * | --- | --- | --- | --- |
 * | `path` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `pathVersion` | `version` | **版本令牌**：只作为 `path` 的 watch 源之一 | 不是 SDK 属性（不经描述符） |
 * | `strokeColor` / `strokeWeight` / `strokeOpacity` / `strokeStyle` | `options` | 各自的 setter | `PATH_STYLE` |
 * | `enableMassClear` / `enableEditing` | `options` | 成对开关 | `PATH_STYLE` |
 * | `visible` | `visibility` | `show`/`hide` | 不是描述符键 |
 *
 * ## `path` 为什么不是内容指纹
 *
 * `path` 是**大数组**（路线动辄上万点）。按内容取指纹意味着每次父级渲染都做一次 O(n) 序列化，
 * 而「路径变了没有」在 v3 里本来就有更便宜的答案：**根引用 + `pathVersion`**
 * （`watchSources: { path: { source: "versioned", versionProp: "pathVersion" } }`）。
 * 两种写法都在用：替换根引用（不可变风格）与原地改数组 + 递增 `pathVersion`。
 *
 * ## 事件面（17 个）来自 `GraphEventMap`
 *
 * 包括编辑六件套（`editstart` / `editend` / `linevertexdrag*` / `linevertexdel`）与
 * `lineupdate`。上游把它们声明在图形族的公共表里，而 **Prism / BezierCurve 的同类表把它们 Omit 掉了**
 * （SDK 没有 `enableEditing`）——这条能力边界由事件矩阵表达，组件不需要知道。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { PolylineHandle } from "../../driver/types/handles";
import type { BPolylineProps } from "../../types/components";
import {
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const POLYLINE_FIELDS: OverlayFieldMap<BPolylineProps> = {
  path: "options",
  pathVersion: "version",
  ...PATH_STROKE_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...VISIBILITY_FIELD,
};

/**
 * `path` 的 watch 源：根引用 + `pathVersion`（大数组不做内容指纹，理由见文件头）。
 */
export const POLYLINE_WATCH_SOURCES = {
  path: { source: "versioned", versionProp: "pathVersion" },
} as const;

export const POLYLINE_DESCRIPTOR_KEYS = {
  path: "path",
  pathVersion: null,
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createPolylineSpec(): OverlaySpec<BPolylineProps, PolylineHandle> {
  return {
    type: "polyline",
    kind: "polyline",
    fields: POLYLINE_FIELDS,
    descriptorKeys: POLYLINE_DESCRIPTOR_KEYS,
    watchSources: POLYLINE_WATCH_SOURCES,
    create: (context, p) =>
      context.client.driver.overlays.createPolyline(p.path, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
      }),
  };
}
