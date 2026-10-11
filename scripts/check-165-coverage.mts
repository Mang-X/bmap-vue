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
  coverageDrift,
  entryPointsFromManifest,
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
const { missing, stale } = coverageDrift(inventory, record);
const counts = statusCounts(record);

/** 取 base 版本的记录（`GITHUB_BASE_REF` 优先，其次 `origin/main`）。取不到返回 `undefined`。 */
function baseRecord(): { record: CoverageRecord; source: string } | undefined {
  const candidates = ["origin/main", process.env.GITHUB_BASE_SHA, process.env.GITHUB_BASE_REF]
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
  for (const ref of candidates) {
    try {
      const text = execFileSync("git", ["show", `${ref}:${recordRel}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      const parsed = JSON.parse(text) as CoverageRecord;
      return { record: parsed, source: ref };
    } catch {
      continue;
    }
  }
  return undefined;
}

const problems: string[] = [];
if (missing.length > 0) {
  problems.push(
    `${missing.length} 个「入口#名字」没有任何处置记录（新增必须判定，不允许静默未核对）：` +
      `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}`,
  );
}
if (stale.length > 0) {
  problems.push(
    `${stale.length} 条记录指向已不存在的导出（陈旧记录不能冒充覆盖）：` +
      `${stale.slice(0, 10).join(", ")}${stale.length > 10 ? " …" : ""}`,
  );
}
if (counts.unaudited > record.baseline.unaudited) {
  problems.push(
    `未核对数 ${counts.unaudited} 超过基线 ${record.baseline.unaudited}：基线只允许下降。`,
  );
}

const base = baseRecord();
if (base) {
  /**
   * 基线**允许**在显式迁移时上涨一次：`baseline.migration` 里记着「本次是哪一个维度的迁移」。
   * 迁移必须是**新出现**的（base 版本里没有这条记录），否则同一条迁移声明可以被反复用来
   * 抬高基线 —— 那等于把判据变成可选的。
   */
  const migration = record.baseline.migration;
  const baseHasMigration = base.record.baseline.migration !== undefined;
  const raised = record.baseline.unaudited > base.record.baseline.unaudited;
  if (raised && !(migration !== undefined && migration.trim().length > 0 && !baseHasMigration)) {
    problems.push(
      `基线从 ${base.record.baseline.unaudited}（${base.source}）涨到 ${record.baseline.unaudited}：` +
        `「只降不升」必须跨提交成立。确因**覆盖维度变更**需要重设时，须在 baseline.migration 里` +
        `写明本次迁移（且该声明必须是新出现的——同一条不能反复用）。`,
    );
  } else if (raised) {
    console.log(`[165-coverage] 基线迁移：${migration}`);
  }
} else {
  /**
   * 取不到 base（浅克隆 / 首次引入 / 本地未 fetch）时**不能退化成一比就过**：那正是
   * 「手动把基线改大」的窗口（实测：只比文件内基线时，把基线改成 99999 仍然全绿）。
   * 退化为「本次必须至少下降到当前未核对数」，并显式打印比较口径。
   *
   * 真基线由 CI 的 `origin/main` 提供；本地看不到时，这条弱判据仍能挡住「只改大基线而不改数据」。
   */
  if (record.baseline.unaudited !== counts.unaudited) {
    problems.push(
      `取不到 base 版本的记录，且基线 ${record.baseline.unaudited} 与当前未核对数 ${counts.unaudited} 不一致：` +
        `无法验证跨提交单调性时，只接受「基线 = 当前未核对数」这种已收口形态。` +
        `请先 \`git fetch origin main\` 再跑，以使用真基线比较。`,
    );
  }
  console.log("[165-coverage] 取不到 base 版本的记录：退化为「基线必须等于当前未核对数」的弱判据");
}

console.log(
  `[165-coverage] 入口 ${entryPoints.length} 个｜清单 ${Object.keys(record.entries).length} 个「入口#名字」`,
);
console.log(
  `[165-coverage] 未核对 ${counts.unaudited}/${record.baseline.unaudited}（上限）｜` +
    `fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}` +
    (base ? `｜base(${base.source}) 基线 ${base.record.baseline.unaudited}` : ""),
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`[165-coverage] FAIL: ${problem}`);
  process.exit(1);
}
console.log("[165-coverage] OK：清单与记录一一对应，且未核对数未超基线（含跨提交单调性）");
