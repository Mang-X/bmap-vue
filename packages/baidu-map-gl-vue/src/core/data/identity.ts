/**
 * 业务身份字段名（构造期 `idKey`）的**唯一判定点**（M6 / issue #36）
 *
 * 「哪些取值算已声明身份」这件事在三处被用到，判定必须只有一份，否则会出现**两套身份语义**
 * （#106 评审第二轮 P2 的实例：`idKey: ""` 在写入侧被当成已声明、在拾取侧被当成未声明——
 * 于是状态命令照常执行，而拾取永远返回 `id: null`）：
 *
 * 1. 构造期选项（要不要把 `idKey` 交给 SDK）；
 * 2. 要素状态命令面的前置条件（身份未知时拒绝执行）；
 * 3. 拾取读取（`featureId(properties, idKey)`）。
 *
 * 判据：**非空字符串**才算已声明。空字符串不是可用的字段名（没有哪份 GeoJSON 用 `""` 作业务键），
 * 把它当身份只会让「按 id 定位」变成一次命中不了的查找；而 `undefined` / `null` / 数字等类型
 * 本来就不是字段名。两者都归一化成「未声明」，由调用方决定怎么表达（告警 / 用 SDK 默认 / 返回 null）。
 */
export function normalizeIdField(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}
