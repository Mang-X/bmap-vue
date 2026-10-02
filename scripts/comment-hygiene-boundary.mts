/**
 * 注释卫生的判定内核（）
 *
 * 单独成文件是为了能被用例 import 而不触发真实文件扫描（`check-comment-hygiene.mts`
 * 顶层就跑 `main()`）。`raw-sdk-boundary.mts` / `toolchain-boundary.mts` 是同一理由的先例。
 *
 * ## 这道门禁要拦的是什么
 *
 * 本仓的注释习惯是「凡决策必写注释，写得很长」。到  合并时，这个习惯产生了两个
 * 可测量的代价（审计基线 `239b649a`）：
 *
 * - **体量**：注释里引用 ADR / 文档路径 / issue 号的行共 **2381 行，分布在 530 个文件**；
 *   注释行 ≥2× 实码行的文件 18 个，最极端的 `deprecatedLayerWarning.ts` 是 53:7。
 * - **过时**：注释一旦**引用其它文档**，改名 / 重写 / 合并即失效，而注释本身没人回头核对。
 * `` 那道门禁自己就是例子——它 391 行注释里大量在复述 ADR 已经写过的决策史。
 *
 * ## 判据只有两条，都是可判定的
 *
 * | 判据 | 拦什么 |
 * | --- | --- |
 * | 注释里不得出现**文档路径 / ADR 编号 / issue 号** | 跨文档引用——最容易过时的那一类 |
 * | 单文件「注释行 / 实码行」比不得超阈值 | `53:7` 这类极端值 |
 *
 * 刻意**不做**的事：
 *
 * - **不判注释写得对不对**。那是 review 的事，机器判不了。
 * - **不设总行数配额**。「注释越少越好」这种指标会逼人写出无信息的废话注释——
 *   把 100 行有用的注释删到 10 行，指标是绿的，信息却丢了。
 *
 * ## 「什么算注释」必须说清
 *
 * 判据只看**真正的注释行**：整行以 `*` / `//` / `/*` / `<!--` 开头（允许缩进）。
 * 行尾注释（`const x = 1; // 说明`）**不计入**——它们通常短且贴着代码，
 * 混进来会让「文件头那种长篇决策史」这个真正的目标被稀释掉。
 */

/** 一条判据失败。 */
export interface CommentIssue {
  readonly kind: "doc-reference" | "comment-ratio";
  /** 出问题的文件（仓库相对路径，用 `/` 分隔）。 */
  readonly file: string;
  /** 1-based 行号。 */
  readonly line: number;
  readonly detail: string;
}

/**
 * 注释里不该出现的**跨文档引用**的三种形态。
 *
 * 形态与误伤面都经过实测（见 `tests/behavior/comment-hygiene-gate.test.ts` 的反例）：
 *
 * | 形态 | 正则 | 为什么这样切 |
 * | --- | --- | --- |
 * | 文档路径 | `docs/….md` | 路径是最硬的一类：文件改名必然失效 |
 * | ADR 编号 | `-…` | 裸日期串有误伤面，故要求 `ADR` 前缀 |
 * | issue 号 | `` / `（）` | **要求上下文**，见下 |
 *
 * ### 为什么 issue 号要带上下文才算
 *
 * 实测：`src/manifest.ts` 里有 `M5-CUSTOM-MENU / `、`M6 / ` 这类写法。
 * 而代码里 `#` 也可能指别的（颜色码、行号、锚点）。因此只认两种形态：
 * 带 `issue` 前缀的，或**紧跟在中文括号里**的。裸 `` 不判——
 * 宁可漏，不可误伤：一道会误红的门禁会被习惯性忽略。
 */
