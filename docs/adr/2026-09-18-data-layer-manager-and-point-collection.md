# 数据层收口：MarkerList / DataLayerManager 语义、泛型 GeoJSON 适配与批量点图层

- 日期：2026-09-18
- 状态：Accepted
- 计划键：`M6-MARKER-POINTCOLLECTION`（issue #34，追踪 #12）
- 相关：`core/data/**`（`points.ts` / `itemScan.ts` / `itemIndex.ts` / `geojsonAdapter.ts` /
  `DataLayerManager.ts`）、`core/layers/LayerRegistry.ts`、`core/layers/nativeLayerAccess.ts`、
  `components/data/**`、`types/components.ts`、`manifest.ts`、`apps/playground/src/main.ts`、
  `tests/behavior/v3-component-scenarios.test.ts`（**吸收**了被删除的 `v3-bpointlayer.test.ts` 与
  `v3-bmarkercluster.test.ts`，见「后果」）、`packages/test-utils/fake-v4-harness.ts`、
  `fixtures/v3-consumer/src/{index.ts,data-components.vue}`、`scripts/probe-point-pick.mts`
- 取代范围：**只取代三处**，其余 ADR 继续有效：
  1. ADR `2026-09-12-jsapi-v4-service-panorama-native-layers` 的欠账「`NativeLayerPointTuple` /
     `toGeoJsonPosition` 零消费者，删除（**M6 的数据适配层需要时再加**）」→ 本 ADR 决策 4 落地了
     这份适配层，且**没有**恢复那两个被删的符号（它们把运行时函数放进 `types/`）；
  2. 该 ADR 的「原生数据图层由 M6 在它之上实现」这句 → 本 ADR 决策 5/6 给出第一个消费者与
     收窄入口；
  3. ADR `2026-09-17-layer-spec-and-registry` 决策 2 里「图层账本只收底图图层」这一层含义 →
     本 ADR 决策 7 把 `kind` 放宽成两个 Facet 的并集（**注册表的释放顺序与不变式不变**）。
  旧 ADR 正文保持原样（它们是冻结文件），只在上面加指针。

## 背景

issue #34 要求「收口 MarkerList/DataLayerManager、泛型 GeoJSON 适配与 PointCollection」。
开工时的事实盘点（都对着代码看，不看票面措辞）：

| 现状 | 问题 |
| --- | --- |
| `BPointLayer.vue` 是 `BMarkerList` 的 deprecated alias | 它**就是**「每项一个 Marker 却叫 PointLayer」——正是 issue 非目标第一条要消除的命名 |
| `BMarkerList` / `BMarkerCluster` 的 props 是 `any` | 公开泛型退化，业务类型在事件里丢失 |
| `DataLayerManager.sync(items, getKey, itemVersion, force)` | `itemVersion` 与 `force` 进了签名却**从未被读**（组件永远传 `false`）⇒ `dataVersion` 是死参数 |
| `DataLayerManager.itemKeys` | 写了但从不读；事件回调闭包捕获**创建时**的 item ⇒ 点击回传的可能是一个已经被替换掉的旧对象 |
| 坏数据（缺 key / 非法坐标） | 直接进 SDK：造出画不出来或身份错乱的资源，且没有任何提示 |
| `shouldFullReplace()` | 只有测试消费者，没有生产调用点，且语义（「根引用相同但长度变化 ⇒ 整批替换」）本身就错 |
| 「批量点层」 | 不存在。文档里写的是「`BPointCollection`（待实现）」 |
| `BMarkerCluster` 的展开单点 id | 走 `gridCluster` 的缺省 `getKey = index`，拿到的是**桶内下标**：两个不同桶的单点会撞成同一个 id ⇒ 静默丢点 |

「批量点层落在哪个 SDK 能力上」是这次唯一需要**查证**的点，因为三个来源的结论不一致：

| 来源 | 结论 |
| --- | --- |
| 上游类型包 `@baidumap/jsapi-v4-types@4.0.4` | **没有** `PointCollection` 声明；批量点专页是 `PointIconLayer` / `PointShapeLayer`（声明完整：`setData` / 样式 / 状态 / 层级 / 显隐 / 拾取） |
| 官方 React 组件库 `huiyan-fe/react-bmap` 的 `PointCollectionPage` | 头一行写「整体 @removed 4.0，仅 v3 可用」 |
| **本仓库的真实运行时记录**（ADR `2026-09-11-jsapi-v4-overlay-facet` 的 smoke 表） | **`BMap.PointCollection` 在 4.0 运行时存在**（与 `Marker3D` / `MapMask` 同属「运行时存在但无声明」） |

