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
 * 因此本门禁分两组：
 *
 * - `REPORTED`：能分析的出口 —— `./advanced` `./composables` `./plugins` `./resolver`
 *   `./ui-kit`，各有基线报告。它们恰好覆盖了根入口之外**不依赖 `.vue` 类型**的全部声明面。
 * - `KNOWN_BLOCKED`：`index` / `components` —— 用**探针**代替跳过：每次运行都真的跑一遍，
 *   并断言失败模式仍然是这一种。一旦它被修好（或变成别的错误）门禁会红，提示把这两个出口
 *   加进 `REPORTED`。**跳过而不探测**才是真正的风险：没人会发现阻塞已经消失或变质。
 *
 * 根入口与组件的类型面此时由另外四道门守：`check:public-dts`（不泄漏 raw SDK / 官方类型包）、
 * `tests/behavior/export-surface-freeze.test.ts`（值导出精确集合）、
 * `generate:api-diff:check`（根入口导出名 vs 官方参考）、`verify:package`（tarball 消费方 vue-tsc）。
 * 两个出口缺的那份「类型级签名快照」是已登记的欠账，不在 #44 里顺手修（它要动 SFC 声明生成，
 * 与冻结公共出口是两件事）。
 *
 * ## 配置与消息口径
 *
 * 共享设置（消息级别 / docModel / rollup 开关）在 `packages/bmap-vue/api-extractor.json`，
 * 本脚本只覆盖**逐出口**的三个字段（入口 d.ts、报告目录、临时目录）：
 *
 * - `ae-undocumented` / `ae-missing-release-tag` / 全部 tsdoc 消息配成 `none` ——
 *   仓库现有注释不是 TSDoc 体例，上百条噪音会把真消息淹掉；
 * - `ae-forgotten-export` 保留 `warning` —— 它正是「导出面之外被引用的类型」的信号
 *   （消费方没法为它命名），每条都算进 `warningCount`，并按 messageId 汇总在输出里；
 * - 本脚本用 `messageCallback` 接管**打印**（`handled=true` 只拦打印、不拦计数），
 *   所以 `result.errorCount` / `result.warningCount` 仍然可信；`--verbose` 打印每条消息正文。
 *
 * 比对本身交给 API Extractor（`apiReportChanged`，按空白归一后逐字符比），本脚本不再字节比对。
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

let baseConfig: Record<string, unknown> | undefined;
function readBaseConfig(): Record<string, unknown> {
  baseConfig ??= JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
  return baseConfig;
}

function reportPath(entry: string): string {
  return resolve(ETC, entry, "bmap-vue.api.md");
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
  if (process.argv.includes("--verbose")) {
    for (const message of collected) {
      console.log(`      ${message.logLevel}: ${message.text}`);
    }
  }
  return { result, summary };
}

function updateMode(): void {
  for (const entry of REPORTED) {
    const target = reportPath(entry);
    // API Extractor **不会**自己建 reportFolder：目录不存在时它只报 ApiReportFolderMissing
    // 并放弃写入（见 Extractor._writeApiReport 的“target file does not exist”分支）。
    mkdirSync(dirname(target), { recursive: true });
    const existedBefore = existsSync(target);
    const { result, summary } = runExtractor(entry, true);
    // 分析报错时写出的基线不可信（AE 仍会落盘）。把它留着等于给「坏基线」开了个提交口子，
    // 所以：报错就退出；文件是这次才被写出来的一并删掉，别留在工作区里待提交。
    if (result.errorCount > 0) {
      if (!existedBefore && existsSync(target)) rmSync(target, { force: true });
      throw new Error(
        `[check-api] ${entry}: --local 期间分析报错 ${result.errorCount} 个（${summary || "无摘要"}）——` +
          `基线不可信${existedBefore ? "，旧基线未改动" : "，已回滚新写出的文件"}；` +
          `先修分析错误再重跑（--verbose 看明细）`,
      );
    }
    if (!existsSync(target)) {
      throw new Error(`[check-api] ${entry}: --local 之后基线仍不存在: ${target}`);
    }
    const lines = readFileSync(target, "utf8").split("\n").length;
    console.log(
      `[check-api] ${entry}: 基线已生成 (${lines} 行, error=${result.errorCount}` +
        `${summary ? `, warning=${result.warningCount}: ${summary}` : ""}) → ${target}`,
    );
  }
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
    try {
      ({ result, summary } = runExtractor(entry, false));
    } catch (error) {
      failures.push(`${entry}: 分析抛错 —— ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    // 比对交给 AE 自己（它按 areEquivalentApiFileContents 判等），不要按字节再判一遍。
    if (result.apiReportChanged) {
      failures.push(
        `${entry}: API report 与基线不一致 —— 公共类型面变了。审阅 .artifacts/api-extractor/` +
          `${entry}/bmap-vue.api.md 后跑 pnpm generate:api 并把基线一起提交`,
      );
      continue;
    }
    if (result.errorCount > 0) {
      failures.push(`${entry}: 分析报错 ${result.errorCount} 个`);
      continue;
    }
    console.log(
      `[check-api] ${entry}: 与基线一致` +
        `${summary ? ` (warning=${result.warningCount}: ${summary})` : ""}`,
    );
  }

  probeKnownBlocked();

  if (failures.length) {
    throw new Error(`[check-api] ${failures.length} 项未通过:\n  - ${failures.join("\n  - ")}`);
  }
  console.log(`[check-api] OK: ${REPORTED.length} 份 API report 与基线一致`);
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
