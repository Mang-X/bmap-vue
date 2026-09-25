/**
 * API Extractor 公共 API report 门禁（issue #44 验收项「API report 只有经过审核的新 1.0 面」）
 *
 * 用法：
 * - `pnpm check:api`      —— 与 `packages/bmap-vue/etc/<出口>/bmap-vue.api.md` 基线比对；
 *                            报告缺失、报告漂移或分析报错都让进程以非零码退出。
 * - `pnpm generate:api`   —— `--local`：把当次产物写进基线（改了公共类型面之后运行并提交它）。
 *
 * ## 覆盖范围：哪些出口有报告、哪两个没有
 *
 * API Extractor 的符号表**无法**分析 Volar 为 SFC 生成的声明形态：`Map.vue.d.ts` 里那句
 *
 * ```ts
 * declare var __VLS_1: { ... }, __VLS_3: { ... }, __VLS_5: { ... };
 * ```
 *
 * 这种**多声明 `var`** 没有被 `vite-plugin-dts` 的 `bundleTypes` 带进合并后的声明文件，
 * 于是 `dist/index.d.ts` / `dist/components.d.ts` 里留下 `typeof __VLS_1` 这样的**悬空引用**，
 * API Extractor 一碰到就抛 `Symbol not found for identifier: __VLS_*`。
 *
 * 因此本门禁对这两个出口分两道：
 *
 * - **探针**：每次运行都真的跑一遍 AE，并断言失败模式仍然是这一种。一旦它被修好（或变成
 *   别的错误）门禁会红，提示把这两个出口加进 `REPORTED`。**跳过而不探测**才是真正的风险：
 *   没人会发现阻塞已经消失或变质。
 * - **类型级签名基线**（`etc/<出口>/bmap-vue.dts.md`，#159 评审 P1-1）：AE 分析不了不等于
 *   这两个出口没有基线。它是 `dist/<出口>.d.ts` 经 TypeScript printer
 *   （`removeComments: true`）规范化后的全文快照——`MapProps`、组件的 props / emits /
 *   slots / 暴露方法与根入口函数签名一改就红，`pnpm generate:api` 更新基线。
 *   只有探针没有基线，等于「已知分析不了 ⇒ 这两个出口的类型面没人守」。
 *
 * 另外五道门继续守根入口与组件的其余面：`check:public-dts`（不泄漏 raw SDK / 官方类型包）、
 * `tests/behavior/export-surface-freeze.test.ts`（值导出精确集合）、
 * `generate:api-diff:check`（根入口导出名 vs 官方参考）、`verify:package`（tarball 消费方 vue-tsc）。
 *
 * ## 配置与消息口径
 *
 * 共享设置（消息级别 / docModel / rollup 开关）在 `packages/bmap-vue/api-extractor.json`，
 * 本脚本只覆盖**逐出口**的三个字段（入口 d.ts、报告目录、临时目录）：
 *
 * - `ae-undocumented` / `ae-missing-release-tag` / 全部 tsdoc 消息配成 `none` ——
 *   仓库现有注释不是 TSDoc 体例，上百条噪音会把真消息淹掉；
 * - `ae-forgotten-export` 保留 `warning` —— 它正是「导出面之外被引用的类型」的信号，
 *   每条都算进 `warningCount`、按 messageId 汇总在输出里，并额外被**身份集合基线**
 *   `etc/<出口>/forgotten-exports.json` 钉死（#159 二轮评审 P1）：比**名字集合**而不是条数。
 *   只比条数会漏掉两种很实际的走法——同一次改动里「删一个旧的 + 新增一个新的」条数不变，
 *   以及「先把 27 降到 26、下一次再涨回 27」；集合基线两种都拦，因为新增的名字不在基线里、
 *   清理掉的名字留在基线里，**两个方向都要跑 `pnpm generate:api` 才能变绿**，于是每一次
 *   消长都出现在 diff 里。报告正文不含这些名字，所以这份集合是唯一能看见它们的基线；
 * - 本脚本用 `messageCallback` 接管**打印**（`handled=true` 只拦打印、不拦计数），
 *   所以 `result.errorCount` / `result.warningCount` 仍然可信；`--verbose` 打印每条消息正文。
 *
 * 比对本身交给 API Extractor（`apiReportChanged`，按空白归一后逐字符比），本脚本不再字节比对；
 * 签名基线与未导出类型集合基线则由本脚本自己做全等比（产物本身已规范化/已排序，不需要空白归一）。
 *
 * `--local` 写基线时，AE 是**先落盘再判定成败**的（`_writeApiReport` 早于 success 判定），
 * 所以分析报错时必须**回滚**旧文件内容，否则会留下一份被污染的基线（#159 评审 P2）。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = resolve(ROOT, "packages/bmap-vue");
const DIST = resolve(PKG, "dist");
const ETC = resolve(PKG, "etc");
const TEMP = resolve(ROOT, ".artifacts/api-extractor");

/** 有基线报告的出口（相对 `package.json#exports` 的键去掉 `./`）。 */
const REPORTED = ["advanced", "composables", "plugins", "resolver", "ui-kit"] as const;

