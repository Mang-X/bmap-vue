---
"@mangax/bmap-vue": patch
---

修掉 `pnpm test:unit` 里**与改动无关的偶发超时**（#216）。

## 根因

Vitest 默认给**每个用例** 5s（本仓此前没设 `testTimeout`，即吃默认值）。而仓里有一批用例
做的是**同步重活**：

- 现场起 TypeScript 编译器做类型检查（`ts.createProgram` + `getSemanticDiagnostics`）——
  `api-forgotten-exports-gate` / `ui-kit-widget-contract`；
- 扫整棵 `packages/bmap-vue/src` 树（含 SFC 解析）——`raw-sdk-scanner` 的 `--src` 模式；
- 在循环里挂载 / 卸载整棵组件树 **100 次**——`component-scenarios`。

本机（10 vCPU、全量并行）实测这几条就要 **0.9–1.2s**（最重的是 `api-forgotten-exports-gate`
的 1204ms）；CI 是 4 vCPU 且并行跑文件，同样的用例会慢好几倍，于是偶发撞到 5s 墙上，
报 `Test timed out`（不是断言不符）。危害不在超时本身，而在它**污染每一张 PR 的信号**——
绿灯不再等于「没有回归」，评审者得先花几轮证明「不是我改坏的」。

## 修法

根 `vitest.config.ts` 显式 `testTimeout: 30_000`（最重实测用例的 25 倍）。

**刻意只动全局，不给逐条用例设预算**：一个显式的 per-test `timeout` 会**盖过**全局值，比全局
更严而非更宽。把重活用例的预算写成 `min(实测 × 40, 上限)` 一类的算式，上限一旦低于安全网，
就等于**把最重的几条重新绑回更紧的预算**——那正是要修的东西。集中一个安全网，没有「逐条算错」
的空间。

判据由 `tests/behavior/unit-test-timeout-gate.test.ts` 钉住三件：`testTimeout` 必须显式设置、
不得回落到默认 5s；必须落在 **[下限, 上限]** 区间内（只锁下限会放过 `Infinity` / 超大值，那等于
把「卡死」当作「慢」）；且 `test:unit` 不得自带 `--testTimeout` 盖过根配置。没有这些判据，把
配置行删回默认或加大到无意义，全套用例照样全绿——而这正是本票要根治的形态。

## 本 PR **不能**证明什么（重要）

- **不能证明偶发率已归零。** 一次 CI 全绿 + 本机（连 CPU 过载都）复现不出原始偶发，只能证明
  「改动目前通过」，不能证明 flaky rate 已是 0。要下这个结论，需要在**同等 4 vCPU 的 CI 环境**
  上重跑若干轮完整 `test:unit`，记录最长单例耗时与 `assertIdle` 失败率。本 PR 不做这件事。
- **不能证明 `component-scenarios` 的 `资源未释放` 是超时副作用。** `assertIdle` 的读数在**它被
  执行的那一刻**取；一个**未验证的假设**是：重活用例超时后 Vitest 并不中止其函数体，仍在飞的
  挂载/卸载继续跑，于是同文件里紧跟着的那条用例读到半程的非零计数，再叠加真实的
  `Test timed out`。放大超时预算能**减少**这个竞争，但**不能据此排除**独立泄漏——
  #216 的这条验收项（「是超时副作用还是真实泄漏」）**本 PR 不关闭**，留待受限环境重复跑或补
  明确的生命周期断言来核实。反面证据仅有一条、也非充分：`#186` 那组用例在 15 轮过载重复跑里
  `assertIdle` 全部通过。

## 验证（到此为止能证明的）

- `pnpm test:unit`：**224 文件 / 4164 passed / 0 failed**（含新增超时预算门禁用例）。
- 全局默认**确为 30s**（现场验证）：一个 6s 的用例通过——在旧的 5s 下会失败。
- 在 **CPU 忙循环制造过载**的条件下：重活文件连跑 12 轮、`component-scenarios` 单独连跑 15 轮，
  **0 次超时**；全量 `test:unit` 在过载下也过。**本机复现不出原始偶发**，因此本修法是按
  **机制 + 实测耗时**做的，而不是「复现后对症」。
- 静态门禁：`check:comment-hygiene` / `docs:format:check` / 性能配置一致性通过。
