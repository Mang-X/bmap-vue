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
 * ## `--record-reference`：把本轮读数录成**版本化实验快照**
 *
 * 票面验收第一条要「数据与脚本入库」。`.artifacts` 被 `.gitignore` 排除，所以跑完的读数
 * 默认不留痕；加这个 flag 才把**当轮**读数整形成稳定 schema 写进
 * `tests/performance/official-contrast/recorded-result.json`（唯一入库的数据事实源）。
 *
 * ⚠️ 快照**不参与任何毫秒判定**——它只承担 provenance（哪次跑 / 哪版 / 哪台机器），
 * 详见 `reference.mts` 文件头。所以这个 flag 是**显式**的：跑基准不等于更新快照。
 * 录完再跑 `pnpm generate:official-contrast:reference` 让人读视图跟着更新。
 *
 * ## 约束（`node --experimental-strip-types`）
 *
 * 不得使用 TS 参数属性；本地模块导入必须带扩展名。
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATASET_VERSION } from "../tests/performance/dataset.ts";
import {
  checkContrastEnvelope,
  decideContrastExit,
  describeReportShapeFault,
  formatContrastReport,
  isContrastReport,
  OFFICIAL_BASELINE_VERSION,
  type ContrastDecision,
  type ContrastReport,
} from "../tests/performance/official-contrast/report.mts";
import { CONTRAST_SCENARIOS } from "../tests/performance/officialScenarios.ts";
import {
  ENGINE_VERSION_BY_KIND,
  REFERENCE_RESULT_VERSION,
  toReferenceSide,
  type ReferenceEnvironment,
  type ReferenceResult,
} from "../tests/performance/official-contrast/reference.mts";

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

/**
 * 读回基准写的报告。
 *
 * ⚠️ **`JSON.parse` 的异常不许逃出**（三轮评审第 2 条）。基准进程被 kill、写盘中断、文件被
 * 截断都会让它抛 `SyntaxError`，而这里是个顶层 `await main()` 的脚本——未捕获异常会由 Node
 * 默认以 **exit 1** 结束。可本脚本的四态合同里 **1 = 本库不变式被破坏**、**2 = 脚手架 /
 * 报告损坏**：把「报告读不出来」报成「不变式回退」是**误报方向反了**，比单纯崩掉更糟——
 * 它会让读报告的人以为架构预期破了。
 *
 * 因此解析失败与「文件不存在」一样归到「拿不到可信读数」，由调用方按脚手架失败 2 结算，
 * 并把 `REPORT_INVALID` 与解析器给的原因一起打出来（截断的 JSON 报
 * `Unexpected end of JSON input` 恰好能指认是写盘中断，不是格式版本漂移）。
 *
 * 「能 parse」也不等于「是报告」，形状由 `isContrastReport` 把关；两种失败都进
 * `reportReadError`，因为**调用方对它们的处置完全一样**（按 2 结算），差别只在措辞。
 */
