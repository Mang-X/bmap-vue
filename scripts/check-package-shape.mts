#!/usr/bin/env node
/**
 * 发布包形状门禁：publint + attw + 版本锁（issue #45）
 *
 * 取代 `quality.yml` 里那两行内联命令。三处改动各有理由：
 *
 * 1. **锁版本**。原本 `npx -y publint .` / `npx -y @arethetypeswrong/cli` 每次从 registry
 *    取当时的最新版，lockfile 管不到。上游新增一条检查就能让昨天还绿的 PR 今天变红。
 * 2. **attw 判定从一句 grep 换成结构化断言**。grep 只看 `node16 (from ESM)` 一格，把
 *    `CJSResolvesToESM`（7 个子路径）与 `NoResolution`（6 个子路径）全藏住了。
 * 3. **attw 自己的退出码不再被 `|| true` 吞掉**。attw 崩溃（脚手架失败）与 attw 判了
 *    契约不满足，此前在这条命令里长得一模一样。
 *
 * ## publint 必须对着 `packages/bmap-vue` 跑
 *
 * 在仓库根跑 publint 会去 lint **整个 monorepo**（`bmap-vue-workspace`），报出
 * 「根 package.json 的 exports 被 Node 忽略」「没有 type 字段」之类与本包无关的噪声。
 * 本脚本显式把 cwd 设在包目录，并在注释里记下这个坑。
 *
 * ## 用法
 *
 * ```bash
 * pnpm build:package && pnpm check:package-shape
 * ```
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateAttwReport,
  unpinnedVersionIssues,
  type AttwReportLike,
} from "./package-shape-boundary.mts";

const root = resolve(import.meta.dirname, "..");
const pkgDir = resolve(root, "packages/bmap-vue");
const artifactsDir = resolve(root, ".artifacts");

function fail(lines: readonly string[]): never {
  console.error(`\n[check-package-shape] FAIL：${lines.length} 条`);
  for (const line of lines) console.error(`  - ${line}`);
  process.exit(1);
}

/* ---------------------------------------------------------------- 1) 版本锁 */

const rootManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
};
const pkgManifest = JSON.parse(readFileSync(resolve(pkgDir, "package.json"), "utf8")) as {
  devDependencies?: Record<string, string>;
};

const pinProblems = [
  ...unpinnedVersionIssues(rootManifest.devDependencies ?? {}, ["publint", "@arethetypeswrong/cli"]),
  ...unpinnedVersionIssues(pkgManifest.devDependencies ?? {}, ["@microsoft/api-extractor"]),
];
if (pinProblems.length > 0) fail(pinProblems);
console.log("[check-package-shape] 版本锁 OK：publint / attw / api-extractor 均精确锁定");

/* ---------------------------------------------------------------- 2) publint */

console.log(`\n[check-package-shape] publint (cwd=${pkgDir})`);
const publintBin = resolve(root, "node_modules/.bin/publint");
try {
  // publint 以退出码表达「有 error」；warning 不阻断（ESM-only 的 `main`/`module` 同指一个
  // 文件是本包的既有设计，不是缺陷），但输出照打出来供 review。
  execFileSync(publintBin, ["."], { cwd: pkgDir, stdio: "inherit", env: { ...process.env, CI: "1" } });
  console.log("[check-package-shape] publint OK");
} catch {
  fail(["publint 判定不通过（见上方输出）"]);
}

/* ---------------------------------------------------------------- 3) attw */

console.log("\n[check-package-shape] attw（结构化判定，取代 grep）");
const attwBin = resolve(root, "node_modules/.bin/attw");
let attwRaw: string | undefined;
let attwExit: number | null = 0;

