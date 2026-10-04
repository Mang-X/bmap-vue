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
 *
 * **这条不变量对七个出口一律成立**（#188 评审 P1 之后）。`index` / `components` 曾经
 * 整出口豁免，等于在两个主出口上关掉这层判据；现在改成「只滤掉 Volar 机器名、
 * 真实类型照旧冻结」，豁免的口子关上了。
 */

/**
 * 有基线报告、因而有身份集合基线的出口（相对 `package.json#exports` 的键去掉 `./`）。
 *
 * 名单放在这里而不是 `check-api.mts`，是为了让零容忍用例能 import 它 —— 用例从**这里**取名单，
 * 而不是自己抄一份：抄一份的话，加第六个出口时门禁会静默漏掉它（AGENTS.md：
 * 「只查数字抓不到『数量对了但漏列』」，这里同理）。
 */
export const REPORTED_ENTRIES = [
  "advanced",
  "composables",
  "plugins",
  "resolver",
  "ui-kit",
  // #188 起接入：这两个出口此前因 Volar `__VLS_*` 悬空引用而**无法**被 AE 分析，
  // 挂在那条「预期失败即通过」的探针上。声明修好后（47 个组件补 `defineSlots`，
  // 见 `packages/bmap-vue/src/components/**`），AE 能正常分析，report 走正常比对。
  "index",
  "components",
] as const;

/**
 * Volar / vue-tsc 的**编译器机器名**（`__VLS_*`）。
 *
 * 这些名字是编译器为「本文件内提升出来的中间符号」生成的，换一个 Volar 版本就可能
 * 变形。它们出现在 `ae-forgotten-export` 里有两个原因：① 声明打包阶段（AE rollup）只保留
 * 导出面可达的符号，于是「只有导出面引用它」的中间名变成未导出；② 组件的
 * `__VLS_Slots` / `__VLS_WithSlots` 是 `.vue` 文件内部生成物。
 *
 * **把它们登记进 `forgotten-exports.json` 等于给编译器内部临时名发公共 API 通行证** ——
 * 那张表的语义是「本库真实类型被导出面之外引用、因而消费方无法命名」，而 `__VLS_*`
 * 恰恰是「消费方永远不该命名的东西」，且它的名字由编译器决定、我们无权裁决。
 *
 * ## 为什么是**过滤**而不是**豁免整个出口**（#188 评审 P1）
 *
 * 首轮把 `index` / `components` 整个登记为「身份集合不适用」，等于在这两个主出口上
 * **关掉了整层判据**：那里有 46 / 14 个本库**真实**类型待裁决（`BMapError` /
 * `PanoramaHandle` / `MarkerListProps` …），它们本该被冻结、且新增必须先处置。
 * 出口级豁免之后 `generate:api` 又能照常更新 report 与签名基线，于是「跑一次生成器
 * 就把新欠账洗成基线」这条路在两个最重要的出口上重新打开 —— 正是 #165 想堵住的。
 *
 * 过滤精确到**名字**而不是出口：`__VLS_*` 被滤掉（无权裁决），真实类型**照旧进基线、
 * 照旧拒绝新增**（有裁决权）。两道性质的差别就是这张表与那个前缀的差别。
 *
 * 刻意**不**放宽前缀去匹配别的形状：一旦写成 `/^__/` 之类，「我们自己的名字恰好以双下划线
 * 开头」就会被静默豁免，而那正是本库真实类型。
 */
export const VOLAR_MACHINE_NAME = /^__VLS_/;

/**
 * 从 AE 报出的未导出类型里滤掉**编译器机器名**，留下本库真实欠账。
 *
 * 纯函数：吃集合、不碰文件系统 —— 可被用例直接断言。过滤后的集合**仍然参与全等比对**，
 * 所以「真实类型新增」依旧会让门禁红。
 */
export function publicForgottenExports(names: readonly string[]): string[] {
  return names.filter((name) => !VOLAR_MACHINE_NAME.test(name));
}

/**
 * **零容忍**的出口：身份集合基线必须恒为 `[]`。
 *
 * 这些出口的存量在 #160 就已清零，任何非空都是回归 —— 判据是「恒空」而不是「比条数」，
 * 哪怕只多一个名字也是欠账回来了。
 *
 * 为什么这张名单**不全覆盖**七个出口（#188 评审 P1）：`index` / `components` 今日分别有
 * 46 / 14 个**真实**类型待公共面裁决（`BMapError` / `PanoramaHandle` /
 * `MarkerListProps` …）。把它们列入零容忍等于要求 #188 这票顺手裁决公共 API 面 ——
 * 每个名字该「升为公共导出」还是「收窄签名」是一次独立裁决，属 ADR 2026-09-25 的范围。
 * 处置完一个就从这张表里删掉它，基线随之变短，**始终拒绝新增**这条不变量不受影响。
 *
 * 名单放在这里而不是用例里，是为了让用例从**门禁的**名单派生（抄一份的话，加出口时会漏）。
 */
export const FORGOTTEN_ZERO_TOLERANCE_ENTRIES: readonly (typeof REPORTED_ENTRIES)[number][] = [
  "advanced",
  "composables",
  "plugins",
  "resolver",
  "ui-kit",
];