/** 已知无法分析的出口：探针断言失败模式，而不是静默跳过。 */
const KNOWN_BLOCKED = ["index", "components"] as const;

/** Volar 悬空引用的失败特征。换成别的错误 ⇒ 门禁红，要求重新评估名单。 */
const KNOWN_BLOCKER_PATTERN = /Symbol not found for identifier: __VLS_/;

const require_ = createRequire(resolve(PKG, "package.json"));
const { Extractor, ExtractorConfig } = require_("@microsoft/api-extractor") as {
  Extractor: {
    invoke: (config: unknown, options?: Record<string, unknown>) => {
      readonly apiReportChanged: boolean;
      readonly errorCount: number;
      readonly warningCount: number;
      readonly succeeded: boolean;
    };
  };
  ExtractorConfig: {
    prepare: (input: {
      configFilePath: string;
      packageJsonFullPath: string;
      configObject: Record<string, unknown>;
    }) => unknown;
  };
};

type Entry = (typeof REPORTED)[number] | (typeof KNOWN_BLOCKED)[number];

/** 共享设置（消息级别 / docModel / rollup 开关）的唯一事实源。 */
const CONFIG_PATH = resolve(PKG, "api-extractor.json");

/**
 * `ae-forgotten-export` 的**身份集合基线**（#159 二轮评审 P1）：`etc/<出口>/forgotten-exports.json`。
 *
 * 这些名字不是「允许漏这么多」，而是「当前已知的存量欠账」——报告里未导出类型只剩一个名字，
 * 它们的结构漂移不会改变基线文本，**名字集合**是唯一还能看见它们的量。判据是全等：
 * 新增（不在基线里）与清理（基线里有、当前没有）都会红，逼着每一次消长都经 `generate:api`
 * 写进基线、出现在评审 diff 里；只比条数则允许 1-for-1 替换与跨提交回弹（评审原话）。
 * 存量清零后这些文件就是 `[]` —— 门禁从「存量清单」变成「零容忍」，机制本身要留着：它就是那道 freeze 门。
 */
function forgottenPath(entry: string): string {
  return resolve(ETC, entry, "forgotten-exports.json");
}

/** AE 给这条消息的固定句式：`The symbol "X" needs to be exported by the entry point <file>`。 */
const FORGOTTEN_SYMBOL_PATTERN = /The symbol "([^"]+)" needs to be exported by the entry point /;

/** 集合基线的期望内容：排序后的名字数组，`JSON.stringify(names, null, 2)` + 末尾换行。 */
function expectedForgottenFile(symbols: readonly string[]): string {
  return `${JSON.stringify([...symbols], null, 2)}\n`;
}

let baseConfig: Record<string, unknown> | undefined;
function readBaseConfig(): Record<string, unknown> {
  baseConfig ??= JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  return baseConfig;
}

function reportPath(entry: string): string {
  return resolve(ETC, entry, "bmap-vue.api.md");
}

/** 类型级签名基线（AE 分析不了的两个出口）。 */
function signaturePath(entry: string): string {
  return resolve(ETC, entry, "bmap-vue.dts.md");
}

const ts = require_("typescript") as typeof import("typescript");