本 issue 用 `scripts/probe-point-pick.mts`（真实 AK + headless Chrome）**重新取了一次证据**：

| 读数 | 值 |
| --- | --- |
| `typeof BMap.PointCollection` | **`"function"`** ⇒ 两份来源里「运行时存在」的一侧成立，「4.0 已移除」的说法**不成立** |
| `typeof BMap.PointShapeLayer` / `PointIconLayer` | 都是 `"function"`；`PointShapeLayer.ShapeType` 有 9 个数字成员 + 同名常量（`0,1,2,3,4,5,6,7,9,CIRCLE,…`） |
| 命中拾取事件的载荷 | `value = { dataIndex: 0, dataItem: { type, geometry, properties: { id: "a", name: "中心点" } } }` |
| 未命中拾取事件的载荷 | `value = { dataIndex: -1, dataItem: undefined }`（**是真值对象**） |
| 事件顶层字段 | `type`（值是 `"onclick"`，不是 `"click"`）/ `pixel` / `latLng` / `value` / `domEvent` |
| `setVisible(false)` 之后 | `getVisible() === false`，`getData()` **仍在**（数据没有因为隐藏被释放） |
| `getPickedItem(0, "onclick")` | 声明面里**也**有这条路：返回 `{ dataIndex, dataItem }`，`dataItem.properties.id === "a"` |

## 决策

### 1. 命名收口：`BMarkerList` 逐项、`BPointCollection` 批量，**删除** `BPointLayer`

- `BMarkerList` 的语义就是「每项一个 SDK Marker」；`BPointCollection` 的语义是「整批一个资源」。
- `BPointLayer` **删除**（而不是继续 deprecated）：issue 的非目标是「不把每项一个 Marker 的组件
  命名为 PointLayer」，留着一个 deprecated alias 等于把那条非目标继续留在公开面上。它在
  `3.0.0-beta.0` 里已经是 deprecated，且文档、迁移指南早就指向 `BMarkerList`。
- 影响面一次收齐：`manifest.ts` →（生成物）`components/index.ts`、`docs/.vitepress/component-index.json`、
  `volar.d.ts`；以及 playground、迁移文档、类型导出（`BPointLayerProps` 一并删除）。

### 2. 取数面三件套统一，`Item` 走 SFC generic 保留

三个数据组件的取数面**完全一致**（`data` / `itemKey` / `getPosition` / `dataVersion` / `visible`），
公开 props 类型收在 `types/components.ts`（`BMapDataProps<Item>` 派生），组件用
`<script setup lang="ts" generic="Item">` 声明，事件载荷就是业务 `Item`。

**生效范围写准**：模板里推断完整（`fixtures/v3-consumer/src/data-components.vue` 用 `vue-tsc` 钉住
「`Item` 不退化成 `unknown` / `any`」）；用 `h()` 编程式构造时**推不出** `Item`——vue-tsc 为泛型组件
生成的 props 是 `NonNullable<Awaited<typeof __VLS_setup>>["props"]`，TS 无法从这种形状反推类型参数。
实测过带 / 不带 `withDefaults` 都一样，所以这是**上游代码生成的形状**导致的，不是本库的取舍。
需要显式类型的调用方用公开的 `BMarkerListProps<Station>` 这一族。
这条限制在消费方 fixture 里用**双向** `@ts-expect-error` 钉住（`fixtures/v3-consumer/src/index.ts`）：
上游哪天修好了推断，那条指令会变成「未使用的指令」而报错，提醒我们更新文档与断言。

### 3. `DataLayerManager` 的 item / version / latest 语义重写

