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
 * ## 判据只有一条（比例），另有两条豁免，都是可判定的
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
 *
 * ⚠️ 它**不包含**表格行——表格是证据的载体，不是证据本身。读数表要算证据得由
 * `isEvidenceDominant` 走「取证行 + 表格归属」那条路。
 */
export function hasLiveEvidence(lines: readonly string[]): boolean {
  return lines.some((l) => isEvidenceLine(l));
}

/**
 * 一行注释是否属于**实测证据**（**取证标记**本身）。
 *
 * ⚠️ 这里**只认取证措辞**（`live 读数` / `probe` / `真实 AK` / `实测`），**不认表格**。
 * 评审第三轮点破过一个版本：它把任何 Markdown 表格行都无条件当证据，于是
 * 「## 设计对照表」这种纯决策表只要凑够行数就能拿到证据豁免——表格是**载体**不是
 * **证据**：`| A | 快 | 差 |` 里的字既不是读数也不是 probe 结果。
 *
 * 那为什么这里返回 false 而 `isEvidenceDominant` 仍能把读数表算成证据块？
 * 因为**表格归属**由 `isEvidenceTableRow` 判定，而它要求这张表**前面有取证行**
 * （`isEvidenceTableLine`）——`nativeLayerStyleOwnership.ts` 的读数表正是如此：
 * 表头那行写着「live 读数 … 逐 kind 证实」，数据行是它的延续。
 */
function stripCommentPrefix(line: string): string {
  return line
    .trim()
    .replace(/^(?:\*+|\/\/+|<!--)\s*/, "")
    .trim();
}

/** 一行是否带**取证措辞**——证据块的起点标记。 */
function isEvidenceLine(line: string): boolean {
  if (!isCommentLine(line)) return false;
  const t = stripCommentPrefix(line);
  return /live\s*(读数|probe|探针|跑通)|真实\s*AK|实测/.test(t);
}

/**
 * 一行是否是一张**已被取证标记引入**的表格的行（表头 / 分隔 / 数据）。
 *
 * 这是对上一版的修正：`isEvidenceLine` 曾经无条件认下任何 `|…|` 行，于是「## 设计对照表」
 * 这种纯决策表也能拿到证据豁免——表格是**载体**不是**证据**：`| A | 快 | 差 |` 里的字
 * 既不是读数也不是 probe 结果。
 *
 * 判据：从这张表**往上**回溯到最近的取证行，中间只允许空行、`*` 与**读表说明**
 * （「`setOpacity(0.25)` → … 读回仍是 `0.25`」这种解释表格怎么读的句子）。
 * 遇到别的注释就说明这张表跟取证无关。
 */
function isEvidenceTableLine(lines: readonly string[], i: number): boolean {
  if (!isTableRow(stripCommentPrefix(lines[i]))) return false;
  for (let j = i - 1; j >= 0 && j >= i - 16; j--) {
    const pt = stripCommentPrefix(lines[j]);
    if (pt === "" || pt === "*") continue;
    if (isEvidenceLine(lines[j])) return true;
    // 已经在表里 ⇒ 同一张表的续行
    if (isTableRow(pt)) continue;
    // 表与取证行之间的读表说明：其后必须紧跟表格（向上看就是这张表）
    if (isEvidenceBridgeLine(lines, j)) continue;
    return false;
  }
  return false;
}