/**
 * 签名基线的期望内容：`dist/<entry>.d.ts` 经 TypeScript printer（`removeComments: true`）
 * 规范化后的全文，套进 markdown 代码块。
 *
 * 用 printer 而不是正则删注释：d.ts 里存在字符串字面量（含 URL），按 `//` 删会把类型截断；
 * printer 同时把引号、缩进、换行一并规范化，产物因此是**稳定**的（同一输入必然同一输出），
 * 注释改动也不会让基线抖动。
 */
function expectedSignatureFile(entry: string): string {
  const fileName = resolve(DIST, `${entry}.d.ts`);
  const parsed = ts.createSourceFile(
    fileName,
    readFileSync(fileName, "utf8"),
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS,
  );
  const body = ts
    .createPrinter({ removeComments: true })
    .printFile(parsed)
    .replace(/\n+$/, "");
  const subpath = entry === "index" ? "." : `./${entry}`;
  return [
    `## API Signature Baseline for "bmap-vue" (entry \`${subpath}\`)`,
    "",
    "> 由 `pnpm generate:api` 生成，请勿手工编辑。",
    `> 内容是 \`dist/${entry}.d.ts\` 经 TypeScript printer（\`removeComments: true\`）规范化后的全文。`,
    "> API Extractor 分析不了这两个出口的 Volar \`__VLS_\` 悬空引用，",
    "> 但它们的类型面仍必须有一份会变红的基线（ADR 2026-09-25 决策 5 / #159 评审 P1-1）。",
    "",
    "```ts",
    body,
    "```",
    "",
  ].join("\n");
}

/**
 * 以 `api-extractor.json` 为底，只覆盖**逐出口**的三个字段。
 *
 * 路径一律写成绝对值而不是配置里的 `<projectFolder>` 令牌：本脚本把 configObject 直接交给
 * `ExtractorConfig.prepare`，不经过 CLI 的令牌展开，写绝对值就没有「令牌在什么时候展开」的歧义。
 */
function configFor(entry: Entry): unknown {
  return ExtractorConfig.prepare({
    configFilePath: CONFIG_PATH,
    packageJsonFullPath: resolve(PKG, "package.json"),
    configObject: {
      ...readBaseConfig(),
      projectFolder: PKG,
      mainEntryPointFilePath: resolve(DIST, `${entry}.d.ts`),
      compiler: { tsconfigFilePath: resolve(PKG, "tsconfig.build.json") },
      apiReport: {
        enabled: true,
        // 一个出口一个目录：报告文件名固定是 <projectName>.api.md，只能靠目录区分出口。
        reportFolder: `${resolve(ETC, entry)}/`,
        reportTempFolder: `${resolve(TEMP, entry)}/`,
      },
    },
  });
}

function assertDist(): void {
  const missing = [...REPORTED, ...KNOWN_BLOCKED]
    .map((entry) => `${entry}.d.ts`)
    .filter((name) => !existsSync(resolve(DIST, name)));
  if (missing.length) {
    throw new Error(
      `[check-api] dist 缺少声明产物: ${missing.join(", ")} —— 先跑 pnpm build:package` +
        `（门禁按 CI 顺序：typecheck 在 build 之前，build 会清空 dist）`,
    );
  }
}

type CollectedMessage = { logLevel: string; messageId: string; text: string };

/**
 * 跑一次分析，**把消息收进内存**而不是让 AE 直接打到控制台。
 *
 * AE 的默认行为是把每条 warning 逐行打出来；`ae-forgotten-export` 在本仓库有上百条
 * （导出面之外被引用的类型），逐行刷屏会把真消息淹掉。收进来之后按 messageId 汇总成一行。
 */
