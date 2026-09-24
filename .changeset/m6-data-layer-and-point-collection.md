---
"bmap-vue": minor
---

收口数据组件：逐项 Marker 与批量点层的边界、`DataLayerManager` 的 item / version / latest 语义、
泛型 GeoJSON 适配，以及新的 `PointCollection`。

**边界现在由「落地成几个 SDK 资源」定义**：`MarkerList` 每项一个 Marker、`MarkerCluster` 每簇一个
Marker、`PointCollection` **整批只有一个原生图层**（官方 `BMap.PointShapeLayer`）。三个组件的取数面
完全一致（`data` / `itemKey` / `getPosition` / `dataVersion` / `visible`），业务数据可以直接平移。

- **`PointCollection`（新增）**：一份业务数据 → 一个 v4 原生批量点图层。`data` / `properties` 走
  `setData()`（不重建）、样式走「更新 + 显式重绘」、`visible` / `opacity` / `zIndex` / 缩放范围走
  字段级 setter（隐藏不摘图层、不释放数据）、构造期项（`enablePicked` / `pickWidth` / `pickHeight` /
  `itemKey`）变化才换实例。图层级拾取提供 `item-click`（**最新**业务 item）与 `click`
  （`PointPick<Item>`，含未命中的 `hit: false`）。默认开启拾取（官方默认关）。
  图层登记进地图的图层账本，因此**地图先销毁**时它也会在 `map.destroy()` 之前被摘掉。
- **`MarkerList` / `MarkerCluster` 泛型化**：`Item` 从 `data` 推断并原样保留到事件载荷（不退化成
  `any` / `unknown`；消费方 fixture 用 `vue-tsc` 钉住）。公开 props 类型具名导出：
  `MarkerListProps<Item>` / `MarkerClusterProps<Item>` / `PointCollectionProps<Item>` /
  `PointPick<Item>`。
- **`MarkerList` / `MarkerCluster` 的 `item-click` 回传「最新」业务 item**：此前事件回调闭包捕获的是
  创建那一刻的对象，数据换引用后点出来的是旧对象。
- **`dataVersion` 真正生效**：相同引用 + 相同版本 ⇒ 不产生任何 SDK 调用；版本变化 ⇒ 逐项重新读取并
  下发（原地改内容的正确用法）。此前它只是签名上的一个从未被读的参数。
- **位置下发由坐标值决定**（不是 item 引用）：换新数组即重新读取，坐标真变才写；`dataVersion` 变化逐项重发（也是「宿主侧自行改过位置、要对回来」的逃生口）。
- **SDK 调用失败可重试**：失败项不记账（短路基线与位置指纹都只在成功后提交），同一批输入再同步会重试；
  `clear()` 里摘除失败也保留该资源的所有权，不会为同一个 key 再建一份。
- **falsy 业务项可用**：拾取回传用 `!== undefined` 判「找到没找到」，`0` / `false` / `""` 这类合法 `Item`
  不再被当成「没找到」。
- **坏数据跳过并告警**：缺 key / 非法坐标 / 重复 key / `properties()` 覆盖要素身份，各有明确的开发期
  告警（按原因聚合计数）。**`(0, 0)` 是合法坐标**，不会被当作「缺失」。同一批数据里 key 重复时
  **后者胜**（重复 id 的行为官方没有声明，不能交给 SDK）。
- **`MarkerCluster` 修复静默丢点**：展开的单点此前用「桶内下标」当 id，两个不同桶的单点会撞成同一个
  id 而只留下一个 Marker；现在用业务 key。
- **`PointCollection` 的要素身份写进 `properties`**：`itemKey` 是字符串时就是该字段名，是函数时用
  保留字段 `__id`，并作为图层的 `idKey` —— 少了它，拾取回来的要素认不出业务项。该路径在真实 4.0 上
  取过证（`scripts/probe-point-pick.mts`）。
- **`MarkerList` / `MarkerCluster` 的 `visible` 真正生效**：此前它是文档里有、实现里没人读的 prop
  （接收后忽略 = 假支持）；现在走覆盖物的 `show` / `hide`（隐藏 ≠ 摘掉，资源与最新项账本都留着）。
- **破坏性变更**：删除 `PointLayer`（它与 `MarkerList` 行为完全相同，却正是 issue 非目标里
  「每项一个 Marker 的组件命名为 PointLayer」那种命名）与 `PointLayerProps`；删除从未有生产调用点的
  死导出 `shouldFullReplace`；`DataLayerManager.sync` 改为对象入参并接管位置读取
  （`sync({ items, getKey, getPosition, version })`），新增 `latest()` / `latestOf()` / `setVisible()`。
- 内部：`core/data/{points,itemScan,itemIndex,geojsonAdapter}.ts` 是数据适配与判定的单一实现，
  逐项 Marker 与批量图层两条路径共用（「什么算坏数据」不再有两份真相）；`LayerRegistry` 的 `kind`
  放宽为底图图层与原生数据图层的并集，释放顺序与不变式不变。
- 决策、取舍与已知限制见 `docs/adr/2026-09-18-data-layer-manager-and-point-collection.md`。
