import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { versionDefine } from './scripts/vite-version-define.mjs'

export default defineConfig({
  plugins: [vue()],
  define: {
    ...versionDefine,
    __DEV__: 'true',
  },
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    /**
     * `testTimeout` 从 Vitest 默认的 5s 抬到 30s（#216）。
     *
     * 5s 是「一个用例」的默认预算，但本仓有一批**同步重活**用例（`ts.createProgram` 现场类型检查、
     * 整棵 `src` 树扫描、100 轮组件树挂载/卸载），本机无并发压力下实测就要 0.5–1.2s；CI 是 4 vCPU
     * 且并行跑文件，同样的用例会慢好几倍，于是偶发撞到 5s 墙上——表现为 `Test timed out`，
     * 而不是断言不符。这类失败的代价是**污染每一张 PR 的信号**：评审者得先证明「不是我改坏的」。
     *
     * 抬到 30s 是**安全网**，不是给某个用例的预算：它 ≈ 本机最慢用例（1.2s）的 25 倍，
     * 慢到不会误伤真回归，又有上限兜底（不能把它当成「允许卡住」）。刻意**不给逐条用例另设
     * 预算**——显式的 per-test `timeout` 会盖过这里的全局值，反而更严。判据见
     * `tests/behavior/unit-test-timeout-gate.test.ts`（区间 + `test:unit` 不得用命令行盖过）。
     *
     * 基准有自己的 180s 预算（`tests/performance/vitest.config.ts`），与此处不冲突。
     */
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
})
