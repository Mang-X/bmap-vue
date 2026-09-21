# 原生点图层与原生聚合：三个点图层组件共用内核、`BMarkerCluster` 原生优先

- 日期：2026-09-19
- 状态：Accepted
- 计划键：`M6-POINT-CLUSTER`（issue #35，追踪 #12）
- 相关：`core/data/pointLayerSpec.ts`、`core/composables/useNativePointLayer.ts`、
  `components/data/{BPointShapeLayer,BPointIconLayer,BPointLayer,BMarkerCluster}.vue`、
  `components/data/{clusterEngine,markerClusterEngine,nativeClusterEngine}.ts`、
  `driver/jsapi-v4/native-layers.ts`、`packages/test-utils/fake-bmap-v4/native-layers.ts`、
  `scripts/probe-native-point-cluster.mts`、`types/components.ts`、`manifest.ts`
- 取代范围：**只取代三处**，其余 ADR 继续有效：
  1. ADR `2026-09-18-data-layer-manager-and-point-collection` 决策 1 的「`BPointCollection` 是批量点
     组件的名字」→ 本 ADR 决策 2 把它更名为 `BPointShapeLayer`（该 ADR 里「删除 `BPointLayer`」的
     那半**仍然有效**：被删的是一个「每项一个 Marker」的组件，本 ADR 重新引入的同名组件落在
     **原生 `PointLayer`** 上，是另一件事）；
  2. 该 ADR 非目标里的「不实现其余原生图层组件（`PointIcon` / `Cluster` / …）——那是 #35 / #36」→
     本 ADR 决策 3/4 落地了 `PointIcon` 与 `Cluster`（`Line` / `Fill` / `Heatmap` / `TrackLine` 仍归 #36 / #43）；
  3. ADR `2026-09-12-jsapi-v4-service-panorama-native-layers` 已知限制里「`PointLayer` / `ClusterLayer`
     等扩展 API 的未声明继承成员（`setVisible` / `setOpacity` / `setZIndex`）本 Facet 按官方文档
     回答不支持」→ 本 ADR 决策 6 **只对 `setVisible` 放开**（取过证），其余继承成员仍然关闭。
  旧 ADR 正文保持原样（它们是冻结文件），只在对应条目上加指针。

## 背景

issue #35 的目标是「实现原生 Point / PointIcon / PointShape / Cluster 图层」，但票面在
**2026-09-19** 追加了一段开工前范围纠正，它把这一票的重心从「补齐 N 个组件」改成了
「**native-first 取证 + 只在真实缺口上做 fallback**」：

> capability 缺失时可以明确返回 unsupported / experimental；**不因为「理论上可能缺失」就自动进入
> 自研 fallback**……只有同时满足四个条件（明确消费场景 / 真实证明原生不可用或不足 / 缺口不能用
> documented unsupported 解决 / 有 benchmark）才继续实现 fallback，否则拆成后续独立 issue。

于是开工第一步不是写组件，而是**把「原生到底行不行」变成读数**。三个来源说法不一：

| 来源 | 说法 | 能否当依据 |
| --- | --- | --- |
| `@baidumap/jsapi-v4-types@4.0.4` | 有 `PointIconLayer` / `PointShapeLayer` 完整声明；**没有** `PointLayer` / `ClusterLayer` | 只能证明「声明面缺」 |
| 官方扩展 API 专页（`.agents/skills/bmap-jsapi-v4/references/runtime-extended-apis.md`） | 列出了 `PointLayer` / `ClusterLayer` 的构造选项、方法面与事件 | 是文档，不是运行时事实 |
| 本库 #23 的 smoke（ADR `2026-09-12-…`） | 「构造器全部存在」；扩展 API 从共享基类继承了 `setVisible` / `setOpacity` / `setZIndex` | **只验过存在与可调用，从没验过「喂数据之后真的聚起来 / 真的能点中」** |
| 官方 React 参考 `huiyan-fe/react-bmap`（`master`） | 只有 `PointIconLayer` / `PointShapeLayer` 两个组件；**没有** `PointLayer` / `ClusterLayer` / 任何聚合组件（`MarkerClusterer` 只出现在 `OverlayTargetContext.ts` 的注释里，没有实现） | 说明「官方薄封装只暴露声明面」是一种既有选择，**不能**据此断言扩展 API 不可用 |

### 本次取证（`scripts/probe-native-point-cluster.mts`，真实 AK + headless Chrome）

