/**
 * 未导出类型（`ae-forgotten-export`）身份集合基线的**判定内核**（issue #160，#165 回归修补）
 *
 * 单独成文件而不是留在 `check-api.mts` 里，是为了能**被用例直接 import**：`check-api.mts`
 * 顶层就跑 `main()`，用例一旦 import 它就会连带触发整轮 API Extractor 分析。
 * `docs-brand-boundary.mts` / `raw-sdk-boundary.mts` 是同一个理由的先例。
 *
 * ## 这道门禁的失效方式
 *
 * `check:api` 逐出口比对身份集合，方向对称（新增与清理都红）。但**生成器原先无条件把当前
 * 集合写回基线** —— 于是 `pnpm generate:api` 成了「把新欠账洗成基线」的那一步：
 * `check:api` 的严格性只在**没跑生成器**时存在，跑一次就失效。
 *
 * #165 正是这样把三个名字（`MarkerLabelInput` / `OverlayAnchorName` / `ViewportOptions`）
 * 吸收进基线的：门禁当时是红的，处置（升为公共导出）只做了根入口那一半，`generate:api` 却把
 * 剩下的一半红线变成了基线；之后 `check:api` 全绿，欠账再无人提。五份基线因此从 `[]` 变成
 * 3 / 2 / 3 个名字，而 #160 的验收标准是**零容忍**。
 *
 * 因此新增的名字**必须**先按 ADR 2026-09-25 的二选一处置（升为公共导出 / 让引用消失），
 * 让它们从集合里**消失**；生成器只自动写「清理」方向。
 */

/**
 * 有基线报告、因而有身份集合基线的出口（相对 `package.json#exports` 的键去掉 `./`）。
 *
 * 名单放在这里而不是 `check-api.mts`，是为了让零容忍用例能 import 它 —— 用例从**这里**取名单，
 * 而不是自己抄一份：抄一份的话，加第六个出口时门禁会静默漏掉它（AGENTS.md：
 * 「只查数字抓不到『数量对了但漏列』」，这里同理）。
 */
export const REPORTED_ENTRIES = ["advanced", "composables", "plugins", "resolver", "ui-kit"] as const;

/**
 * 一个符号在**某个出口**上被刻意接受为未导出类型的记录。
 *
 * 刻意接受是例外而非常规：1.0 的立场是「没有登记就是不允许」，所以本仓库**当前一张豁免都没有**
 * （`FORGOTTEN_EXEMPTIONS` 刻意留空，见该常量）。真出现第一个需求时再把它加进来。
 */
export interface ForgottenExemption {
  /** 登记这个豁免的理由。必填 —— 没有理由的豁免在 review 里无法判断该不该留。 */
  readonly reason: string;
  /** 豁免适用的出口（相对 `package.json#exports` 的键去掉 `./`）。 */
  readonly entry: string;
}

/**
 * 生成器可以**自动**吸收的「新增」名字，逐条带理由。
 *
 * 空表 = 「不接受任何欠账」（1.0 的默认立场）。刻意**不**提供任何默认豁免：
 * 「没登记就是不允许」这条不变量只有靠空表才成立（AGENTS.md 的「不留『以后可能有用』的扩展面」）。
 *
 * 键是**符号名**，值的 `entry` 决定它对**哪个出口**生效 —— 按二元组而不是按名字匹配：
 * 同一个类型在 `./advanced` 被接受，不代表它在 `./plugins` 也被接受，逐出口分析的引用点
 * 并不相同。
 */
export const FORGOTTEN_EXEMPTIONS: Readonly<Record<string, ForgottenExemption>> = {};

/**
 * 返回「新增未导出类型」里**不该**被自动写进基线的名字；非空就说明生成器必须拒绝。
 *
 * 纯函数：只吃集合、不碰文件系统 —— 因此能被用例直接断言，而不必先 build 出 dist。
 * 已在基线里的名字不算新增（否则「清理」方向会被误拦，见 `check-api.mts` 的写盘路径）。
 */
export function newForbiddenForgottenExports(
  entry: string,
  baseline: readonly string[],
  actual: readonly string[],
  exemptions: Readonly<Record<string, ForgottenExemption>> = FORGOTTEN_EXEMPTIONS,
): string[] {
  return actual.filter(
    (name) => !baseline.includes(name) && exemptions[name]?.entry !== entry,
  );
}

/** 拒绝时的提示文案。单独抽出来是为了让「谁在拒绝」与「拒绝对谁」在用例里同源可读。 */
export function forbiddenForgottenMessage(entry: string, added: readonly string[], target: string): string {
  return (
    `[check-api] ${entry}: 生成器拒绝吸收 ${added.length} 个**新增**未导出类型: ${added.join(", ")}\n` +
    `  身份集合基线 ${target} 未被改动（该出口的 report 基线已回滚）。` +
    `每个新名字先按 ADR 2026-09-25 的二选一处置：\n` +
    `    - 该形状消费方确实要能命名 ⇒ 加进本出口的 export type 面（随后它就不再出现在集合里）；\n` +
    `    - 内部实现被公共签名带出来 ⇒ 收窄签名 / 让依赖它的类型不再依赖它。\n` +
    `  刻意接受某个欠账时，在 scripts/api-forgotten-boundary.mts 的 FORGOTTEN_EXEMPTIONS 里` +
    `显式登记并写明理由。`
  );
}
