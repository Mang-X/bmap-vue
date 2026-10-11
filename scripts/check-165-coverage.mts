#!/usr/bin/env node
/**
 * #165 覆盖门禁：清单与记录必须一一对应，且 `unaudited` **只能下降**。
 *
 * 判据（全部 fail-closed）：
 * 1. 记录文件必须存在且形状合法（缺失 = 判红，不按空集通过）；
 * 2. 每个可发布入口的每个公共名都必须有一条记录（新增导出不许「静默未核对」）；
 * 3. 记录里不许有已经不存在于任何入口的名字（避免用陈旧记录冒充覆盖）；
 * 4. `unaudited` 数量不得超过基线。
 *
 * 需要先 `pnpm build:package`（清单来自 `dist/<entry>.d.ts`，即**发布面**）。
 *
 * 用法：`pnpm check:165-coverage`
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coverageDrift,
  inventoryOf,
  readCoverageRecord,
  statusCounts,
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
const record = readCoverageRecord(recordFile);
const { missing, stale } = coverageDrift(inventory, record);
const counts = statusCounts(record);

const problems: string[] = [];
if (missing.length > 0) {
  problems.push(
    `${missing.length} 个公共导出没有任何处置记录（新增必须判定，不允许静默未核对）：` +
      `${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}`,
  );
}
if (stale.length > 0) {
  problems.push(
    `${stale.length} 条记录指向已不存在的导出（陈旧记录不能冒充覆盖）：` +
      `${stale.slice(0, 12).join(", ")}${stale.length > 12 ? " …" : ""}`,
  );
}
if (counts.unaudited > record.baseline.unaudited) {
  problems.push(
    `未核对数从基线 ${record.baseline.unaudited} 涨到 ${counts.unaudited}：` +
      `基线只允许下降。若确实新增了未核对的导出，请先判定它，再下调基线。`,
  );
}

const perEntry = Object.entries(inventory)
  .map(([entry, names]) => `${entry}=${names.length}`)
  .join(" ");
console.log(`[165-coverage] 发布面：${perEntry}（去重后 ${Object.keys(record.entries).length} 个名字）`);
console.log(
  `[165-coverage] 未核对 ${counts.unaudited}/${record.baseline.unaudited}（上限）｜` +
    `fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}`,
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`[165-coverage] FAIL: ${problem}`);
  process.exit(1);
}
console.log("[165-coverage] OK：清单与记录一一对应，且未核对数未超基线");
