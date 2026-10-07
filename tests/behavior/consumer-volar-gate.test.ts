/**
 * Volar 消费者门禁的自测（issue #158 工作包 C）
 *
 * ## 判据只在两处
 *
 * 1. **合成报告的行为反例**：`parseVolarDiagnostics` / `assertVolarReport` 是纯函数，这里
 *    喂真实形态的诊断行（含应被忽略的 `Found N errors` 之类），确认解析与断言的行为；
 *    再对每一类违规各喂一份合成报告，确认它抛错。
 * 2. **接线**：`verify:package` 真的调了驱动脚本（新增门禁最典型的失效方式是「写了但没跑」）。
 *
 * 真实 `vue-tsc` 对着装出来的 tarball 编译真实 `.vue` 模板这件事，由 `verify:package`
 * 的集成门禁验证（CI 的 `package` job）。
 *
 * ## 刻意**不**做的事
 *
 * 不扫描 `positive.vue` / `negative.vue` / tsconfig / runner 的源码形状。探针写成**只有
 * template 的 SFC**，「无本地 import」因此是结构保证；「GlobalComponents 真的生效」由反证
 * 的诊断证明。「不增加锁定源码或注释写法的门禁」是 #158 的非目标。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertVolarReport,
  parseVolarDiagnostics,
  UNKNOWN_SLOT_MEMBER_SENTINEL,
  WRONG_PROP_VALUE_SENTINEL,
  type VolarDiagnostic,
  type VolarReport,
  type VolarRun,
} from "../../scripts/consumer-volar-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function diagnostic(overrides: Partial<VolarDiagnostic> = {}): VolarDiagnostic {
  return { file: "negative.vue", line: 2, column: 9, code: 2322, message: "", ...overrides };
}

function run(overrides: Partial<VolarRun> = {}): VolarRun {
  return { exitCode: 0, output: "", diagnostics: [], ...overrides };
}

function validReport(): VolarReport {
  return {
    positive: run({ exitCode: 0, diagnostics: [] }),
    negative: run({
      exitCode: 2,
      diagnostics: [
        diagnostic({
          code: 2322,
          message: `Type '"${WRONG_PROP_VALUE_SENTINEL}"' is not assignable to type '"suspend" | "dispose" | undefined'.`,
        }),
        diagnostic({
          code: 2339,
          line: 3,
          column: 27,
          message: `Property '${UNKNOWN_SLOT_MEMBER_SENTINEL}' does not exist on type '{ status: MapStatus; map: MapHandle | null; }'.`,
        }),
      ],
    }),
  };
}

describe("Volar 门禁：接线", () => {
  it("verify:package 调的是同一个 Volar 实现（否则这道门禁写了但没跑）", () => {
    expect(read(VERIFY), "verify-package.mts 没有调用 Volar 门禁").toContain("consumer-volar.mts");
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    const workflow = readWorkflow("quality.yml");
    expect(stepBlockContaining(workflow, "verify:package").length).toBeGreaterThan(0);
    expect(workflow, "CI 里出现了 Volar 脚本的第二处调用").not.toContain("consumer-volar.mts");
  });
});

describe("Volar 门禁：诊断解析", () => {
  it("解析出文件 / 行列 / 诊断码 / 消息", () => {
    const raw = "negative.vue(2,9): error TS2322: Type 'string' is not assignable to type 'number'.\n";
    expect(parseVolarDiagnostics(raw)).toEqual([
      { file: "negative.vue", line: 2, column: 9, code: 2322, message: "Type 'string' is not assignable to type 'number'." },
    ]);
  });

  it("忽略非诊断行（清点行、空行）", () => {
    const raw = [
      "Found 2 errors in the same file.",
      "",
      "negative.vue(2,9): error TS2322: bad value",
      "  some indented hint line",
    ].join("\n");
    expect(parseVolarDiagnostics(raw).map((d) => d.code)).toEqual([2322]);
  });
});

describe("Volar 门禁：判据有牙（合成报告逐个喂）", () => {
  it("合法报告必须通过（避免判据恒假）", () => {
    expect(() => assertVolarReport(validReport())).not.toThrow();
  });

  it.each([
    [
      "正证退出码非零但没有带位置的诊断（TS18003 那类失败会假绿）",
      () => ({
        ...validReport(),
        positive: run({ exitCode: 2, output: "error TS18003: No inputs were found in config file." }),
      }),
    ],
    [
      "正证出现诊断（合法 props/slots 不可推导）",
      () => ({
        ...validReport(),
        positive: run({ diagnostics: [diagnostic({ file: "positive.vue" })] }),
      }),
    ],
    [
      "反证退出码 0（预期诊断一条都没出现）",
      () => ({
        ...validReport(),
        negative: run({ exitCode: 0, diagnostics: validReport().negative.diagnostics }),
      }),
    ],
    [
      "反证缺 TS2322（已有 prop 值类型写错没被检出）",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: validReport().negative.diagnostics.filter((d) => d.code !== 2322),
        }),
      }),
    ],
    [
      "有一条 TS2322，但不带 prop 值 sentinel（别的表达式冒充）",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: [
            diagnostic({ code: 2322, message: "Type 'string' is not assignable to type 'number'." }),
            ...validReport().negative.diagnostics.filter((d) => d.code === 2339),
          ],
        }),
      }),
    ],
    [
      "TS2322 来自别的文件（不是探针）",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: validReport().negative.diagnostics.map((d) =>
            d.code === 2322 ? { ...d, file: "src/unrelated.vue" } : d,
          ),
        }),
      }),
    ],
    [
      "反证缺 TS2339（不存在的 slot 成员没被检出）",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: validReport().negative.diagnostics.filter((d) => d.code !== 2339),
        }),
      }),
    ],
    [
      "TS2339 不是关于那个 slot 成员",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: validReport().negative.diagnostics.map((d) =>
            d.code === 2339 ? { ...d, message: "Property 'somethingElse' does not exist." } : d,
          ),
        }),
      }),
    ],
    [
      "TS2339 来自别的文件（不是探针）",
      () => ({
        ...validReport(),
        negative: run({
          exitCode: 2,
          diagnostics: validReport().negative.diagnostics.map((d) =>
            d.code === 2339 ? { ...d, file: "src/unrelated.vue" } : d,
          ),
        }),
      }),
    ],
    [
      "反证完全没报错（GlobalComponents 没生效）",
      () => ({ ...validReport(), negative: run({ exitCode: 1, diagnostics: [] }) }),
    ],
  ])("违规必须判红：%s", (_label, mutate) => {
    expect(() => assertVolarReport(mutate())).toThrow();
  });
});
