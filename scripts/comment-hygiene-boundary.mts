/**
 * 注释卫生的判定内核（）
 *
 * 单独成文件是为了能被用例 import 而不触发真实文件扫描（`check-comment-hygiene.mts`
 * 顶层就跑 `main()`）。`raw-sdk-boundary.mts` / `toolchain-boundary.mts` 是同一理由的先例。
 *
 * ## 这道门禁要拦的是什么
 *
 * 本仓的注释习惯是「凡决策必写注释，写得很长」。到 1.0 合并时，这个习惯产生了两个
 * 可测量的代价（审计基线 `239b649a`）：
 *
 * - **体量**：注释里引用 ADR / 文档路径 / issue 号的行共 **2381 行，分布在 530 个文件**；
 *   注释行 ≥2× 实码行的文件 18 个，最极端的 `deprecatedLayerWarning.ts` 是 53:7。
 * - **过时**：注释一旦**引用其它文档**，改名 / 重写 / 合并即失效，而注释本身没人回头核对。
 * `check:toolchain` 自己就是例子——它 391 行注释里大量在复述 ADR 已经写过的决策史。
 *
 * ## 判据只有一条（比例），另有四条豁免，都是可判定的
 *
 * | 判据 | 拦什么 |
 * | --- | --- |
 * | 单文件「注释行 / 实码行」比不得超阈值 | `53:7` 这类极端值 |
 *
 * 曾经还有一条「注释里不得出现文档路径 / ADR 编号 / issue 号」，**已被实测推翻并删除**：
 * 核对全部 499 处后没有一处是纯重复，每处都在承载实质理由——删掉编号只会把注释变成
 * 没有依据的断言（「让『没传』=『不表态』（决策 5）」删掉「决策 5」就悬了）。
 * 相关的 `checkDocReferences` / `findDocReference` 已随之删除——判据退化成常量、没有
 * 消费者时，留着只会让人以为它还在生效。
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
  readonly kind: "comment-ratio";
  /** 出问题的文件（仓库相对路径，用 `/` 分隔）。 */
  readonly file: string;
  /** 1-based 行号。 */
  readonly line: number;
  readonly detail: string;
}

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
 * 该文件注释里是否含**实测证据**（live 读数 / 实测记录）。
 *
 * 判据刻意窄：只认明确的取证措辞，不看「实测」以外的词。宁可漏豁免（多红一次，
 * 人来看一眼）也不可宽豁免（真债务被放过）。
 */
export function hasLiveEvidence(lines: readonly string[]): boolean {
  return lines.some((l) => isEvidenceLine(l));
}

/**
 * 一行注释是否属于**实测证据**。
 *
 * ⚠️ 必须认得**表格数据行**，不能只认表格标题行。实测踩到：`nativeLayerStyleOwnership.ts`
 * 的注释是一张 22 行的 live 读数表，而只有表头那行含「live 读数」字样——数据行是
 * `| \`text\` | \`setOptions\` | **是**（merge） | **是**（\`0.75\`） |`，第一版判据把整张表
 * 判成「证据只占 3%」，于是门禁翻红，而那些数字恰恰是不可替代的证据本身。
 *
 * 判据：表头（含取证措辞或 markdown 表头）之后的**连续表格行**都算证据。
 */
function stripCommentPrefix(line: string): string {
  return line
    .trim()
    .replace(/^(?:\*+|\/\/+|<!--)\s*/, "")
    .trim();
}

function isEvidenceLine(line: string): boolean {
  if (!isCommentLine(line)) return false;
  const t = stripCommentPrefix(line);
  if (/live\s*(读数|probe|探针)|真实\s*AK|实测/.test(t)) return true;
  // markdown 表格行：表头、数据行、以及**分隔行**（`| --- | --- |`）。
  // ⚠️ 分隔行必须算：漏掉它会把一张表从中间劈成两半，两半都不够 5 行 ⇒ 永不豁免。
  if (/^\|.*\|/.test(t)) return true;
  return false;
}