function runExtractor(entry: Entry, localBuild: boolean): {
  result: ReturnType<typeof Extractor.invoke>;
  summary: string;
  /** `ae-forgotten-export` 的符号名集合（排序去重），用于身份集合基线比对。 */
  forgotten: string[];
} {
  const collected: CollectedMessage[] = [];
  const result = Extractor.invoke(configFor(entry), {
    localBuild,
    toolFilename: "api-extractor",
    messageCallback: (message: {
      logLevel: string;
      messageId: string;
      text: string;
      formatMessageWithoutLocation(): string;
    }) => {
      // 只收进计数器的两类：其余（ae-undocumented 等）已按 api-extractor.json 配成 none，
      // 它们的 logLevel 是 none，不进 errorCount/warningCount，收进来只会让汇总对不上账。
      if (message.logLevel === "warning" || message.logLevel === "error") {
        collected.push({
          logLevel: message.logLevel,
          messageId: message.messageId,
          text: message.formatMessageWithoutLocation(),
        });
      }
      // handled=true 只拦「打印」，不拦 error/warning 计数（见 ExtractorMessage.handled 注释），
      // 所以 result.errorCount 仍然是可信的门禁信号。
      message.handled = true;
    },
  });
  const counts = new Map<string, number>();
  for (const message of collected) {
    counts.set(message.messageId, (counts.get(message.messageId) ?? 0) + 1);
  }
  const summary = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, count]) => `${id}×${count}`)
    .join(", ");
  // 身份集合：从消息正文里把符号名取出来（上游句式变了就红，不静默降级成「读不出＝0 条」）。
  const forgottenSet = new Set<string>();
  for (const message of collected) {
    if (message.messageId !== "ae-forgotten-export") continue;
    const match = FORGOTTEN_SYMBOL_PATTERN.exec(message.text);
    if (match === null) {
      throw new Error(
        `[check-api] ${entry}: 无法从 ae-forgotten-export 消息解析符号名 —— 上游句式变了？\n${message.text}`,
      );
    }
    forgottenSet.add(match[1]!);
  }
  const forgotten = [...forgottenSet].sort();
  if (process.argv.includes("--verbose")) {
    for (const message of collected) {
      console.log(`      ${message.logLevel}: ${message.text}`);
    }
  }
  return { result, summary, forgotten };
}

/** AE **先落盘、后判定成败**；报错时把基线恢复成运行前的内容（原本不存在则删掉）。 */
function restoreBaseline(target: string, previous: string | undefined): void {
  if (previous === undefined) {
    rmSync(target, { force: true });
    return;
  }
  if (readFileSync(target, "utf8") !== previous) writeFileSync(target, previous);
}

function updateMode(): void {
  for (const entry of REPORTED) {
    const target = reportPath(entry);
    // API Extractor **不会**自己建 reportFolder：目录不存在时它只报 ApiReportFolderMissing
    // 并放弃写入（见 Extractor._writeApiReport 的“target file does not exist”分支）。
    mkdirSync(dirname(target), { recursive: true });
    // 跑之前先留一份：`_writeApiReport` 早于 success 判定执行，`localBuild` 下即使 errorCount > 0
    // 也会把既有基线覆盖掉（#159 评审 P2）。只删新写的文件是不够的 —— 老基线同样会被改。
    const previous = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    let run: ReturnType<typeof runExtractor>;
    try {
      run = runExtractor(entry, true);
    } catch (error) {
      // AE 抛错（报告可能已落盘）与「解析不出符号名」走同一条回滚路径，不留半写状态。
      restoreBaseline(target, previous);
      throw error;
    }
    const { result, summary, forgotten } = run;
    // 分析报错时写出的基线不可信。把它留着等于给「坏基线」开了个提交口子，所以：报错就回滚。
    if (result.errorCount > 0) {
      restoreBaseline(target, previous);
      throw new Error(
        `[check-api] ${entry}: --local 期间分析报错 ${result.errorCount} 个（${summary || "无摘要"}）——` +
          `基线不可信，已${previous === undefined ? "删除新写出的文件" : "恢复运行前的旧内容"}；` +
          `先修分析错误再重跑（--verbose 看明细）`,
      );
    }
    if (!existsSync(target)) {
      throw new Error(`[check-api] ${entry}: --local 之后基线仍不存在: ${target}`);
    }
    writeForgottenBaseline(entry, forgotten);
    const lines = readFileSync(target, "utf8").split("\n").length;
    console.log(
      `[check-api] ${entry}: 基线已生成 (${lines} 行, error=${result.errorCount}` +
        `${summary ? `, warning=${result.warningCount}: ${summary}` : ""}) → ${target}`,
    );
  }
  for (const entry of KNOWN_BLOCKED) writeSignatureBaseline(entry);
}

