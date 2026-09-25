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
import contrastConfig from "./official-contrast.vitest.config";

interface VitestConfigShape {
  readonly define?: Record<string, unknown>;
  readonly resolve?: { readonly alias?: Record<string, string> };
  readonly test?: {
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly environment?: string;
    readonly globals?: boolean;
    readonly setupFiles?: readonly string[];
    readonly fileParallelism?: boolean;
    readonly execArgv?: readonly string[];
    readonly env?: Record<string, string>;
  };
}

const root = rootConfig as unknown as VitestConfigShape;
const perf = perfConfig as unknown as VitestConfigShape;
const contrast = contrastConfig as unknown as VitestConfigShape;

/** #140 的对照基准文件：两套基准的配置对它**互斥**。 */
const CONTRAST_FILE = "tests/performance/official-contrast.perf.test.ts";

describe("基准配置与根配置的一致性", () => {
  it("共享项必须一致（DOM 环境 / setup / 编译期常量 / 别名）", () => {
    // 正证守卫：根配置本身得是「有内容」的，否则下面几条会在两个空对象之间比较并通过。
    expect(root.test?.setupFiles?.length, "根配置必须有 setupFiles").toBeGreaterThan(0);

    expect(perf.test?.environment, "DOM 环境").toBe(root.test?.environment);
    expect(perf.test?.globals, "globals").toBe(root.test?.globals);
    expect(perf.test?.setupFiles, "setup 文件").toEqual(root.test?.setupFiles);
    expect(perf.define, "编译期常量（__DEV__）").toEqual(root.define);
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

  it("两套基准互斥：对照基准被基线配置 exclude，且只出现在对照配置的 include 里", () => {
    // 少了这条，`perf:baseline` 会顺带跑一遍跨库对照，把 `*.ours` / `*.official` 写进
    // `PERF_METRICS_DIR` ⇒ 基线的指标集合校验确定性红（#140 第 2 轮评审第 3 条，CI 实锤）。
    expect(perf.test?.exclude, "基线配置必须 exclude 对照基准").toContain(CONTRAST_FILE);
    expect(contrast.test?.include, "对照配置只跑对照基准").toEqual([CONTRAST_FILE]);
    // 对照基准不能在自己的配置里又被 exclude 掉——那会让对照档一跑就「没有可执行范围」。
    expect(contrast.test?.exclude ?? [], "对照配置不该再 exclude 自己").not.toContain(CONTRAST_FILE);
  });

  it("对照配置从基线配置派生：共享项不许各自漂移", () => {
    // 对照配置是 `import perfConfig` 后只改 `include` / `env`；这里逐项钉住，
    // 防止「派生」退化成两份手抄。
    for (const key of [
      "environment",
      "globals",
      "setupFiles",
      "fileParallelism",
      "execArgv",
    ] as const) {
      expect(contrast.test?.[key], `对照配置的 ${key} 与基线配置漂移了`).toEqual(perf.test?.[key]);
    }
    expect(contrast.define, "编译期常量（__DEV__）").toEqual(perf.define);
    expect(contrast.resolve?.alias, "resolve.alias").toEqual(perf.resolve?.alias);
  });

  it("对照基准的指标目录与基线指标目录物理分开", () => {
    // 根因防线：两条路径任一成立都足以避免指标集漂移。目录必须是**绝对**路径——
    // 相对路径按 `process.cwd()` 解释，从别处调起 vitest 就会跑到别处去。
    const contrastDir = contrast.test?.env?.PERF_METRICS_DIR;
    expect(contrastDir, "对照配置没钉 PERF_METRICS_DIR").toBeTruthy();
    expect(
      contrastDir?.endsWith("/.artifacts/perf/metrics"),
      "对照指标目录不能落在基线的 .artifacts/perf/metrics",
    ).toBe(false);
    expect(contrastDir?.startsWith("/"), "对照指标目录必须是绝对路径").toBe(true);
  });
});
