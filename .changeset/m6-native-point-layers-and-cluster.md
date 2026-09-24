---
"bmap-vue": minor
---

原生点图层与原生聚合：三个点图层组件、`MarkerCluster` 原生优先，以及 `PointCollection` 的更名。

- **`BPointShapeLayer` / `PointIconLayer`（新增）**：一份业务数据 → 一个 v4 原生批量点图层
  （官方 `BMap.PointShapeLayer` / `BMap.PointIconLayer`，两处都有完整类声明）。三个点图层组件
  的取数面与 `MarkerList` 完全一致（`data` / `itemKey` / `getPosition` / `dataVersion` /
  `properties` / `visible`），业务数据可以直接平移；更新路径逐条对应官方入口（数据走 `setData`
  不重建、样式走 `setStyleOptions` + 显式重绘、显隐与透明度 / 层级 / 缩放范围走字段级 setter、
  构造期项变化才换实例）。图层级拾取提供 `item-click`（**最新**业务 item）与 `click`
  （`PointPick<Item>`，含未命中的 `hit: false`）。默认开启拾取（官方默认关）。
- **`PointLayer`（新增，`experimental`）**：落在官方**扩展 API** `BMap.PointLayer` 上
  （运行时存在、类型包无类声明、可视化实现按需异步注入）。一个组件覆盖「形状 / 图标」两种模式；
  选项是**扁平**的（`shape` / `icon` / `size` / `fillColor` / …）。能力就绪前创建会经
  `resource:error` 交出 `BMAP_CAPABILITY_UNSUPPORTED`，**不会**自动改用另外两个类。
- **`MarkerCluster` 默认走原生聚合**：默认 `engine="native"`，落地成一个原生 `ClusterLayer`
  （WebGL，整批点一个资源）。原生可用性由本库的真实取证确定（`scripts/probe-native-point-cluster.mts`），
  因此「原生缺失时的自研 fallback」这条自动降级**不成立**；`engine="markers"`（网格聚合 + 每簇一个
  Marker）改为**显式选择**，它的增量是唯一能给出**簇内业务项**的路径。
- **`cluster-click` 载荷改为两种引擎的公共最小契约**：`ClusterPick<Item>` =
  `{ engine, id, size, position, items }`。`items` 在 `native` 引擎下是 `null`（官方没有公开
  「簇里有哪几个业务项」的读回入口），在 `markers` 下是业务项数组。**破坏性变更**：旧载荷
  （`points`）不再存在。
- **新增 `cluster-change` 事件**：聚合结果读数 `ClusterChange` = `{ engine, clusters, singles, zoom }`。
  原生引擎转发官方 `ClusterLayer` 的 `change`，`markers` 引擎在重算后给出同名同形的读数
  （因此两种引擎的调用方代码不需要分支）。它是**读数转发**，本库不把它存成组件状态。
- **不补官方默认值**：`clusterRadius` / `clusterMinPoints` / `clusterMinZoom` / `clusterMaxZoom` /
  `fitViewOnClick` / `singleStyle` 未提供时**不写这个选项**，用 SDK 自己的默认值（本库实测那一组是
  `60 / 2 / 3 / 16 / true / null`，只作参考）。⚠️ 其中 `fitViewOnClick` 的官方默认是 **`true`**
  —— 点簇会缩放地图，不想缩放请显式传 `false`。
- **数据变空走 `clearData()`**：空 `data` 不再交付一条空 `FeatureCollection`（图层留着、数据清空）。
  点图层与原生聚合都是这条规则；卸载仍然只走 `removeLayer`。
- **`engine` 与选项的匹配关系会告警**：`gridSize` / `minClusterSize` / `zoom` 只对 `markers` 生效，
  `clusterRadius` / `clusterMinPoints` / `clusterMinZoom` / `clusterMaxZoom` / `fitViewOnClick` /
  `singleStyle` 只对 `native` 生效；与当前引擎不匹配的选项会指出名字并**告警一次**，不静默。
- **`PointCollection` → `BPointShapeLayer`（更名）**：`PointCollectionProps` →
  `BPointShapeLayerProps`。它在 `1.0.0-rc.0` 里并不存在（是未发布 changeset 里的新增），因此
  **不留弃用别名**。改名后三个点图层的名字与它们各自落地的 SDK 类同名（官方 React 参考实现也只
  暴露 `PointIconLayer` / `PointShapeLayer`）。
- **`point` / `cluster` 上的 `visible` 真正生效**：为这两个扩展 API 的 kind 放开了
  `setVisible`（有 live 取证：`setVisible(false)` 后 `getVisible() === false` 且可恢复），
  此前它们是「按官方专页口径回答不支持」⇒ `visible` 会静默不生效。其余继承成员
  （`setOpacity` / `setZIndex` / `setMinZoom` / `setMaxZoom` / 状态 API）**仍然关闭**：
  没有消费者，也没有取证。
- 内部：三个点图层组件共用一份生命周期（`core/data/pointLayerSpec.ts` 的 profile +
  `core/composables/useNativePointLayer.ts`），`MarkerCluster` 的两个引擎各收在一个模块里
  （`components/data/{clusterEngine,markerClusterEngine,nativeClusterEngine}.ts`）。
  探针新增 `pnpm probe:native-point-cluster`。
- **`./core` 出口的三处新增（附加、不破坏）**：`LayerRecord.detach()` —— 与 `dispose()` 分工的
  **三阶段严格**释放路径（quiesce 挡业务回调 → 摘资源（失败抛）→ 解绑监听 + 销账；失败时**不解绑
  也不销账**）；`LayerRecord.attachment` —— `"attached" | "unknown"` 的挂载态（`remove` 抛错后
  无法判断资源是否还在图上 ⇒ `unknown`；**下一次**严格释放会受控地再摘一次把它收敛成确定状态，
  收敛期间组件**不再向该实例写入**）；`LayerRegistrationInput.quiesce` —— 摘除期间的业务回调门
  （可选，由账本在严格路径上驱动）；`DataLayerManager.size` —— 「还有几个资源归我管」的读数
  （摘除失败会按所有权保留，因此计数归零 ⟺ 确认摘净）；`DataLayerManager.unknownSize` ——
  挂载态未知（摘除抛错、无法判断是否仍在图上）的资源数；这类资源**不进入**位置 / 显隐写入
  （索引记账照旧），只由摘除路径把它收敛回确定状态。
- 决策、取证读数与已知限制见 `docs/adr/2026-09-19-native-point-layers-and-cluster.md`；
  四轮评审修正（各自的三条 / 两条 / 一条 / 一条阻塞项 + 逐条复现读数）见该 ADR 的末节。
