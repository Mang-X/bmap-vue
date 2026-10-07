---
"@mangax/bmap-vue": patch
---

修复共享 Client 加载的取消隔离与销毁后状态回写（#186）

`createClientContext`（`<BMapProvider>` / `<Map>` / 服务 composable / 插件默认 definition 共用的
**唯一** Client 收口点）把「共享生产任务」与「第一个调用者的等待」写成了同一件事，三条缺陷因此
是结构性的：

- **取消隔离**：第一个调用者的 `signal` 直接进了共享任务。它取消时**未取消的后来者一并被拒**；
  而后来者取消只影响自己——先后调用者语义不对称。现在共享任务归 context 所有、不接受任何
  调用者的 signal，每次 `load(signal)` 只是 caller-owned 的等待，abort 只以
  `BMAP_PROVIDER_ABORTED` 结算自己。这与下一层 `SharedLoadTask` / `SdkRegistry.subscribe`
  的既有口径同构。
- **`dispose()` 是终态**：此前迟到的成功/失败仍把 `disposed` 改写成 `ready` / `error`。
  现在成功/失败写入前各判一次 `disposed`，迟到的成功以 `BMAP_RESOURCE_DISPOSED` 拒绝且不写
  `client`，迟到的失败不改 `status` / `error`。
- **等待监听器**：`Promise.race` 的 abort 监听器在正常完成时未被移除，现在结算前先解绑
  （有单测钉住「完成后不再有解绑动作」）。

两处顺带收窄：`load()` 的失败改为**拒绝原错误**（与 `MapRuntime.doMount`、`BMapProvider.ensureLoad`
对齐，不再把 `BMapError` 的 `code` 折进新错误的字段；`ctx.error` 仍是归一化后的 `BMapError`）；
`retry()` 只在 `error` 档复位状态，不再把在飞的 `loading` 抹成 `idle`。

评审修正（P1）：拆分时「缺 definition」这条**启动前**失败一度写成独立的 `Promise.reject`，
绕过了统一的状态写入——`<BMapProvider>` 的 `#error` 插槽判的是 `context.status === "error"`，
于是缺配置时错误插槽不再出现、context 静默停在 `idle`。现在启动前失败与生产失败汇进同一处
结算，`status` / `error` 的读数与旧实现一致（新增单测与 `#error` 插槽用例各一条钉住）。

底层加载**依旧不可取消**（官方 Loader 没有公开取消接口，SDK namespace 是进程级共享状态）：
取消是**逻辑**取消——丢弃回包，不假装终止了网络请求，也不重置上游 `window.BMap`。
决策与依据见 ADR `2026-10-03-client-context-shared-task-ownership`。

公开 API 形状无变化。