function readReport(): ContrastReport | null {
  if (!existsSync(reportPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (error) {
    reportReadError = error instanceof Error ? error.message : String(error);
    return null;
  }
  // ⚠️ 「能 parse」不等于「是报告」。`{}` / `[]` / `null` / `scenarios:[null]` 都是合法
  // JSON，而下游 `checkContrastEnvelope` 会解引用 `report.envelope.runId`、计数函数会读
  // `entry.ours` —— 那时抛的是 TypeError，同样以未捕获异常的形式**逃出 main() 并让
  // Node 以 1 结束**，把「拿到一份垃圾」报成「不变式回退」。因此形状在这里先验一次
  // （验到元素，见 `isContrastReport` 的注释），不对就当「读不出来」。
  if (!isContrastReport(parsed)) {
    // `isContrastReport` 刚判过 false，所以这里**必然**拿到非 null 的 fault（`??` 只是为了
    // 满足类型；若真为 null，说明守卫与叙述各改一边，那条消息反而有用，不该吞掉）。
    reportReadError =
      describeReportShapeFault(parsed) ?? "报告形状与 v1 契约不符，且守卫未能指出具体一条";
    return null;
  }
  return parsed;
}

/** 报告读不出来时的原因（`readReport` 写入；为 `null` 表示「文件不存在」而非「解析失败」）。 */
let reportReadError: string | null = null;

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

/**
 * Fake 替身引擎的版本标识。
 *
 * 票面写的是「同 JSAPI 4.0」。本档没有真实 JSAPI（无 AK），跑的是本仓库的 Fake v4；
 * 它的"版本"就是这串字符串——写进快照，是为了**如实记下**测的到底是哪套引擎，
 * 而不是含糊地让 "4.0" 指代一个从未加载过的官方 SDK。
 */
/** 本采集脚本只跑 Fake 档。`mode` 与 `engine.version` 都从 `reference.mts` 的配对表取。 */
const RECORDED_MODE: ReferenceResult["mode"] = "fake-v4";

/** 快照的入库路径（唯一的数据事实源；人读视图由它派生，不手写第二份数字）。 */
/**
 * 由报告信封拼出快照的机器身份（字段名只在这里一处落地一次）。
 *
 * `dom` 直接写 "happy-dom"：**本档就是** Fake v4 + happy-dom，这是事实陈述，不是前瞻。
 * （上一版写「`dom` 由 `mode` 决定」并配一个 `mode === "fake-v4" ? … : undefined` 三元——
 * 那是**假话**：`mode` 是字面量类型，那个 `undefined` 分支不可达，注释与代码互相打脸。）
 *
 * ⚠️ 这里**不**宣称「换 mode 时 TS 会报错」——那也是假话，实测过两条都不成立：
 * ① `toReferenceEnvironment` 根本不收 `mode` 参数，硬编码的 `dom` 与 mode 没有任何类型
 * 关联；② `scripts/**` **不在任何 tsconfig 的 include 里**（`tsconfig.tests.json` 只管
 * tests、`tsconfig.json` 只管 packages），本文件靠 `--experimental-strip-types` 跑，
 * 塞一个类型错误进去照样 exit 0。真出第二种 mode 时，**要人来改这里**——那正是把字面量
 * 写在这里、而不是编一个不可达三元的原因：改的地方是显式的。
 */
function toReferenceEnvironment(envelope: {
  platform: string;
  arch: string;
  cpuModel: string;
  node: string;
}): ReferenceEnvironment {
  return {
    platform: envelope.platform,
    arch: envelope.arch,
    cpuModel: envelope.cpuModel,
    node: envelope.node,
    // ⚠️ 刻意**不加** `mode === "fake-v4" ? … : undefined` 这种前瞻分支：`mode` 现在就是
    // 字面量类型 `"fake-v4"`，那个 `undefined` 分支**不可达**，写它等于对着一份不存在的
    // 未来编故事。真出第二种 mode 时，**要人来改这一行**（TS 不会拦：本文件不在任何
    // tsconfig 的 include 里，靠 `--experimental-strip-types` 跑，类型错误不拦）。
    dom: "happy-dom",
  };
}

const REFERENCE_PATH = resolve(
  repoRoot,
  "tests/performance/official-contrast/recorded-result.json",
);

/**
 * 把当轮报告整形成**版本化实验快照**并写入仓库。
 *
 * 刻意**不是** baseline：快照不参与毫秒比较（见 `reference.mts` 文件头），只回答
 * 「这是哪一次跑、哪一版实现、哪台机器、哪份数据、哪两个库版本」。因此它带 `sourceCommit`
 * ——只有 `recordedAt` 的话，几年后只剩一个日期，对不上代码。
 *
 * `runId` / `startedAt` / `finishedAt` / `durationMs` 这些**一次性编排字段不录**：每次都变，
 * 录进去只会制造无谓 diff，掩盖「读数真的动了」这件事。
 */
function recordReference(report: ContrastReport): void {
  let sourceCommit: string;
  try {
    sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    // 取不到 SHA 时**不**编一个：快照的核心价值就是「对得上代码」，SHA 缺失就明说缺失。
    console.error(
      "[perf:contrast] 取不到 git HEAD（不在 git 仓库里？）——快照的 sourceCommit 会记为 unknown，\n" +
        "  它将无法回答「这组读数对应哪一版实现」。",
    );
    sourceCommit = "unknown";
  }
  const reference: ReferenceResult = {
    version: REFERENCE_RESULT_VERSION,
    mode: RECORDED_MODE,
    // 票面说「同 JSAPI 4.0」「本库最终 1.0 RC tarball」，本档两条都达不到：组件场景导入
    // `src/**`，且 `jsapi-loader` 复用 Fake（无 AK、无网络）。因此把真实身份写进快照，
    // 让渲染层**据此加限定语**，而不是让读者默认「测的是发布物 × 真实 JSAPI」。
    engine: {
      kind: "fake",
      version: ENGINE_VERSION_BY_KIND.fake,
      // 量的是 src/**，不是 tarball——`oursVersion` 读自 package.json，说的是版本号，
      // 不是「被加载的那个构建」。两者都真，合起来才是误导。
      oursUnderTest: "source",
    },
    recordedAt: report.finishedAt,
    sourceCommit,
    datasetVersion: report.envelope.datasetVersion,
    oursVersion: report.envelope.oursVersion,
    officialVersion: report.envelope.officialVersion,
    // ⚠️ 字段名**不在这里重打一遍**：`ReferenceEnvironment` 加字段时，编排若还手写这份
    // 字面量就会静默漏掉新增字段（少一个可选字段照样过）。DOM 固定写 "happy-dom" 的理由
    // 见 `toReferenceEnvironment` 的注释——**本档就是** happy-dom，换 mode 时要人来改。
    environment: toReferenceEnvironment(report.envelope),
    scenarios: report.scenarios.map((entry) => ({
      id: entry.id,
      official: entry.official,
      ours: toReferenceSide(entry.ours),
      officialSide: toReferenceSide(entry.officialSide),
      ...(entry.officialSkippedReason
        ? { officialSkippedReason: entry.officialSkippedReason }
        : {}),
    })),
    notMeasured: report.notMeasured,
  };
  writeFileSync(REFERENCE_PATH, `${JSON.stringify(reference, null, 2)}\n`);
  console.log(
    `[perf:contrast] 已录入实验快照 ${REFERENCE_PATH}\n` +
      `  来源 commit ${sourceCommit} · 录于 ${report.finishedAt} · ${reference.scenarios.length} 场景\n` +
      `  下一步：pnpm generate:official-contrast:reference（让人读视图跟上）`,
  );
}

async function main(): Promise<void> {
  const benchExit = await runBenchmark();
  if (benchExit !== 0) {
    // 基准自己红了：要么断言挂了（不变式破坏），要么用例崩了。两种都不该被重跑掩盖。
    const report = readReport();
    if (!report) {
      // 两种「拿不到读数」要分开说：文件根本没写出来 vs 写了但**不可用**（解析不了 / 形状
      // 不对）。后者几乎总是写盘中断 / 进程被 kill（`Unexpected end of JSON input` 能指认
      // 这一点），报 REPORT_MISSING 会把人引去查「基准是不是没跑到写报告」，方向是错的。
      console.error(
        reportReadError
          ? `[perf:contrast] 基准退出码 ${benchExit}，报告不可用（${reportPath}）：` +
              `${reportReadError}\n  REPORT_INVALID: 报告存在但不是可用的对照报告——按脚手架失败 2` +
              `（**不是** 1：1 专指不变式被破坏）`
          : `[perf:contrast] 基准退出码 ${benchExit} 且没有产出报告（${reportPath}）——按脚手架失败 2`,
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
    console.error(
      reportReadError
        ? `[perf:contrast] REPORT_INVALID：${reportPath} 不是可用的对照报告（${reportReadError}）——按脚手架失败 2`
        : `[perf:contrast] REPORT_MISSING：${reportPath}`,
    );
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
  if (hasFlag("record-reference") && decision.exitCode === 0) {
    recordReference(report);
  }
}

await main();
