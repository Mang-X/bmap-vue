/**
 * prop 别名的**读取规则**（M5-CUSTOM-MENU / issue #33）
 *
 * 「新 API 优先」这条规则原本只写在 `useOverlaySpec` 里。`<ContextMenu>` 的 `menuItems` → `items`
 * 需要**同一条**规则，而把它在两个地方各写一遍，正是本仓库反复吃过亏的形态（两份同源实现会在
 * 「正典为 `undefined` 算不算缺失」「旧名只给一半怎么办」这类细节上分叉，而分叉的表现是
 * 「旧名有时生效有时不生效」）。因此规则收在这里，两个消费者共用：
 *
 * | 消费者 | 用法 |
 * | --- | --- |
 * | `useOverlaySpec`（覆盖物内核） | 读 props 前解析正典值（`bounds` ← `startPoint` + `endPoint`） |
 * | `ContextMenuSpec`（菜单） | 读 props 前解析正典值（`items` ← `menuItems`） |
 *
 * 规则三条（与 issue #31 的验收逐字对应）：
 *
 * 1. **正典有值 ⇒ 旧名完全不参与**（连告警都不发）：这是「新 API 优先」，不是「两边合并」；
 * 2. **旧名要齐备**：`deprecated` 列出的名字必须**全部**给出，否则没有可解释的语义，此时按
 *    「正典缺失」处理，**不猜**；
 * 3. `derive()` 返回 `undefined` 表示「旧名这条路也不成立」，等价于正典缺失。
 *
 * 告警**不在这里发**：本函数只回答「读到了什么、有没有用到旧名」，输出由调用方的
 * `DeprecationWarner` 负责（同实例一次、稳定 code）。把「判定」与「输出」分开，是为了让同一份
 * 判定既能驱动运行时、也能被用例与文档复用。
 */
import type { OverlayPropAlias } from "./aliases";

export interface ResolvedPropAlias {
  /** 这次读取得到的值。 */
  readonly value: unknown;
  /** 这次读取是否用到了弃用的旧名（`true` 时调用方应当告警一次）。 */
  readonly usedAlias: boolean;
}

/**
 * 按别名表解析一个正典 prop 的取值。
 *
 * 入参是**原始 props 记录**（不解包响应式对象，与 `useOverlaySpec.readProp` 同口径）。
 */
export function resolvePropAliasValue(
  alias: OverlayPropAlias,
  props: Record<string, unknown>,
): ResolvedPropAlias {
  const canonical = props[alias.canonical];
  if (canonical !== undefined) return { value: canonical, usedAlias: false };
  // 旧名必须**齐备**：只给一半就没有可解释的语义，此时不猜、也不告警
  if (alias.deprecated.some((key) => props[key] === undefined)) {
    return { value: undefined, usedAlias: false };
  }
  const derived = alias.derive(props);
  if (derived === undefined) return { value: undefined, usedAlias: false };
  return { value: derived, usedAlias: true };
}
