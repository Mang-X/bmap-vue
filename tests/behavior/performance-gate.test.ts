/**
 * 性能门禁的「真的在跑」回归（M6-PERFORMANCE / issue #37）
 *
 * 为什么单独一个文件：这个仓库对每条门禁都配一条「它在 CI 里真的执行了、且没被 `if:` /
 * `continue-on-error` 架空」的用例（docs / typecheck / no-bmapgl / smoke 各有一条）。缺了它，
 * 「门禁不存在」或「门禁被注释掉」这两件事都不会有人发现 —— 那比门禁失败更难查。
 *
 * 三条断言各自的失效方式都配了负例自测（synthetic workflow），确保**判定式本身**有判别力：
 * 1. `performance` job 真的存在，并且跑的是 `pnpm perf:baseline`；
 * 2. 那个 step 没被 `if:` / `continue-on-error` 架空；
 * 3. 它排在 `build:package` **之后**（包体读数需要 `dist`，缺了会以 3（blocked）收场）。
 *
 * 另外锁住「脚本入口是真的」：`package.json` 里的 `test:performance` / `perf:baseline` 指向的
 * 文件必须存在（本仓库有过指向不存在脚本的死条目，值不了门禁但会误导人）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  compareShapeRatios,
  computeShapeRatios,
  decideExitCode,
  describeDroppedMetrics,
  describeKeySetMismatch,
  describeMachineMismatch,
  validateReportShape,
} from "../../scripts/collect-performance-baseline.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const repoRoot = resolve(import.meta.dirname, "../..");
const workflow = readWorkflow("quality.yml");
const PERF_STEP_COMMAND = "pnpm perf:baseline";

/** 按缩进切出某个 job 的原文（与 docs / typecheck 门禁用例同一口径）。 */
function jobSectionLines(text: string, name: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

interface PerfGateProbe {
  jobFound: boolean;
  step: { index: number; block: string[] } | null;
  buildStep: { index: number } | null;
  /** step 级的「架空」开关（行内注释 `# if: ...` 不会命中）。 */
  blockers: string[];
}

/** 探针：给一段 workflow 原文，回答上面三条断言要问的事。 */
function probePerfGate(text: string): PerfGateProbe {
  const job = jobSectionLines(text, "performance");
  const block = stepBlockContaining(text, PERF_STEP_COMMAND);
  const runLine = text.split(/\r?\n/).findIndex((line) => line.includes(`run: ${PERF_STEP_COMMAND}`));
  const buildLine = text
    .split(/\r?\n/)
    .findIndex((line) => line.includes("run: node --experimental-strip-types scripts/build-package.mts"));
  return {
    jobFound: job.length > 0,
    step: block.length > 0 && runLine >= 0 ? { index: runLine, block } : null,
    buildStep: buildLine >= 0 ? { index: buildLine } : null,
    blockers: block.filter((line) => /^\s*(?:-\s+)?(if|continue-on-error)\s*:/.test(line)),
  };
}

describe("#37 性能门禁：真的进 CI 且步骤没被架空", () => {
  const probe = probePerfGate(workflow);

  it("quality.yml 里有 performance job", () => {
    expect(probe.jobFound, "找不到 `performance` job 段").toBe(true);
  });

  it("job 里跑的是 `pnpm perf:baseline`（注释里提到不算）", () => {
    expect(probe.step, "没有 `run: pnpm perf:baseline` step").not.toBeNull();
    // 正证守卫：切出来的 step 块要落在 performance job 段里，而不是别的 job 的同类命令。
    const job = jobSectionLines(workflow, "performance").join("\n");
    expect(job, "perf:baseline 必须跑在 performance job 里").toContain(`run: ${PERF_STEP_COMMAND}`);
  });

  it("该 step 没有被 if / continue-on-error 架空", () => {
    expect(probe.step, "找不到 step，无从判断是否被架空").not.toBeNull();
    expect(probe.blockers.map((line) => line.trim()), "step 被开关架空").toEqual([]);
  });

  it("包体读数的前置 `build:package` 排在它之前", () => {
    expect(probe.buildStep, "performance job 里没有 build:package step").not.toBeNull();
    expect(probe.step!.index, "build:package 必须早于 perf:baseline").toBeGreaterThan(probe.buildStep!.index);
  });

  it("测试代码的类型门禁在 CI 里真的跑了（评审 4 的durable 修法，不是一次性临时配置）", () => {
    const block = stepBlockContaining(workflow, "pnpm typecheck:tests");
    expect(block.length, "quality.yml 里找不到跑 `pnpm typecheck:tests` 的 step").toBeGreaterThan(0);
    expect(
      block.filter((line) => /^\s*(?:-\s+)?(if|continue-on-error)\s*:/.test(line)),
      "该 step 被 if / continue-on-error 架空",
    ).toEqual([]);
  });

  it("package.json 里的基准入口指向真实存在的文件", () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:performance"], "test:performance 必须走基准专用配置").toContain(
      "tests/performance/vitest.config.ts",
    );
    expect(pkg.scripts["perf:baseline"], "perf:baseline 必须走采集脚本").toContain(
      "scripts/collect-performance-baseline.mts",
    );
    expect(pkg.scripts["typecheck:tests"], "typecheck:tests 必须走独立配置").toContain(
      "tsconfig.tests.json",
    );
    for (const relative of [
      "scripts/collect-performance-baseline.mts",
      "tests/performance/vitest.config.ts",
      "tests/performance/baseline.json",
      "tsconfig.tests.json",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
    }
  });
});

