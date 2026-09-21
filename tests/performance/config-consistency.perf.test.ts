/**
 * 基准配置与根配置的一致性门禁（M6-PERFORMANCE / issue #37）
 *
 * 为什么需要它：基准有一份自己的 `vitest.config.ts`（串行 + `--expose-gc` + 独立范围），
 * 而它与根配置**共享**几项（DOM 环境、setup 文件、编译期常量、别名）。这些项一旦漂移，
 * 症状是「基准里的用例莫名失败」，而不是「配置错了」——最难查的一类失效。
 *
 * 因此这里直接 import 两份配置对象比对，**不做文本匹配**：文本匹配会在格式调整后假绿。
 */
import { describe, expect, it } from "vitest";
import rootConfig from "../../vitest.config";
import perfConfig from "./vitest.config";

interface VitestConfigShape {
  readonly define?: Record<string, unknown>;
  readonly resolve?: { readonly alias?: Record<string, string> };
  readonly test?: {
    readonly include?: readonly string[];
    readonly environment?: string;
    readonly globals?: boolean;
    readonly setupFiles?: readonly string[];
    readonly fileParallelism?: boolean;
    readonly execArgv?: readonly string[];
  };
}

const root = rootConfig as unknown as VitestConfigShape;
const perf = perfConfig as unknown as VitestConfigShape;

describe("基准配置与根配置的一致性", () => {
  it("共享项必须一致（DOM 环境 / setup / 编译期常量 / 别名）", () => {
    // 正证守卫：根配置本身得是「有内容」的，否则下面几条会在两个空对象之间比较并通过。
    expect(root.test?.setupFiles?.length, "根配置必须有 setupFiles").toBeGreaterThan(0);

    expect(perf.test?.environment, "DOM 环境").toBe(root.test?.environment);
    expect(perf.test?.globals, "globals").toBe(root.test?.globals);
    expect(perf.test?.setupFiles, "setup 文件").toEqual(root.test?.setupFiles);
    expect(perf.define, "编译期常量（__DEV__ / __VERSION__）").toEqual(root.define);
    // 别名也要对齐：基准同样 import 组件库源码，少一个别名会以「模块解析失败」的形式炸在运行期。
    expect(perf.resolve?.alias, "resolve.alias").toEqual(root.resolve?.alias);
  });

  it("基准专属项必须真的设上（否则本套的前提出错时会静默）", () => {
    expect(perf.test?.fileParallelism, "基准必须串行").toBe(false);
    expect(perf.test?.execArgv, "堆趋势需要强制 GC").toContain("--expose-gc");
    expect(perf.test?.include, "基准只跑 tests/performance").toEqual(["tests/performance/**/*.test.ts"]);
    // 正证守卫：根配置的范围不能被顺带改窄（否则 `test:unit` 会静默漏跑一整片）。
    expect(root.test?.include?.length, "根配置的 include 不能为空").toBeGreaterThan(0);
  });
});
