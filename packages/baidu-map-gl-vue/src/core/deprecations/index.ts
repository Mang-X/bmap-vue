/**
 * 集中弃用层（M5-VECTORS / issue #31，读取规则抽出由 M5-CUSTOM-MENU / issue #33 补上）
 *
 * 三个模块，职责不重叠：
 *
 * - `aliases.ts`：**旧名 → 新名**的身份与文案（单一事实源，文档表格也从它派生）；
 * - `resolve.ts`：prop 别名的**读取规则**（新 API 优先 / 旧名要齐备 / 不猜）——两个消费者
 *   （`useOverlaySpec` 与 `ContextMenuSpec`）共用，不各写一遍；
 * - `warner.ts`：**同实例只警告一次**（组件的用法提示，随实例消失）。
 *
 * 消费者只有三个：`useOverlaySpec`（prop 别名的读取层 + 事件别名的补发）、`useContextMenu`
 * （菜单项的旧 prop 名）与文档。组件**不**写自己的兼容代码——那正是 #28 明令禁止、#31 要收掉的东西。
 */
export {
  DEPRECATED_EVENT_ALIAS_CODE,
  DEPRECATED_PROP_ALIAS_CODE,
  OVERLAY_EVENT_ALIASES,
  OVERLAY_PROP_ALIASES,
  allEventAliases,
  describeDeprecation,
  eventAliasesOf,
  propAliasesOf,
} from "./aliases";
export type {
  DeprecationNotice,
  OverlayEventAlias,
  OverlayPropAlias,
} from "./aliases";
export { resolvePropAliasValue } from "./resolve";
export type { ResolvedPropAlias } from "./resolve";
export { createDeprecationWarner } from "./warner";
export type { DeprecationWarner } from "./warner";