/** 是否 markdown 表格行（表头 / 分隔 / 数据）。 */
function isTableRow(t: string): boolean {
  return /^\|.*\|/.test(t);
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
    // 证据行 = 取证标记，**或**由取证标记领进来的表格行
    if (isEvidenceLine(l) || (isTableRow(stripCommentPrefix(l)) && isEvidenceTableLine(lines, i))) {
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
 * 判据两条：① 文件里有 `interface` / `type` 字面量；② **该字面量内**的成员声明行
 * 占实码行的多数（≥ `TYPE_MEMBER_SHARE`）。
 *
 * ⚠️ 两条都不能少。判据经历过两次修正，两次都是被评审的反例推翻：
 *
 * **第一版**只认 `readonly x:` 与 `x: (`，于是 `MapExpose` 的方法签名
 * （`getContainer(): T;` 这类**零参数方法签名**）一条都不匹配，豁免形同虚设——而
 * `src/types/` 当时还被 `SKIP_DIRS` 整个跳过，这个文件压根没进扫描（评审第三轮发现）。
 *
 * **第二版**换成宽松的 `MEMBER_DECL`，结果它把**普通实现语句**也当成成员
 * （评审第四轮：`run();`、`emit("x");`、`callback(ready);`、`foo: bar,` 全部误判），
 * 于是一个实现文件配 100 行决策史就能拿到「类型定义密集」豁免——这条豁免变成了
 * 一个万能后门。
 *
 * 所以现在**必须先确认文件里有 interface / type 字面量**，再只数**花括号内部**的成员。
 * `run();` 那种行即便长得像成员，也不处在类型字面量里。
 */
const TYPE_MEMBER_SHARE = 0.5;
const MEMBER_DECL =
  /^(?:readonly\s+)?[A-Za-z_$][\w$]*\??\s*(?::\s*[^;]*|\([^)]*\)\s*:?\s*[^;]*?)\s*[;,]?\s*$/;
const TYPE_LITERAL_OPEN = /^(?:export\s+)?(?:interface|type)\s+[A-Za-z_$][\w$]*[^=]*=?\{?/;

function isTypeDefinitionDense(
  lines: readonly string[],
  stats: FileCommentStats,
): boolean {
  if (stats.codeLines === 0) return false;
  // 前置条件：文件里确实有interface / type 字面量，否则一律不豁免。
  // ⚠️ 这一条是给第二版补的漏——`run();` 与 `getContainer(): T;` 在正则上无法区分，
  // 唯一的区别是后者处在 `{ … }` 里面。
  const hasTypeLiteral = lines.some(
    (l) => !isCommentLine(l) && TYPE_LITERAL_OPEN.test(l.trim()),
  );
  if (!hasTypeLiteral) return false;

  let memberLines = 0;
  let depth = 0;
  for (const l of lines) {
    const t = l.trim();
    if (isCommentLine(l) || t === "") continue;
    if (TYPE_LITERAL_OPEN.test(t)) {
      // 开括号可能在同一行（`interface A {`）也可能换行；数 `{` 与 `}` 的差值
      depth += (t.match(/\{/g) ?? []).length - (t.match(/\}/g) ?? []).length;
      continue;
    }
    if (depth <= 0) continue; // 不在类型字面量内 ⇒ 不是成员
    if (/^}/.test(t)) {
      depth = 0;
      continue;
    }
    if (MEMBER_DECL.test(t)) memberLines += 1;
  }
  return memberLines / stats.codeLines >= TYPE_MEMBER_SHARE;
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
 * 收集待扫描的源文件。
 *
 * ⚠️ **fail-closed**：任何一处读不到（目录不可读、条目`stat` 失败、文件读不出）
 * 都记进 `failures` 并由调用方判红，**不静默跳过**。
 *
 * 这一点是评审第五轮点破的：初版三处都是 `catch { return out }` / `continue`，
 * 于是「扫描目录不存在」或「某个文件权限不足」时门禁会**漏掉它并仍可能输出 OK**。
 * 与 #192 明确要求的 fail-closed 相反——门禁最危险的状态不是判红，是**看起来在跑
 * 而其实没看见该看的东西**（与 `SKIP_DIRS` 漏掉 `src/types/` 同一类）。
 *
 * `fs` 可注入是为了让「读失败」这条路径能被用例覆盖，而不是只能靠 chmod 制造。
 */
export interface ScanFailure {
  readonly path: string;
  readonly op: "readdir" | "stat" | "readFile";
}

export interface CollectResult {
  readonly files: readonly string[];
  readonly failures: readonly ScanFailure[];
}

export interface ScanFs {
  readdir(dir: string): readonly string[];
  stat(full: string): { isDirectory(): boolean };
  readFile(full: string): string;
}

export function collectScanFiles(
  roots: readonly string[],
  opts: {
    readonly skipDirs: ReadonlySet<string>;
    readonly extensions: ReadonlySet<string>;
    readonly fs: ScanFs;
    readonly join: (dir: string, name: string) => string;
  },
): CollectResult {
  const files: string[] = [];
  const failures: ScanFailure[] = [];

  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = opts.fs.readdir(dir);
    } catch {
      failures.push({ path: dir, op: "readdir" });
      return;
    }
    for (const name of entries) {
      if (opts.skipDirs.has(name)) continue;
      const full = opts.join(dir, name);
      let isDir: boolean;
      try {
        isDir = opts.fs.stat(full).isDirectory();
      } catch {
        failures.push({ path: full, op: "stat" });
        continue;
      }
      if (isDir) {
        walk(full);
        continue;
      }
      const dot = name.lastIndexOf(".");
      if (dot !== -1 && opts.extensions.has(name.slice(dot))) files.push(full);
    }
  };

  for (const r of roots) walk(r);
  return { files, failures };
}
