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
  invalidExemptKeys,
  inventoryOf,
  migrationIsFresh,
  regressedJudgedKeys,
  readCoverageRecord,
  statusCounts,
  unjudgedNewKeys,
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
if (base.kind === "unavailable") {
  /**
   * 取不到任何 base：**不退化成一比就过**（实测那样把基线改成 99999 仍会全绿）。
   * 退化为「基线必须等于当前未核对数」，并打印比较口径。
   */
  if (record.baseline.unaudited !== counts.unaudited) {
    problems.push(
      `取不到 base 版本的记录（已尝试 GITHUB_BASE_SHA / origin/<base_ref> / GITHUB_BEFORE_SHA / HEAD^），` +
        `且基线 ${record.baseline.unaudited} 与当前未核对数 ${counts.unaudited} 不一致：` +
        `无法验证跨提交单调性时，只接受「基线 = 当前未核对数」这种已收口形态。`,
    );
  }
  console.log("[165-coverage] 取不到 base 版本的记录：退化为「基线必须等于当前未核对数」的弱判据");
} else if (base.kind === "absent") {
  console.log(`[165-coverage] base（${base.source}）里还没有这份记录：按首次引入处理，只比较文件内基线`);
} else {
  /**
   * 基线**允许**在显式迁移时上涨一次：`baseline.migration` 里记着「本次是哪一个维度的迁移」。
   * 迁移必须是**新出现**的（base 版本里没有这条记录），否则同一条迁移声明可以被反复用来
   * 抬高基线 —— 那等于把判据变成可选的。
   */
  const migration = record.baseline.migration;
  const migrationFresh = migrationIsFresh(migration, base.record.baseline.migration);
  const raised = record.baseline.unaudited > base.record.baseline.unaudited;
  if (raised && !migrationFresh) {
    problems.push(
      `基线从 ${base.record.baseline.unaudited}（${base.source}）涨到 ${record.baseline.unaudited}：` +
        `「只降不升」必须跨提交成立。确因**覆盖维度变更**需要重设时，须在 baseline.migration 里` +
        `写明本次迁移（内容必须相对 base 是新的——同一条不能反复用）。`,
    );
  } else if (raised) {
    console.log(`[165-coverage] 基线迁移：${migration?.reason}`);
  }

  /**
   * **净额抵消**：(#215 第三轮评审 P1) 只比总数时，「新增 1 个未核对 + 判掉/删除 1 个旧的」
   * 可以让总数不变而新符号从未被判定。这里逐个要求：本次新出现的键必须**已经判定**
   * （非 `unaudited` 且带 note —— 后者由 readCoverageRecord 保证）。
   */
  /**
   * 只有**内容相对 base 是新的**迁移才给豁免；同一条声明重复用不给。
   * 豁免是 migration 里**精确列出**的键，没有「缺省 = 全豁免」这条路（第四轮评审 P1）。
   */
  const exemptNewKeys = migrationFresh ? (migration?.exemptNewKeys ?? []) : [];
  if (exemptNewKeys.length > 0) {
    const invalid = invalidExemptKeys(exemptNewKeys, record.entries, base.record.entries);
    if (invalid.length > 0) {
      problems.push(
        `${invalid.length} 条豁免声明指向的不是「本次新增且仍未判定」的键（清单过期或抄错）：` +
          `${invalid.slice(0, 10).join(", ")}${invalid.length > 10 ? " …" : ""}`,
      );
    }
  }
  const undecided = unjudgedNewKeys(record.entries, base.record.entries, { exemptNewKeys });
  /**
   * 已判定的结论不能无痕回退（第五轮评审 P1）：只比未核对总数时，
   * 「A: fixed → unaudited」会被「B: unaudited → retained」净额抵消。
   */
  const regressed = regressedJudgedKeys(record.entries, base.record.entries);
  if (regressed.length > 0) {
    problems.push(
      `${regressed.length} 个**已判定**的键被退回 unaudited（审计结论不能靠别处的进展冲抵；` +
        `确需重新审计请显式说明并由评审放行）：` +
        `${regressed.slice(0, 10).join(", ")}${regressed.length > 10 ? " …" : ""}`,
    );
  }
  if (undecided.length > 0) {
    problems.push(
      `${undecided.length} 个**本次新增**的键仍是 unaudited（不允许用「判掉/删除旧项」抵消总数）：` +
        `${undecided.slice(0, 10).join(", ")}${undecided.length > 10 ? " …" : ""}`,
    );
  }
}

console.log(
  `[165-coverage] 入口 ${entryPoints.length} 个｜清单 ${Object.keys(record.entries).length} 个「入口#名字」`,
);
console.log(
  `[165-coverage] 未核对 ${counts.unaudited}/${record.baseline.unaudited}（上限）｜` +
    `fixed ${counts.fixed} / retained ${counts.retained} / n-a ${counts["not-applicable"]} / deferred ${counts.deferred}` +
    (base.kind === "found" ? `｜base(${base.source}) 基线 ${base.record.baseline.unaudited}` : ""),
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`[165-coverage] FAIL: ${problem}`);
  process.exit(1);
}
console.log("[165-coverage] OK：清单与记录一一对应，且未核对数未超基线（含跨提交单调性）");
