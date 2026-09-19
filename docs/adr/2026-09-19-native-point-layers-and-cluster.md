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
- 不做 Worker 预处理与性能预算（#37）。
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
10. **存量同类机制由 #104 审计**：本票新增的引擎/内核里没有用 FIFO、时序邻接或计数去恢复上游
    没公开的身份（`items: null` 与 `dataIndex: -1` 都是「拿不到就说拿不到」），但 `gridCluster`
    那套像素网格聚合本身属于 #104 的审计范围 —— 它的去留由 #104 的 inventory 结论决定。

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
