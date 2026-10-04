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
import { createPathReadBacks } from "../../core/overlays/overlayCommands";
import type { RectangleProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_COORD_TYPE_FIELD,
  PATH_DASH_ARRAY_FIELD,
  PATH_FILL_FIELDS,
  PATH_LINK_RIGHT_FIELD,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  PATH_ZINDEX_FIELD,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const RECTANGLE_FIELDS: OverlayFieldMap<RectangleProps> = {
  bounds: "options",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_ZINDEX_FIELD,
  ...PATH_CLICKING_FIELD,
  // ↓ issue #165 图形族补齐：`RectangleOptions` 还有三项此前没有出口。
  // ⚠️ **刻意不加** `strokeLineCap` / `strokeLineJoin`——官方 `RectangleOptions` 里**没有**这两项
  // （只有 `PolylineOptions` / `PolygonOptions` 有）。
  ...PATH_COORD_TYPE_FIELD,
  ...PATH_DASH_ARRAY_FIELD,
  ...PATH_LINK_RIGHT_FIELD,
  ...VISIBILITY_FIELD,
};

export const RECTANGLE_DESCRIPTOR_KEYS = {
  bounds: "bounds",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * 构造期选项的袋（issue #165 图形族补齐）。
 *
 * `linkRight` 的官方 `@default` 是 `false`，与 Vue 的 `Boolean` 未给值**值上一致**，
 * 但仍走条件展开：让「没给」只有**一个**表示（`undefined`），
 * 否则父级某次传 `:link-right="undefined"` 会触发一次**内容完全没变**的重建。
 */
function ctorOptions(p: Readonly<RectangleProps>): Record<string, unknown> {
  return {
    strokeColor: p.strokeColor,
    strokeWeight: p.strokeWeight,
    strokeOpacity: p.strokeOpacity,
    strokeStyle: p.strokeStyle,
    zIndex: p.zIndex,
    fillColor: p.fillColor,
    fillOpacity: p.fillOpacity,
    enableMassClear: p.enableMassClear,
    enableEditing: p.enableEditing,
    ...(p.enableClicking === undefined ? {} : { enableClicking: p.enableClicking }),
    ...(p.coordType === undefined ? {} : { coordType: p.coordType }),
    ...(p.dashArray === undefined ? {} : { dashArray: p.dashArray }),
    ...(p.linkRight === undefined ? {} : { linkRight: p.linkRight }),
  };
}

export function createRectangleSpec(): OverlaySpec<RectangleProps, OverlayHandle> {
  return {
    type: "rectangle",
    kind: "rectangle",
    fields: RECTANGLE_FIELDS,
    descriptorKeys: RECTANGLE_DESCRIPTOR_KEYS,
    create: (context, p) => context.client.driver.overlays.createRectangle(p.bounds, ctorOptions(p)),
    /**
     * 命令面（#165 Class 3 / TASK 2g）：官方声明的**读回**。
     *
     * 写这一侧（`setBounds` / 描边填充 setter / `setZIndex`）已由 `bounds` / 样式 / `zIndex`
     * 这些**受控 prop** 覆盖，#165 §5-C 明确「能改 prop」不算实现同名方法，因此不重复暴露。
     * 读这一侧没有任何 prop 能替代 —— 组件永远不会替调用方读一次。
     *
     * ⚠️ 不镜像成组件状态（官方 getter 给的是**当前值**而不是 SDK 默认值）。
     *
     *
     * **刻意不给** `setPositionAt`：官方 `Rectangle.d.ts` 没有这个方法（矩形的几何是
     * `setBounds(bounds)`，而 `bounds` 已是受控 prop）。给它一个「四个顶点逐个改」的
     * 等价物会是**自研**语义——`getBounds()` 的四个角点顺序官方没有承诺。
     */
    expose: (exposeCtx) => createPathReadBacks(exposeCtx, { fill: true }),
  };
}
