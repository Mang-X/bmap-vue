/**
 * 样式消费门禁的自测（issue #158 工作包 D）
 *
 * ## 判据只在两处
 *
 * 1. **合成产物的行为反例**：`assertStylesReport` 是纯函数，这里对每一类违规各喂一份合成
 *    产物，确认它抛错；再确认合法产物能过（否则判据可能恒红）。
 * 2. **接线**：`verify:package` 真的调了驱动脚本（新增门禁最典型的失效方式是「写了但没跑」）。
 *
 * 真实 `vite build` 对着装出来的 tarball 跑这件事，由 `verify:package` 的集成门禁验证。
 *
 * ## 刻意**不**做的事
 *
 * 不扫描入口源码的形状（是否有顶层副作用、import 了什么）。「入口被摇成 0 字节」由产物里
 * 的 `BMAP_` 正证在集成层挡住 —— 产物为空时它找不到标记，门禁就红。
 * 「不增加锁定源码或注释写法的门禁」是 #158 的非目标。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertStylesReport, type StylesReport } from "../../scripts/consumer-styles-boundary.mts";
import { readWorkflow, stepBlockContaining } from "./workflow-helpers";

const ROOT = resolve(import.meta.dirname, "../..");
const VERIFY = resolve(ROOT, "scripts/verify-package.mts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const PUBLISHED_AUTOCOMPLETE_CSS =
  ".b-auto-complete-input[data-v-x]{z-index:10;box-sizing:border-box;" +
  "max-width:calc(100% - 20px);position:absolute;top:10px;left:10px}";

function validReport(): StylesReport {
  return {
    withStyles: { code: "export const x = 1;", css: PUBLISHED_AUTOCOMPLETE_CSS },
    rootOnly: { code: "const BMAP_ERROR = 'x';", css: "" },
  };
}

describe("样式门禁：接线", () => {
  it("verify:package 调的是同一个样式实现（否则这道门禁写了但没跑）", () => {
    expect(read(VERIFY), "verify-package.mts 没有调用样式门禁").toContain("consumer-styles.mts");
  });

  it("CI 的 package job 仍然只经 verify:package 这一个入口", () => {
    const workflow = readWorkflow("quality.yml");
    expect(stepBlockContaining(workflow, "verify:package").length).toBeGreaterThan(0);
    expect(workflow, "CI 里出现了样式脚本的第二处调用").not.toContain("consumer-styles.mts");
  });
});

describe("样式门禁：判据有牙（合成产物逐个喂）", () => {
  it("合法产物必须通过（避免判据恒假）", () => {
    expect(() => assertStylesReport(validReport())).not.toThrow();
  });

  it.each([
    [
      "显式 import 的产物没有任何 CSS",
      () => ({
        ...validReport(),
        withStyles: { code: validReport().withStyles.code, css: "" },
      }),
    ],
    [
      "显式 import 的 CSS 缺少 position:absolute",
      () => ({
        ...validReport(),
        withStyles: {
          code: validReport().withStyles.code,
          css: PUBLISHED_AUTOCOMPLETE_CSS.replace("position:absolute;", ""),
        },
      }),
    ],
    [
      "显式 import 的 CSS 缺少 z-index:10",
      () => ({
        ...validReport(),
        withStyles: {
          code: validReport().withStyles.code,
          css: PUBLISHED_AUTOCOMPLETE_CSS.replace("z-index:10;", ""),
        },
      }),
    ],
    [
      "不 import 的产物却带上了 Autocomplete 规则（自动注入回归）",
      () => ({
        ...validReport(),
        rootOnly: { code: validReport().rootOnly.code, css: PUBLISHED_AUTOCOMPLETE_CSS },
      }),
    ],
    [
      "根入口产物被摇空了（找不到本库标记）",
      () => ({
        ...validReport(),
        rootOnly: { code: "export {};", css: "" },
      }),
    ],
  ])("违规必须判红：%s", (_label, mutate) => {
    expect(() => assertStylesReport(mutate())).toThrow();
  });
});
