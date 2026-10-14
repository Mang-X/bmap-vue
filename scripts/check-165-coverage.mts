#!/usr/bin/env node
/**
 * #165 覆盖门禁。四条判据（全部 fail-closed）：
 *
 * 1. 记录文件必须存在且**通过完整校验**（基线是非负整数、已判定项有非空 note…）；
 * 2. 每个入口的每个公共名都必须有一条 `入口#名字` 记录（新增导出不许「静默未核对」）；
 * 3. 记录里不许有已不存在于任何入口的键（陈旧记录不能冒充覆盖）；
 * 4. `unaudited` 不得超过基线，且当能取到**上一版**记录时，基线本身也**不得上涨**
 *    （同文件内两个值可被一起改大，只比较它们等于没比较）。
 *
 * 第 4 条的跨提交部分靠 `git show <ref>:<file>`；取不到 base（浅克隆 / 首次提交）时退化为
 * 只比较文件内基线，并**打印说明**——不静默假装比过了。
 *
 * 需要先 `pnpm build:package`。用法：`pnpm check:165-coverage`
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  entryPointsFromManifest,
  evaluateCoverage,
  inventoryOf,
  readCoverageRecord,
  statusCounts,
  type CoverageRecord,
} from "./coverage-inventory.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(root, "packages/bmap-vue/dist");
const recordRel = "docs/zh-CN/contributing/165-coverage.json";
const recordFile = resolve(root, recordRel);

const pkg = JSON.parse(readFileSync(resolve(root, "packages/bmap-vue/package.json"), "utf8"));
const entryPoints = entryPointsFromManifest(pkg, distRoot);

const inventory = inventoryOf(entryPoints);
const record = readCoverageRecord(recordFile);

/**
 * 取 **base 版本**的记录。选源顺序刻意与 CI 触发场景对齐：
 *
 * - PR：`GITHUB_BASE_SHA`（workflow 显式注入 `github.event.pull_request.base.sha`）——
 *   不能用 `origin/main`，否则对 `2.x` / `next` 的 PR 会与**错误的目标分支**比较；
 * - PR 的次选：`origin/${GITHUB_BASE_REF}`（目标分支名）；
 * - push：`GITHUB_BEFORE_SHA`（`github.event.before`），否则 `HEAD^`；push 到 main 时
 *   `origin/main` 通常就是本次 HEAD，拿它比较自己永远发现不了上涨。
 *
 * 返回 `missing: "absent"` 表示「base 里还没有这份文件」（首次引入），与「取不到 ref」区分开：
 * 前者是合法初态，后者是基础设施问题，不能混为一谈。
 */
function baseRecord():
  | { kind: "found"; record: CoverageRecord; source: string }
  | { kind: "absent"; source: string }
  | { kind: "unavailable" } {
  const candidates: string[] = [];
  const baseSha = process.env.GITHUB_BASE_SHA;
  const before = process.env.GITHUB_BEFORE_SHA;
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseSha) candidates.push(baseSha);
  if (baseRef) candidates.push(`origin/${baseRef}`);
  if (before && !/^0{40}$/.test(before)) candidates.push(before);
  candidates.push("HEAD^");

  for (const ref of candidates) {
    let text: string;
    try {
      text = execFileSync("git", ["show", `${ref}:${recordRel}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const message = String((error as { stderr?: unknown }).stderr ?? "");
      // 文件在 base 里不存在 = 首次引入（合法初态），与「ref 取不到」区分开
      if (/exists on disk, but not in|does not exist in|: did not match/.test(message)) {
        return { kind: "absent", source: ref };
      }
      continue;
    }
    try {
      return { kind: "found", record: JSON.parse(text) as CoverageRecord, source: ref };
    } catch {
      continue;
    }
  }
  return { kind: "unavailable" };
}

/**
 * 判定本身只有一处实现（`evaluateCoverage`，纯函数、无 I/O），这里只负责**组装输入**：
 * 清单 / 当前记录 / base 记录。`base.kind === "found"` 的跨提交路径由
 * `tests/behavior/165-coverage-gate.test.ts` 直接驱动（#215 第六轮评审缺的那条全链路判据）。
 */
const base = baseRecord();
const evaluation = evaluateCoverage({ inventory, record, base });
for (const note of evaluation.notes) console.log(note);
const problems = evaluation.problems;
const counts = statusCounts(record);
console.log(
  `[165-coverage] 入口 ${entryPoints.length} 个｜清单 ${Object.keys(record.entries).length} 个「入口#名字」`,
);
console.log(
  `[165-coverage] 未核对 ${counts.unaudited}/${record.baseline.unaudited}（上限）｜` +
    `consistent ${counts.consistent} / fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}` +
    (base.kind === "found" ? `｜base(${base.source}) 基线 ${base.record.baseline.unaudited}` : ""),
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`[165-coverage] FAIL: ${problem}`);
  process.exit(1);
}
console.log("[165-coverage] OK：清单与记录一一对应，且未核对数未超基线（含跨提交单调性）");