一条命令跑完，三个臂（`PointShapeLayer` 作**正证控件** / `PointLayer` / `ClusterLayer`）各自
创建 → 挂载 → 喂一份「40 个紧邻点 + 2 个远点」的 GeoJSON → 用 CDP 派发**真实鼠标点击**：

| 读数 | 值 |
| --- | --- |
| 构造器存在性 | `PointShapeLayer` / `PointIconLayer` / `PointLayer` / `ClusterLayer` **全是 `function`** |
| `PointLayer` 产出 | `getItems()` = **42**（逐点缓存真的建起来了） |
| `PointLayer` 选项 | `setOptions({ size: 24 })` 后 `getOptions().size === 24`（扁平选项走 `setOptions` 合并生效） |
| `PointLayer` 命中载荷 | `{ lng, lat, size, scale, offset, id, index, properties, feature }` —— **没有 `dataIndex` / `dataItem`** |
| `ClusterLayer` 聚合产出 | `change` 事件派发 `{ clusters: 1, singles: 1, zoom: 11 }`（40 近点聚成 1 簇） |
| `ClusterLayer` 选项 | 不传任何聚合参数时 `getOptions()` 回读 **`clusterRadius: 60` / `clusterMinPoints: 2` / `clusterMinZoom: 3` / `clusterMaxZoom: 16` / `fitViewOnClick: true` / `updateRealTime: false` / `waitTime: 300` / `singleStyle: null`**（官方默认值，本库只引用、不写入）；传了就回读得到传入值 |
| **簇**命中载荷 | `{ isCluster: true, clusterId, parentId, pointCount, latLng, bbox, properties: { isCluster, clusterId, parentId, pointCount, pointCountAbbrev, allCount } }` |
| **单点**命中载荷（同一图层） | `{ id: "k-far-0", isCluster: false, … }` ⇒ **业务键可得** |
| 簇内业务项 | `getClusterLayer()` 返回的是内部 `PointLayer`，它的 `getItems()` **只有簇级条目**（`properties.isCluster === true`）——「这个簇里有哪几个业务项」**没有公开读回入口** |
| `setVisible(false)` | 三个臂都成功，`getVisible() === false`，可恢复 |
| `redraw()` | `ClusterLayer` 上可调用（`PointShapeLayer` 上没有这个成员） |

**结论：原生 Cluster 的缺口不成立。** 按票面纠正的四个条件，第 2 条（「真实 SDK 证明原生 Cluster
不可用、能力不足」）**被读数否证**，因此本票**不实现**自研 fallback 引擎；已有的网格实现按
决策 4 处置。

## 决策

### 1. 三个点图层组件共用**一份**生命周期：`pointLayerSpec` + `useNativePointLayer`

`BPointShapeLayer` / `BPointIconLayer` / `BPointLayer` 的差异只有四处（原生 kind、构造期选项、
就地写入的字段名、命中载荷的形状），其余全部相同。差异不可能靠「各写一遍」保持不变式 ——
这份生命周期里有六处「写错了也看不出来」的判定：构造期指纹、数据输入指纹、字段指纹、
merge 语义下的**逐字段**撤回、「先摘成功再建新的」、失败不推进记账。

因此：差异写成 `core/data/pointLayerSpec.ts` 里的三个 **profile**（纯函数、可在没有 SDK /
没有 Vue 的环境里直接测），生命周期收进 `core/composables/useNativePointLayer.ts`
（`BPointCollection` 的 #34 实现是它的第一版原型，逐行平移）。

profile 是**工厂函数**而不是常量对象：`NativePointLayerProfile<Props>` 里的 `Props` 带 `Item`
（`properties?: (item: Item) => …` 在参数位置逆变），用 `any` 抹平会把「调用方传错 props」
变成运行时问题。

**`supports()` 是「这个 kind 有没有这个入口」的单一事实源**：内核按 Driver 的
`NATIVE_LAYER_DESCRIPTORS` 决定写不写某个字段，组件侧不再抄一份「哪些字段可用」；
真收下一个用不了的 prop 时**告警一次并点名**（收下不生效属于假支持）。

### 2. 命名收口：`BPointCollection` → `BPointShapeLayer`，**不留别名**

三个组件的名字必须能一眼看出各自落在**哪个 SDK 类**上，而官方的类名就是
`PointShapeLayer` / `PointIconLayer` / `PointLayer`（官方 React 参考实现也只暴露前两个、且同名）。
「Collection」既不是 SDK 的名字，也没有表达出「这是形状点」这个唯一重要的差异。

