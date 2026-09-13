/**
 * `typecheck:v3` CI 门禁回归（M3A0-BOUNDARY 衍生 / issue #50）
 *
 * `typecheck:v3` 曾因上游类型包的大小写引用缺陷被移出 CI（PR #49 只在原位留了 NOTE 注释），
 * 本次随补丁恢复（见 `v3-upstream-types-case-patch.test.ts` 与 ADR 2026-09-13）。
 *
 * 断言落在**真正的 step** 上：`expect(workflow).toContain("pnpm typecheck:v3")` 会被那段
 * NOTE 注释满足，等于空转；因此这里按 YAML 的缩进边界切出 `quality` job 段与其中的 step 区块
 * （`v3` job 里也有 build，跨 job 取首个匹配会把顺序断言弄错）。
 *
 * 两条自我保护：
 * - 判定逻辑写成纯函数（输入 workflow 文本），并用 LF / CRLF 两种编码各跑一遍：工作区的换行符
 *   不该改变结论（Windows 上 `core.autocrlf` 或编辑器都可能把工作流存成 CRLF，仓库没有
 *   `.gitattributes` 兜底）。
 * - 另用合成 workflow 做**负例自测**：把「注释掉 step / `if:` 或 `continue-on-error` 架空 /
 *   顺序颠倒 / 只写在别的 job 里」四种形态各造一个负例，证明这套判定真的会红，而不是恒真。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKFLOW_PATH = resolve(import.meta.dirname, "../../.github/workflows/quality.yml");
const workflowLf = readFileSync(WORKFLOW_PATH, "utf8");

const TYPECHECK_COMMAND = "pnpm typecheck:v3";
const BUILD_COMMAND = "node --experimental-strip-types scripts/build-v3\\.mts";

function toCrlf(text: string): string {
  return text.replace(/\r?\n/g, "\r\n");
}

/** 行首缩进宽度（用于按 YAML 结构切分）。 */
function indentOf(line: string): number {
  return line.match(/^\s*/)![0].length;
}

/**
 * 按缩进切出某个 job 的原文行（从 `  <name>:` 到下一个同级 key 之前）。
 *
 * 按 `\r?\n` 分行：CRLF 检出时行尾会带 `\r`，用 `\n` 切开会让 `"  quality:\r"` 匹配不上
 * `"  quality:"`，整个 job 段变成空数组 —— 判定结果就随工作区换行符变化了。
 */
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

interface Step {
  /** step 区块的全部原文行（从 `- ` 那一行起，到下一个同级 step 之前）。 */
  lines: string[];
  /** 区块在 job 段内的起始行号，用于比较顺序。 */
  index: number;
}

/**
 * 按列表项缩进切出每个 step 的**完整区块**。
 *
 * 不能只取 `run:` 行前后固定几行：step 级字段（`if`、`continue-on-error`、`env`…）可以排在
 * `run:` 之前任意远，固定窗口会漏检，而漏检的方向恰好是「把被架空的门禁判成通过」。
 */