| 旧 | 新 |
| --- | --- |
| `sync(items, getKey, version, force)`（`version` / `force` 从未被读） | `sync({ items, getKey, getPosition, version })`：**对象入参**，「这一项有没有表态」在代码里可见 |
| 位置由宿主自己读（`createMarker(item)`） | `createMarker(item, point)` / `updatePosition(resource, point, item)`：位置只从 `getPosition` 读一次，**校验与下发用同一份取值** |
| 同一份入参重复 sync 会再走一遍 diff | **短路**：入参引用 + `version` 都没变 ⇒ 一个字都不下发（「大数组重复渲染不付代价」的落点） |
| `version` 无效 | `version` 变化 ⇒ **视为内容变了**：逐项重新读坐标并**重发一遍**（原地 `list[0].lng = 1` 的正确用法，也是「宿主侧自行改过位置需要对回来」的逃生口） |
| 位置下发由 **item 引用**决定（第二层、未公开的短路条件） | 位置下发由**值指纹**决定：根引用变化 ⇒ 重新读取，坐标真的变了才写。引用比较会漏掉「换根引用 + 复用同一个 item 对象 + 原地改坐标」，也会在「换根引用但坐标没变」时产生多余下发（评审 #102 F1，两个方向都实测） |
| `itemKeys` 写了不读；事件闭包捕获创建时的 item | `latest(key)` / `latestOf(resource)` 成为公开读数（`core/data/itemIndex.ts`，与批量图层路径共用一份实现），事件路径据此回传**最新**业务项 |
| 坏数据直接进 SDK | 由 `core/data/itemScan.ts` 统一跳过 + 报告（见决策 4） |
| SDK 调用失败只告警，随后仍把 `lastItems` / `lastVersion` / 位置指纹推进 | **失败不推进记账**：短路基线与位置指纹都只在成功后提交 ⇒ 同一批输入能重试（评审 #102 F2）。永久销毁路径的 `clear()` 同样保留失败项的所有权（评审 #102 F3） |

`force` 与 `shouldFullReplace()` **删除**：前者没有语义（「整批替换」的正确表达是换数据 + diff），
后者是只被自己的测试消费的死导出，且它把「根引用相同、长度变化」判成整批替换——长度变化本来就由
diff 正确处理。删导出是公开面变更，写进 changeset。

### 4. 坏数据的口径：**跳过 + 报告**，判定只有一份实现

`core/data/itemScan.ts` 是「哪些项能变成资源」的唯一判定，三条数据路径（逐项 Marker、聚合、批量
GeoJSON）共用它 —— 两份同源实现会分叉在「什么算坏数据」上，而分叉的表现是**同一份数据在两种组件里
得到不同结果**。

| 情形 | 处置 | 依据 |
| --- | --- | --- |
| key 取不到可用值（`undefined` / `null` / `NaN`） | 跳过 + 报告 | `NaN !== NaN`：登记进去会让每次 diff 都判成新增（同一项反复建资源）；没有身份就做不了 keyed diff |
| 坐标不是合法点（缺字段 / `NaN` / `±Infinity` / 字符串 / 越界） | 跳过 + 报告 | 传给 SDK 会得到画不出来的图，或更糟：一个语法合法但位置错误的覆盖物 |
| **`(0, 0)`** | **合法，照常生成** | 几内亚湾是真坐标；把 0 当「缺失」的哨兵是**猜测**，会静默丢掉真实数据。需要「这一项没有位置」请让 `getPosition` 返回 `null` |
| 同一批数据里 key 重复 | **后者胜** + 报告 | SDK 对重复 id 的行为**没有任何声明**（`PointShapeLayer.d.ts` 里没有相关文字）⇒ 不能交给它；`Map.set` 语义也是后者胜 |
| `properties()` 写了 id 字段 | 被要素身份覆盖 + 报告 | 否则 SDK 的 `idKey` 指向的是用户那份值，要素身份被悄悄换掉 |

「跳过而不是抛错」的理由是数据驱动组件的现实（外部数据源总会漏字段），但**不静默**：每个被跳过的项
都产生一条结构化问题，组件按原因聚合计数后 `devWarn`（逐项打日志会把控制台刷满，反而看不见）。

### 5. `idKey` 必须真的写进 `properties`（拾取的身份来源）

探针实测：命中要素的业务键在 `event.value.dataItem.properties` 上（`properties.id === "a"`）。
因此 `geojsonAdapter` 把要素身份写进 `properties`：`itemKey` 是字符串时就是该字段名，是函数时用
保留字段 `__id`（函数没有可用的属性名），并把同一个名字作为图层的 `idKey` —— **少了它，拾取回来
的要素认不出业务项**（这是「点得到要素、拿不到业务 item」的唯一根因）。

### 6. `BPointCollection`：一个原生批量图层 + 四条更新路径

- 落地在官方 `PointShapeLayer`（**两处都声明**的批量点能力；`PointCollection` 虽在运行时存在，
  但没有声明面 ⇒ 不用它，见背景里的事实表）；