**不留弃用别名**的依据是事实而不是偏好：`3.0.0-beta.0` 里**没有** `BPointCollection`
（它是 `.changeset/m6-data-layer-and-point-collection.md` 这条**未发布** changeset 里的新增），
所以「别名」不会有任何消费者，只会把「同一件事两个名字」固定进公开面 —— 与 #34 决策 1 删掉
`BPointLayer` 的理由同源。

### 3. `BPointLayer` 落在扩展 API 上，**不自动降级**，并如实标 `experimental`

它是三者里唯一「运行时存在、类型包无类声明、可视化实现按需异步注入」的。三条后果：

- 能力守卫在**调用时刻**求值（注入完成后重试即可成功），失败经 `resource:error` 交出；
- **不自动改用 `PointShapeLayer` / `PointIconLayer`**：那是另外两个 SDK 能力，偷偷换掉等于把调用方
  的意图改掉。要「最稳」就用那两个组件；
- 它的选项是**扁平**的（官方例子 `new BMap.PointLayer({ shape, size, fillColor })`），
  与 `BPointShapeLayer` 的 `style` 袋不同 —— 如实照抄 SDK 的形状。

保留它的理由不是「多一个更好」，而是**官方扩展专页把它列为公开能力且本库取过证**；它相对另两个
组件的增量是「一个组件覆盖形状 / 图标两种模式」。

### 4. `BMarkerCluster` 原生优先；`markers` 引擎是**显式选择**，不是自动 fallback

| 引擎 | 默认 | 落地成什么 | 唯一增量 |
| --- | --- | --- | --- |
| `native` | ✅ | 一个原生 `ClusterLayer`（WebGL） | 原生渲染、一个资源承载全部点 |
| `markers` |  | 网格聚合 + 每簇 / 每单点一个 Marker | **`cluster-click` 能带回簇内业务项** |

三个必须写清楚的点：

1. **`markers` 不是「原生坏了就用它兜着」**：原生实测可用（见背景），所以自动降级不成立。
   它存在是因为它多给一样东西，而那样东西官方**没有公开入口**（簇内业务项）—— 这是
   「用业务项换资源形态」的**显式**取舍，调用方自己选。
2. **票面 fallback 四条件的核对**（按纠正的要求逐条记）：

   | 条件 | 核对结果 |
   | --- | --- |
   | 有明确的 Stable 消费场景需要聚类 | 成立（`BMarkerCluster` 有文档、playground 与用例） |
   | **真实证明原生 Cluster 不可用 / 不足** | **不成立**（本次读数：可用且选项生效） |
   | 缺口不能用 documented unsupported / capability 分流解决 | 不适用 |
   | 有 benchmark 证明自研 fallback 的价值 | 未提供 |

   因为第 2 条不成立，本票**不继续开发** fallback（于是没有新增聚合算法、没有 Worker、没有
   性能承诺）；保留的是 #34 已落地的那一份，且它不再出现在默认路径上。
3. **换引擎 = 换资源形态** ⇒ `engine` 变化整层重建（旧引擎先 `dispose`，新引擎再 `mount`）。
   两个引擎的真实边界（谁能给出业务项、谁隐藏时不摘资源）写在组件文档里。

### 5. `cluster-click` 的载荷是两种引擎的**公共最小契约**

```ts
interface BMapClusterPick<Item> {
  engine: "native" | "markers";
  id: string;          // native = 官方 clusterId；markers = 网格 id
  size: number;        // 簇内点数
  position: { lng: number; lat: number };
  items: Item[] | null; // native ⇒ null（官方拿不到）；markers ⇒ 业务项数组
}
```

`items` 用 `null` 而不是空数组：让「这一层拿不到」与「这一簇确实是空的」在类型上就分得开。
不为了「两种引擎看起来一样」去把 `items` 填成 `[]`，也不去恢复 SDK 没有公开的簇内身份
（票面纠正的明确要求）。

### 6. 为 `point` / `cluster` 放开 `setVisible`（取证驱动的取代）

所有数据组件共享 `BMapDataProps.visible`。三个声明面点图层本来就有 `setVisible`；两个扩展 API
（`point` / `cluster`）此前按「只认官方专页声明的方法面」回答 `unsupported`（ADR `2026-09-12-…`
的已知限制），于是 `visible` 在它们上会**静默不生效**。

