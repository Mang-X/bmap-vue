#!/usr/bin/env node
/**
 * 删除注释里的 **ADR 编号** 与**仓库内文档路径**（issue #192）
 *
 * ## 范围只含这两类，不含 issue 引用
 *
 * 用户明确要求删除的是「ADR 引用」。实测构成：ADR 30 处 + 文档路径 14 处 = 43 处，
 * 而 issue 引用有 456 处——**不在本脚本范围内**。
 *
 * ## 为什么要写得比 `scrub-comment-refs.mts` 保守
 *
 * 那个脚本的教训：正则分不清「引用」与「句子成分」，曾把
 * `（M4-HANDLE-UX / issue #29）` 改成 `（M4-HANDLE-UX /`。本脚本只删**自包含的引用片段**
 * （ADR 编号、`.md` 路径、以及包裹它们的括号/「见」等连接词），不重排周边文字，
 * 删完若括号失衡或留下连接符就**跳过该行**。
 *
 * 用法：`node --experimental-strip-types scripts/strip-adr-refs.mts [--dry]`
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry");

const SCAN_ROOTS = ["packages/bmap-vue/src", "scripts"];
const EXTENSIONS = new Set([".ts", ".mts", ".vue"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".artifacts", ".pnpm", "types"]);

/** 门禁脚本与本脚本自身要排除：它们在解释这些引用，删掉等于毁掉判据的文档。 */
const EXCLUDE = new Set([
  "scripts/strip-adr-refs.mts",
  "scripts/scrub-comment-refs.mts",
  "scripts/check-comment-hygiene.mts",
  "scripts/comment-hygiene-boundary.mts",
  "scripts/toolchain-boundary.mts",
  "scripts/check-toolchain.mts",
  "tests/behavior/comment-hygiene-gate.test.ts",
  "tests/behavior/toolchain-gate.test.ts",
]);

/**
 * 待删除的片段。**只删引用本身**，连带它自带的包裹括号与前置连接词。
 *
 * 形态来自实测的 43 处，不是猜的：
 * - `ADR 2026-09-11 §6`（带节号）
 * - `见 ADR 2026-09-14`（带「见」）
 * - `（ADR 2026-09-13 决策 3、4）`（括号包裹 + 决策号）
 * - `ADR \`2026-09-14-map-controlled-state\``（反引号 + slug）
 * - `` `docs/zh-CN/components/map.md` ``（反引号包裹的路径）
 * - `详见 \`docs/…md\`。`（前置「详见」+ 句号）
 */
const PATTERNS: readonly RegExp[] = [
  // ADR：可选前置「见/详见/依据/参见」，可选反引号，可带 §节号 与 「决策 N」
  // ⚠️ slug 必须**整段**吃掉：ADR 文件名形如 `2026-09-11-jsapi-v4-driver-foundation.md`，
  // 只吃 `[a-z-]*` 会留下 `4-driver-foundation` 这种碎片（实测踩到）。
  /(?:见|详见|依据|参见|参见)?\s*ADR\s*`?\s*\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)*\s*`?(?:\s*§\s*\d+)?(?:\s*的)?(?:\s*决策\s*[\d、和及]+)?/gi,
  // 仓库内文档路径：可选前置「见/详见/契约见」+ 反引号
  /(?:见|详见|契约见|取用方式见|适用范围见)?\s*`?docs\/[\w./-]+\.md`?/g,
  // `docs/adr/….md` 已被上一条覆盖；这里补 `fixtures/…` 这类同仓路径引用
  /`?fixtures\/[\w./-]+\.(?:ts|tgz)`?/g,
];

/** 括号配平（全角 / 半角各算各的）。 */
function balanced(text: string): boolean {
  const count = (re: RegExp): number => (text.match(re) ?? []).length;
  return count(/（/g) === count(/）/g) && count(/\(/g) === count(/\)/g);
}

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
    else if (EXTENSIONS.has(name.slice(name.lastIndexOf(".")))) out.push(full);
  }
  return out;
}

let changedFiles = 0;
let cleaned = 0;
const skipped: string[] = [];

for (const scanRoot of SCAN_ROOTS) {
  for (const file of collectFiles(resolve(root, scanRoot))) {
    const rel = file.slice(root.length + 1).split("\\").join("/");
    if (EXCLUDE.has(rel)) continue;

    const original = readFileSync(file, "utf8");
    const lines = original.split("\n");
    let fileChanged = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const m = /^(\s*)(\/\/|\*|<!--)/.exec(line);
      if (m === null) continue;

      const body = line.slice(m[0].length);
      if (!/ADR\s*\d{4}-\d{2}-\d{2}|docs\/[\w./-]+\.md/.test(body)) continue;

      let next = body;
      for (const re of PATTERNS) next = next.replace(re, "");

      // 安全闸 2：留下**孤立的 slug 碎片**（形如 `4-only-baseline`）⇒ 跳过。
      // 判据：删ADR 后若还剩「数字开头且含连字符」的片段，说明 slug 没被整段吃掉。
      if (/\b\d{1,2}-[a-z][\w-]*\b/.test(next)) {
        skipped.push(`${rel}:${i + 1}  ${line.trim().slice(0, 76)}`);
        continue;
      }

      // 安全闸：括号失衡 ⇒ 跳过（删引用不该破坏句子结构）
      if (!balanced(next)) {
        skipped.push(`${rel}:${i + 1}  ${line.trim().slice(0, 76)}`);
        continue;
      }

      // 清掉删除后残留的孤立标点与多余空白（`（，）` → `（）`、`见  ：` → `：`）
      let trimmed = next
        .replace(/[（(]\s*[，,、；;]\s*[）)]/g, "")
        .replace(/[，,、；;]\s*[）)]/g, "）")
        .replace(/[（(]\s*[，,、；;]/g, "（")
        .replace(/\s+([，,。：:；;）)])/g, "$1")
        .replace(/（\s*）/g, "")
        .trim();

      // 整行只剩标点 ⇒ 删整行
      if (/^[，,。：:；;、\s]*$/.test(trimmed)) {
        lines[i] = undefined as unknown as string;
      } else {
        lines[i] = `${m[1]}${m[2]} ${trimmed}`;
      }
      fileChanged = true;
      cleaned += 1;
    }

    const out = lines.filter((l): l is string => l !== undefined).join("\n");
    if (fileChanged && out !== original) {
      changedFiles += 1;
      if (!DRY) writeFileSync(file, out, "utf8");
    }
  }
}

console.log(`[strip-adr-refs]${DRY ? "（dry-run，未写盘）" : "已写盘"}`);
console.log(`  改动 ${changedFiles} 个文件，清理 ${cleaned} 行`);
if (skipped.length > 0) {
  console.log(`  ⚠️ 跳过 ${skipped.length} 行（删除会破坏括号配平，需人工处理）：`);
  for (const s of skipped) console.log(`    ${s}`);
}
console.log("\n  人工核对建议：git diff | grep -E '^[-+]\\s*(\\*|//|<!--)'逐行看过再提交。");