- 更新路径（每条都对官方入口）：

  | 变化 | 路径 |
  | --- | --- |
  | `data` / `dataVersion` / `properties` | `setData()`，不重建 |
  | 样式五件（`shape` / `size` / `color` / `strokeColor` / `strokeWeight`） | `setStyleOptions` + **显式 `doOnceDraw()`**（官方口径：样式更新后不会自动重绘） |
  | `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter，不重建 |
  | `itemKey`（⇒ `idKey`）/ `enablePicked` / `pickWidth` / `pickHeight` | **重建实例**（构造期选项；官方只有整袋 `setBaseOptions`，且它同样不自动重绘） |

- `visible` 走 `setVisible(false)` 而**不是**「摘掉图层」：官方在这批图层上**有**这个 setter，
  探针实测 `setVisible(false)` 之后 `getVisible() === false` 且 `getData()` 仍在（隐藏不释放数据），
  而 `removeLayer` 之后的实例不可复用（#98 的实测，见 `layer-spec-and-registry` 决策 8）。
- **重建必须「先摘成功、再建新的」**：`removeLayer` 失败时保留旧实例并交出 `resource:error`——
  宁可这一次不更新，也不能让新旧两份同时挂在图上。
- 「由有值变回未表态」（例如 `opacity` 从 `0.5` 撤回 `undefined`）⇒ 重建并告警：官方没有 unset
  入口，本库**不猜**默认值。判定与执行分开，避免同一次更新里的一步 SDK 异常把已确定的收敛挡掉。

### 7. 原生数据图层也登记进地图的图层账本

`LayerRegistry` 的 `kind` 放宽成 `LayerKind | NativeLayerKind`（两个 Facet 的并集，名字不重叠），
`BPointCollection` 的实例登记进去，因此 `MapRuntime.dispose()` 会在 `map.destroy()` **之前**摘掉它。

为什么不新造一个注册表、也不挂在别的 scope 上：

```text
MapRuntime.dispose()
  ├─ 3. layers.disposeAll()   ← 原生数据图层在这里被摘掉（与底图图层同一条路径）
  ├─ 4. map.destroy()
  └─ 7. resources.dispose()   ← 根 scope 太晚：destroy 之后再摘图层没有意义