本次取证（`setVisible(false)` → `getVisible() === false` → 恢复）把这一条从「响应官方文档的保守
选择」变成「有读数支持的放开」。**只放开 `setVisible`**：`setOpacity` / `setZIndex` /
`setMinZoom` / `setMaxZoom` / 状态 API 仍然关闭（没有消费者，也没有取证）——「要放开必须像
`setVisible` 一样先取证」这句话写进了 `driver/jsapi-v4/native-layers.ts` 的注释与 Fake 的文件头。

### 7. 聚合参数是**构造期**选项（变化 ⇒ 重建）

官方扩展专页同时列了 `setOptions` 与 `redraw`，但本库**没有取证**「改了聚合参数再 `redraw()`
真的会重新聚簇」。在两个选项（赌一个未取证的语义 / 重建）里选重建：重建是唯一能保证生效的路径，
代价是这一层重新渲染一次。`markers` 引擎在同名 prop 变化时同样整批重算 —— 两种引擎的
**调用方语义**因此一致，差异只在实现。

### 8. 不补官方默认值；`change` 只转发；空数据走 `clearData`

三条都来自同一句口径「不猜、不镜像」：

- **不补默认值**：不传 `clusterRadius` 等就**不写这个键**（读数见背景表：官方自己的默认值是
  `60 / 2 / …`，但那是**本次读数**，不是跨版本的承诺）。代价写进组件文档：默认行为由 SDK 决定，
  本库实测到的那一组值只作参考 —— 特别提醒 `fitViewOnClick` 的官方默认是 **`true`**（点簇会缩放）。
- **`change` 只转发**：官方 `ClusterLayer` 的 `change` 载荷是 `{ singles, clusters, zoom }`，本库
  把它投影成 `cluster-change` 事件（`BMapClusterChange`）**原样交给调用方**，不在组件里存一份
  「现在几簇」的镜像状态（ownership-first）。`markers` 引擎在自己重算之后给出同名同形的读数，
  因此两种引擎的调用方代码不需要分支。
- **空数据走 `clearData()`**：官方为这类图层提供了 `clearData`，而「一条空 FeatureCollection」与
  「没有数据」语义不同（前者要 SDK 解析并走一次空渲染）。这是本库对 `clearData` 的唯一调用点；
  卸载不需要先清数据（`removeLayer` 才是释放）。

## 后果

- **正面**：三个点图层组件共用一份内核（六条不变式只有一个副本）；拾取业务键 / 坏数据 / 释放
  顺序与逐项 Marker 路径共用同一份判定；`BMarkerCluster` 的默认路径不再自研聚合；
  扩展 API 的可用性从「文档说可以」变成「有读数」；`visible` 在两个扩展 API 上真的生效。
- **负面 / 成本**：
  - `BPointCollection` / `BPointCollectionProps` **更名**（`BPointShapeLayer` /
    `BPointShapeLayerProps`）—— 发布前更名，无别名，写进 changeset；
  - `cluster-click` 载荷**破坏性变更**（`Cluster<Item>` → `BMapClusterPick<Item>`，
    业务项从 `points` 移到 `items`，且 `native` 引擎下为 `null`）；
  - `BMarkerCluster` 的**默认资源形态变了**（每簇一个 Marker → 一个原生图层）：
    既有用法若依赖「每簇一个 Marker」或「`cluster-click` 拿到业务项」，必须显式写
    `engine="markers"`；
  - `gridSize` / `minClusterSize` / `zoom` 只在 `markers` 引擎下生效，反之 `clusterRadius` 等只在
    `native` 下生效 —— 与引擎不匹配的选项会**告警一次**（不静默）；
  - `point` / `cluster` 的 `setVisible` 是新放开的契约，`Fake` 与契约用例都要跟着建模。
- **回滚**：删掉 `pointLayerSpec.ts` + `useNativePointLayer.ts` + `BPointIconLayer.vue` /
  `BPointLayer.vue`，把 `BPointShapeLayer.vue` 还原成内联实现的 `BPointCollection.vue`，
  `BMarkerCluster.vue` 还原为 #34 版本；Driver 的 `operations` 里去掉 `setVisible` 两处即可。

## 非目标

- **不实现 fallback 聚合引擎**（票面纠正：缺口不成立。要做得先有 benchmark 与消费场景）。
- 不实现 `Line` / `Fill` / `Heatmap` / `TrackLine` 的组件面（#36 / #43）。
- 不做 Feature State / `hitTest` 的组件面（#36）。
- 不做 Worker 预处理与性能预算（#37）。（**#37 已收口**：预算与基线已建立，Worker 按证据判定不引入，
  见 [`2026-09-21-performance-baseline-and-worker-decision.md`](./2026-09-21-performance-baseline-and-worker-decision.md)；
  本文件其余内容不变。）
