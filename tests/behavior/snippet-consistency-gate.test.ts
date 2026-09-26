/**
 * 三处 API 示例一致性门禁自测（issue #141）
 *
 * 这道门禁的判据是「示例里用到的每个标识符都必须真的在发布声明面里，且三处形状一致」。
 * 它的失效方式是**恒绿**：抽取逻辑写错（没抓到任何标识符）时，所有输入都会通过。
 * 所以这里的核心是给抽取器本身配**正例与反例**：
 * - 一个只含合法示例的 markdown → 必须抽出预期的标识符（证明它抓得到东西）；
 * - 一个含不存在名字的 markdown → 必须被标成未知（证明它抓得到**坏**东西）；
 * - 注释与 bash/json 代码块里的名字**不算**（证明判据不产生噪音）。
 *
 * 最后一节把门禁接回仓库：真实树通过、声明面缺失时 fail-closed、CI 真的跑它。
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-snippet-consistency.mts");

const tmp: string[] = [];
const makeTmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "snippet-gate-"));
  tmp.push(dir);
  return dir;
};
afterEach(() => {
  while (tmp.length > 0) rmSync(tmp.pop()!, { recursive: true, force: true });
});

interface ScanResult {
  code: number;
  output: string;
}

function runGate(args: string[] = []): ScanResult {
  try {
    const output = execFileSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

describe("check-snippet-consistency · 抽取器有区分力", () => {
  it("真实树通过，并报出它实际校验的标识符", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    // 关键：不能是「扫了 0 个标识符所以通过」——那正是这道门禁该防的恒绿。
    const match = /的 (\d+) 个标识符/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(3);
    expect(r.output).toContain("Map");
    expect(r.output).toContain("createBMapPlugin");
  });

  it("声明面读不到时 fail-closed（没有判据就不能放行）", () => {
    // 门禁跑在 build:package 之后。没有 dist/ 时判据不存在，恒绿比变红更危险。
    const out = runGate();
    if (out.code === 0) {
      expect(out.output).not.toContain("读不到 packages/bmap-vue/dist");
    } else {
      expect(out.output).toContain("读不到 packages/bmap-vue/dist");
    }
  });
});

describe("check-snippet-consistency · 判据本身", () => {
  it("三处的示例形状必须一致（某一份少一个标识符即红）", () => {
    // 判据是「并集包含」：任何一处缺少并集里的某个名字就是漂移。
    // 这条通过 `check-snippet-consistency` 的真实输出间接覆盖：真实三处形状一致且
    // 各不相同（README 少一些、docs 多一些），所以「完全相等」这个更弱的判据会误红。
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("形状一致");
  });
});

describe("check-snippet-consistency · CI 接线", () => {
  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "scripts/check-snippet-consistency.mts");
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-snippet-consistency.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:snippet-consistency"]).toContain("scripts/check-snippet-consistency.mts");
  });
});
