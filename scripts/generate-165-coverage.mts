#!/usr/bin/env node
/**
 * 生成 / 更新 #165 覆盖记录（`docs/zh-CN/contributing/165-coverage.json`）。
 *
 * 行为：
 * - **保留**已有名字的处置（人工判定不会被生成器覆盖）；
 * - 新增公共名以 `unaudited` 落盘（并打印出来，提醒有人要判）；
 * - 已消失的名字连同记录一起删除；
 * - `baseline.unaudited` 只在 **下降** 时更新（上涨即 bug，门禁会拦）。
 *
 * 用法：`pnpm generate:165-coverage`
 */
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coverageDrift,
  inventoryOf,
  readCoverageRecord,
  statusCounts,
  type CoverageRecord,
  type CoverageStatus,
} from "./coverage-inventory.mts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = resolve(root, "packages/bmap-vue/dist");
const recordFile = resolve(root, "docs/zh-CN/contributing/165-coverage.json");

const entryPoints = [
  { entry: ".", dts: resolve(distRoot, "index.d.ts") },
  { entry: "./components", dts: resolve(distRoot, "components.d.ts") },
  { entry: "./composables", dts: resolve(distRoot, "composables.d.ts") },
  { entry: "./plugins", dts: resolve(distRoot, "plugins.d.ts") },
  { entry: "./resolver", dts: resolve(distRoot, "resolver.d.ts") },
  { entry: "./advanced", dts: resolve(distRoot, "advanced.d.ts") },
  { entry: "./ui-kit", dts: resolve(distRoot, "ui-kit.d.ts") },
];
const inventory = inventoryOf(entryPoints);

const previous: CoverageRecord = existsSync(recordFile)
  ? readCoverageRecord(recordFile)
  : { baseline: { unaudited: 0 }, entries: {} };

const names = new Set<string>();
for (const list of Object.values(inventory)) for (const name of list) names.add(name);

const entries: CoverageRecord["entries"] = {};
let added = 0;
for (const name of [...names].sort()) {
  const kept = previous.entries[name];
  if (kept) {
    entries[name] = kept;
    continue;
  }
  added += 1;
  entries[name] = { status: "unaudited" as CoverageStatus };
}

const next: CoverageRecord = {
  baseline: previous.baseline,
  entries,
};
const counts = statusCounts(next);
const { stale } = coverageDrift(inventory, next);

// 基线只能下降：新记录里 unaudited 变多说明有人在生成前把状态改回去了（或人工判定被覆盖）。
const baseline = Math.min(previous.baseline.unaudited || counts.unaudited, counts.unaudited);
const finalRecord: CoverageRecord = { baseline: { unaudited: baseline }, entries };

writeFileSync(recordFile, `${JSON.stringify(finalRecord, null, 2)}\n`);

console.log(`[165-coverage] 记录了 ${Object.keys(entries).length} 个公共名`);
console.log(
  `  未核对 ${counts.unaudited}｜已判定 ${counts.fixed + counts.retained + counts["not-applicable"] + counts.deferred}` +
    `（fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}）`,
);
if (added > 0) console.log(`  新增 ${added} 个名字，已按 \`unaudited\` 落盘 —— 需要逐个判定`);
if (stale.length > 0) console.log(`  移除了 ${stale.length} 个已消失的名字：${stale.join(", ")}`);
console.log(`  基线（unaudited 上限）：${baseline}`);
