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
 * 其余项（`environment` / `globals` / `setupFiles` / `define` / `resolve.alias`）**必须与根配置
 * 逐字一致**——它们一旦漂移，症状是「基准里的用例莫名失败」而不是「配置错了」。
 * 这条约定由 `config-consistency.perf.test.ts` 守着（文本比对会假绿，所以那边 import 两份对象比）。
 */
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import { versionDefine } from "../../scripts/vite-version-define.mjs";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@v2": resolve(import.meta.dirname, "../../packages"),
    },
  },
  define: {
    ...versionDefine,
    __DEV__: "true",
  },
  test: {
    include: ["tests/performance/**/*.test.ts"],
    environment: "happy-dom",
    globals: true,
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    execArgv: ["--expose-gc"],
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