function stepBlocks(jobLines: string[]): Step[] {
  const itemIndents = jobLines
    .filter((line) => /^- /.test(line.trimStart()) && indentOf(line) > indentOf(jobLines[0] ?? ""))
    .map(indentOf);
  if (itemIndents.length === 0) return [];
  const stepIndent = Math.min(...itemIndents);

  const blocks: Step[] = [];
  let current: Step | undefined;
  for (let i = 0; i < jobLines.length; i += 1) {
    const line = jobLines[i]!;
    if (indentOf(line) === stepIndent && line.trimStart().startsWith("- ")) {
      if (current) blocks.push(current);
      current = { lines: [line], index: i };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function isRunLine(line: string, command: string): boolean {
  return new RegExp(`^\\s*run:\\s*${command}\\s*$`).test(line);
}

/** step 级的「架空」开关（`if` / `continue-on-error`；行内注释 `# if: ...` 不会命中）。 */
function isBlockingKey(line: string): boolean {
  // `(?:-\s+)?` 放过列表项前缀：step 的首行可以写成 `- if: false`（官方文档里的步骤示例就有
  // `- if:` 开头的写法），只匹配「空白后直接是字段名」会漏检整整一个字段位置。
  return /^\s*(?:-\s+)?(if|continue-on-error)\s*:/.test(line);
}

interface GateProbe {
  jobFound: boolean;
  step?: Step;
  buildStep?: Step;
  blockers: string[];
}

/** 探测 `quality` job 里 typecheck 门禁的形态。 */
function probeQualityGate(text: string): GateProbe {
  const lines = jobSectionLines(text, "quality");
  if (lines.length === 0) return { jobFound: false, blockers: [] };

  const steps = stepBlocks(lines);
  const step = steps.find((candidate) => candidate.lines.some((l) => isRunLine(l, TYPECHECK_COMMAND)));
  const buildStep = steps.find((candidate) =>
    candidate.lines.some((l) => isRunLine(l, BUILD_COMMAND)),
  );

  return {
    jobFound: true,
    step,
    buildStep,
    blockers: step ? step.lines.filter(isBlockingKey) : [],
  };
}

/** 把探测结果翻译成问题清单（空数组 = 通过）。 */
function problems(probe: GateProbe): string[] {
  const out: string[] = [];
  if (!probe.jobFound) out.push("找不到 quality job 段");
  if (probe.jobFound && !probe.step) out.push("没有 `run: pnpm typecheck:v3` 这个 step");
  if (probe.blockers.length > 0) {
    out.push(`typecheck step 被 ${probe.blockers.map((l) => l.trim()).join(" / ")} 架空`);
  }
  if (!probe.buildStep) out.push("quality job 里找不到 build:v3 step");
  if (probe.step && probe.buildStep && probe.step.index > probe.buildStep.index) {
    out.push("typecheck:v3 排在了 build:v3 之后");
  }
  return out;
}

const CRLF_WORKFLOW = toCrlf(workflowLf);

describe("测试夹具自身有效（防止下面的断言空转）", () => {
  it("CRLF 夹具确实只含 \\r\\n", () => {
    expect(CRLF_WORKFLOW).toContain("\r\n");
    expect(/[^\r]\n/.test(CRLF_WORKFLOW), "CRLF 夹具里混进了裸 \\n").toBe(false);
  });
});

for (const [label, text] of [
  ["LF", workflowLf],
  ["CRLF", CRLF_WORKFLOW],
] as const) {
  describe(`quality job 的 typecheck:v3 门禁（${label} 换行）`, () => {
    const probe = probeQualityGate(text);

    it("能定位到 quality job 段", () => {
      expect(probe.jobFound, `${label} 输入下找不到 quality job 段`).toBe(true);
    });

    it("typecheck:v3 是可执行的 step（注释里提到不算）", () => {
      expect(probe.step, `${label} 输入下没有 \`run: ${TYPECHECK_COMMAND}\` step`).toBeDefined();
    });

    it("该 step 没有被 if / continue-on-error 之类开关架空", () => {
      // 先确认能找到 step：否则下面这条会因为「没得检查」而空转通过
      expect(probe.step, `${label} 输入下找不到 step，无从判断是否被架空`).toBeDefined();
      expect(probe.blockers.map((l) => l.trim()), `${label} 输入下 step 被开关架空`).toEqual([]);
    });

    it("typecheck:v3 排在 build:v3 之前（它在 dist 里 emit 声明，放在 build 之后会得到假失败）", () => {
      expect(probe.step, `${label} 输入下找不到 typecheck step`).toBeDefined();
      expect(probe.buildStep, `${label} 输入下找不到 build:v3 step`).toBeDefined();
      expect(probe.step!.index).toBeLessThan(probe.buildStep!.index);
    });
  });
}

const FIXTURE_HEAD = [
  "name: Quality",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  quality:",
  "    runs-on: ubuntu-latest",
  "    steps:",
].join("\n");

// 末尾的 `v3` job 里也有 build：断言不能跨 job 取首个匹配。
const FIXTURE_TAIL = [
  "  v3:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - name: Build v3 package",
  "        run: node --experimental-strip-types scripts/build-v3.mts",
  "",
].join("\n");

function fixture(qualitySteps: string): string {
  return `${FIXTURE_HEAD}\n${qualitySteps}\n${FIXTURE_TAIL}`;
}

const BUILD_STEP = [
  "      - name: Build v3 artifacts for global bundle tests",
  "        run: node --experimental-strip-types scripts/build-v3.mts",
];

/** 合法形态：typecheck 在 build 之前。 */
const HEALTHY_STEPS = [
  "      - name: Type-check v3 package",
  `        run: ${TYPECHECK_COMMAND}`,
  ...BUILD_STEP,
].join("\n");

describe("门禁判定自测（合成 workflow 负例）", () => {
  it("健康夹具应当零问题（否则下面的负例没有意义）", () => {
    expect(problems(probeQualityGate(fixture(HEALTHY_STEPS)))).toEqual([]);
  });

  it("typecheck step 被注释掉要报「没有 step」", () => {
    const steps = HEALTHY_STEPS.replace(
      `        run: ${TYPECHECK_COMMAND}`,
      `        # run: ${TYPECHECK_COMMAND}`,
    );
    expect(problems(probeQualityGate(fixture(steps)))).toContain(
      "没有 `run: pnpm typecheck:v3` 这个 step",
    );
  });

  it("step 带 `if: false`（不在 run 紧邻两行内）要报「被架空」", () => {
    const steps = [
      "      - name: Type-check v3 package",
      "        if: false",
      "        env:",
      "          FORCE_COLOR: '1'",
      `        run: ${TYPECHECK_COMMAND}`,
      ...BUILD_STEP,
    ].join("\n");
    const found = problems(probeQualityGate(fixture(steps)));
    expect(found.some((line) => line.includes("架空")), `期望报出「被架空」，实际：${found}`).toBe(
      true,
    );
  });

  it("step 带 `continue-on-error: true` 要报「被架空」", () => {
    const steps = [
      "      - name: Type-check v3 package",
      "        continue-on-error: true",
      `        run: ${TYPECHECK_COMMAND}`,
      ...BUILD_STEP,
    ].join("\n");
    const found = problems(probeQualityGate(fixture(steps)));
    expect(found.some((line) => line.includes("架空")), `期望报出「被架空」，实际：${found}`).toBe(
      true,
    );
  });

  // step 的**首行**可以带 YAML 列表项前缀：`- if: false` 是合法写法（官方文档的步骤示例就有
  // `- if:` 开头的），不能只匹配「空白后直接是字段名」。两种字段 × 两种换行各一个负例。
  for (const blocking of ["if: false", "continue-on-error: true"]) {
    for (const [label, encode] of [
      ["LF", (text: string) => text],
      ["CRLF", toCrlf],
    ] as const) {
      it(`step 首行写成 \`- ${blocking}\`（${label}）要报「被架空」`, () => {
        const steps = [
          `      - ${blocking}`,
          "        name: Type-check v3 package",
          `        run: ${TYPECHECK_COMMAND}`,
          ...BUILD_STEP,
        ].join("\n");
        const found = problems(probeQualityGate(encode(fixture(steps))));
        expect(
          found.some((line) => line.includes("架空")),
          `期望报出「被架空」，实际：${found}`,
        ).toBe(true);
      });
    }
  }

  it("flow-style 步骤（`- {if: false, run: ...}`）要报错，不能被静默放过", () => {
    const steps = [`      - {if: false, run: ${TYPECHECK_COMMAND}}`, ...BUILD_STEP].join("\n");
    const found = problems(probeQualityGate(fixture(steps)));
    // 本判定只支持块式 YAML：flow-style 下连 `run:` 都认不出来，于是报「没有 step」。方向是
    // 「报错」而不是「静默放行」——这是不为一条 CI 形状门禁引入 YAML 解析依赖的刻意取舍。
    expect(found, "flow-style 必须报错，不能静默通过").not.toEqual([]);
  });

  it("typecheck 排在 build 之后要报顺序问题", () => {
    const steps = [...BUILD_STEP, "      - name: Type-check v3 package", `        run: ${TYPECHECK_COMMAND}`].join(
      "\n",
    );
    expect(problems(probeQualityGate(fixture(steps)))).toContain(
      "typecheck:v3 排在了 build:v3 之后",
    );
  });

  it("typecheck 只出现在 v3 job 时要报「没有 step」（不能跨 job 取首个匹配）", () => {
    const qualitySteps = BUILD_STEP.join("\n");
    const onlyInV3 = fixture(qualitySteps).replace(
      "  v3:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Build v3 package",
      [
        "  v3:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: Type-check v3 package",
        `        run: ${TYPECHECK_COMMAND}`,
        "      - name: Build v3 package",
      ].join("\n"),
    );
    expect(problems(probeQualityGate(onlyInV3))).toContain(
      "没有 `run: pnpm typecheck:v3` 这个 step",
    );
  });
});