/**
 * attw 的输出**必须由 shell 重定向落文件再读**，不能用 `execFileSync` 的 stdout 捕获。
 *
 * 实测：attw 在本包上产出 **134541 字节** JSON，且用**非零退出码**（有 problem 时）表示结论。
 * 这两件事同时发生时，`execFileSync` 的 `error.stdout` 会被**截断到 65536 字节**
 * （恰好 2^16，Node 管道读取的分块边界），于是 `JSON.parse` 抛
 * `Unterminated string in JSON at position 65536`。这与 `maxBuffer` 无关——调大它无效，
 * 因为截断发生在 stdout 缓冲而非缓冲上限。
 *
 * 症状极具迷惑性：同一个脚本连跑多次会**时绿时红**，而 attw 单独跑 4 次全部稳定。
 * 判据本身没问题，坏的是**读取方式**。attw 0.18.5 没有 `--out` 选项（只有 `--format json`
 * 走 stdout），因此唯一可靠的读法是让 shell 把 stdout 直接重定向进文件：那条路径不经过
 * Node 的管道缓冲。
 *
 * 退出码用 `spawnSync` 单独取，因此非零退出不影响报告文件的完整性。
 */
const attwOutFile = resolve(artifactsDir, "attw-report.json");
mkdirSync(artifactsDir, { recursive: true });
rmSync(attwOutFile, { force: true });
const attwRun = spawnSync(
  `${JSON.stringify(attwBin)} --pack . --format json > ${JSON.stringify(attwOutFile)}`,
  {
    cwd: pkgDir,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  },
);
if (existsSync(attwOutFile)) {
  attwRaw = readFileSync(attwOutFile, "utf8");
  attwExit = attwRun.status;
} else {
  // 非零退出在 attw 这里是**正常语义**（有 problem），不是脚手架失败：那正是原 CI
  // `|| true` 吞掉的东西。真正该红的是「连报告文件都没有」——那时判定根本没发生。
  fail([
    `attw 没有产出报告文件（脚手架失败，不等于通过）：status=${attwRun.status} ${attwRun.stderr ?? ""}`,
  ]);
}

// 显式守卫而不是直接 `JSON.parse(attwRaw)`：若上一段走到 fail()，TypeScript 知道它
// never 返回，但运行时 attwRaw 确实是 undefined。少了这句，症状会是一条莫名其妙的
// "Cannot read properties of undefined"，而不是「脚手架没跑起来」。
if (attwRaw === undefined) {
  fail(["attw 的输出为空：判定没有真的发生（fail-closed）"]);
}

let report: AttwReportLike | null = null;
try {
  report = JSON.parse(attwRaw) as AttwReportLike;
} catch {
  fail(["attw 的 JSON 解析失败：判定没有真的发生（fail-closed）"]);
}

const { problems, accepted } = evaluateAttwReport(report);
if (problems.length > 0) fail(problems.map((p) => `[${p.kind}] ${p.detail}`));

console.log("[check-package-shape] attw OK：无未登记的问题");
if (accepted.length > 0) {
  // 已审阅的例外**必须打印出来**。原来的 grep 让它们隐形，于是「有意接受」与「没看见」
  // 长得一样——这正是本门禁要消除的形态。
  console.log("[check-package-shape] attw 已知例外（逐条审阅、刻意接受）：");
  for (const item of accepted) {
    console.log(`  - ${item.detail}`);
  }
  console.log("  依据见 scripts/package-shape-boundary.mts#ATTW_EXCEPTIONS（修它们属 #158 的范围）");
}
if (attwExit !== null && attwExit !== 0) {
  console.log(
    `[check-package-shape] 注：attw 退出码 ${attwExit}（仅表示「有 problem」，结论以上面的判定为准）`,
  );
}

// 报告体积是这次修 bug 的关键证据，记一笔便于日后排查：「时绿时红」几乎总是 stdout
// 被截断，而不是判据出错。attw 报告 134541 字节 > 65536 的管道分块边界。
console.log(
  `[check-package-shape] attw 报告 ${attwRaw.length} 字节（> 65536 时必须走文件重定向，见上方注释）`,
);