- 不把 `value` 归一化进 `DriverEvent`（仍走 `raw` 逃生口，欠账留给 #36 的拾取面收口）。

## 已知限制

1. **扩展 API 的命中载荷没有要素下标**：`PointLayer` 的载荷里有 `index` 字段，但它的语义
   （是不是本次 `setData` 的要素下标）**没有取证** ⇒ 本库**不读它**，`click.dataIndex` 如实给
   `-1`。拿一个语义未定的数字当要素下标会静默映射到另一个业务项，比拿不到更糟。
2. **扩展 API 的「未命中」载荷形状未取证**：因此「命中」的判据是「能不能解析出业务身份」。
   对声明面的图层仍然是官方的 `dataIndex === -1` 口径。
3. **原生聚合的簇内业务项拿不到**：官方在命中载荷里只给簇的元数据，`getClusterLayer().getItems()`
   也只有簇级条目。要业务项就用 `engine: "markers"`。
4. **原生聚合的选项更新只有「重建」一条路**：`setOptions` + `redraw()` 是否会重新聚簇**未取证**，
   因此聚合参数按构造期选项处理（决策 7）。
5. **`BPointLayer` 上没有 `opacity` / `zIndex` / `minZoom` / `maxZoom`**：它们是继承自共享基类的
   成员，Driver 按官方专页口径回答 `unsupported`（只有 `setVisible` 取过证）。传了会告警，不静默。
6. **`BPointShapeLayer` 的样式面仍是官方 `PointShapeStyle` 的五个字段子集**（#34 的限制不变）：
   `anchor` / `scale` / `rotation` / `offset` / `visibility` / 样式表达式没有当前消费者。
7. **`native` 引擎不承诺聚合读数的时序**：原生聚合是**去抖**的（官方默认
   `updateRealTime: false` / `waitTime: 300`，见背景表的读数），因此数据更新之后簇的重算有约 300ms
   的窗口 —— 官方 `change` 事件什么时候来由 SDK 决定。本库**只转发**它（`cluster-change`），
   不据此推导业务行为、也不镜像成组件状态（ownership-first：`BMarkerCluster` 拥有的只有 props）。
8. **`cluster-click` 的 `position` / `size` 在载荷缺字段时是占位值**：实测载荷总有 `latLng` /
   `pointCount`，因此正常路径不会走到；真缺了会**告警一次**并给出 `{ lng: 0, lat: 0 }` / `0`
   （不静默、也不丢弃整次点击）。
9. **扩展 API 的 `setVisible` 之外没有放开别的继承成员**（决策 6）：`opacity` / `zIndex` /
   `minZoom` / `maxZoom` 在 `BPointLayer` 与原生聚合上**没有 prop**，传了会告警。
