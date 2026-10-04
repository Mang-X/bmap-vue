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
  checkCommentRatio,
  countLines,
  type CommentIssue,
} from "./comment-hygiene-boundary.mts";

const root = resolve(import.meta.dirname, "..");

/** 纳入扫描的目录（相对仓库根）。理由见文件头。 */
const SCAN_ROOTS = ["packages/bmap-vue/src", "scripts"] as const;

/** 纳入扫描的扩展名。 */
const EXTENSIONS = new Set([".ts", ".mts", ".vue"]);

/** 不扫描的目录名。 */
const SKIP_DIRS = new Set(["node_modules", "dist", ".artifacts", ".pnpm", "types"]);

/** 递归列出待扫描的源文件（`sep` 换 `/`，让报错里的路径跨平台一致）。 */
function collectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectFiles(full, out);
    else {
      const dot = name.lastIndexOf(".");
      if (dot !== -1 && EXTENSIONS.has(name.slice(dot))) out.push(full);
    }
  }
  return out;
}

const issues: CommentIssue[] = [];
let scanned = 0;

for (const scanRoot of SCAN_ROOTS) {
  const abs = resolve(root, scanRoot);
  for (const file of collectFiles(abs)) {
    scanned += 1;
    const relPath = relative(root, file).split(sep).join("/");
    let lines: string[];
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch {
      // 读不到就不判这一条：这不是本门禁该红的事（那是别的问题）。
      continue;
    }
    issues.push(...checkCommentRatio(relPath, countLines(lines), DEFAULT_LIMITS, lines));
  }
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
console.log("  单文件注释/实码比不超阈值（含实测证据主体 / 实测更正 / 类型定义密集的豁免）。");