/** 写两个 AE 分析不了的出口的类型级签名基线。 */
function writeSignatureBaseline(entry: string): void {
  const target = signaturePath(entry);
  mkdirSync(dirname(target), { recursive: true });
  const expected = expectedSignatureFile(entry);
  if (existsSync(target) && readFileSync(target, "utf8") === expected) {
    console.log(`[check-api] ${entry}: 签名基线未变 → ${target}`);
    return;
  }
  writeFileSync(target, expected);
  console.log(`[check-api] ${entry}: 签名基线已生成 → ${target}`);
}

/** 写某出口的未导出类型**身份集合**基线；内容没变就不动文件（免得空跑也制造 diff）。 */
function writeForgottenBaseline(entry: string, symbols: readonly string[]): void {
  const target = forgottenPath(entry);
  mkdirSync(dirname(target), { recursive: true });
  const expected = expectedForgottenFile(symbols);
  if (existsSync(target) && readFileSync(target, "utf8") === expected) {
    console.log(`[check-api] ${entry}: 未导出类型集合未变 (${symbols.length} 个)`);
    return;
  }
  writeFileSync(target, expected);
  console.log(`[check-api] ${entry}: 未导出类型集合已写入 (${symbols.length} 个) → ${target}`);
}

/**
 * 比对 `ae-forgotten-export` 的**身份集合**与基线，**全等**才通过（#159 二轮评审 P1）。
 *
 * 两个方向都红，而且都要求跑 `pnpm generate:api`，好让每一次消长都出现在评审 diff 里：
 *
 * - **新增**（当前有、基线没有）：冻结面不接受新的未导出类型。先按 ADR 2026-09-25 的二选一
 *   处置（升为公共导出 / 让引用消失），确属刻意接受才更新基线；
 * - **清理**（基线有、当前没有）：名字留在基线里等于给它留了重新加回来的口子——评审举的
 *   「27 → 26 → 下次再涨回 27」在身份这一层同样成立，所以存量减少也必须同步基线。
 *
 * 刻意不用「当前 ⊆ 基线」的子集判据：子集判据下清理是**静默绿**的，基线会随时间烂掉，
 * 几个月后被删掉的名字仍然"合法"。全等是子集判据的严格加强，两处漏法都堵上。
 */
function forgottenBaselineFailure(entry: string, actual: readonly string[]): string | undefined {
  const target = forgottenPath(entry);
  if (!existsSync(target)) {
    return `${entry}: 未导出类型身份基线缺失 ${target} —— 跑 pnpm generate:api 并提交它`;
  }
  const expected = expectedForgottenFile(actual);
  const raw = readFileSync(target, "utf8");
  if (raw === expected) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `${entry}: 未导出类型身份基线不是合法 JSON: ${target} —— 跑 pnpm generate:api 重新生成`;
  }
  const baseline = Array.isArray(parsed)
    ? parsed.filter((name): name is string => typeof name === "string")
    : [];
  const added = actual.filter((name) => !baseline.includes(name));
  const removed = baseline.filter((name) => !actual.includes(name));
  const details =
    [
      ...(added.length ? [`新增 ${added.length} 个: ${added.join(", ")}（基线里没有）`] : []),
      ...(removed.length
        ? [`清理掉 ${removed.length} 个: ${removed.join(", ")}（仍留在基线里）`]
        : []),
      ...(added.length === 0 && removed.length === 0
        ? ["集合内容一致，但文件不是生成器的规范化形式（被手工编辑过）"]
        : []),
    ].join("；");
  const temp = resolve(TEMP, entry, "forgotten-exports.json");
  mkdirSync(dirname(temp), { recursive: true });
  writeFileSync(temp, expected);
  return (
    `${entry}: 未导出类型身份基线漂移 —— ${details}。审阅 ${temp} 后跑 pnpm generate:api` +
    ` 并把基线一起提交（新增的必须先按 ADR 2026-09-25 的二选一处置，别用生成器盖过去）`
  );
}

