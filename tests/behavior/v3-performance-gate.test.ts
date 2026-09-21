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
 * 3. 它排在 `build:v3` **之后**（包体读数需要 `dist`，缺了会以 3（blocked）收场）。
 *
 * 另外锁住「脚本入口是真的」：`package.json` 里的 `test:performance` / `perf:baseline` 指向的
 * 文件必须存在（本仓库有过指向不存在脚本的死条目，值不了门禁但会误导人）。
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideExitCode,
  describeKeySetMismatch,
  describeMachineMismatch,
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
    .findIndex((line) => line.includes("run: node --experimental-strip-types scripts/build-v3.mts"));
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

  it("包体读数的前置 `build:v3` 排在它之前", () => {
    expect(probe.buildStep, "performance job 里没有 build:v3 step").not.toBeNull();
    expect(probe.step!.index, "build:v3 必须早于 perf:baseline").toBeGreaterThan(probe.buildStep!.index);
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

  it("四态退出码：回退 > blocked > 通过（「没跑完」不许当通过）", () => {
    expect(decideExitCode({ regressions: 0, bundleStatus: "ok" })).toBe(0);
    expect(decideExitCode({ regressions: 1, bundleStatus: "ok" })).toBe(1);
    expect(decideExitCode({ regressions: 0, bundleStatus: "blocked" })).toBe(3);
    expect(decideExitCode({ regressions: 2, bundleStatus: "blocked" }), "回退优先于 blocked").toBe(1);
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