/**
 * 实测证据豁免的判据。**两个条件都要满足**，缺一不可。
 *
 * ⚠️ 这道判据被评审驳回过两次，两次的错法不同，都记在这里：
 *
 * **第一版（整文件短路）**：命中一行 `// 实测` 就豁免整个文件。任意一条就能让高比例文件
 * 完全绕过门禁——实测当时只有两个文件超阈值，证据行分别只占 1% / 3%，豁免的实际效果
 * 等于关掉判据，只是做得更隐蔽。
 *
 * **第二版（连续 ≥5 行即可）**：把「整文件短路」换成「成块」，仍然错：只要文件里有任意
 * 一张 5 行的读数表，**后面 100+ 行决策史全部绕过**比例检查。函数叫 `isEvidenceDominant`
 * 却不判 dominant——名不副实，这正是评审第二次驳回的理由。
 *
 * **现在**：证据块既要**成块**（连续 ≥ `MIN_EVIDENCE_BLOCK_LINES` 行），又要**占多数**
 * （≥ `MIN_EVIDENCE_SHARE` 的注释行）。两条合起来才是名副其实的「证据主导」：
 * 只有当这份注释的**主体**是取证记录时，高比例才是该留的。
 */
const MIN_EVIDENCE_BLOCK_LINES = 5;
const MIN_EVIDENCE_SHARE = 0.6;

/**
 * 该文件的注释是否**以实测证据为主体**（是则豁免比例判据）。
 *
 * 两个条件：① 存在连续 ≥5 行的证据块（形态对）；② 证据行占全部注释行 ≥60%（主体对）。
 * 缺任何一个都不豁免——尤其 ②，它挡住「表格在前、决策史在后」这种形态。
 */
export function isEvidenceDominant(
  lines: readonly string[],
  stats: FileCommentStats,
): boolean {
  if (stats.commentLines === 0) return false;
  let run = 0;
  let evidenceLines = 0;
  let hasBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (isEvidenceLine(l)) {
      run += 1;
      evidenceLines += 1;
      if (run >= MIN_EVIDENCE_BLOCK_LINES) hasBlock = true;
      continue;
    }
    if (t === "" || t === "*") continue;
    if (run > 0 && isEvidenceBridgeLine(lines, i)) {
      run += 1;
      evidenceLines += 1;
      if (run >= MIN_EVIDENCE_BLOCK_LINES) hasBlock = true;
      continue;
    }
    run = 0;
  }
  // 形态对 **且** 主体对 —— 两个条件缺一不可（见 MIN_EVIDENCE_SHARE）
  return hasBlock && evidenceLines / stats.commentLines >= MIN_EVIDENCE_SHARE;
}

/**
 * 这一行是否属于**证据块内部的桥接行**——即取证行与表格之间的读表说明。
 *
 * ⚠️ 曾经的实现是「取证行后跟任意 2 行注释都算证据」，立刻被反例推翻：
 * 一句 `// 实测` + 8 段决策史也能凑满 5 行而豁免，等于把评审点破的漏洞原样放回来。
 *
 * 现在要求桥接行**后面紧跟表格**（跳过空行 / `*`），也就是「这张表怎么读」——
 * 那种行只在有表的地方出现，决策史里不会出现。
 */
function isEvidenceBridgeLine(lines: readonly string[], i: number): boolean {
  for (let j = i + 1; j < lines.length; j++) {
    const t = stripCommentPrefix(lines[j]);
    if (t === "" || t === "*") continue;
    return /^\|.*\|/.test(t);
  }
  return false;
}

/**
 * 该文件是否**类型定义密集**——即高注释比来自「逐成员说明」而非决策史堆积。
 *
 * 判据：export 的 interface / type 成员占实码行的多数。这类文件（`MapExpose` 那样
 * 冻结一个公共接口的形状）天然需要逐成员说明，压缩它等于删掉使用面。
 *
 * 这条豁免此前只写在测试文件头与 AGENTS.md 的叙述里，**实现中并不存在**——即文档承诺了
 * 一条不存在的判据。评审扫 `mapExpose.ts` 时才发现：它是冻结面（79 注释 / 21 实码
 * = 3.8:1），逐条读过确认每一段都在说明某个成员的语义，按比例判红等于逼人删掉使用面。
 */