function probeKnownBlocked(): void {
  for (const entry of KNOWN_BLOCKED) {
    let thrown: unknown;
    try {
      runExtractor(entry, false);
    } catch (error) {
      thrown = error;
    }
    if (thrown === undefined) {
      throw new Error(
        `[check-api] ${entry}: 之前挡住 API Extractor 的 Volar __VLS_ 阻塞**消失了** ——` +
          `把这个出口加进 REPORTED，让它的类型面也进基线报告。`,
      );
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (!KNOWN_BLOCKER_PATTERN.test(message)) {
      throw new Error(
        `[check-api] ${entry}: 分析失败，但不是已登记的 Volar __VLS_ 阻塞：\n${message}`,
      );
    }
    console.log(`[check-api] ${entry}: 已知阻塞（Volar __VLS_ 悬空引用）仍然成立，探针通过`);
  }
}

function checkMode(): void {
  const failures: string[] = [];
  for (const entry of REPORTED) {
    const target = reportPath(entry);
    if (!existsSync(target)) {
      failures.push(`${entry}: 基线报告缺失 ${target} —— 跑 pnpm generate:api 并提交它`);
      continue;
    }
    let result: ReturnType<typeof Extractor.invoke>;
    let summary = "";
    let forgotten: string[] = [];
    try {
      ({ result, summary, forgotten } = runExtractor(entry, false));
    } catch (error) {
      failures.push(`${entry}: 分析抛错 —— ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    // 分析报错时消息不全，比出来的集合不可信 —— 先报错，别拿半截集合去和基线比。
    if (result.errorCount > 0) {
      failures.push(`${entry}: 分析报错 ${result.errorCount} 个（${summary || "无摘要"}）`);
      continue;
    }
    let entryFailed = false;
    // 未导出类型在报告里只剩一个名字，结构漂移不改基线文本 ⇒ 只有**名字集合**可比（二轮评审 P1）。
    const forgottenFailure = forgottenBaselineFailure(entry, forgotten);
    if (forgottenFailure !== undefined) {
      failures.push(forgottenFailure);
      entryFailed = true;
    }
    // 比对交给 AE 自己（它按 areEquivalentApiFileContents 判等），不要按字节再判一遍。
    if (result.apiReportChanged) {
      failures.push(
        `${entry}: API report 与基线不一致 —— 公共类型面变了。审阅 .artifacts/api-extractor/` +
          `${entry}/bmap-vue.api.md 后跑 pnpm generate:api 并把基线一起提交`,
      );
      entryFailed = true;
    }
    if (entryFailed) continue;
    console.log(
      `[check-api] ${entry}: 与基线一致` +
        `${summary ? ` (warning=${result.warningCount}: ${summary})` : ""}` +
        `，未导出类型 ${forgotten.length} 个与身份基线一致`,
    );
  }

  checkSignatureBaselines(failures);
  probeKnownBlocked();

  if (failures.length) {
    throw new Error(`[check-api] ${failures.length} 项未通过:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(
    `[check-api] OK: ${REPORTED.length} 份 API report 与基线一致，` +
      `${REPORTED.length} 份未导出类型身份集合基线一致，` +
      `${KNOWN_BLOCKED.length} 份类型级签名基线一致`,
  );
}

/** AE 分析不了的两个出口：比对 `etc/<entry>/bmap-vue.dts.md` 与当前 `dist` 的规范化签名。 */
function checkSignatureBaselines(failures: string[]): void {
  for (const entry of KNOWN_BLOCKED) {
    const target = signaturePath(entry);
    if (!existsSync(target)) {
      failures.push(`${entry}: 签名基线缺失 ${target} —— 跑 pnpm generate:api 并提交它`);
      continue;
    }
    const expected = expectedSignatureFile(entry);
    if (readFileSync(target, "utf8") === expected) {
      console.log(
        `[check-api] ${entry}: 类型级签名基线一致 (${expected.split("\n").length} 行)`,
      );
      continue;
    }
    const temp = resolve(TEMP, entry, "bmap-vue.dts.md");
    mkdirSync(dirname(temp), { recursive: true });
    writeFileSync(temp, expected);
    failures.push(
      `${entry}: 类型级签名基线漂移 —— dist/${entry}.d.ts 的签名变了。` +
        `审阅 ${temp} 后跑 pnpm generate:api 并把基线一起提交`,
    );
  }
}

function main(): void {
  assertDist();
  if (process.argv.includes("--local")) {
    updateMode();
    return;
  }
  checkMode();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