describe("重录基线的输入校验（#124 最后一项验收的回归）", () => {
  /** 一份**最小但合法**的报告（各条校验的正证控件：改坏其中一项必须被抓住）。 */
  function validReport(): Record<string, unknown> {
    return {
      version: 1,
      generatedAt: "2026-09-24T08:52:37.358Z",
      dataset: { version: "1" },
      engine: "fake-v4",
      environment: {
        platform: "linux",
        arch: "x64",
        cpuModel: "AMD EPYC 7763 64-Core Processor",
        node: "v24.20.0",
      },
      normalizer: { metric: "calibration.cpu", minMs: 32.81 },
      metrics: {
        "mount.pointCollection@100": {
          minMs: 7.99,
          medianMs: 9.04,
          maxMs: 16.39,
          samples: 5,
          normalized: 0.2433,
        },
      },
      readouts: { "multiUpdate.setData@1000": 1, "volume.line@1000": "1000" },
      notMeasured: [],
      bundle: { status: "ok", totals: { runtimeBytes: 787917 } },
    };
  }

  it("正证控件：完整报告不报任何问题（否则下面几条会恒真）", () => {
    expect(validateReportShape(validReport())).toEqual([]);
  });

  it("顶层字段齐全但 metrics 为空 ⇒ 必须拒绝（否则 `--update` 会把门禁输入删空）", () => {
    const problems = validateReportShape({ ...validReport(), metrics: {} });
    expect(problems.join("；")).toContain("metrics 为空");
  });

  it("机器身份缺一项 ⇒ 必须拒绝（缺了它门禁会退化成「只出报告」）", () => {
    for (const key of ["platform", "arch", "cpuModel", "node"]) {
      const environment: Record<string, unknown> = { ...(validReport().environment as object) };
      delete environment[key];
      expect(
        validateReportShape({ ...validReport(), environment }).join("；"),
        `缺 environment.${key} 必须被拒`,
      ).toContain(`environment.${key}`);
    }
  });

  it("指标值非有限数 / 归一化分母非正数 ⇒ 必须拒绝（NaN 会让比值静默失去判别力）", () => {
    const nan = validReport();
    (nan.metrics as Record<string, Record<string, unknown>>)["mount.pointCollection@100"]!.minMs =
      "oops";
    expect(validateReportShape(nan).join("；")).toContain("不是有限数");
    expect(validateReportShape({ ...validReport(), normalizer: { metric: "x", minMs: 0 } }).join("；")).toContain(
      "normalizer.minMs",
    );
  });

  it("bundle.status=ok 却缺 totals ⇒ 必须拒绝（包体读数会静默变空）", () => {
    expect(validateReportShape({ ...validReport(), bundle: { status: "ok" } }).join("；")).toContain(
      "bundle.totals",
    );
  });

  it("子集报告（少指标）必须被识别：报告缺基线已有指标 ⇒ 不能据此重录", () => {
    expect(describeDroppedMetrics(["a", "b"], ["a", "b", "c"])).toContain("c");
    // 正证控件：指标齐全（哪怕顺序不同 / 只多不少）不拦
    expect(describeDroppedMetrics(["b", "a", "d"], ["a", "b"])).toBeNull();
  });

  it("端到端：残缺报告 + `--update` 退出码 2，且 baseline.json 不被改写", () => {
    // 这一条真的跑脚本（不只测纯函数）：保证「校验在任何写入之前」这个次序不被以后的重构改掉。
    const baselinePath = resolve(repoRoot, "tests/performance/baseline.json");
    const before = readFileSync(baselinePath, "utf8");
    const broken = { ...validReport(), metrics: {} };
    const dir = mkdtempSync(join(tmpdir(), "perf-bad-report-"));
    const reportPath = join(dir, "report.json");
    writeFileSync(reportPath, JSON.stringify(broken));
    try {
      const res = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          resolve(repoRoot, "scripts/collect-performance-baseline.mts"),
          `--from-report=${reportPath}`,
          "--update",
        ],
        { cwd: repoRoot, encoding: "utf8" },
      );
      expect(res.status, `残缺报告必须被拒：\n${res.stdout}${res.stderr}`).toBe(2);
      expect(readFileSync(baselinePath, "utf8"), "被拒时不得改写提交基线").toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("门禁判定的纯函数（issue #37 评审 1 / 2 的回归）", () => {
  it("指标集合漂移：报告侧**少**一条必须失败（原实现只看反方向，会静默少测一项）", () => {
    // 评审给的最小复现：删掉一条既有 benchmark/metric ⇒ 它从报告里消失。
    const message = describeKeySetMismatch(["a", "b"], ["a", "b", "cluster@50000"]);
    expect(message).toContain("cluster@50000");
    expect(message).toContain("基线有而报告没有");
  });

  it("指标集合漂移：报告侧**多**一条也要失败（改名 / 新增同罪）", () => {
    expect(describeKeySetMismatch(["a", "renamed@50000"], ["a", "old@50000"])).toContain("old@50000");
    expect(describeKeySetMismatch(["a", "renamed@50000"], ["a", "old@50000"])).toContain("renamed@50000");
  });

  it("集合一致 ⇒ 不拦（正证控件：否则判定恒返回失败也能过）", () => {
    expect(describeKeySetMismatch(["a", "b"], ["b", "a"])).toBeNull();
    expect(describeKeySetMismatch([], [])).toBeNull();
  });

  it("机器身份：只比 platform + arch 是不够的 —— 同平台不同 CPU 也必须只出报告", () => {
    // 证据来自本 PR 的两次连续 CI 推送：同一个 `ubuntu-latest` label，SKU 从
    // `INTEL(R) XEON(R) PLATINUM 8573C` 变成 `Intel(R) Xeon(R) 6973P-C`，calibration 30.19ms → 21.99ms。
    const baseline = {
      platform: "linux",
      arch: "x64",
      cpuModel: "INTEL(R) XEON(R) PLATINUM 8573C",
    };
    const message = describeMachineMismatch(baseline, {
      platform: "linux",
      arch: "x64",
      cpuModel: "Intel(R) Xeon(R) 6973P-C",
    });
    expect(message, "同平台不同 SKU 必须判为不可比").not.toBeNull();
    expect(message).toContain("CPU 不同");
  });

  it("机器身份：跨平台不可比；机器一致才可比", () => {
    const baseline = { platform: "linux", arch: "x64", cpuModel: "Xeon X" };
    expect(describeMachineMismatch(baseline, { platform: "darwin", arch: "arm64", cpuModel: "Apple M4" })).toContain(
      "跨平台",
    );
    expect(describeMachineMismatch(baseline, { platform: "linux", arch: "x64", cpuModel: "Xeon X" })).toBeNull();
  });

  it("机器身份：旧格式基线（没有 machine 记录）只出报告，不猜", () => {
    expect(describeMachineMismatch(undefined, { platform: "linux", arch: "x64", cpuModel: "X" })).toContain("旧格式");
  });

  it("同轮比值：任一端低于噪声地板时跳过（读数是真实 CI / 开发机的对照）", () => {
    const values = {
      // 实测：`adaptPoints@1k` 在开发机 0.057ms、CI 0.29ms ⇒ 被它当分母的比值两边差 3.3×
      // （而同一批里另外两条比值只差 1.07× / 1.25×）。因此地板必须同时约束比值的两端。
      "adaptPoints@50000": 52.9,
      "adaptPoints@1000": 0.0088,
      "mount.pointCollection@50000": 25.9,
      "mount.lineLayerGeoJson@50000": 1.0,
      "replace.reactiveArray@50000": 10.3,
      "replace.markRawArray@50000": 1.0,
      "mount.line@50000": 1.2,
      "mount.line@1000": 0.17,
    };
    const { readings, skipped } = computeShapeRatios(values, 0.1);
    expect(readings.map((entry) => entry.name)).toContain("adaptationOverPassthrough@50000");
    expect(skipped.join(" "), "亚毫秒分母的比值必须被跳过").toContain("adaptPointsTotal50kOver1k");
    expect(skipped.join(" ")).toContain("低于噪声地板");
  });

  it("同轮比值：一条指标变慢 10× 会被拦下（正证控件：不变时不拦）", () => {
    // 直接用「归一化值」的量级（校准量当 1），并且每一项都高于噪声地板 ——
    // 否则夹具自己会把条目跳过，测试就变成恒真（第一版就是这么写的）。
    const baseline = {
      "mount.pointCollection@50000": 25,
      "mount.lineLayerGeoJson@50000": 1,
      "replace.reactiveArray@50000": 10,
      "replace.markRawArray@50000": 1,
      "mount.line@50000": 1.2,
      "mount.line@1000": 0.2,
      "mount.pointCollection@1000": 1,
    };
    const same = computeShapeRatios(baseline, 0.1);
    expect(compareShapeRatios(same.readings, baseline, 5).regressions, "同值不应拦").toEqual([]);

    const slower = { ...baseline, "mount.pointCollection@50000": 25 * 10 };
    const regressions = compareShapeRatios(computeShapeRatios(slower, 0.1).readings, baseline, 5).regressions;
    expect(regressions.map((item) => item.name)).toContain("adaptationOverPassthrough@50000");
    expect(regressions[0]!.ratio).toBeGreaterThan(5);
  });

  it("四态退出码：回退 > blocked > 通过（「没跑完」不许当通过）", () => {
    expect(decideExitCode({ regressions: 0, bundleStatus: "ok" })).toBe(0);
    expect(decideExitCode({ regressions: 1, bundleStatus: "ok" })).toBe(1);
    expect(decideExitCode({ regressions: 0, bundleStatus: "blocked" })).toBe(3);
    expect(decideExitCode({ regressions: 2, bundleStatus: "blocked" }), "回退优先于 blocked").toBe(1);
  });
});

describe("文档口径与脚本常量一致（评审第 3 轮：旧口径会误导重录基线）", () => {
  // 这组断言的由来：这轮迭代把噪声地板从 0.05 → 0.5 → 0.1、把可比性判据从 `platform + arch`
  // 扩成 `+ cpuModel`、换了基线机器，但**文档里只改了一部分**——评审逐条列出来才发现。
  // 写死「文档必须与脚本常量一致」，下次改常量时门禁会直接指出来。
  const scriptPath = "scripts/collect-performance-baseline.mts";
  const scriptText = readFileSync(resolve(repoRoot, scriptPath), "utf8");
  const DOCS = [
    "docs/adr/2026-09-21-performance-baseline-and-worker-decision.md",
    "docs/internal/performance-baseline.md",
  ];
  const docText = (doc: string): string => readFileSync(resolve(repoRoot, doc), "utf8");

  it("噪声地板：脚本常量与两处文档里「噪声地板」那句话写的是同一个值", () => {
    const match = /const FLOOR_UNITS = ([\d.]+);/.exec(scriptText);
    expect(match, `脚本里找不到 FLOOR_UNITS 的常量定义`).not.toBeNull();
    const floor = match![1]!;
    for (const doc of DOCS) {
      const lines = docText(doc).split(/\r?\n/);
      const floorLines = lines.filter((line) => line.includes("噪声地板") || line.includes("归一化值低于"));
      expect(floorLines.length, `${doc} 里没有「噪声地板」的说明`).toBeGreaterThan(0);
      expect(
        floorLines.some((line) => line.includes(floor)),
        `${doc} 的噪声地板没有跟着脚本的 ${floor} 更新`,
      ).toBe(true);
      // 地板是**归一化单位**：绝对毫秒等价值随 `calibration.cpu` 变（当前 CI 基线 32.83ms ⇒ ≈3.3ms，
      // 开发机 ≈1ms）。写成固定的「1ms」会把读者带偏 —— 所以那句话必须点明它是归一化单位。
      expect(
        floorLines.some((line) => line.includes("归一化单位")),
        `${doc} 没有说明噪声地板是归一化单位（绝对值随 calibration 变）`,
      ).toBe(true);
    }
  });

  it("默认阈值：脚本常量与文档里「阈值」那句话写的是同一个倍数", () => {
    const match = /const DEFAULT_TOLERANCE = ([\d.]+);/.exec(scriptText);
    expect(match, "脚本里找不到 DEFAULT_TOLERANCE").not.toBeNull();
    const tolerance = match![1]!;
    for (const doc of DOCS) {
      const toleranceLines = docText(doc)
        .split(/\r?\n/)
        .filter((line) => line.includes("阈值"));
      expect(toleranceLines.length, `${doc} 里没有「阈值」的说明`).toBeGreaterThan(0);
      expect(
        toleranceLines.some((line) => new RegExp(`${tolerance}\\s*[×x]`).test(line)),
        `${doc} 的默认阈值没有跟着脚本的 ${tolerance}× 更新`,
      ).toBe(true);
    }
  });

  it("可比性判据：脚本比较的每一项都写在文档里（不是只写 platform + arch）", () => {
    for (const field of ["platform", "arch", "cpuModel"]) {
      expect(scriptText, `脚本没有比较 ${field}`).toContain(field);
    }
    for (const doc of DOCS) {
      expect(docText(doc), `${doc} 没写清可比性判据（应含 platform + arch + cpuModel）`).toContain(
        "platform + arch + cpuModel",
      );
    }
  });
});

describe("探针自身的判别力（负例自测：不能只测「能通过」）", () => {
  const HEAD = [
    "name: Quality",
    "on:",
    "  pull_request:",
    "jobs:",
    "  performance:",
    "    runs-on: ubuntu-latest",
    "    steps:",
  ].join("\n");

  it("被注释掉的 step 找不到（不是「文件里出现过这个字符串」就算数）", () => {
    const text = [HEAD, "      # - name: Perf", `      #   run: ${PERF_STEP_COMMAND}`].join("\n");
    expect(probePerfGate(text).step).toBeNull();
  });

  it("`continue-on-error: true` 会被判成架空", () => {
    const text = [
      HEAD,
      "      - name: Perf",
      `        run: ${PERF_STEP_COMMAND}`,
      "        continue-on-error: true",
    ].join("\n");
    expect(probePerfGate(text).blockers.length).toBeGreaterThan(0);
  });

  it("`if: false` 会被判成架空", () => {
    const text = [HEAD, "      - name: Perf", "        if: false", `        run: ${PERF_STEP_COMMAND}`].join(
      "\n",
    );
    expect(probePerfGate(text).blockers.length).toBeGreaterThan(0);
  });

  it("只有别的 job 里有这条命令时，performance job 段仍判为不存在", () => {
    const text = [
      "name: Quality",
      "on:",
      "  pull_request:",
      "jobs:",
      "  other:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - run: ${PERF_STEP_COMMAND}`,
    ].join("\n");
    const result = probePerfGate(text);
    expect(result.jobFound).toBe(false);
  });
});
