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

根 `vitest.config.ts` 显式 `testTimeout: 30_000`（== 最重实测用例的 25 倍 / 实测基线的 ~25×）。

**刻意只动全局，不给逐条用例设预算**：一个显式的 per-test `timeout` 会**盖过**全局值，比全局
更严而非更宽。把重活用例的预算写成 `min(实测 × 40, 上限)` 一类的算式，上限一旦低于安全网，
就等于**把最重的几条重新绑回更紧的预算**——那正是要修的东西。集中一个安全网，没有「逐条算错」
的空间。

判据由 `tests/behavior/unit-test-timeout-gate.test.ts` 钉住：`testTimeout` 必须显式设置、不得
回落到默认的 5s、且相对最重实测用例有不小于 10× 的余量。否则把这一行删回默认，全套用例照样
全绿——而这正是本票要根治的形态。

## 关于 `component-scenarios` 的 `资源未释放` 读数

`assertIdle` 的读数在**它被执行的那一刻**取。最可能的机制是：重活用例超时后，Vitest 并不中止
它的函数体，仍在飞的挂载/卸载继续跑，于是**同文件里紧跟着的**那条用例在 `assertIdle` 时读到了
半程的非零计数（62 listeners / 1 map / 1 overlay 这类），再叠加真实的 `Test timed out`——
**是超时的下游表现，不是独立泄漏**。

这个机制我**没有复现**（本机连过载都不触发），所以只作为解释而不是结论；能站住的是反面证据：
`#186` 那组用例在 15 轮过载重复跑里 `assertIdle` **全部通过**。门禁修掉后不再有超时路径去产出
半程读数，这条歧义也就消失了。

## 验证

- `pnpm test:unit`：**224 文件 / 4164 passed / 0 failed**（含新增 2 条超时预算门禁用例）。
- 全局默认**确为 30s**（现场验证）：一个 6s 的用例通过——在旧的 5s 下会失败。
- 在 **CPU 忙循环制造过载**的条件下：重活文件连跑 12 轮、`component-scenarios` 单独连跑 15 轮，
  **0 次超时**；全量 `test:unit` 在过载下也过。也就是说**本机复现不出原始偶发**（连过载都不触发），
  因此本修法是按**机制 + 实测耗时**做的，而不是「复现后对症」。
- 静态门禁：`check:comment-hygiene` / `docs:format:check` / 性能配置一致性通过。