10. **存量同类机制已由 #104 审计**（该票已落地：#105 `refactor(OWNERSHIP-AUDIT): 删掉恢复未公开
    因果身份的面`）：#105 删掉的是**恢复未公开因果身份**的那一类面（`useBMapTrackAnimation` 一族），
    与本票新增的引擎/内核不重叠 —— 本票没有用 FIFO、时序邻接或计数去恢复上游没公开的身份
    （`items: null` 与 `dataIndex: -1` 都是「拿不到就说拿不到」）。`gridCluster` 那套像素网格聚合
    仍留在原处，#105 没有动它。

## 评审修正（PR #108 第一轮，2026-09-19）

评审给 3 条阻塞项，**三条全部先复现、后修**（每条都在改实现之前跑出红色，判定用退出码）。
三条都落在**失败 / 替换路径**上——happy path 的用例覆盖不到的地方。

| # | 评审意见 | 复现读数（修前） | 处置 |
| --- | --- | --- | --- |
| 1 | 重建路径「手动 `remove` + `record.dispose()`」会**摘两次**，且第一次摘除时业务监听还活着；换引擎时 `engine.dispose()` 吞掉摘除失败 ⇒ 两套资源同图 | ① 重建的动作序列 `["addLayer","removeLayer","removeLayer","addLayer"]`（应是 3 步）；② 换引擎在注入 `removeLayer` 失败后：`resource:error` = 0 且新引擎的 Marker 已经建起来（`overlay > 0`，旧图层仍在图上） | 决策 9（下）：账本新增**严格** `detach()`；点图层内核与原生聚合引擎的重建都改走它；`ClusterEngine` 拆成 `dispose()`（卸载、吞错）/ `detach()`（替换、抛错），换引擎失败时**保留旧引擎** |
| 2 | 簇命中缺必要元数据时仍派发伪造了 `(0,0)` / `0` / `""` 的载荷（`BMapClusterPick` 又把这些字段声明成必填非空） | `simulateMalformedNativeClusterHit({ isCluster: true, clusterId: 7, pointCount: 3 })`（无 `latLng`）仍然派发了 `cluster-click` | 决策 5 补一条：**必要元数据不完整 ⇒ 告警一次且不派发**（公开类型因此可以说「这三个字段一定是真实值」） |
| 3 | `visible` 的独立 watcher 直接调 `engine.setVisible()`，绕过组件自己定义的统一 `resource:error` 出口 | 注入 `setVisible` 失败后 `resource:error` = 0（异常冒成 Vue watcher 的未处理异常） | 该 watcher 收进同一个错误出口；两个引擎的显隐收敛到各自的 `applyVisible()`，`appliedVisible` **只在成功后推进**（失败不是「已完成」，下一次收敛会重试） |

修 1 的过程中还发现**同一族的第二个缺陷**（评审没提到、自查新增）：`remove` 回调在调用 SDK **之前**
就把 `handle` / `instance` 清空了，于是一次抛错的摘除会把记账清成「已经没有实例了」，
重试路径（`detach()` 的门禁）直接跳过摘除。修法与「记账晚于副作用」同一条：**先摘、后销账**。

### 决策 9：账本的释放拆成「卸载（吞错）」与「替换（严格）」两条

`removeLayer` 允许「先产生副作用、再抛错」，因此**只有成功返回能当作「确认摘掉」**。
把这两种语义写成两个方法，而不是让调用方各自拼事务：

| 方法 | 语义 | 适用 | 失败时 |
| --- | --- | --- | --- |
| `LayerRecord.dispose()` | 幂等 + **吞错**（日志可观测） | 组件卸载、Map 卸载（`disposeAll()`） | 继续走完；没有重试的位置 |
| `LayerRecord.detach()` | **三阶段严格**：quiesce（挡业务回调，**可恢复**）→ 摘资源（**失败抛**）→ commit（解绑监听 + 销账） | 重建 / 换引擎（**资源替换**） | **不销账、不解绑**：关掉门就恢复可用，调用方**放弃替换**并保留旧实例 |

`ClusterEngine` 用同一对语义（`dispose()` / `detach()`）。这条拆分的收益是**顺序不变式只有一处**：
「摘除期间业务不穿透」（#22 的既有口径）由账本内部保证，调用点不再各写一遍、也再不会出现
「手动 remove 一次 + dispose 又 remove 一次」。

### 评审修正（第二轮，commit `e12a93a`）

第一轮修完之后评审又给了 2 条，主题是**「失败以后能不能真的恢复」**——这是第一轮
（「失败不要静默」）的下一层，同样全部先复现后修：

| # | 评审意见 | 复现读数（修前） | 处置 |
| --- | --- | --- | --- |
| 1 | 严格 `detach()` 仍不可回滚：`unbind()`（`scope.dispose()`）不可逆，`remove` 失败 ⇒ 旧实例「还在图上，但已经点不动」；markers 的部分失败还会留下「一部分摘掉、一部分留着但没监听」的半拆态 | ① native 换引擎注入 `removeLayer` 失败后，再模拟 cluster / item click —— **一个事件都收不到**（监听已随 detach 解绑）；② markers 部分失败后 `attached('overlay')` 从 2 掉到 1（被摘掉的那个不会自己回来） | 见下「三阶段 detach」：`quiesce` 门（可恢复）+ 失败**不解绑不销账**；markers 引擎在部分失败时**重放上一次同步**把旧引擎**恢复完整**（补建被摘掉的那些）再放弃换引擎 —— `size > 0` 只证明所有权没丢，不证明旧引擎被保留 |
| 2 | markers 的 visible 重试被内层短路吞掉：`DataLayerManager.setVisible()` 先把 `this.visible` 改成目标值，再逐资源写 | 注入一个 Marker 的 `hide` 失败之后，下一次收敛**不会**补写（`this.visible === desired` 顶部直接 return），失败的 Marker 永久留着可见 | `setVisible` 改成**逐条隔离 + 全部成功才提交**：失败保持 `this.visible` 原值（下一次调用会对**所有**资源重新对齐）并把错误交给调用方；`applyVisibility(resource, desired, key)` 显式接收目标值，不再读可能已被推进的内部状态 |

第二轮的两条都落在「同一条不变式的另一面」上：第一轮保证「失败**不静默**」，第二轮保证
「失败**可恢复**」——补的用例（`BMarkerCluster：换引擎摘除失败后旧原生引擎仍可用`、
`markers 部分摘除失败 ⇒ 旧引擎恢复完整并可继续交互`、`markers 显隐失败后下一次收敛把所有
Marker 对齐`）在修前都是红的。

**自查新增的同类项（仍**未**改）**：`core/composables/useLayerResource.ts` 的 `remove` 回调有同样的
「先清 `instance`、再调 SDK」顺序（十种底图图层共用的内核）。它那个内核有自己的挂载 / 摘除三态机
（#96 七轮评审的产物），改它需要它自己的复现与回归，本 PR 不顺手动它。另外它的替换路径同样直接调
`remove` 而没走账本的严格 `detach()` —— 但注意：那一侧**已经有** `ensureDetached()` 的三态收敛
保护（本 ADR 的 `attachment` / `quiesce` 正是照它的口径补到数据图层一侧的）。

⚠️ **#104（#105）已经落地，但没有覆盖这一处**（它删的是「恢复未公开因果身份」的面，与这条顺序
问题不是同一族，且 #105 没有改 `useLayerResource.ts`）。因此这条**仍然没有归属的票**，
建议随下一次数据/图层内核的改动一起收，或单独开一张把它和有同样顺序的调用点一起清掉。

### 评审修正（第三轮，commit `3d9880f`）

第三轮 1 条：**失败模型只覆盖了「remove 在副作用之前抛错」这一种形状**。这是前三轮的第三次推进：
第一轮「失败不要静默」→ 第二轮「失败要可恢复」→ 第三轮「**「可恢复」到底能承诺到哪一步**」。

| 形状 | 资源状态 | 能承诺什么 |
| --- | --- | --- |
| `remove` 在副作用**之前**抛错 | 仍在图上 | 监听恢复 + 资源仍在（第二轮覆盖） |
| `remove` 在副作用**之后**抛错 | **已经不在了** | 只有监听可恢复 —— 资源那一侧是 **unknown** |

处置（采用评审给的第二条路：诚实的 `unknown` 状态，不假装已恢复）：

1. **账本**：`LayerRecord` 新增 `attachment: "attached" | "unknown"` —— 与
   `useLayerResource` 的 `MountState` 同源、同术语。`detach()` 的 catch 只承诺「监听恢复」，
   把挂载态标成 `unknown`；**下一次** `detach()` / `dispose()` 承担**收敛**职责（受控地再摘一次：
   成功 ⇒ 确定已摘除；再失败 ⇒ 仍是 `unknown`，状态有界可观测）—— 用的正是仓库既有的前提 P
   （「对已经摘掉的图层重复 `removeLayer` 是安全的」，#98 live 实测成立，见 ADR 决策 12b）。
2. **消费方**：挂载态 `unknown` 时**一个字都不写**（`applyData` / `applyVisible` / 字段写入都跳过，
   与 `useLayerResource` 同一条规则）；收敛交给下一次替换路径。文档里凡是「旧实例完整恢复」
   的说法全部改成「监听恢复 + 资源状态 unknown」。
3. **markers**：`removeOverlay` 之后的异常同样让对应 Marker 的挂载态成为 unknown。重放**只补建
   确认摘掉的那些**；未能确认的保留所有权、不重建（重建可能重复挂一份）。错误文案如实上报
   「N 个 Marker 未能确认摘除（可能仍在图上）」，**不**宣称「已恢复旧引擎」。
   ⚠️ 覆盖物**不做**「再摘一次」的收敛：重复 `removeOverlay` 的安全性本库**没有 live 取证**
   （图层那边有 #98 的实测）。无证据不猜 —— 因此 markers 的收敛上限就是「如实上报 unknown」。
4. **测试**：harness 补上一直存在、但没接进来的 `failNextRemoveLayerAfterDetach`，fake 补对称的
   `failNextRemoveOverlayAfterDetach`，两条回归分别钉住「native：不按已挂上处理 + 下一次收敛把
   图层带回」与「markers：上报 unknown 而不是假恢复、且不会凭空变出 Marker」。

**一处诚实的覆盖说明**：`unknown` 期间「不写入」这条规则**没有**写成组件级断言 —— 从组件面观测
不到它的窗口（任何会触发写入的 props 变化都会**先**走替换/收敛路径），为此写的断言经反证确认是
**恒真**的（去掉门仍然绿），因此删掉而不是留着冒充覆盖。要钉住它需要给引擎加一条直接调用的单测
（不需要 Vue），登记为欠账。

### 评审修正（第四轮，commit `fdee24e`）

第四轮 1 条：**`unknown` 必须是贯穿后续生命周期的持久状态**。前三轮把它当成一次性的判断
（「这次失败不算成功」），但它其实是资源**在之后每一次写入里都要被尊重**的状态。

| 缺口 | 症状（稳定复现） | 处置 |
| --- | --- | --- |
| native：`sync()` 只按构造指纹决定要不要收敛 | 60 → 80 时 after-detach 抛错（实例可能已不在图上），用户再把参数**改回 60** ⇒ 指纹重新等于 `instanceKey` ⇒ 未知门静默 return，**再也没有任何收敛动作**（组件可能永久空白，除第一次错误外没有新信号） | `sync()` 改成 **`unknown` 优先于构造指纹**：`record.attachment === "unknown"` 先走 `recreate()`（受控 detach 把状态收敛回确定态），再谈指纹与普通字段。**点图层内核同款修复**（自查发现的同族：它的 `sync()` 有同样的短路形状） |
| markers：unknown 只活在错误文案里 | 取消切换（`engine` 改回 `markers`）后，未知句柄又被当成正常资源做位置 / 显隐写入（`resources` 只是 `Map<key, Resource>`，没有挂载态） | `DataLayerManager` 增加**持久**的 `unknownKeys`：摘除失败即登记；登记的资源**不进入**位置 / 显隐写入（索引记账照旧 —— 它回答的是「业务对象是哪个」），只有**摘除**路径（数据里删掉它、管理器被清理）能把它收敛掉。新增 `unknownSize` 读数；`markers` 引擎的错误文案改为从这个持久状态读 |

回归两条（都做了**单点反证**：去掉 `unknown` 优先级 / 去掉写入门，用例分别变红）：
`BMarkerCluster：unknown 优先于构造指纹 —— 参数改回旧值也会主动收敛`、
`BMarkerCluster：markers 的 unknown 是持久状态 —— 取消切换后不再被当成正常资源写`
（后者带**正证控件**：已知资源确实收到了这一轮的写入，证明那条 0 不是「什么都没跑」）。

**仍未补的覆盖（第三轮提出、本轮重申）**：`unknown` 分支的**直接引擎单测**。它需要一份
「不经组件挂载就能拿到的 ready context」——`createFakeV4Client()` 目前只覆盖到原生图层面，
cluster 引擎还要 map 句柄与事件面。现状由两条组件级用例 + 单点反证覆盖；要彻底摆脱「依赖多个
props 的 patch 顺序」，得先在测试基建里加一个 ready-context 构造器，登记为欠账。

## 参考

- issue #35（`M6-POINT-CLUSTER`）与总追踪 #12；票面 2026-09-19 的开工前范围纠正。
- `@baidumap/jsapi-v4-types@4.0.4`：`layer/PointShapeLayer.d.ts` / `layer/PointIconLayer.d.ts`
  （构造选项、样式字段、方法面逐条核对）。
- 官方 Skill `.agents/skills/bmap-jsapi-v4/references/runtime-extended-apis.md`
  （`PointLayer` / `ClusterLayer` 的选项与方法面；本 ADR 把它当**线索**，结论以探针读数为准）。
- 官方参考实现 `huiyan-fe/react-bmap`（`master`）：`src/components/Layer/PointIconLayer.tsx` /
  `PointShapeLayer.tsx`（构造选项与事件名的对照来源）；它的组件清单里没有 `PointLayer` /
  `ClusterLayer`（背景里的对照表）。
- 探针 `scripts/probe-native-point-cluster.mts`（复现：`BAIDU_MAP_AK=<ak> pnpm probe:native-point-cluster`）：
  本 ADR 全部运行时读数的来源，也是决策 4 与决策 6 的证据。
- ADR `2026-09-18-data-layer-manager-and-point-collection`（数据适配层与 `DataLayerManager`）、
  `2026-09-12-jsapi-v4-service-panorama-native-layers`（原生图层 Facet 的基础口径）、
  `2026-09-13-official-first-loader-and-ui-kit`（official-first 的判据）。
