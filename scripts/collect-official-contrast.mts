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
        resolve(repoRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "tests/performance/official-contrast.perf.test.ts",
        "--config",
        "tests/performance/vitest.config.ts",
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

async function main(): Promise<void> {
  const benchExit = await runBenchmark();
  if (benchExit !== 0) {
    // 基准自己红了：要么断言挂了（不变式破坏），要么用例崩了。两种都不该被重跑掩盖，
    // 因此直接按「拿不到可信报告」处理，并把基准的退出码带出来。
    const report = readReport();
    if (report) {
      const decision = decideContrastExit({
        envelopeIssues: checkContrastEnvelope(report, {
          runId,
          datasetVersion: DATASET_VERSION,
        }),
        fatal: report.fatal,
        blockedReason: report.blockedReason,
        done: report.done,
        expectedScenarioCount: CONTRAST_SCENARIOS.length,
        scenarioCount: report.scenarios.length,
        invariants: report.invariants,
      });
      console.log(formatContrastReport({ report, decision }));
      console.error(`[perf:contrast] 基准退出码 ${benchExit}，判定 exit=${decision.exitCode}`);
      process.exitCode = benchExit !== 0 ? 2 : decision.exitCode;
      return;
    }
    console.error(
      `[perf:contrast] 基准退出码 ${benchExit} 且没有产出报告（${reportPath}）——按脚手架失败 2`,
    );
    process.exitCode = 2;
    return;
  }

  const report = readReport();
  if (!report) {
    console.error(`[perf:contrast] REPORT_MISSING：${reportPath}`);
    process.exitCode = 2;
    return;
  }

  const envelopeIssues = checkContrastEnvelope(report, {
    runId,
    datasetVersion: DATASET_VERSION,
  });
  const decision = decideContrastExit({
    envelopeIssues,
    fatal: report.fatal,
    blockedReason: report.blockedReason,
    done: report.done,
    expectedScenarioCount: CONTRAST_SCENARIOS.length,
    scenarioCount: report.scenarios.length,
    invariants: report.invariants,
  });
  console.log(formatContrastReport({ report, decision }));
  console.error(
    `[perf:contrast] exit=${decision.exitCode} ok=${decision.ok} ` +
      `scenarios=${report.scenarios.length}/${CONTRAST_SCENARIOS.length} ` +
      `official=${OFFICIAL_BASELINE_VERSION}\n` +
      decision.reasons.map((r) => `  ${r}`).join("\n"),
  );
  process.exitCode = decision.exitCode;
}

await main();
