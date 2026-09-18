/**
 * 集中弃用层（M5-VECTORS / issue #31）
 *
 * 两个模块，职责不重叠：
 *
 * - `aliases.ts`：**旧名 → 新名**的身份与文案（单一事实源，文档表格也从它派生）；
 * - `warner.ts`：**同实例只警告一次**（组件的用法提示，随实例消失）。
 *
 * 消费者只有两个：`useOverlaySpec`（prop 别名的读取层 + 事件别名的补发）与文档。
 * 组件**不**写自己的兼容代码——那正是 #28 明令禁止、#31 要收掉的东西。
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
export { createDeprecationWarner } from "./warner";
export type { DeprecationWarner } from "./warner";
