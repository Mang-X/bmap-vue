#!/usr/bin/env node
/**
 * 官方对照基准的采集编排（issue #140）
 *
 * ```bash
 * pnpm perf:contrast
 * ```
 *
 * 产物：`.artifacts/perf-contrast/contrast-report.json`（由基准自己写）+ stdout 的人读表格。
 *
 * ## 这个脚本只做三件事
 *
 * 1. 跑 `vitest tests/performance/official-contrast.perf.test.ts`，让基准**自己**产报告；
 * 2. 读回那份报告，跑**纯函数**判定（`checkContrastEnvelope` / `decideContrastExit`）；
 * 3. 渲染人读表格并写退出码。
 *
 * 判定逻辑**不在这里**（在 `tests/performance/official-contrast/report.mts`），渲染也不在这里
 * （`formatContrastReport`）。与 `collect-live-performance.mts` 同一分工：编排归编排，
 * 纯逻辑归纯逻辑 —— 因此判定与渲染可以用合成输入直接单测，不必起浏览器或跑基准。
 *
 * ## 退出码
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | `0` | 采齐、信封自检通过、不变式未破 |
 * | `1` | **不变式被破坏**（本库侧的架构预期没了）——唯一能返回 1 的原因 |
 * | `2` | 脚手架失败（基准没跑起来 / 报告缺失 / 官方版本漂移） |
 * | `3` | blocked——**不是通过** |
 *
 * 刻意**没有**「比官方慢就算回退」：那是票面禁止的营销式排名。绝对毫秒只进报告。
 *
 * ## 两条容易变成假绿的接线（都被钉住）
 *
 * - **「采齐了没」数的是真测到的场景，不是填了行的场景**：报告永远按场景表逐条产出一行，
 *   因此 `scenarios.length` 恒等于场景表条数；这里数 `ours !== null` 的行，并额外要求每条
 *   可比较场景都真的拿到官方侧读数。
 * - **基准红了不等于脚手架坏了**：不变式被破坏时 vitest 非零退出，编排**按报告判定结算**，
 *   判定为不变式破坏就如实给 1。
 * - **报告说没事 ≠ 进程说没事**（反方向同样要钉）：基准里大量**普通 `expect`** 不写进
 *   `invariants` 判定模型，其中一条挂掉时 `afterAll` 仍可能写出 `done=true` / 不变式全 PASS
 *   的报告。「vitest 非零 + 报告判 0」这种组合按 2 结算，绝不按报告放行。
 *
 * ## 约束（`node --experimental-strip-types`）
 *
 * 不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATASET_VERSION } from "../tests/performance/dataset.ts";
import {
  checkContrastEnvelope,
  decideContrastExit,
  formatContrastReport,
  OFFICIAL_BASELINE_VERSION,
  type ContrastDecision,
  type ContrastReport,
} from "../tests/performance/official-contrast/report.mts";
import { CONTRAST_SCENARIOS } from "../tests/performance/officialScenarios.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const CONTRAST_DIR = resolve(repoRoot, ".artifacts/perf-contrast");

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/** 报告路径可覆盖，便于 CI 把 artifact 收到别处。 */
const reportPath = resolve(repoRoot, argValue("out") ?? resolve(CONTRAST_DIR, "contrast-report.json"));
const runId = randomUUID();

/** 基准跑满 10 场景 + 官方侧各 5 次采样，给足余量（§6/§7 的 5 万点最慢）。 */
const BENCH_TIMEOUT_MS = Number(argValue("timeout") ?? 600_000);

function runBenchmark(): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        // 用 vitest 的 JS API 之外最朴素的一种：`vitest run` 子进程。这样基准跑在与本脚本
        // 无关的环境里，它的 `process.env`（CONTRAST_RUN_ID / PERF_CONTRAST_DIR）由我们注入。
        //
        // ⚠️ 必须用**对照基准自己的**配置，不能用 `tests/performance/vitest.config.ts`：
        // 那是 #37 单库趋势基线的配置，它把 `PERF_METRICS_DIR` 喂给 `baseline.json` 的
        // 指标集校验。反过来也不能把对照基准挂在基线配置下（它已被那份配置 exclude），
        // 否则 `perf:baseline` 顺带跑一遍跨库基准 → 指标集漂移 → `performance` job 红
        // （#140 第 2 轮评审第 3 条）。两份配置的隔离理由见
        // `tests/performance/official-contrast.vitest.config.ts` 文件头。
        resolve(repoRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        "tests/performance/official-contrast.vitest.config.ts",
      ],
      {
        cwd: repoRoot,
        stdio: hasFlag("quiet") ? "ignore" : "inherit",
        env: {
          ...process.env,
          // 基准按这三个环境变量把自己写的报告落到我们指定的位置、并认我们生成的 runId。
          PERF_CONTRAST_DIR: CONTRAST_DIR,
          PERF_CONTRAST_REPORT: reportPath,
          CONTRAST_RUN_ID: runId,
        },
      },
    );
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, BENCH_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolvePromise(code ?? 1);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolvePromise(2);
    });
  });
}

function readReport(): ContrastReport | null {
  if (!existsSync(reportPath)) return null;
  return JSON.parse(readFileSync(reportPath, "utf8")) as ContrastReport;
}

