---
"@mangax/bmap-vue": patch
---

#165 收口两条：`<PointLayer>.isFlat` 补齐 + 「等成员面补齐再判成员存在」变成判定层

## 1. `<PointLayer>.isFlat`（家族内一致性）

`PointLayerProps` 补上官方 `PointLayerOptions.isFlat`（`visualization/PointLayer.d.ts:123`）
并按**与两个兄弟逐字同形**的口径转发。原先该 prop **整个缺失**：`PointCollection`
（`PointCollection.vue:162`）与 `PointIconLayer`（`PointIconLayer.vue:134`）**都投影了它**，
文件里没有任何写下的理由 —— 属「已有但缺失」，不是刻意的收窄。

「没表态 ⇒ **整个键不存在**」（不是 `isFlat: undefined`）：官方 `setOptions` 自己会忽略未声明的
键并告警一次（`PointLayer.d.ts:298`），发一个「键在、值 undefined」的成员既可能被那条告警扫到，
也可能被某个默认分支当成「显式 undefined」写进样式。

⚠️ **顺带更正一处会误导人的注释**：官方三处的 `@default` **互相矛盾** ——
`visualization/PointLayer.d.ts:121` 与 `visualization/TextLayer.d.ts:117` 写 `false`，
而 `layer/PointIconLayer.d.ts:15` / `layer/PointShapeLayer.d.ts:15` 写 `true`
（重新克隆 `baidu-maps/jsapi-v4-types` @ `5ba67f4` 逐条读完）。因此本库**不给** `isFlat`
默认值、也**不**替官方选一个；「没传 = 不表态 = SDK 自己的默认」是三个点图层组件一致的处置。

契约：`tests/type-contracts/point-layer-is-flat.type-test.ts`（类型面，钉住「不接受字符串/数字」
与「三族同形」）+ `component-scenarios.test.ts`（不表态不进选项袋、表态后换实例）。

## 2. 「等成员面补齐再判成员存在」从注释变成可执行判定层

`docs/zh-CN/contributing/165-runtime-audit-2026-09-27.md` 里一整轮 🔴 结论
（`CityListControl` 命令面整个不存在 / `expand` 静默空操作 / `removeCopyright` 不存在）
**全部是假的**：官方 4.0.5 的控件命令面是**分阶段挂载**的，完整成员面晚约 2.4s 才补上，
取样早一步就把「**还没到**」读成了「**永远没有**」。它此前**静默通过**了全绿的测试 ——
原因不是判断写错了，而是「读到 `false`」与「确实不存在」在取样代码里**长得一模一样**。

新增共享判定层 `scripts/official-probe/member-surface.mts` 并改写 `probe-165c-surface.mts`
（审计正是在该探针的控制面读数上抓到这个 bug）。三条不变式：

1. `absent` **只在 settled 之后**可能出现；补齐之前一律 `unsettled`（未判定）；
2. 等待**可观测**：`settled` / `timedOut` / `settledAfterMs` / 逐次 `timeline` / 终态每类成员数
   单独成段，读者能分辨「稳定态读数」与「提前读数」；
3. 等待**超时**是正常结果，而超时后的 `absent` 正是要根除的假阴性 ⇒ 判定层收的是
   **报告**的 `settled` 标志，不让调用点自己判断「我等到没有」。

⚠️ 判定层第一版写完后，live 复跑立刻抓到**第二个**假阴性（同一类错误，方向相反）：
页面侧只采 `settleWhenPresent` 里的成员，`open` / `close` / `getTriggerDom` 根本没被读过，
却在稳定态被判成 `absent`。修法是 spec 增加**独立**的 `observe` 集合
（判就绪的成员 ≠ 要下结论的成员）。这一条比窗口那条**更难发现**：它出现在 settled **之后**，
报告看起来完全正常。live 复跑九个成员全 `present`，与稳定态读数一致。

回归守卫 `tests/behavior/probe-member-surface.test.ts`（17 条）：假 SDK 编排那个窗口，
**页面侧那份源码也用 `new Function` 真跑一遍** —— 等待逻辑本身是被测到的，不只是「写了注释」。
三次变异验证过它确实承重（恒 `settled` ⇒ 4 条红；页面侧不等待 ⇒ 1 条红；
`observe` 退回只用 `settleWhenPresent` ⇒ 1 条红）。

**不影响公共 API 面**（新增的 `PointLayerProps.isFlat` 是可选 prop），
`etc/**` 的基线由父任务统一重新生成。
