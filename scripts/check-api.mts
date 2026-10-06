/**
 * API Extractor 公共 API report 门禁（issue #44 验收项「API report 只有经过审核的新 1.0 面」）
 *
 * 用法：
 * - `pnpm check:api`      —— 与 `packages/bmap-vue/etc/<出口>/bmap-vue.api.md` 基线比对；
 *                            报告缺失、报告漂移或分析报错都让进程以非零码退出。
 * - `pnpm generate:api`   —— `--local`：把当次产物写进基线（改了公共类型面之后运行并提交它）。
 *
 * ## 覆盖范围：七个出口全部有 report 与签名基线
 *
 * #188 之前，`.` / `./components` 这两个出口挂在一个**「预期失败即通过」的探针**上：
 * API Extractor 的符号表分析不了 Volar 为 SFC 生成的这段声明 ——
 *
 * ```ts
 * declare var __VLS_1: { ... }, __VLS_3: { ... }, __VLS_5: { ... };
 * ```
 *
 * 这种**多声明 `var`** 不会进入打包后的声明文件，于是 `dist/index.d.ts` 里留下对
 * `__VLS_1` 的 `typeof` **悬空引用**，AE 一碰到就抛 `Symbol not found for identifier`，
 * 消费方开 `skipLibCheck: false` 则报 `TS2304`（实测 51 处）。
 *
 * 根因不是「多声明 `var`」本身，而是**类型位置的 `typeof`**：AE 的 rollup 只保留
 * 导出面可达的符号，模块局部变量不在其中，引用它的 `__VLS_Slots` 却留了下来。
 * 实测把 `var` 拆开、改成 `type`、或换成已声明的唯一名，**都无效**。
 * 唯一成立的是给组件补 `defineSlots` —— Volar 会把插槽载荷**内联**进 `__VLS_Slots`，
 * 全程没有中间 `var`（且声明从此受模板校验）。
 *
 * 因此本门禁现在对**七个出口一视同仁**，分三层：
 *
 * - **API report**（`etc/<出口>/bmap-vue.api.md`）：AE 自己按空白归一后逐字符比。
 * - **未导出类型身份集合**（`etc/<出口>/forgotten-exports.json`）：`ae-forgotten-export`
 *   的符号名集合（滤掉 Volar 机器名），**全等**才通过（#159 二轮评审 P1）。**七个出口
 *   一律适用**；零容忍名单与机器名过滤的理由写在
 *   `api-forgotten-boundary.mts#FORGOTTEN_ZERO_TOLERANCE_ENTRIES` / `#VOLAR_MACHINE_NAME`。
 * - **类型级签名基线**（`etc/<出口>/bmap-vue.dts.md`，#159 引入）：`dist/<出口>.d.ts` 经
 *   TypeScript printer（`removeComments: true`）规范化后的全文快照。它补的是 report 补不到的
 *   那一层 —— report 对未导出类型只留 `typeof getXxx` 这种**名字引用**，底下那个函数的签名
 *   一改，report 文本不动、名字集合也不动，只有 d.ts 快照会红。
 *
 * 「声明本身对消费方是否合法」由 `check:dts-strict` 单独守：AE 通过**不等于**声明合法，
 * 那道门禁让消费方开 `skipLibCheck: false` 真编译一遍。
 *
 * 另外几道门继续守根入口与组件的其余面：`check:public-dts`（不泄漏 raw SDK / 官方类型包）、
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
import { PKG_DIR, releaseIdentityOf } from "./release-identity.mts";
import {
  collectForbiddenAdditions,
  forbiddenForgottenMessage,
  newForbiddenForgottenExports,
  publicForgottenExports,
  REPORTED_ENTRIES,
} from "./api-forgotten-boundary.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 发布包名，从 manifest 派生。签名基线的 header 里写着它——写死会让基线记录一个
 * 已经不存在的身份，而基线是要长期当契约守的（#45 评审 P1 同类问题）。
 */