/**
 * 报告里**真的测到**的场景数（`ours !== null` 的行）。
 *
 * ⚠️ 不能用 `report.scenarios.length`：`buildScenarioReadings()` 永远按场景表逐条产出
 * 一行（没跑到的填 `ours: null`），那个长度**恒等于**场景表条数——拿它判「采齐了没」
 * 是一条恒真的假绿路径（第 1 轮评审第 6 条）。这里数真正有读数的行。
 */
function measuredScenarioCount(report: ContrastReport): number {
  return report.scenarios.filter((entry) => entry.ours !== null).length;
}

/** 场景表里声明了官方等价物（可比较）的条数。 */
function comparableScenarioTotal(): number {
  return CONTRAST_SCENARIOS.filter((scenario) => scenario.official !== null).length;
}

/** 可比较场景里**真的**拿到官方侧读数的条数（`officialSide !== null`）。 */
function measuredComparableCount(report: ContrastReport): number {
  return report.scenarios.filter(
    (entry) => entry.official !== null && entry.officialSide !== null,
  ).length;
}

/** 一份报告的全部判定入参——两处调用点共用，避免它们漂移。 */
function decide(report: ContrastReport): ContrastDecision {
  return decideContrastExit({
    envelopeIssues: checkContrastEnvelope(report, {
      runId,
      datasetVersion: DATASET_VERSION,
    }),
    fatal: report.fatal,
    blockedReason: report.blockedReason,
    done: report.done,
    expectedScenarioCount: CONTRAST_SCENARIOS.length,
    scenarioCount: measuredScenarioCount(report),
    expectedComparableScenarios: comparableScenarioTotal(),
    comparableScenarioCount: measuredComparableCount(report),
    invariants: report.invariants,
  });
}

async function main(): Promise<void> {
  const benchExit = await runBenchmark();
  if (benchExit !== 0) {
    // 基准自己红了：要么断言挂了（不变式破坏），要么用例崩了。两种都不该被重跑掩盖。
    const report = readReport();
    if (!report) {
      console.error(
        `[perf:contrast] 基准退出码 ${benchExit} 且没有产出报告（${reportPath}）——按脚手架失败 2`,
      );
      process.exitCode = 2;
      return;
    }
    // ⚠️ **不再**把「基准红了」一律映射成 2（第 1 轮评审第 7 条）。此前
    // `benchExit !== 0 ? 2 : ...` 让那条唯一的 1（不变式被破坏）在 `pnpm perf:contrast`
    // 下**永不可达**——`recordInvariant` 用 `expect(...).toBe(true)` 让 vitest 非零退出，
    // 编排再把非零一律压成 2，文档里写的「1 = 不变式被破坏」在唯一的正式入口上从来没发生过。
    // 报告与信封**可读**时按报告自身判定结算，判定为不变式破坏就如实给 1。
    const decision = decide(report);
    // ⚠️ 但「判定为 0」**不能**原样放行（第 2 轮评审第 1 条）。基准里有大量**普通
    // `expect`**（§3 的 setPosition/recreates、卸载残留归零、§6/§7 的资源构成、§10 的
    // 不重建……），它们不写进 `invariants` 判定模型；某一条挂掉时 vitest 非零退出，而
    // `afterAll` 仍可能写出一份 `done=true` / 10-10 / 不变式全 PASS 的报告 ⇒ 判定 0。
    // 原样结算等于**把测试失败吞成通过**，是比「1 不可达」更严重的一条假绿。
    //
    // 因此：报告明确判到 1/2/3 就按它结算；只有「报告说没事、进程说有事」这种**无法归类**
    // 的组合归 2（脚手架 / 断言失败）——它绝不能变绿。
    const exitCode = decision.exitCode === 0 ? 2 : decision.exitCode;
    console.log(formatContrastReport({ report, decision }));
    console.error(
      `[perf:contrast] 基准退出码 ${benchExit}，判定 exit=${exitCode}` +
        (exitCode === 2 && decision.exitCode === 0
          ? "\n  VITEST_FAILED_UNMODELLED: 基准进程非零退出，但报告判定模型未覆盖到它" +
            "（普通 expect 失败 / 用例崩溃）。按脚手架失败 2 结算——不按报告放行。"
          : "") +
        "\n" +
        decision.reasons.map((r) => `  ${r}`).join("\n"),
    );
    process.exitCode = exitCode;
    return;
  }

  const report = readReport();
  if (!report) {
    console.error(`[perf:contrast] REPORT_MISSING：${reportPath}`);
    process.exitCode = 2;
    return;
  }

  const decision = decide(report);
  console.log(formatContrastReport({ report, decision }));
  console.error(
    `[perf:contrast] exit=${decision.exitCode} ok=${decision.ok} ` +
      `scenarios=${measuredScenarioCount(report)}/${CONTRAST_SCENARIOS.length} ` +
      `comparable=${measuredComparableCount(report)}/${comparableScenarioTotal()} ` +
      `official=${OFFICIAL_BASELINE_VERSION}\n` +
      decision.reasons.map((r) => `  ${r}`).join("\n"),
  );
  process.exitCode = decision.exitCode;
}

await main();
