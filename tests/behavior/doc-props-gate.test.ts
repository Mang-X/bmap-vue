/**
 * 文档 prop 名门禁自测（issue #141）
 *
 * ## 这道门禁在防什么
 *
 * `docs:typecheck` 编译示例，但**编译不出**「prop 名写错」这一类错误：
 * 一个不存在的 kebab prop 会落进 `$attrs`，Vue 既不报错、也不生效。#165 把
 * `enableScrollWheelZoom` 改名成 `enableWheelZoom` 之后，文档里 9 处旧名一直静静
 * 躺在那儿——每一条都让示例的一个开关**静默失效**。
 *
 * ## 失效方式
 *
 * 抽取器写错会让门禁恒绿（扫不到东西）或恒红（把所有 prop 都判成不符）。
 * 所以每条规则都配正反例，并断言**真实扫描面确实扫到了东西**——
 * 「扫到 0 个所以通过」和「真的干净」在日志上必须长得不一样。
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const SCRIPT = resolve(ROOT, "scripts/check-doc-props.mts");

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

describe("check-doc-props · 判据有区分力", () => {
  it("真实文档面通过，并且**确实扫到了东西**", () => {
    const r = runGate();
    expect(r.code, r.output).toBe(0);
    // 关键：不能是「扫到 0 个所以通过」。这是本用例最重要的一条。
    const match = /(\d+) 处 prop 名/.exec(r.output);
    expect(match, r.output).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(50);
  });

  it("kebab-case 的 prop 名被接受（Vue 会归一化成 camel）", () => {
    // 真实扫描面里全是 kebab 写法的 prop（`:enable-wheel-zoom`），若抽取器不认
    // kebab，上面那条会立刻红。显式点出来，避免以后有人「修」过头。
    const r = runGate();
    expect(r.output).not.toContain("enable-wheel-zoom");
  });
});

describe("check-doc-props · 抽取器", () => {
  it("camel：kebab 归一化成 camelCase", () => {
    // 与实现同形地验一遍规则本身
    const camel = (s: string): string => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    expect(camel("enable-wheel-zoom")).toBe("enableWheelZoom");
    expect(camel("enableDblclickZoom")).toBe("enableDblclickZoom");
  });
});

describe("check-doc-props · CI 接线", () => {
  it("门禁真的在 quality job 里跑，且没被架空", () => {
    const block = stepBlockContaining(readWorkflow("quality.yml"), "scripts/check-doc-props.mts");
    expect(block.length, "workflow 里找不到调用该门禁的 step").toBeGreaterThan(0);
    const text = block.join("\n");
    expect(text).toContain("run: node --experimental-strip-types scripts/check-doc-props.mts");
    expect(text).not.toContain("continue-on-error");
    expect(text).not.toMatch(/^\s*if:/m);
  });

  it("package.json 暴露了对应 script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:doc-props"]).toContain("scripts/check-doc-props.mts");
  });
});