function isTypeDefinitionDense(
  lines: readonly string[],
  stats: FileCommentStats,
): boolean {
  if (stats.codeLines === 0) return false;
  let memberLines = 0;
  for (const l of lines) {
    const t = l.trim();
    if (!isCommentLine(l)) {
      // `export interface X {` / `export type X = {` 及其续行
      if (/^export\s+(interface|type)\s+\w/.test(t) || /^\s*readonly\s+\w+\??\s*[:(]/.test(t) || /^\s*\w+\??\s*:\s*\(/.test(t) || /^\s*\/\*\*\s*---/.test(t)) {
        memberLines += 1;
      }
    }
  }
  return memberLines / stats.codeLines >= 0.5;
}

/**
 * 该文件是否含**成块的实测更正**（是则豁免比例判据）。
 *
 * 形态：注释里出现「曾记成 X，那是**误读** / 实测证明不是 X」这类**自我推翻**的段落，
 * **且该段落自带取证依据**（同段落附近有 live 读数行）。
 *
 * ⚠️ 两个条件都不能少。初版只判「出现过 `记成` / `推翻` 等词」，反例立刻成立：
 * 一句「这里我们记成 A，后来改成 B」+ 100 行决策史就豁免了整个文件——那又回到评审
 * 第一次驳回的「整文件短路」。词只是**入口**，取证行才是它之所以不可删的原因。
 *
 * 为什么这类注释不该被压：AGENTS.md 的 Evidence-first 要求「未知运行时行为先 probe 再建
 * 抽象」，而「上一轮的判断被实测推翻」是这条原则的**产物**——压掉它，下次有人读到那个已被
 * 推翻的判断（它往往还留在别的文件里），会重新踩同一个坑。`nativeLayerStyleOwnership.ts`
 * 就是这个形态：读数表只占 8%，主体是「评审记错了，merge 不是整袋替换」这段更正。
 */
const CORRECTION_MIN_BLOCK = 4;

function hasMeasuredCorrection(lines: readonly string[]): boolean {
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = stripCommentPrefix(l);
    const isCorrection =
      isCommentLine(l) &&
      /(误读|曾记成|此前.{0,8}记成|记错了|判断错|并不是|≠)/.test(t);
    if (isCorrection) {
      run += 1;
      // 更正段自带取证依据（往后 12 行内有 live 读数/ 读数表）⇒ 不可删
      const hasEvidence = lines
        .slice(i, i + 12)
        .some((x) => isCommentLine(x) && /live\s*(读数|probe|探针)|真实\s*AK|实测|^\s*\*\s*\|/.test(stripCommentPrefix(x)));
      if (hasEvidence && run >= 1) {
        const block = lines
          .slice(i, i + CORRECTION_MIN_BLOCK)
          .filter((x) => isCommentLine(x) && x.trim() !== "" && x.trim() !== "*").length;
        return block >= 2;
      }
      continue;
    }
    if (l.trim() === "" || l.trim() === "*") continue;
    run = 0;
  }
  return false;
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
  //
  // ⚠️ 但「整文件短路」本身是评审点破的缺陷（见 MIN_EVIDENCE_BLOCK_LINES）：命中一行就免判，
  // 让豁免实际等于关掉判据。现在要求证据行**构成注释的主体**才豁免。
  if (lines !== undefined && isEvidenceDominant(lines, stats)) return [];

  // **类型定义密集豁免**：逐成员说明是冻结面的固有需要（见 isTypeDefinitionDense）。
  if (lines !== undefined && isTypeDefinitionDense(lines, stats)) return [];

  // **实测更正豁免**：「上一轮判断被实测推翻」是 Evidence-first 的产物（见 hasMeasuredCorrection）。
  if (lines !== undefined && hasMeasuredCorrection(lines)) return [];

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