```

组件自持的 scope 只覆盖「组件卸载」这一条路径（地图被销毁而组件还在的路径到不了）。这是**跨 Facet
同一条不变式**，因此复用同一个账本，而不是新造一个只有一个月消费者的注册表。

### 8. 指纹口径：`data` 按引用、函数按源码、字段按值

这是本次最容易写出「每次渲染都重写一遍」的地方，三档刻意不同：

- `data`（整份 `FeatureCollection`）按**引用**——深序列化一次就是 O(n)；
- 回调型 props（`getPosition` / `properties` / 函数式 `itemKey`）按**源码文本**——父级的内联箭头
  每次渲染都是新函数对象、但源码相同 ⇒ 指纹稳定（与图层内核「内联箭头不触发重建」同源）；
  代价写进文档：换的是**闭包里的值**（源码没变）时请递增 `dataVersion`；
- 其余字段按**值**（复用 `core/layers/LayerSpec.ts` 的 `stableLayerValue`）。**不能**按对象引用：
  `styleValue()` 每次返回新对象，按引用会让样式在每次 props 变化时都被重写（本 ADR 第四轮自审
  抓到过一次真实的多余写入）。

## 后果

- 正面：三个数据组件的边界（每项一个 Marker / 每簇一个 Marker / 整批一个原生图层）在类型、文档与
  用例三处一致；业务类型从 `data` 一路保留到事件载荷；`dataVersion` 不再是死参数；坏数据可诊断；
  批量点层从「待实现」变成有真实运行时依据的实现。
- 负面/成本：两个既有的组件级测试文件被**删除并吸收**到 `v3-component-scenarios.test.ts` 的「数据组件领域行为」
  一节（`v3-bpointlayer.test.ts` 的三条：逐项 Marker 计数 / keyed diff / 卸载释放；`v3-bmarkercluster.test.ts`
  的两条：近点聚合、卸载释放）——两个文件的名字对应的是被删除的组件名，留着会指向不存在的对象；
  迁移后的用例**加强了**（新增「不同桶的单点不撞 id」「簇与单点点击回传最新业务数据」）。
- 负面/成本：`DataLayerManager.sync` 的签名是**破坏性变更**（对象入参 + 位置改由管理器读）；
  `BPointLayer` / `BPointLayerProps` 删除；`shouldFullReplace` 删除。全部写进 changeset。
- 回滚：三个组件的实现彼此独立，删掉 `BPointCollection.vue` + `nativeLayerAccess.ts` + 还原
  `LayerRegistry` 的 `kind` 联合即可回到 #40 的状态；`DataLayerManager` 的旧签名在 git 历史里。

## 非目标

- 不把每项一个 Marker 的组件命名为 `PointLayer`（issue 非目标）。
- **不对大型 `data` 做 deep watch**：`data` 只按引用比较，原地修改靠 `dataVersion` 表态。
- **不为每个数据项绑定独立 Vue watcher**：diff / 合帧 / 最新项账本都在管理器里完成。
- 不实现其余原生图层组件（`PointIcon` / `Cluster` / `Line` / `Fill` / `Heatmap` / `TrackLine`）与
  Feature State / `hitTest` 的组件面——那是 #35 / #36。
- 不做 Worker 预计算与性能预算（#37）。

## 已知限制

1. **`h()` 编程式构造推导不出 `Item`**（vue-tsc 生成的 props 形状所致，见决策 2）。模板用法不受影响；
   需要显式类型时用公开的 props 类型。
2. **拾取载荷的 `value` 走 `raw` 逃生口**：`NormalLayerPickEvent.value` 在 `.d.ts` 里只声明成
   `object`，而 Driver 归一化后的 `DriverEvent` 不含它，因此组件读 `event.raw.value`，坐标 / 像素
   用归一化后的 `point` / `pixel`。把 `value` 归一化进 `DriverEvent` 属于事件 facet 的改动，登记为欠账
   （#35 / #36 的拾取面收口时一起做）。
3. **事件对象的 `type` 是 `"onclick"` 而不是 `"click"`**（探针实测）。本库按订阅时给的名字归一化
   （`type || rawType`），所以回调里看到的是 `"click"`；但**不要**用 `event.type` 反查订阅名。
4. **`getPickedItem(index, model)` 这条声明面入口没被采用**：它同样能拿到 `{ dataIndex, dataItem }`
   （探针实测），但语义是「上一次拾取的结果」，与事件载荷相比多一层隐式状态；本组件用事件载荷 +
   自己的 `dataIndex` 兜底。需要「事后查询上一次命中」的场景可以作为后续议题（#35）。
5. **`BPointCollection` 只暴露 `PointShapeStyle` 的五个字段**（`shape` / `size` / `color` /
   `strokeColor` / `strokeWeight`）：其余声明项（`anchor` / `scale` / `rotation` / `offset` /
   `visibility` / `StyleExpress` 数据驱动表达式）没有当前消费者。要放开属于组件面扩展，按需加。
6. **未命中事件也要处理**：官方在未命中时**同样派发** `click`（`value` 是 `{ dataIndex: -1,
   dataItem: undefined }` 的真值对象）。因此 `if (event.value)` 不能当命中判断——本组件显式查
   `dataIndex !== -1`，并且只有命中才派发 `item-click`。
7. **`BMarkerCluster` 的簇 id 是 `c-<cellX>:<cellY>`**（`gridCluster` 生成），展开单点用业务 key。
   业务 key 恰好长成 `c-<数字>:<数字>` 时理论上会与簇 id 撞——概率极低且可通过换 key 规避，本轮不处理。
8. **位置记账是「我们最后一次成功下发的坐标」**：宿主若在 SDK 侧自行改过位置（例如自己拖了 Marker），
   本管理器不知道；此时递增 `dataVersion` 会让它**逐项重发一遍**（这就是 `dataVersion` 的逃生口用法）。
   反过来，把位置判定改成「按值」的代价是：SDK 侧被外部改动后、只用「换根引用」是**对不回来**的
   （值指纹相同 ⇒ 不写）——换引用解决的是「读了新数据」，不是「覆盖外部改动」。
9. **地图销毁之后组件再收到 props 变化**：账本摘除时会把组件侧的实例记账置空，于是 `sync()` 会
   尝试**重建**——而地图已经销毁，`addLayer` 会失败并经 `resource:error` 交出（失败路径上先登记的
   账本记录会把那个注定挂不上的实例摘掉，不留孤儿）。要更干净需要一条「地图已销毁」的通知通道
   （跨 Facet 改动），本轮不做：现状是**可观测的失败**，不是静默残留。

## 评审修正（PR #102 第一轮）

四条意见全部**先复现、后修**（每条都在最小场景上先写出会红的用例，再改实现）。
两条既有用例编码了被推翻的旧契约，已**改写**（不是删除）：它们断言的「换引用就重发位置」正是这次去掉的
未公开短路条件。

| # | 评审意见 | 复现读数（修前） | 处置 |
| --- | --- | --- | --- |
| F1 | 位置下发拿 item 引用当第二层短路 ⇒ 「换根引用 + 复用同一 item + 原地改坐标」漏更新 | 单测 `expected [] to deeply equal [ { lng: 2, lat: 1 } ]`；组件级 `overlayPositions()` 仍是旧坐标 | 改成**位置值指纹**（`appliedPositions`）：根引用变化即重新读取、坐标真变才写；`version` 变化仍逐项重发 |
| F2 | 失败的更新被标成已应用（`lastItems/lastVersion` 无条件推进）⇒ 同一批输入被短路吞掉、永不重试 | 同一输入再 sync 时 `updatePosition` 未被调用；创建失败同样不再补建 | 失败**不推进**短路基线；位置指纹只在成功返回后提交（与「记账晚于副作用」同一条规则） |
| F3 | `clear()` 里 `removeMarker` 失败后仍删账 ⇒ 旧资源没人认领，之后为同一 key 再建一份 | `size` 期望 1、实得 0；再 sync 会重复创建 | 与 diff 删除路径统一：**失败保留所有权**（留给下一次摘除 / 销毁重试） |
| F4 | 拾取用 truthy 判「找到没找到」⇒ `0` / `false` / `""` 这类合法业务项变成 `item: null` 且不派发 `item-click` | `click.item` 期望 `0`、实得 `null` | 改 `!== undefined`（两处查找 + `handlePick` 的派发判断）。**没有**把 `Item` 约束成 object —— 公开类型允许函数式 `itemKey/getPosition`，收紧是破坏性变更 |

单点反证（逐条把修复改回旧写法；判定用**退出码**，不看输出文本）：

| 反证 | 结果 |
| --- | --- |
| F1 退回「按 item 引用决定位置」 | 4 条红（两条新单测 + 改写后的 diff 用例 + 组件级位置用例） |
| F2 退回「无条件推进短路基线」 | F2 的重试用例红 |
| F3 退回「clear 失败也删账」 | F3 的所有权用例红 |
| F4 退回 `if (latest)` | 组件级 falsy 业务项用例红 |

改写的既有用例（说清改了什么）：`DataLayerManager.test.ts` 的「第二次同步做 keyed diff」把
「a 换了引用 ⇒ 更新」改成「a 的**坐标**变了 ⇒ 更新」并断言只有 a 被写；「位置更新失败不影响其它项」
把触发条件从「换引用」改成「坐标真的变了」（三项都变），断言三项都被试过、各告警一次。

## 参考

- issue #34（`M6-MARKER-POINTCOLLECTION`）与总追踪 #12。
- `@baidumap/jsapi-v4-types@4.0.4`：`layer/PointShapeLayer.d.ts`（构造选项 / `PointShapeStyle` /
  方法面逐条核对）、`layer/NormalLayer.d.ts`（`NormalLayerPickEvent`）。
- 官方 Skill `.agents/skills/bmap-jsapi-v4/references/visualization-layers.md`（批量图层的
  拾取口径、`doOnceDraw` 的必要性、`idKey` 用法）；`data-layers.md`（#97 / #98 的实测更正）。
- 官方参考实现 `huiyan-fe/react-bmap`：`src/components/Layer/PointIconLayer.tsx` /
  `PointShapeLayer.tsx`（构造选项与事件名的对照来源）、`test/src/pages/overlay/PointCollectionPage.tsx`
  （它的「4.0 已移除」标注与本次实测不符，已在背景里写明）。
- 探针 `scripts/probe-point-pick.mts`（复现：`BAIDU_MAP_AK=<ak> pnpm probe:point-pick`）：
  本 ADR 决策 5/6 与已知限制 2/3/4/6 的读数来源。
- ADR `2026-09-17-layer-spec-and-registry`（图层内核与账本的释放顺序）、
  `2026-09-17-overlay-spec-and-marker`（覆盖物 `visible` = `show`/`hide` 的口径）、
  `2026-09-14-map-handle-container-and-visibility`（KeepAlive dispose 路径）。
