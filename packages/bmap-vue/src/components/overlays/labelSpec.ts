/**
 * Label 的 `OverlaySpec` 声明（M5-VECTORS / issue #31）
 *
 * 从 SFC 里抽出来是为了**可测**：`overlay-suite.test.ts` 拿 `LABEL_FIELDS` 与
 * `LabelProps` 的键集、以及 Driver 的属性描述符逐条交叉核对。
 *
 * ## 每个公开属性的更新策略（`LABEL_FIELDS` 是唯一声明点）
 *
 * | prop | 策略 | 落地 | 依据（`OVERLAY_DESCRIPTORS.label`） |
 * | --- | --- | --- | --- |
 * | `content` | `options` | `setOptions` → `setContent` | `mutateBy("setContent", { ctorKey: null })`（构造期是第一个位置参数） |
 * | `position` | `position` | `driver.overlays.setPosition` | `mutateBy("setPosition", { value: "point" })` |
 * | `offset` | `options` | `setOffset` | `mutable`（`value: "size"`） |
 * | `style` | `options` | `setStyles`（v4 是**复数**） | `mutateBy("setStyles", { ctorKey: "styles" })` |
 * | `zIndex` | `options` | `setZIndex` | `mutable` |
 * | `enableMassClear` | `options` | 成对开关 | `toggleBy([enableMassClear, disableMassClear])` |
 * | `visible` | `visibility` | `show`/`hide`，不可用时退回 `add`/`remove` | 继承自 `Overlay` 基类，**不是**描述符键 |
 *
 * ## 事件面（8 个）来自 `LabelEventMap`
 *
 * 上游给 Label 的事件表**比图形族窄**：没有 `rightdblclick` / `mousemove`、没有拖拽、
 * 也没有编辑事件。组件不再手写这份名单——它由 `kind` 从事件矩阵派生
 * （`core/overlays/overlayEventCatalog.ts`），因此「Label 上多了个 Polygon 才有的编辑事件」
 * 在结构上不可能。
 */
import type { OverlayFieldMap, OverlaySpec } from "../../core/overlays/OverlaySpec";
import type { LabelHandle } from "../../driver/types/handles";
import type { LabelProps } from "../../types/components";
import { VISIBILITY_DESCRIPTOR_KEY, VISIBILITY_FIELD } from "./overlayFields";

/** prop → 更新策略（带 `-?` 的映射类型：漏一个 prop 就编译失败）。 */
export const LABEL_FIELDS: OverlayFieldMap<LabelProps> = {
  content: "options",
  position: "position",
  offset: "options",
  style: "options",
  zIndex: "options",
  enableMassClear: "options",
  // issue #165 第三批：官方 `LabelOptions` 7 个键里最后两个。
  //
  // ⚠️ `anchor` **此前不在这个表里**，而 `OVERLAY_DESCRIPTORS.label` 却**早就**登记了
  // `mutateBy("setAnchor", …)` —— 描述符有、组件不暴露 ⇒ 那条更新路径一次都没被触发过。
  // live 读数（2026-09-27，settle 之后）判 `setAnchor` 可观察地生效（DOM 角点随锚点移动）
  // ⇒ `options`。`width` 相反：官方 `Label` 上**没有** `setWidth`（整条原型链 layer = -1）
  // ⇒ `recreate`。
  anchor: "options",
  width: "recreate",
  ...VISIBILITY_FIELD,
};

/** prop → Driver 描述符键。只写两项：语义键 `position` 与不经描述符的 `visible`。 */
export const LABEL_DESCRIPTOR_KEYS = {
  position: "position",
  ...VISIBILITY_DESCRIPTOR_KEY,
} as const;

export function createLabelSpec(): OverlaySpec<LabelProps, LabelHandle> {
  return {
    type: "label",
    kind: "label",
    fields: LABEL_FIELDS,
    descriptorKeys: LABEL_DESCRIPTOR_KEYS,
    create: (context, p) =>
      context.client.driver.overlays.createLabel(p.content, {
        position: p.position,
        offset: p.offset,
        style: p.style,
        zIndex: p.zIndex,
        enableMassClear: p.enableMassClear,
        // `anchor` 是官方常量名、Driver 边界内换成数值；`width` 是构造期项
        // （官方没有 `setWidth`）。未给时是 `undefined`，`projectOptions` 会跳过该键。
        anchor: p.anchor,
        width: p.width,
      }),
  };
}