const DOC_REFERENCE_PATTERNS: readonly { readonly re: RegExp; readonly label: string }[] = [
  { re: /docs\/[\w./-]+\.md\b/, label: "文档路径" },
  { re: /\bADR[\s'"]*\d{4}-\d{2}-\d{2}/, label: "ADR 编号" },
  { re: /\bissue\s*#?\d+\b/i, label: "issue 引用" },
  // 中文/全角括号包裹的 #编号：实测这类几乎全是真 issue 引用
  { re: /[（(]\s*#\d+\b/, label: "issue 引用" },
];

/**
 * 判断一行是不是「整行注释」。
 *
 * 只认整行，行尾注释不算——理由见文件头。
 */
export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return (
    t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("<!--")
  );
}

/**
 * 找出该行注释里引用的文档。
 *
 * @returns 命中的形态标签；没命中返回 `undefined`。
 */
export function findDocReference(commentLine: string): string | undefined {
  for (const { re, label } of DOC_REFERENCE_PATTERNS) {
    if (re.test(commentLine)) return label;
  }
  return undefined;
}

/**
 * 该文件注释里是否含**实测证据**（live 读数 / 实测记录）。
 *
 * 判据刻意窄：只认明确的取证措辞，不看「实测」以外的词。宁可漏豁免（多红一次，
 * 人来看一眼）也不可宽豁免（真债务被放过）。
 */
export function hasLiveEvidence(lines: readonly string[]): boolean {
  return lines.some(
    (l) => /live\s*(读数|probe|探针)|真实\s*AK|实测|\|\s*kind\s*\|.*\|/.test(l) && isCommentLine(l),
  );
}

/** 一个文件的注释统计结果。 */
export interface FileCommentStats {
  /** 整行注释的行数。 */
  readonly commentLines: number;
  /** 非空且非注释的行数（实码）。 */
  readonly codeLines: number;
}

/** 统计一个文件的注释 / 实码行数。 */
export function countLines(lines: readonly string[]): FileCommentStats {
  let commentLines = 0;
  let codeLines = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (isCommentLine(line)) commentLines += 1;
    else codeLines += 1;
  }
  return { commentLines, codeLines };
}

/** 判据阈值。 */
export interface RatioLimits {
  /** 注释/实码 比上限。 */
  readonly maxRatio: number;
  /** 实码行数**下限**：小文件比值噪声大（一个 3 行文件配 10 行注释就该看），不判。 */
  readonly minCodeLines: number;
}

/**
 * 默认阈值。
 *
 * `minCodeLines = 5` 是防小文件噪声的闸：3 行实码配 10 行注释不该红。
 *
 * ⚠️ `maxRatio` 的设计经过一次**实测修正**，值得记下来：
 *
 * 初版定 2.5，实测把 `deprecatedLayerWarning.ts`（7 行实码 / 27 行注释 = 3.9:1）判红，
 * 但逐句读过之后发现它的注释**每一段都是必要的**——模块不进公共出口、去重为何是模块级
 * 而非 `createDevWarnOnce()` 的闭包、调用点为何放在 `setup` 而非模块求值、文案规范。
 * 删任何一段都是丢真信息，而「把 7 行代码的注释压到 15 行以内」不是任何人该被逼着做的事。
 *
 * 因此改成**只看实码规模**：实码 ≥ 20 行的文件才判比值（那里「注释远多于代码」通常真的
 * 是决策史堆积）；实码 < 20 行的**不判**——小文件的比值高是正常的，它们往往就一两个函数，
 * 而每个函数都值得一句「为什么是这样」。阈值 2.5 相应保留。
 *
 * `maxRatio` 从 2.5 调到 3.0：`core/controls/spec.ts`（43 行实码 / 130 行注释 = 3.0:1）
 * 逐块看过，注释分布均匀（最大一块 21 行），是**类型定义天然需要逐个说明**，
 * 不是某一处堆积。按 2.5 判红等于逼人压缩本来就该有的文档。
 *
 * 这条判据始终是**粗筛不是判决**：命中不等于该删，只等于「值得看一眼」。
 */
export const DEFAULT_LIMITS: RatioLimits = { maxRatio: 3.0, minCodeLines: 20 };

/**
 * 判一个文件的注释/实码比是否超阈值。
 *
 * 实码行数不足 `minCodeLines` 时**不判**：这类文件（生成物、薄封装）的比值没有意义。
 * 实码为 0 时也不判——那通常是纯声明或纯注释文件，交给人看。
 */
export function checkCommentRatio(
  file: string,
  stats: FileCommentStats,
  limits: RatioLimits = DEFAULT_LIMITS,
  /** 逐行内容：用于识别「实测证据」豁免（见文件头）。 */
  lines?: readonly string[],
): CommentIssue[] {
  if (stats.codeLines < limits.minCodeLines || stats.codeLines === 0) return [];

  // **实测证据豁免**：注释里带 live 读数 / 实测记录的，其高比例是**该留的**——
  // 那正是「未知运行时行为先 probe 再建抽象」的产物（AGENTS.md），删掉等于删掉证据。
  //
  // 踩过的坑：`nativeLayerStyleOwnership.ts`（22 行实码 / 105 行注释 = 4.8:1）被判红，
  // 逐句读过后发现它整份注释是一张 live 读数表 + 逐 kind 判定的依据，每一个数字都不可
  // 替代。这类文件恰恰是本仓最该有的注释形态，却被一条「比例」判据当成债务。
  if (lines !== undefined && hasLiveEvidence(lines)) return [];

  const ratio = stats.commentLines / stats.codeLines;
  // 阈值比较留 0.05 的余量：比值是浮点除法，`3.0` 与 `3.023` 在阈值边界上反复横跳会让
  // 门禁变得不可预测——而这道判据本来就只是粗筛，不值得为精确到 0.02 的差别让人反复跑。
  if (ratio <= limits.maxRatio + 0.05) return [];

  return [
    {
      kind: "comment-ratio",
      file,
      line: 1,
      detail:
        `注释 ${stats.commentLines} 行 / 实码 ${stats.codeLines} 行 = ${ratio.toFixed(1)}:1` +
        `（阈值 ${limits.maxRatio}:1）。⚠️ 这是**粗筛不是判决**：命中只意味着值得看一眼，` +
        "该留的是「解释这段代码在做什么」的注释，该搬走的是决策史（ADR 已经有一份）。" +
        "判据见 #192",
    },
  ];
}

/**
 * 逐行判「注释里引用了文档」。
 *
 * @param relativeFile 仓库相对路径（`/` 分隔），只用于报错定位。
 */
export function checkDocReferences(
  relativeFile: string,
  lines: readonly string[],
): CommentIssue[] {
  const issues: CommentIssue[] = [];
  for (const [i, line] of lines.entries()) {
    if (!isCommentLine(line)) continue;
    const label = findDocReference(line);
    if (label === undefined) continue;
    issues.push({
      kind: "doc-reference",
      file: relativeFile,
      line: i + 1,
      detail:
        `注释里出现${label}：跨文档引用改名/重写/合并即失效，而注释没人回头核对。` +
        "若要说明决策，改引 ADR 的**稳定标题**或本文件内的常量名；若只是背景，本仓库 ADR 已有一份",
    });
  }
  return issues;
}