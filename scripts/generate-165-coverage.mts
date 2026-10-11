#!/usr/bin/env node
/**
 * 生成 / 更新 #165 覆盖记录（`docs/zh-CN/contributing/165-coverage.json`）。
 *
 * 行为：
 * - **保留**已有键的处置（人工判定不会被生成器覆盖）；
 * - 新增 `入口#名字` 以 `unaudited` 落盘（并打印出来，提醒有人要判）；
 * - 已消失的键连同记录一起删除；
 * - `baseline.unaudited` **只降不升**：已有文件时取 `min(旧基线, 当前未核对数)`，
 *   **不用 `||`**（`0 || n` 会让「已经收口到 0」的基线重新上涨）。
 *
 * 用法：`pnpm generate:165-coverage`（需要先 `pnpm build:package`）
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coverageDrift,
  coverageKey,
  entryPointsFromManifest,
  inventoryOf,
  readCoverageRecord,
  statusCounts,
  type CoverageRecord,
} from "./coverage-inventory.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(root, "packages/bmap-vue/dist");
const recordFile = resolve(root, "docs/zh-CN/contributing/165-coverage.json");

const pkg = JSON.parse(readFileSync(resolve(root, "packages/bmap-vue/package.json"), "utf8"));
// 入口从**发布 manifest** 派生：新增子路径不会被静默漏检。
const entryPoints = entryPointsFromManifest(pkg, distRoot);

const inventory = inventoryOf(entryPoints);

const previous: CoverageRecord = existsSync(recordFile)
  ? readCoverageRecord(recordFile)
  : { baseline: { unaudited: 0 }, entries: {} };

const keys = new Set<string>();
for (const [entry, names] of Object.entries(inventory)) {
  for (const name of names) keys.add(coverageKey(entry, name));
}

const entries: CoverageRecord["entries"] = {};
let added = 0;
for (const key of [...keys].sort()) {
  const kept = previous.entries[key];
  if (kept) {
    entries[key] = kept;
    continue;
  }
  added += 1;
  entries[key] = { status: "unaudited" };
}

const draft: CoverageRecord = { baseline: previous.baseline, entries };
const counts = statusCounts(draft);
const { stale } = coverageDrift(inventory, draft);

// **只降不升**：已有文件时用旧基线；首次初始化才等于当前未核对数。
// 刻意不用 `||` —— 基线为 0 时 `0 || n` 会取到 n，让收口阶段重新上涨。
const baseline = existsSync(recordFile)
  ? Math.min(previous.baseline.unaudited, counts.unaudited)
  : counts.unaudited;

writeFileSync(
  recordFile,
  `${JSON.stringify(
    {
      baseline: {
        unaudited: baseline,
        // 迁移声明是**一次性**的：写到已经重设过的记录上就失去意义（check 脚本会拒绝重复使用）。
        ...(baseline === previous.baseline.unaudited && previous.baseline.migration
          ? { migration: previous.baseline.migration }
          : {}),
      },
      entries,
    },
    null,
    2,
  )}\n`,
);

console.log(`[165-coverage] 入口 ${entryPoints.length} 个：${entryPoints.map((p) => p.entry).join(" ")}`);
console.log(`[165-coverage] 记录了 ${Object.keys(entries).length} 个「入口#名字」`);
console.log(
  `  未核对 ${counts.unaudited}｜已判定 ${counts.fixed + counts.retained + counts["not-applicable"] + counts.deferred}` +
    `（fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}）`,
);
if (added > 0) console.log(`  新增 ${added} 个键，已按 \`unaudited\` 落盘 —— 需要逐个判定`);
if (stale.length > 0) console.log(`  移除了 ${stale.length} 个已消失的键`);
console.log(`  基线（unaudited 上限）：${baseline}`);
