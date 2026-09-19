/**
 * 业务身份字段名（构造期 `idKey`）的**唯一判定点**（M6 / issue #36）
 *
 * 「哪些取值算已声明身份」这件事在三处被用到，判定必须只有一份，否则会出现**两套身份语义**
 * （#106 评审的实例：写入侧把某个取值当已声明、读取侧当未声明，于是状态命令照常执行、而拾取永远
 * 返回 `id: null`）：
 *
 * 1. 构造期选项（要不要把 `idKey` 交给 SDK）；
 * 2. 要素状态命令面的前置条件（身份未知时拒绝执行）；
 * 3. 拾取读取（业务键）。
 *
 * 判据：**只要是字符串就算已声明**；`undefined`（以及 JS 调用方传进来的非字符串）才算未声明。
 *
 * ⚠️ **空字符串是合法字段名，刻意不收窄**（#106 第三轮评审）：`idKey` / `itemKey` 本质是
 * `PropertyKey`，仓库既有口径同样如此（`core/data/itemScan.ts#isUsableItemKey` 对空字符串照收，
 * 也允许 symbol）。上游没有任何证据要求 `idKey` 非空，凭「通常没人这么写」自造限制会让
 * 「本库认识的身份」与「SDK 手上的身份」再次分叉——`BPointCollection` 的 `itemKey: ""` 正是这样：
 * 适配层把业务键写进 `properties[""]`，而收窄后的判定却不认它（第三轮评审的 P1 回退）。
 *
 * 因此本函数只做**类型归一化**（非字符串 → 未声明），不做**取值收窄**；
 * 「能不能用作公开 `id` / Feature State 的键」是另一件事，由 `readFeatureId` 单独表达。
 */
export function normalizeIdField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
