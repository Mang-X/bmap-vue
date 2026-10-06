#!/usr/bin/env node
/**
 * 注释卫生门禁（issue #192）
 *
 * 只判一条：单文件的「注释行 / 实码行」比不得超阈值（且须是真债务，不是实测证据）。
 *
 * ⚠️ 这里**刻意没有**「注释不得引用 ADR / issue / 文档路径」这条判据，尽管它一度是本门禁
 * 的主判据。实测推翻了它：核对全部 499 处剩余引用后，**没有一处是纯重复**——每一处都在
 * 承载实质理由，删掉编号只会把注释变成没有依据的断言，例如：
 *
 * ```text
 * 让「没传」=「不表象」（决策 5）   ← 删掉编号就成了没有依据的断言
 * 释放顺序是硬约束（§6）：卸载时先解绑业务事件  ← 编号是这条约束的出处
 * ```
 *
 * ADR 与 issue 引用在本仓是**合理习惯**，不是债。详见 issue #192 与
 * `comment-hygiene-boundary.mts` 文件头。
 *
 * ## 范围刻意只含 `packages/bmap-vue/src` 与 `scripts`
 *
 * - `docs/**` 是**文档本身**，它引用 ADR 与 issue 是天经地义的；
 * - `tests/**` 的注释常在解释「为什么这条断言要这么写」，大量带票号是刻意留的线索；
 * - `node_modules` / `dist` / `.artifacts` 是外来物，扫了只会产出噪声。
 *
 * 新增范围时要重新想一遍：这个目录里的注释引用文档，是**该清理的债**还是**合理的线索**？
 *
 * ```bash
 * pnpm check:comment-hygiene
 * ```
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_LIMITS,
  collectScanFiles,
  scanFilesContent,
  type CommentIssue,
  type ScanFailure,
} from "./comment-hygiene-boundary.mts";

const root = resolve(import.meta.dirname, "..");

/** 纳入扫描的目录（相对仓库根）。理由见文件头。 */
const SCAN_ROOTS = ["packages/bmap-vue/src", "scripts"] as const;

/** 纳入扫描的扩展名。 */
const EXTENSIONS = new Set([".ts", ".mts", ".vue"]);

/**
 * 不扫描的目录名（**只按名字匹配**）。
 *
 * ⚠️ 这里刻意**不含 `types`**。原来的名单里有它，本意是跳过 `node_modules/@types`，
 * 但 `SKIP_DIRS.has(name)` 只看目录名，于是本仓自己的 `src/types/`（2 个文件）与
 * `src/driver/types/`（11 个文件）也被一起跳过——13 个源文件从这道门禁的视野里消失了。
 *
 * 代价是具体的：`src/types/mapExpose.ts`（79 注释 / 21 实码 = 3.8:1）正是「类型定义
 * 密集」豁免的**真实样本**，而它压根没被扫过——豁免有没有用、判据准不准，都无从验证。
 * 门禁最危险的状态不是判红，是**看起来在跑而其实没看见该看的东西**。
 *
 * `node_modules` 已在根层被排除（不在 `SCAN_ROOTS` 里），`dist` / `.artifacts` /
 * `.pnpm` 是构建产物。外部 `@types` 由 `node_modules` 一条覆盖，不需要单列。
 */
const SKIP_DIRS = new Set(["node_modules", "dist", ".artifacts", ".pnpm"]);

const issues: CommentIssue[] = [];
const failures: ScanFailure[] = [];

const scanFs = {
  readdir: (d: string) => readdirSync(d),
  stat: (f: string) => statSync(f),
  readFile: (f: string) => readFileSync(f, "utf8"),
};

const collected = collectScanFiles(
  SCAN_ROOTS.map((r) => resolve(root, r)),
  { skipDirs: SKIP_DIRS, extensions: EXTENSIONS, fs: scanFs, join },
);
failures.push(...collected.failures);

// 读取 + 判定同样走可注入的纯函数（`scanFilesContent`）：这样「文件读不出」这条
// fail-closed 路径也能被单测锁住，而不是只能靠 chmod 制造。
const content = scanFilesContent(collected.files, {
  fs: scanFs,
  rel: (full) => relative(root, full).split(sep).join("/"),
  limits: DEFAULT_LIMITS,
});
issues.push(...content.issues);
failures.push(...content.failures);
const scanned = content.scanned;

// ⚠️ **fail-closed**：读不到任何一处都判红。初版三处都是静默 `continue`，
// 于是「扫描目录不可读」或「某个文件读不出」时门禁会漏掉它并仍可能输出 OK——
// 与 #192 要求的 fail-closed 相反。门禁最危险的状态不是判红，是**看起来在跑
// 而其实没看见该看的东西**。
if (failures.length > 0) {
  console.error(
    `\n[check-comment-hygiene] FAIL：${failures.length} 处读不到（扫了 ${scanned} 个文件）\n`,
  );
  for (const f of failures.slice(0, 20)) {
    console.error(`    ${f.op}  ${f.path}`);
  }
  if (failures.length > 20) console.error(`    … 另有 ${failures.length - 20} 处`);
  console.error(
    "\n  判据是 fail-closed：读不到就不能算「没问题」。先修可读性（权限 / 路径 /\n  是否为断链），再谈注释卫生。",
  );
  process.exit(1);
}

if (issues.length > 0) {
  const byKind = new Map<string, CommentIssue[]>();
  for (const i of issues) {
    const list = byKind.get(i.kind) ?? [];
    list.push(i);
    byKind.set(i.kind, list);
  }

  console.error(`\n[check-comment-hygiene] FAIL：${issues.length} 条（扫了 ${scanned} 个文件）\n`);
  for (const [kind, list] of byKind) {
    console.error(`  ${kind} × ${list.length}`);
    for (const i of list.slice(0, 10)) {
      console.error(`    ${i.file}:${i.line}  ${i.detail}`);
    }
    if (list.length > 10) {
      console.error(`    … 另有 ${list.length - 10} 处`);
    }
    console.error("");
  }
  console.error("  判据与处置口径见 issue #192 与 scripts/comment-hygiene-boundary.mts 文件头。");
  process.exit(1);
}

console.log(`[check-comment-hygiene] OK：注释卫生（扫了 ${scanned} 个文件）`);
console.log("  单文件注释/实码比不超阈值（含实测证据主体 / 类型定义密集的豁免）。");