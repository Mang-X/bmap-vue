/**
 * **跨库对照**基准专用的 vitest 配置（issue #140）
 *
 * ## 为什么必须与 `tests/performance/vitest.config.ts` 分家
 *
 * 两套基准是**两件不可互相替代的东西**，产物也必须分开落盘：
 *
 * | | #37 单库趋势基线 | #140 跨库对照 |
 * | --- | --- | --- |
 * | 回答 | 「本库相对**自己**上次跑，是不是变慢了」 | 「本库与官方 1.0.1 在同一场景差在哪」 |
 * | 指标集 | 固定一列，参与 `baseline.json` 双向集���校验 | `*.ours` / `*.official` 成对出现，**随场景表增减** |
 * | 消费方 | `collect-performance-baseline.mts`（趋势门禁） | `collect-official-contrast.mts`（对照报告与退出码） |
 *
 * 曾经只有一份配置（include 是「tests/performance 下全部 .test.ts」），于是对照基准也被
 * `perf:baseline` 顺带跑了一遍，把 `map.lifecycle.ours` / `marker100.mount.official` ……
 * 写进**同一个** `PERF_METRICS_DIR`；随后基线的指标集合双向校验判定「报告有而基线没有」
 * ⇒ `performance` job 确定性红（第 2 轮评审第 3 条，Actions run 36092344781 实锤）。
 *
 * 两种「解法」都有害：把跨库指标录进 `baseline.json` 等于把两套体系再耦合一次
 * （场景表一改就红，且官方侧的毫秒会挡住本库自己的趋势）；靠记忆「别跑那条命令」不算门禁。
 * 因此**执行范围在配置层隔离**：
 *
 * - 基线配置 `exclude` 掉对照基准（见 `tests/performance/vitest.config.ts`）；
 * - 对照基准则有自己的 `include`，并把 `PERF_METRICS_DIR` 钉到**基线目录之外**——
 *   即使有人手工 `vitest run --config` 跑本套，也写不进 `baseline.json` 的输入目录。
 *
 * ## 其余项**不重新发明**：import 基线配置再覆盖两个字段
 *
 * 两份配置手抄一遍共享项（`environment` / `globals` / `setupFiles` / `define` / `alias` /
 * `fileParallelism` / `execArgv`）必然漂移，而漂移的症状是「基准里的用例莫名失败」而不是
 * 「配置错了」——本仓最难查的一类失效。因此这里从基线配置**派生**：
 * `config-consistency.perf.test.ts` 逐项断言两者共享项相等，本文件改坏共享项会立刻红。
 */
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import perfConfig from "./vitest.config";

const base = perfConfig as Record<string, unknown>;
const baseTest = (perfConfig as { test?: Record<string, unknown> }).test ?? {};

/** 本套的文件名：基线配置 exclude 它，本套 include 它——两处必须是同一个字面量。 */
const CONTRAST_FILE = "tests/performance/official-contrast.perf.test.ts";

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    /** 只跑对照基准这一份文件——它要按场景表成对采样，不能与别的文件抢 CPU。 */
    include: [CONTRAST_FILE],
    /**
     * **必须把基线的 `exclude` 里那条对照基准摘掉。**
     *
     * 上一行是 `...baseTest`，而基线配置的 `exclude` 正是为了把本文件排除在单库趋势
     * 基准之外。`defineConfig` 会把这里的 `exclude` 与继承来的那份再合并，直接沿用
     * 等于「include 选中它、exclude 又排除它」⇒ 对照档一跑就是**零可执行文件**，
     * 而 vitest 对「没有匹配到任何文件」并不总是非零退出——这正是本套最怕的那类假绿。
     * 保留 `configDefaults.exclude` 里的 node_modules / dist 默认排除。
     */
    exclude: (baseTest.exclude as string[] | undefined)?.filter(
      (pattern) => pattern !== CONTRAST_FILE,
    ),
    /**
     * 指标快照的落盘目录：**与基线目录物理分开**。
     *
     * `createPerfRecorder.flush()` 读 `PERF_METRICS_DIR`（缺省 `.artifacts/perf/metrics`，
     * 正是 `collect-performance-baseline.mts` 喂给基线校验的那个目录）。对照基准的读数
     * 进那里一次，就是上面那条 `performance` job 红的成因。`resolve` 到**绝对**路径：
     * 相对路径会按 `process.cwd()` 解释，从别的目录调起 vitest 时就跑到别处去了。
     */
    env: {
      ...((baseTest.env as Record<string, string> | undefined) ?? {}),
      PERF_METRICS_DIR: resolve(import.meta.dirname, "../../.artifacts/perf-contrast/metrics"),
    },
  },
});
