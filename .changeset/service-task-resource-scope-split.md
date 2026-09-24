---
"bmap-vue": major
---

服务任务分两档 + ResourceScope 收成最小外部资源内核（#139）。

**服务任务分层**：按「该服务的 SDK 实例**有没有公开的释放入口**」分成两档，而不是让所有服务共用一套实例身份语义。Geocoder / GeocodeDetail / Convertor / Boundary / Geolocation / LocalCity / IpLocation 走简单档（无状态实例通道），**不再**携带无消费者的 recreate / refuse / 待释放队列状态，也不再暴露 `invalidateService`；LocalSearch 与四个路线服务走独占档（官方有 `disposeLocalSearch` / `disposeRoute`），保留 supersede 语义与释放失败重试。两档共用同一个框架无关内核。

**公共面收窄**：`useServiceTask` / `UseServiceTaskOptions` / `ServiceTask` / `ServiceInvokeContext` / `SupersedeMode` / `SupersedePolicy` 全部内部化，不再从根入口导出（对外只有 12 个服务 composable 本身）。根入口导出数 394 → 387。

**ResourceScope 不再管 Vue 的 effect 生命周期**：`run()` 与内嵌 `effectScope` 删除，24 处 `scope.add(watch(...))` 拆掉——watcher 在 setup 同步期由 Vue 自己停。ResourceScope 收成最小外部资源内核（`add` / `fork` / `signal` / `size` / `label` / `isDisposed` / `dispose`），零消费者的 `addEventListener` / `observe` / `remove` / `onDisposeError` / `parentSignal` 一并删除；「单个 disposer 抛错不中断其余释放」与「父释放 ⇒ 子释放」两条行为保留并有对应用例。同时删除 `MapRuntimeShape.scope`（`resources` 的零读者别名）。

决策与全部依据见 ADR `docs/adr/2026-09-24-service-task-and-resource-scope-split.md`。