const PKG_NAME = releaseIdentityOf(
  JSON.parse(readFileSync(resolve(ROOT, PKG_DIR, "package.json"), "utf8")),
).name;
const PKG = resolve(ROOT, "packages/bmap-vue");
const DIST = resolve(PKG, "dist");
const ETC = resolve(PKG, "etc");
const TEMP = resolve(ROOT, ".artifacts/api-extractor");

/**
 * 七个出口：report、未导出类型身份集合、签名基线都逐出口生效（#188 评审 P1 之后
 * 再无「不适用」的出口 —— 未清零的 `index` / `components` 也有基线，只是非空）。
 * 名单见 `api-forgotten-boundary.mts`（#188 起含 `index` / `components`）。
 *
 * #188 之前这里有两个名单（`REPORTED` 与 `KNOWN_BLOCKED`），两层判据各走一份。
 * 豁免撤销后两者合并成一份 —— 留一个纯别名 `ALL_ENTRIES = REPORTED` 只会让人
 * 以为两层判据还在。
 */
const REPORTED = REPORTED_ENTRIES;

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

type Entry = (typeof REPORTED)[number];

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
function expectedSignatureFile(entry: Entry): string {
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
  // 头两行说明对七个出口**同形**（#188 评审 P1 之后）：`__VLS_` 的出口级豁免撤销了，
  // 机器名改成**按名字**过滤，真实欠账照旧进身份集合基线。没有出口需要单独说明，
  // 因此这里不再按出口分支 —— 留一个恒为假的分支就等于留一个没人验证的开关。
  const note = [
    "> 这个出口同时有 API report 与 forgotten-export 身份集合（后者已滤掉 Volar 机器名）；",
    "> 本快照是第三层：report 对未导出类型只留 `typeof getXxx` 名字引用、集合只记符号名，",
    "> **同名结构**的漂移只有这里看得见（ADR 2026-09-25 决策 5 / #159 三轮评审 P1）。",
  ];
  return [
    `## API Signature Baseline for "${PKG_NAME}" (entry \`${subpath}\`)`,
    "",
    "> 由 `pnpm generate:api` 生成，请勿手工编辑。",
    `> 内容是 \`dist/${entry}.d.ts\` 经 TypeScript printer（\`removeComments: true\`）规范化后的全文。`,
    ...note,
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
  const missing = [...REPORTED]
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
  /** `ae-forgotten-export` 的符号名集合（排序去重，**已滤掉 Volar 机器名**），用于身份集合基线比对。 */
  forgotten: string[];
  /** 被过滤掉的 Volar 机器名个数。只进输出，让「滤掉了多少」可见 —— 静默过滤会让人以为欠账变少了。 */
  machineNameCount: number;
} {
  const collected: CollectedMessage[] = [];
  const result = Extractor.invoke(configFor(entry), {
    localBuild,
    toolFilename: "api-extractor",
    messageCallback: (message: {
      logLevel: string;
      messageId: string;
      text: string;
      handled?: boolean;
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
  // 滤掉 Volar 机器名（#188 评审 P1）：它们的名字由编译器决定、我们无权裁决，
  // 登记进冻结表等于给内部临时名发公共 API 通行证。**真实类型一个都不滤** ——
  // 首轮是按「出口」豁免的，等于在 index/components 上关掉了整层判据。
  // 过滤后的集合照旧参与全等比对、照旧拒绝新增。
  const allForgotten = [...forgottenSet].sort();
  const forgotten = publicForgottenExports(allForgotten);
  const machineNameCount = allForgotten.length - forgotten.length;
  if (process.argv.includes("--verbose")) {
    for (const message of collected) {
      console.log(`      ${message.logLevel}: ${message.text}`);
    }
  }
  return { result, summary, forgotten, machineNameCount };
}

/** AE **先落盘、后判定成败**；报错时把基线恢复成运行前的内容（原本不存在则删掉）。 */
function restoreBaseline(target: string, previous: string | undefined): void {
  if (previous === undefined) {
    rmSync(target, { force: true });
    return;
  }
  if (readFileSync(target, "utf8") !== previous) writeFileSync(target, previous);
}

/** 一个出口的 AE 跑批结果（`updateMode` 两阶段之间传递）。 */
interface EntryRun {
  readonly entry: Entry;
  readonly result: { errorCount: number; warningCount: number };
  readonly summary: string;
  readonly forgotten: readonly string[];
  readonly machineNameCount: number;
  readonly previousReport: string | undefined;
}

/**
 * `--local` 的**第一阶段**：只跑分析、只读基线，一个字节都不写。
 *
 * 存在的理由是**事务边界**（#160 评审 P1）：原先 `updateMode` 逐个出口直接落盘，
 * `advanced` / `composables` 写成功、`plugins` 被「新增未导出类型」拒绝时，只回滚了
 * `plugins` 自己 —— 前两个出口的新 report 留在工作树，而且后面的签名基线循环根本没跑到，
 * 于是「report 已更新、对应 `bmap-vue.dts.md` 未更新」的组合会被提交出去。
 * 改成 preflight 后，任何一个出口有 forbidden addition 都在**写任何文件之前**失败。
 *
 * AE 在 `localBuild=false` 下**不写** report（这是 `checkMode` 一直依赖的行为），
 * 所以这一阶段对 `etc/` 是纯只读的。
 */
function preflight(): EntryRun[] {
  const runs: EntryRun[] = [];
  for (const entry of REPORTED) {
    const target = reportPath(entry);
    // AE 需要 reportFolder 存在才会写；`localBuild=false` 下它只读，但保持目录存在以免
    // 拿到与 `updateMode` 不同的失败模式。
    mkdirSync(dirname(target), { recursive: true });
    const previousReport = existsSync(target) ? readFileSync(target, "utf8") : undefined;
    const { result, summary, forgotten, machineNameCount } = runExtractor(entry, false);
    if (result.errorCount > 0) {
      throw new Error(
        `[check-api] ${entry}: --local 期间分析报错 ${result.errorCount} 个（${summary || "无摘要"}）——` +
          `先修分析错误再重跑（--verbose 看明细）。本命令一个基线都还没写`,
      );
    }
    runs.push({ entry, result, summary, forgotten, machineNameCount, previousReport });
  }
  // 身份集合的判据在**所有**出口都跑完之后统一下（`collectForbiddenAdditions` 不短路）：
  // 非空就一次性报出全部待处置出口，并保证此时 `etc/` 一个字节都没被写过。
  // **七个出口一律参与**（#188 评审 P1）：`index` / `components` 的机器名已在
  // `runExtractor` 里按名字滤掉，剩下的真实欠账必须先处置，与其他出口同一把尺子。
  const refusals = collectForbiddenAdditions(
    runs.map((run) => ({
      entry: run.entry,
      baseline: readForgottenBaseline(run.entry),
      actual: run.forgotten,
    })),
  );
  if (refusals.length > 0) {
    throw new Error(
      `${forbiddenForgottenMessage(refusals)}\n` +
        `  出口已全部判定完毕，本次命令**没有写任何基线** ——` +
        ` 处置完上面每个名字后重跑即可。`,
    );
  }
  return runs;
}

/**
 * `--local` 的**第二阶段**：preflight 全绿后落盘。
 *
 * 这里仍保留逐出口的回滚 —— AE 的 `_writeApiReport` 早于 success 判定，写盘阶段的失败
 * （磁盘满 / 权限）同样会留下半写状态。preflight 挡住的是**判定**失败，写盘失败要靠回滚。
 */
function updateMode(): void {
  const runs = preflight();
  for (const run of runs) {
    const { entry, result, summary, forgotten, machineNameCount, previousReport } = run;
    const target = reportPath(entry);
    try {
      mkdirSync(dirname(target), { recursive: true });
      const fresh = runExtractor(entry, true);
      if (fresh.result.errorCount > 0) {
        throw new Error(
          `[check-api] ${entry}: 写盘期间分析报错 ${fresh.result.errorCount} 个` +
            `（${fresh.summary || "无摘要"}）—— 基线不可信，恢复运行前的内容`,
        );
      }
      // 用 preflight 判过的 `forgotten`，不用重跑那份：判据已在第一阶段全绿，二次判定只会
      // 让「为什么这次没被拒」变得不可解释。**七个出口都写**（#188 评审 P1）：
      // 机器名已在 `runExtractor` 里滤掉，剩下的是本库真实欠账，必须有基线才谈得上「拒绝新增」。
      writeForgottenBaseline(entry, forgotten);
    } catch (error) {
      restoreBaseline(target, previousReport);
      throw error;
    }
    const lines = readFileSync(target, "utf8").split("\n").length;
    console.log(
      `[check-api] ${entry}: 基线已生成 (${lines} 行, error=${result.errorCount}` +
        `${summary ? `, warning=${result.warningCount}: ${summary}` : ""}` +
        `${machineNameCount > 0 ? `, 另滤掉 ${machineNameCount} 个 Volar 机器名` : ""}` +
        `) → ${target}`,
    );
  }
  // 签名基线是**每个出口**都有的那一层（#159 三轮评审 P1），七个出口一律写。
  for (const entry of REPORTED) writeSignatureBaseline(entry);
}

/** 写某个出口的类型级签名基线（七个出口都写）。 */
function writeSignatureBaseline(entry: Entry): void {
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

/** 解析身份集合基线文件的内容；不是 JSON 数组返回 `undefined`，形状不对则按空集。 */
function parseForgottenFile(raw: string): string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return Array.isArray(parsed)
    ? parsed.filter((name): name is string => typeof name === "string")
    : [];
}

/**
 * 读出基线里的身份集合。
 *
 * **缺文件即判失败，不按空集处理**（#188 评审 P1 的直接后果）。原先这里返回 `[]`，
 * 于是「删掉基线文件」与「基线确实是空的」在判定上**完全一样** ——
 * `newForbiddenForgottenExports` 会把当前全部真实欠账当成「新增」拒绝，但那只是
 * 巧合般地挡住了删除；而 `preflight` 里那次判定发生在写盘之前，它一旦被绕过
 * （`--local` 的第二阶段，或任何把空集写回基线的路径）就等于洗掉了欠账。
 *
 * 刻意**不**提供任何「重建基线」的旁路：`index` / `components` 的首份基线已随本票
 * 提交（46 / 14 个名字），迁移完成后没有任何理由需要重建它，而任何重建入口都是
 * 「跑一次就把新欠账洗成基线」那条路的变体（#165 要堵的正是它）。真要新增欠账，
 * 先按 ADR `2026-09-25` 的二选一处置。
 */
function readForgottenBaseline(entry: string): string[] {
  const target = forgottenPath(entry);
  if (!existsSync(target)) {
    throw new Error(
      `${entry}: 未导出类型身份基线缺失 ${target}\n` +
        `  基线缺失**不能**按空集处理：那会让「当前全部欠账」看起来像「新增」，` +
        `而任何把空集写回去的路径都等于洗掉欠账。\n` +
        `  七个出口的基线都应随源码提交；若确实要新增欠账，先按 ADR 2026-09-25 的` +
        `二选一处置（升为公共导出 / 让引用消失），而不是重建基线。`,
    );
  }
  return parseForgottenFile(readFileSync(target, "utf8")) ?? [];
}

/**
 * 写某出口的未导出类型**身份集合**基线；内容没变就不动文件（免得空跑也制造 diff）。
 *
 * **只自动写「清理」方向**（判据与理由见 `api-forgotten-boundary.mts`）。「拒绝」时基线
 * **一个字节都不动** —— 否则「拒绝」只是个提示，红线照样被洗掉。AE 此时**已经**把该出口的
 * report 基线写掉了，所以调用方要一并回滚它（见 `updateMode` 里的 try/catch）。
 *
 * 这条**防御性复检**刻意保留（而不是只依赖 `preflight()`）：preflight 与写盘之间基线可能
 * 被外部改动（并发运行 / 手工编辑），那时这里仍要给出门禁错误而不是把欠账写进基线。
 * 因此文案必须按**当前** `forbiddenForgottenMessage` 的签名调用 —— 它收的是 refusal 数组，
 * 不是 `(entry, added, target)` 三个散参（评审抓到的正是这个失效兜底分支）。
 */
function writeForgottenBaseline(entry: Entry, symbols: readonly string[]): void {
  const target = forgottenPath(entry);
  const added = newForbiddenForgottenExports(entry, readForgottenBaseline(entry), symbols);
  if (added.length > 0) throw new Error(forbiddenForgottenMessage([{ entry, added }]));
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
 * - **新增**（当前有、基线没有）：冻结面不接受新的未导出类型。先按二选一
 *   处置（升为公共导出 / 让引用消失），确属刻意接受才更新基线；
 * - **清理**（基线有、当前没有）：名字留在基线里等于给它留了重新加回来的口子——评审举的
 *   「27 → 26 → 下次再涨回 27」在身份这一层同样成立，所以存量减少也必须同步基线。
 *
 * 刻意不用「当前 ⊆ 基线」的子集判据：子集判据下清理是**静默绿**的，基线会随时间烂掉，
 * 几个月后被删掉的名字仍然"合法"。全等是子集判据的严格加强，两处漏法都堵上。
 */
function forgottenBaselineFailure(entry: Entry, actual: readonly string[]): string | undefined {
  const target = forgottenPath(entry);
  if (!existsSync(target)) {
    // 提示**刻意不**说「跑 generate:api 重建」：那份基线是提交物，重建入口刻意不存在
    // （#188 评审 P1 —— 删文件再重建与 #165 那条洗基线路由只差一步）。
    return (
      `${entry}: 未导出类型身份基线缺失 ${target}\n` +
      `  基线是提交物，刻意没有重建入口（删掉再重建 = 把当前欠账洗成新基线）。\n` +
      `  从 git 恢复它（git checkout -- ${target.replace(ROOT + "/", "")}）；` +
      `  若确实要新增未导出类型，先按 ADR 2026-09-25 的二选一处置。`
    );
  }
  const expected = expectedForgottenFile(actual);
  const raw = readFileSync(target, "utf8");
  if (raw === expected) return undefined;
  const parsed = parseForgottenFile(raw);
  if (parsed === undefined) {
    return `${entry}: 未导出类型身份基线不是合法 JSON: ${target} —— 跑 pnpm generate:api 重新生成`;
  }
  const baseline = parsed;
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
    let machineNameCount = 0;
    try {
      ({ result, summary, forgotten, machineNameCount } = runExtractor(entry, false));
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
        `，未导出类型 ${forgotten.length} 个与身份基线一致` +
        `${machineNameCount > 0 ? `（另滤掉 ${machineNameCount} 个 Volar 机器名）` : ""}`,
    );
  }

  checkSignatureBaselines(failures);

  if (failures.length) {
    throw new Error(`[check-api] ${failures.length} 项未通过:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(
    `[check-api] OK: ${REPORTED.length} 份 API report 与基线一致，` +
      `${REPORTED.length} 份未导出类型身份集合基线一致（已滤掉 Volar 机器名），` +
      `${REPORTED.length} 份类型级签名基线一致`,
  );
}

/** 每个出口：比对 `etc/<entry>/bmap-vue.dts.md` 与当前 `dist` 的规范化签名。 */
function checkSignatureBaselines(failures: string[]): void {
  for (const entry of REPORTED) {
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
