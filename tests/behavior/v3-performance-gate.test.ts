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
    for (const relative of [
      "scripts/collect-performance-baseline.mts",
      "tests/performance/vitest.config.ts",
      "tests/performance/baseline.json",
    ]) {
      expect(existsSync(resolve(repoRoot, relative)), `${relative} 不存在`).toBe(true);
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
