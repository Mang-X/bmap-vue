/**
 * 基准专用 vitest 配置（M6-PERFORMANCE / issue #37）
 *
 * 与根 `vitest.config.ts` 的差异只有四处，每处都有理由（不是「顺手多一份配置」）：
 *
 * 1. `include` 只覆盖 `tests/performance/**`：基准不该混进 `test:unit` 的执行范围（那会让每次
 *    跑单测都背上五十多秒的采样）。
 * 2. `fileParallelism: false`：基准**必须串行**。两个基准文件并行跑会互相抢 CPU，读数不再可比，
 *    而「可比」正是本套存在的唯一理由。
 * 3. `execArgv: ['--expose-gc']`：堆趋势要测的是「**留住**了多少」，不是「分配了多少」。
 *    没有强制 GC 时，100 次 10k 要素替换的读数会是 200MB+ 的未回收垃圾，根本分不清
 *    「泄漏」与「GC 还没跑」（实测：有 `gc()` 时同一场景的保留量是 0.03MB）。
 *    Vitest 4 起该选项在**顶层**（`poolOptions` 已移除）。
 * 4. `testTimeout` 放大：50k 规模的多次采样 + 100 次替换 + 强制 GC 本来就是几十秒的量级。
 *
 * 其余项（`environment` / `globals` / `setupFiles` / `define`）**必须与根配置
 * 逐字一致**——它们一旦漂移，症状是「基准里的用例莫名失败」而不是「配置错了」。
 * 这条约定由 `config-consistency.perf.test.ts` 守着（文本比对会假绿，所以那边 import 两份对象比）。
 *
 * 5. `exclude` 掉 #140 的跨库对照基准：它有**自己的**配置与**自己的**指标目录
 *    （见 `official-contrast.vitest.config.ts` 的文件头）。两套基准混进同一个
 *    `PERF_METRICS_DIR` 会让基线的指标集��校验确定性红。
 */
import { configDefaults, defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { versionDefine } from "../../scripts/vite-version-define.mjs";

export default defineConfig({
  plugins: [vue()],
  define: {
    ...versionDefine,
    __DEV__: "true",
  },
  test: {
    include: ["tests/performance/**/*.test.ts"],
    // 「单库趋势基线」这一套的**边界**：#140 的跨库对照基准跑在**自己的**配置里
    // （`official-contrast.vitest.config.ts`），不进入本配置的 `PERF_METRICS_DIR`。
    //
    // 曾经两份共用这一个 include，于是 `perf:baseline` 顺带跑了对照基准，把
    // `*.ours` / `*.official` 成对的跨库指标写进基线目录，随后基线的「指标集合双向校验」
    // 判定「报告有而基线没有」⇒ `performance` job 确定性红（#140 第 2 轮评审第 3 条）。
    // 指标集一改就红，且官方侧毫秒会挡住本库自己的趋势——所以是**执行范围隔离**，
    // 不是往 baseline.json 里补录这些指标。两侧理由见
    // `official-contrast.vitest.config.ts` 的文件头。
    //
    // ⚠️ 必须带 `configDefaults.exclude`：**写 `exclude` 就是整份替换默认值**，
    // 裸写一条会把 `node_modules` / `dist` 的默认排除弄掉，让 vitest 去收集依赖目录。
    exclude: [...configDefaults.exclude, "tests/performance/official-contrast.perf.test.ts"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    execArgv: ["--expose-gc"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
