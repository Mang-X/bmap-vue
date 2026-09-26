/**
 * Polygon 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * ## 每个公开属性的更新策略
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.polygon`） |
 * | --- | --- | --- | --- |
 * | `points` | `options` | `setPath`（`value: "path"`） | `mutateBy("setPath", { ctorKey: null })` |
 * | `pathVersion` | `version` | 版本令牌（`points` 的 watch 源之一） | 不是 SDK 属性 |
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
import {
  createPathCommands,
  createPathReadBacks,
} from "../../core/overlays/overlayCommands";
import type { PolygonProps } from "../../types/components";
import {
  PATH_FILL_FIELDS,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  PATH_ZINDEX_FIELD,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const POLYGON_FIELDS: OverlayFieldMap<PolygonProps> = {
  points: "options",
  pathVersion: "version",
  isBoundary: "recreate",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_ZINDEX_FIELD,
  ...VISIBILITY_FIELD,
};

export const POLYGON_WATCH_SOURCES = {
  points: { source: "versioned", versionProp: "pathVersion" },
} as const;

export const POLYGON_DESCRIPTOR_KEYS = {
  points: "path",
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
      context.client.driver.overlays.createPolygon(p.points, {
        strokeColor: p.strokeColor,
        strokeWeight: p.strokeWeight,
        strokeOpacity: p.strokeOpacity,
        strokeStyle: p.strokeStyle,
        zIndex: p.zIndex,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        isBoundary: p.isBoundary,
        enableMassClear: p.enableMassClear,
        enableEditing: p.enableEditing,
      }),
    /**
     * 命令面（#165 Class 3 / TASK 2g）：官方声明的**读回**。
     *
     * 写这一侧（`setPath` / 描边填充 setter / `setZIndex`）已由 `path` / 样式 / `zIndex`
     * 这些**受控 prop** 覆盖，#165 §5-C 明确「能改 prop」不算实现同名方法，因此不重复暴露。
     * 读这一侧没有任何 prop 能替代 —— 组件永远不会替调用方读一次。
     *
     * ⚠️ 不镜像成组件状态（官方 getter 给的是**当前值**而不是 SDK 默认值）。
     *
     * 另外给 `setPositionAt`（官方 `Polygon.d.ts`：`setPositionAt(index: number, point: Point, deep?: number): void`）——
     * `deep` **只属于 Polygon**（多环路径的层数），非 polygon 传它会显式抛
     * `BMAP_INVALID_ARGUMENT`（官方签名只有两个参数，第三个会被静默忽略）。
     */
    expose: (exposeCtx) => ({
      ...createPathReadBacks(exposeCtx, { fill: true }),
      ...createPathCommands(exposeCtx),
    }),
  };
}
