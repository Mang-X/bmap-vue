/**
 * Circle 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
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
import { createCircleReadBacks } from "../../core/overlays/overlayCommands";
import type { CircleProps } from "../../types/components";
import {
  PATH_CLICKING_FIELD,
  PATH_COORD_TYPE_FIELD,
  PATH_DASH_ARRAY_FIELD,
  PATH_FILL_FIELDS,
  PATH_STROKE_FIELDS,
  PATH_TOGGLE_FIELDS,
  PATH_ZINDEX_FIELD,
  VISIBILITY_DESCRIPTOR_KEY,
  VISIBILITY_FIELD,
} from "./overlayFields";

export const CIRCLE_FIELDS: OverlayFieldMap<CircleProps> = {
  center: "position",
  radius: "options",
  ...PATH_STROKE_FIELDS,
  ...PATH_FILL_FIELDS,
  ...PATH_TOGGLE_FIELDS,
  ...PATH_ZINDEX_FIELD,
  ...PATH_CLICKING_FIELD,
  // ↓ issue #165 图形族补齐：`CircleOptions` 只比已覆盖的多这两项。
  // ⚠️ **刻意不加** `strokeLineCap` / `strokeLineJoin` / `linkRight` / `geodesic` / `clip`——
  // 官方 `CircleOptions` 里一个都没有（圆形没有「跨经度的路径」，也没有「两点怎么连」的问题）。
  ...PATH_COORD_TYPE_FIELD,
  ...PATH_DASH_ARRAY_FIELD,
  ...VISIBILITY_FIELD,
};

export const CIRCLE_DESCRIPTOR_KEYS = {
  center: "center",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

/**
 * 构造期选项的袋（issue #165 图形族补齐）。
 *
 * `enableClicking` 由条件展开送出，而 `Circle.vue` 的 `withDefaults` 写的是 `enableClicking: true`
 * （`<Rectangle>` / `<Marker>` 同款）——因此**当前**这个键在未给时仍会送出 `true`：
 * 值与官方 `@default true` 一致，只是**来源**是本库而不是 SDK。这是既有行为，本次**不改**
 * （改它属于「调整既有 prop 的缺省表示」，不在 #165 图形族补齐的范围内）。
 *
 * 写成条件展开而不是裸写，是为了让**这个 spec 的构造袋形状统一**：将来若把 `withDefaults`
 * 改成 `undefined`（`<GroundOverlay>` / `<CustomOverlay>` 的处置），这里不必再动一行。
 * `coordType` / `dashArray` 则是**新**加的，两项都不是 `Boolean` ⇒ 没有 Vue 转换陷阱，
 * 未给时真的是 `undefined` ⇒ 键不存在。
 */
function ctorOptions(p: Readonly<CircleProps>): Record<string, unknown> {
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
  };
}

export function createCircleSpec(): OverlaySpec<CircleProps, CircleHandle> {
  return {
    type: "circle",
    kind: "circle",
    fields: CIRCLE_FIELDS,
    descriptorKeys: CIRCLE_DESCRIPTOR_KEYS,
    create: (context, p) => context.client.driver.overlays.createCircle(p.center, p.radius, ctorOptions(p)),
    /**
     * 命令面（#165 Class 3 / TASK 2g）：官方 `Circle.d.ts` 声明的九个 getter。
     *
     * **只暴露读回，不重复暴露写**：写（`setCenter` / `setRadius` / 描边填充四件套 / `setZIndex`）
     * 已经由 `center`（`position` 策略）与 `radius` / 样式 / `zIndex`（`options` 策略）这些
     * **受控 prop** 覆盖——#165 §5-C 明确「能改 prop」**不算**实现同名方法，因此写这一侧
     * 不需要 expose；读这一侧**没有**任何 prop 能替代，组件永远不会替调用方读一次。
     *
     * ⚠️ **不镜像成组件状态**：官方这九个 getter 返回的是**当前值**而不是 SDK 默认值
     * （`OVERLAY_REVERT_RATIONALE` 逐字段记录了这条）。写进 ref 就等于把 SDK 当前值升级成
     * 第二主模型，`props` 与它迟早分叉。
     */
    expose: (exposeCtx) => createCircleReadBacks(exposeCtx),
  };
}