/**
 * 一个符号在**某个出口**上被刻意接受为未导出类型的记录。
 *
 * 刻意接受是例外而非常规：1.0 的立场是「没有登记就是不允许」，所以本仓库**当前一张豁免都没有**
 * （`FORGOTTEN_EXEMPTIONS` 刻意留空，见该常量）。真出现第一个需求时再把它加进来。
 */
export interface ForgottenExemption {
  /** 登记这个豁免的理由。必填 —— 没有理由的豁免在 review 里无法判断该不该留。 */
  readonly reason: string;
}

/**
 * 生成器可以**自动**吸收的「新增」名字，逐条带理由。
 *
 * 空表 = 「不接受任何欠账」（1.0 的默认立场）。刻意**不**提供任何默认豁免：
 * 「没登记就是不允许」这条不变量只有靠空表才成立（AGENTS.md 的「不留『以后可能有用』的扩展面」）。
 *
 * 键是**出口名**（相对 `package.json#exports` 去掉 `./`），值是该出口自己的一张表，键为符号名 ——
 * **按 (entry, name) 两层匹配**，这样同一个符号可以在多个出口各自登记、各自写理由。
 * 刻意不用 `Record<name, { entry }>`：那样键只有名字，同名符号在第二个出口登记时会**覆盖**
 * 第一条（`{ A: { entry: "advanced" } }` 与 `{ A: { entry: "plugins" } }` 不能共存），
 * 而一个类型同时出现在多个出口恰恰是常态 —— 本 PR 处置的三个名字就同时出现在三个出口。
 */
export const FORGOTTEN_EXEMPTIONS: Readonly<Record<string, Readonly<Record<string, ForgottenExemption>>>> = {};

/** 取出某出口的豁免表（没登记 = 没有豁免）。 */
export function exemptionsFor(
  entry: string,
  exemptions: Readonly<Record<string, Readonly<Record<string, ForgottenExemption>>>> = FORGOTTEN_EXEMPTIONS,
): Readonly<Record<string, ForgottenExemption>> {
  return exemptions[entry] ?? {};
}

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
  exemptions: Readonly<Record<string, Readonly<Record<string, ForgottenExemption>>>> = FORGOTTEN_EXEMPTIONS,
): string[] {
  const forEntry = exemptions[entry] ?? {};
  return actual.filter((name) => !baseline.includes(name) && forEntry[name] === undefined);
}

/** 拒绝时的提示文案。单独抽出来是为了让「谁在拒绝」与「拒绝对谁」在用例里同源可读。 */
export function forbiddenForgottenMessage(
  refusals: readonly { readonly entry: string; readonly added: readonly string[] }[],
): string {
  const lines = refusals.map(({ entry, added }) => `  ${entry}（${added.length} 个）: ${added.join(", ")}`);
  return (
    `[check-api] 生成器拒绝吸收 ${refusals.length} 个出口上的**新增**未导出类型:\n` +
    `${lines.join("\n")}\n` +
    `  身份集合基线未被改动。每个新名字先按 ADR 2026-09-25 的二选一处置：\n` +
    `    - 该形状消费方确实要能命名 ⇒ 加进该出口的 export type 面（随后它就不再出现在集合里）；\n` +
    `    - 内部实现被公共签名带出来 ⇒ 收窄签名 / 让依赖它的类型不再依赖它。\n` +
    `  刻意接受某个欠账时，在 scripts/api-forgotten-boundary.mts 的 FORGOTTEN_EXEMPTIONS 里` +
    `显式登记并写明理由。`
  );
}

/** 一个出口的 forbidden 判定结果。 */
export interface ForgottenRefusal {
  readonly entry: string;
  /** 该出口上新增（扣掉豁免）的未导出类型符号名。 */
  readonly added: readonly string[];
}

/**
 * 对**所有**出口收集 forbidden additions，返回非空就说明整个写盘阶段必须放弃。
 *
 * 纯函数，因此「跨出口事务」这条性质可以被直接断言，而不必真去跑一次会改工作树的
 * `generate:api`（#160 评审 P1）：只要这里返回非空，`updateMode` 就还没写过任何文件 ——
 * 判据发生在**只读**的 preflight 阶段，写盘阶段在它之后才开始。
 *
 * 刻意**不短路**：收集全部出口再一次性报错，而不是遇到第一个就退出。理由有二 ——
 * ① 一次 `generate:api` 就能看到所有出口的待处置名字，省掉「改一个跑一轮」；
 * ② 与「任何出口有 forbidden 就不写盘」的不变量同形：判据只依赖最终结果，不依赖遍历顺序。
 */
export function collectForbiddenAdditions(
  perEntry: readonly {
    readonly entry: string;
    readonly baseline: readonly string[];
    readonly actual: readonly string[];
  }[],
  exemptions: Readonly<Record<string, Readonly<Record<string, ForgottenExemption>>>> = FORGOTTEN_EXEMPTIONS,
): ForgottenRefusal[] {
  const refusals: ForgottenRefusal[] = [];
  for (const { entry, baseline, actual } of perEntry) {
    const added = newForbiddenForgottenExports(entry, baseline, actual, exemptions);
    if (added.length > 0) refusals.push({ entry, added });
  }
  return refusals;
}
