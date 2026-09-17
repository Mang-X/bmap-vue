# LayerSpec / LayerRegistry 与统一槽位口径（十条图层共用同一个生命周期内核）

- 日期：2026-09-17
- 状态：Accepted
- 计划键：`M7-LAYERS`（issue #40，追踪 #12）
- 相关：`packages/baidu-map-gl-vue/src/core/layers/**`、`core/composables/useLayerResource.ts`、
  `driver/types/layers.ts`、`driver/jsapi-v4/layers.ts`、`components/layers/**`、
  `driver/capability/catalog.ts`、`tests/behavior/v3-layer-suite.test.ts`、
  `packages/test-utils/fake-bmap-v4/controls-layers.ts`、`packages/test-utils/driver-contract.ts`
- 取代范围：#22 的 ADR `2026-09-11-jsapi-v4-control-layer-facets` **整体仍然有效**，本 ADR 在它
  之上扩展 kind 数量与「统一槽位」这一层，并**取代它的三处结论**（只取代这三条，其余不动）：
  1. §3 的注册表释放口径 → 见本 ADR 决策 2；
  2. §2 / §11 的「可见性即挂上 / 摘掉」从「v4 的现状」升格为所有 kind 的唯一口径 → 见决策 7；
  3. **§12 的「`TrafficLayer` 刻意不承接」** → 见决策 1 的 kind 表与「已知限制」第 9 条：
     本 issue 的验收清单明确要求 `TrafficLayer`，因此加 `traffic` kind；但 §12 记下的**技术
     事实仍然成立**（`TrafficLayer` 是页面级单实例：`map` / 缓存 / 刷新 timer 在所有实例之间
     共享），所以本库**不承诺**多实例隔离，并在组件文档里写明。

## 背景

issue #40 要求「统一 LayerSpec、LayerRegistry 和实例 child scope」，并补齐 Stable 常用图层：
`TrafficLayer` / `TileLayer` / `GeoJSONLayer` / `DOMLayer` 与 XYZ / WMS / WMTS / Raster 基线，
统一 `visible` / `opacity` / `minZoom` / `maxZoom` / `zIndex` / `data` / `options`。

难点不在「多写几个组件」，而在**十个 kind 的接口面并不一致**（issue 的非目标也明确写了
「不假定所有 Layer 都有相同事件和数据接口」）。逐成员核对
`@baidumap/jsapi-v4-types@4.0.4` 的 11 个图层类之后得到的事实：

| 事实 | 影响 |
| --- | --- |
| 这批图层**没有任何** `setOpacity` / `setMinZoom` / `setMaxZoom`（`MVTLayer` 之外） | 这三个槽位只能构造期生效 ⇒ 变化时**重建** |
| 只有 `TileLayer` 家族（含 `TrafficLayer`）与 `XYZLayer` / `RasterTileLayer` / `WMSLayer` / `WMTSLayer` 有 `setZIndex` | `zIndex` 在部分 kind 上可就地更新，`GeoJSONLayer` / `DistrictLayer` 上根本没有该语义 |
| `DOMLayer` 用整袋 `setStyleOptions(partial)` 更新构造项，没有逐字段 setter | 需要第三条更新通道（整袋 setter） |
| `GeoJSONLayer` / `DOMLayer` 的官方构造签名是**两参**（首参分别是 `layerName` 与 `createDOM`） | 这两个首参不是选项，塞进选项袋会被忽略 |
| `DOMLayer` **没有** `clearData`（清空入口是 `removeAllOverlays()`） | 「清空数据」要跨 kind 归一化 |
| 只有 `GeoJSONLayer` / `DOMLayer` 声明了 `addEventListener` | 事件面按声明给，不给其余 kind 编事件 |
| `PanoramaCoverageLayer` 在 4.0.4 里**没有类声明** | 只能按结构探测（沿用 #22 的口径） |

## 决策

### 1. 一份 `LayerSpec` + 三条更新路径

`core/layers/LayerSpec.ts` 定义领域规格（`kind` + `options` + 六个统一槽位），
`core/composables/useLayerResource.ts`（建立在既有原语 `useSdkResource` 之上）负责把它变成
一个 SDK 实例。变化只有三条路径，判据由 Driver 回答：

| 变化 | 路径 | 判据 |
| --- | --- | --- |
| `visible` | 挂上 / 摘掉 | 恒成立（所有 kind 一致） |
| 可就地更新的槽位（有 setter 的 `zIndex`、数据图层的 `data`）与可变 option（`colors` / `edge` / `offsetX`…） | 原地写入 | `surface().operations` 或 `isMutableOption()` |
| 其余（构造选项、URL、`opacity` / `minZoom` / `maxZoom`） | **重建**（原子替换） | `layerRebuildKey()` 变化 |

注意：`opacity` / `minZoom` / `maxZoom` 是**必须重建**的那一类（官方这批图层没有对应 setter），
不要误读成「可就地更新」。

### 2. `LayerRegistry` 随 Map 释放，且 `disposeAll()` 先摘 SDK 资源

新增 `core/layers/LayerRegistry.ts`，并把 `MapRuntime.layers` 从 `OverlayRegistry` 换成它。

**这是对 #22 ADR 的一处修改**：`OverlayRegistry.dispose()` 只释放 owner scope、不摘 SDK 资源
（覆盖物由组件自己摘），而图层的「先摘子资源、再销毁 Map」是一条跨 Facet 不变式。因此
`LayerRegistry.disposeAll()` 按注册**逆序**逐个 `LayerRecord.dispose()`，由
`MapRuntime.dispose()` 在 `map.destroy()` 之前调用；每条记录内部沿用 #22 的顺序——
**先释放实例 child scope（解绑业务监听）、再摘除 SDK 资源**。
`keepAliveBehavior="dispose"` 的停用路径也因此能把仍挂着的图层摘干净。

记录本身是幂等的（同 `ResourceRegistration` 形状），因此「组件卸载 / 重建 / Map 销毁」三条
路径交叉触发时只生效一次。

**摘除的门禁是「调用过 `addLayer`」而不是「成功返回过」**（`mountAttempted` ≠ `mounted`）：
真实 SDK 的 `addLayer` 可能「已经产生副作用、然后抛错」，用成功返回的记账当门禁会让那次补偿
摘除被跳过、实例永久留在图上。Driver 的 `remove` 明确不读自己的挂载记账，正是为了支持这种
best-effort 摘除；组件层不能用更严格的记账把它挡掉。失败补偿与 watch 路径的异常都收成
`resource:error`（两条路径共用同一个上报出口），且失败后记账复位、可以重试挂载。

### 3. 能力面的单一事实源在 Driver，内核只做投影

`LayerDriver` 新增三个查询：`surface(kind)`（构造期槽位 + 可用操作）、`supports(kind, op)`、
`isMutableOption(kind, key)`。`core/layers` 不复制这张表——它只按需向 Driver 提问。
好处是「哪一个 kind 支持什么」只有一处，且**可以对着官方声明逐条校对**（见「测试」）。

### 4. 可就地更新的槽位**不进**构造选项

规则收敛成一句：**能就地写的，就只在挂载后写一次**。否则同一个值有两条写入路径，
而 `data` 这种「写一次就重建全部覆盖物」的槽位重复写入是有害的（旧实现里
「DOM 元素被抹掉后定时器回调还在」就是这么来的）。内核按槽位记账指纹，未变化的槽位不重复写。

### 5. 组件层的布尔 option 用**显式 `undefined`** 关闭 Vue 的隐式 `false`

Vue 对 `boolean` prop 有「缺省即 `false`」的转换（`resolvePropValue` 里
`isAbsent && !hasDefault ⇒ false`）。图层 option 里大量是布尔开关，其中
**`TrafficLayer.edge` 的官方默认是 `true`**（「交通流量图默认会绘制白色描边」）：不给显式默认值
就等于每个用户都在隐式传 `edge: false`，把 SDK 的默认值改掉。
因此每个图层组件的布尔 option prop 都在 `withDefaults` 里写成 `undefined`
（`{ default: undefined }` 让 `hasDefault` 为真，从而关闭那次转换）——
「没传」就是**不表态**，构造选项与 setter 调用里都不会出现这个键。
`v3-layer-suite.test.ts` 有对应回归（不传 ⇒ `layerCalls` 为空；显式 `false` ⇒ 真的调到 `setEdge`）。

### 6. 可就地更新的 option：挂载时必须写一次，且**只在写成功后记账**

见决策 4：它们不进构造选项。因此 `mount()` 的顺序是
`syncMounted → syncPostMountSlots → syncMutableOptions`，其中最后一步是这些 option 唯一的
生效路径（`appliedMutableKey` 用「未写」哨兵初始化，保证这次一定发生）。漏掉它的症状是
「初始 `colors` / `offsetX` 静默失效、改一次才生效」——`v3-layer-suite.test.ts` 有回归。

**记账（`appliedMutableKey` / `appliedMutableKeys`）只在成功写入 SDK 之后更新**：未挂载时不写、
也**不记**。这一点是 PR #96 第一轮评审的发现 1——先记账再判断 `mounted` 会把「挂载期间设的值」
记成已应用，切回可见时指纹相同直接跳过，值就永久丢了（`<BTrafficLayer :visible="false" :edge="false" />`
是最小复现）。

顺着同一条规则，**已经写入过的键 / 槽位从有值变回未表态 ⇒ 重建图层**（见已知限制 5）：SDK 没有
unset 入口，本库也不猜默认值，换一个新实例（构造期不传它）才是回到「SDK 自己的默认状态」的唯一
办法。这条对**统一槽位**同样成立（`zIndex: 5 → undefined`、DOM 的 `minZoom: 3 → undefined`…），
唯一例外是 `data`：它有 `null = 清空` 的显式语义，`undefined` 表示「不表态（保持现状）」。
（第二轮评审发现 2。）

同样地，**applied 记账只在 SDK 调用成功返回之后才提交**：这不只适用于可变 option，也适用于走整袋
`setOptions` 的槽位——整袋调用抛错时不能把这一袋记成已写入，否则后续同值更新会被指纹跳过、
**永不重试**，声明与 SDK 状态静默分叉。（第二轮评审发现 3。）

### 7. 回调型 option 分两类：**转发**（每次调用）与**重建**（只求一次）

`stableLayerValue` 刻意把函数折叠成 `fn`（否则父级每次渲染产生的内联箭头都会让图层重建），
**代价是「函数 A → 函数 B」的变化在指纹里看不出来**——PR #96 第一轮评审的发现 2 指的就是它：
`BRasterLayer.url` 从回调换成另一个回调、`tileLoadFunction` 换实现、XYZ/WMTS 的模板回调、
GeoJSON 的函数型 style，全都会被折叠吞掉，SDK 永远用旧实现。

折叠行为要保留，但「换实现要有可观测效果」这条语义不能丢。判据是**SDK 什么时候调用这个回调**：

| 类别 | 例子 | 处理 |
| --- | --- | --- |
| **每个工作单元都会再调用** | `url`、`tileLoadFunction`、`xTemplate` / `yTemplate` / `zTemplate` / `bTemplate` | 交给 SDK 的是 **`forwardCallback` 包装**：函数身份稳定、每次调用读**最新 prop**。**不重建**（下一个瓦片就会用到新实现） |
| **只在解析数据时求一次** | GeoJSON 的 `markerStyle` / `polylineStyle` / `polygonStyle`（`IDENTITY_SENSITIVE_OPTION_KEYS`） | 指纹按**引用**比较（`layerDataIdentity`）⇒ 换函数即**重建**。光转发不够：已经在图上的要素不会知道实现换了（第二轮评审发现 1） |
| 只在解析数据时求一次，但**有官方参考实现先例** | `BDOMLayer` 的 `createDom` | 仍走**转发**（不重建）：参考实现 `huiyan-fe/react-bmap` 用 `useLatest` 包装，让新工厂只作用于**后续**创建的元素。用户要换既有元素时重新赋值 `data`（触发一次 `setData`），届时包装函数会把最新 prop 交出去。两者的差别是**有意保留**的，各自有正证用例 |

`forwardCallback` 的两条语义细节刻意如此：创建时不是函数就原样返回（「不表态」就该缺席，
包一层空函数等于假支持）；调用时刻 prop 已变成非函数时继续用**最后一个确定的实现**，而不是抛错
——这类变化同时会改变重建指纹、旧实例很快被替换，在替换完成前抛错只会把「我要换了」变成 SDK 侧
的一次异常。

**身份敏感那一类的代价必须写出来**：函数按引用比较意味着**内联箭头每次渲染都会触发重建**，
请传稳定引用（`computed` / 模块常量）。另一半是**对象仍按值**比较：同内容的新对象不重建。

残余限制：**嵌套在对象里的函数**（例如 `markerStyle: { icon: fn }`）仍被折叠（见已知限制 8）。

### 8. `visible` 统一表达为「挂上 / 摘掉」

**这是对 #22 ADR 的第二处修改**：它把「可见性在 v4 就是挂上 / 摘掉」写成 layer facet 的现状，
本 ADR 把它升格为**所有 kind 的唯一口径**，即使某个 kind 官方提供了 `show` / `hide`
（`XYZLayer`）或 `setVisible`（`GeoJSONLayer`）也**不用**它们——否则会出现
「两种显隐机制」，且「`visible: false` 的实例仍被挂在图上」这种两套事实源的状态。
`LayerSpec` 的 `options` 里出现 `visible` 时 Driver 会告警一次并忽略。

### 9. 跨 kind 的归一化操作：`setZIndex` / `setData` / `clearData`

三个操作都由 Driver 按 kind 映射到官方入口（`DOMLayer.clearData → removeAllOverlays()`），
该 kind 没有入口时**显式失败**（`BMAP_CAPABILITY_UNSUPPORTED`）并告警一次，不静默 no-op。
`surface().operations` 是唯一声明；替身（Fake）按官方声明实现成员，因此
「声明了但替身里没有」与「替身里有但没声明」都会被测试抓到。

### 10. 事件面按官方声明给（且**必须**有可解绑入口）

本库的事件订阅走 `EventDriver.on()`，它要求目标**同时**具备 `addEventListener` 与
`removeEventListener`：缺一个就告警 + no-op，因为「绑上解不掉」的监听器违反本库「所有监听器
都必须有释放路径」的硬约束。逐成员核对 4.0.4 声明后的结论：

| kind | `addEventListener` | `removeEventListener` | 组件是否提供事件 |
| --- | --- | --- | --- |
| `GeoJSONLayer` | ✅ | ✅ | ✅ `click` / `mousemove` / `mouseout` |
| `DistrictLayer` | ✅ | ✅ | ✅ `click` / `mouseover` / `mouseout`（`BDistrictLayer` 的既有 API，依据充分） |
| `DOMLayer` | ✅ | ❌ | ❌ 不提供（见决策 13） |
| `TileLayer` 家族 / `XYZLayer` / `WMSLayer` / `WMTSLayer` / `RasterTileLayer` | ❌ | ❌ | ❌ 无事件面 |

其余 kind **不声明**事件 props——非目标「不假定所有 Layer 都有相同事件接口」。

### 11. 每一条新 kind 都要过一遍同一批断言

`packages/test-utils/driver-contract.ts` 的 `LAYER_FACET_KINDS` 从 3 种扩到 10 种
（「creates / mounts / updates / removes」在每种 kind 上各跑一遍），
`tests/behavior/v3-layer-suite.test.ts` 按 issue 的「测试要求」分节覆盖
（统一内核 / URL 重建 / 参数生成 / 响应式数据 / Registry 与 Map dispose / 事件归属 / 能力标记）。

### 12. 永久销毁前先清数据覆盖物（`clearData` → `removeLayer`），临时摘挂不清

依据是仓库自己的 4.0 清理口径（`.agents/skills/bmap-jsapi-v4/references/data-layers.md`）：

- `DOMLayer`：**先 `removeAllOverlays()` 再 `removeLayer()`**；该文档明确「`setData(null)` 只清空
  数据引用，不会移除已经渲染出来的 overlays」，并把「对 DOMLayer 只调用 `setData(null)`」
  列为常见错误；
- `GeoJSONLayer`：`clearData()` 在 `removeLayer` **之前**（该文档同时写明：`removeLayer` 已经摘掉
  覆盖物、解绑监听并清空图层持有的 Map 引用，**之后再 `destroy()` 不起作用**——所以本库**不**调用
  `destroy()`：它既无必要，也不会产生可观测效果）。

因此 `LayerRecord.dispose()`（组件卸载 / 重建 / Map 销毁三条路径的公共出口）在摘除图层之前，
对**支持 `clearData` 的 kind** 调一次统一清空入口（Driver 按 kind 映射到 `clearData` /
`removeAllOverlays`）。两条边界刻意如此：**`visible=false` 的临时摘挂不清**（切回可见时数据照旧，
不用补 `setData`）；清理失败不阻断摘除，但经 `logger.warn` 可观测。
（第三轮评审发现 2。）

### 13. `BDOMLayer` 不提供交互事件（官方声明缺 `removeEventListener`）

官方 4.0.4 的 `DOMLayer` **只有** `addEventListener`，没有可解绑入口；而本库的
`EventDriver.on()` 要求目标**同时**具备 `addEventListener` 与 `removeEventListener`，缺一个就
告警 + 返回 no-op（连 `addEventListener` 都不会调用——这正是「绑上就解不掉」的显式拒绝）。
仓库的官方技能文档把「在短生命周期组件注册 DOMLayer 事件」列为常见错误。

因此 `BDOMLayer` **不绑定、也不公开** `click` / `mouseover` / `mouseout`：公开一个真实契约下
no-op 的 `@click` 比不提供更糟。需要交互时在 `createDom` 里给元素自己挂监听（元素随数据 / 图层
一起销毁），或把图层放到与 Map 同生命周期的壳层里经 `advanced` 逃生口自行注册。
配套把 Fake 从基类继承来的 `removeEventListener` **遮蔽掉**（替身必须与声明一致，否则
「组件能订阅、真实契约下收不到」这类缺陷会被测试全绿掩盖），并补一条「EventDriver 拒绝订阅」
的机制正证。（第三轮评审发现 1。）

## 与官方参考实现 `huiyan-fe/react-bmap` 的对照

| 维度 | 参考实现 | 本库 | 结论 |
| --- | --- | --- | --- |
| 图层工厂 | `createLayerComponent`：**所有** props 变化都用 `stableStringify` 出一个 key，变了就重建 | 按「三条路径」分流（可写就写、能构造就构造、其余重建） | **本库更细**：`data` / `zIndex` / `colors` 这类变化不重建（参考实现的注释也承认「图层没有 setter 抽象，props 变化只能靠重建」） |
| `GeoJSONLayer` 构造 | `new rawSDK.GeoJSONLayer(layerName, opts)` | 同源（`signature: "layerName-options"`，`layerName` 有具名槽位） | 同源 |
| `DOMLayer` 构造 | `new rawSDK.DOMLayer(createDOM, opts)` | 同源（`createDOM` 有具名槽位，缺首参 `BMAP_INVALID_ARGUMENT`） | 同源（本库多一条「缺首参显式失败」） |
| `createDOM` 引用变化 | `useLatest` + 稳定 wrapper，避免重建 | 指纹把函数折叠成 `fn`，因此不重建 | 同目的、不同手段 |
| `DOMLayer.setData` 去重 | 记 `appliedDataKey`，避免同一份数据写两次 | 按**槽位**记账指纹（`data` 只是其中一个槽位） | 同目的、更一般 |
| `TrafficLayer` 的 `setColors` / `setEdge` | 手写组件 + `debugWarn` 包裹调用 | 声明为可就地更新的 option，由 Driver 分类 | 同源 |
| 图层显隐 | overlay 侧用 `hideOverlay`；图层侧靠重建 | 统一为挂载状态（所有 kind 一致） | **本库更严**（一种机制） |
| 事件载荷 | `driver.addEventListener` 直接把原生事件给回调 | 归一化 `DriverEvent` + `raw` 逃生口 | 本库更严（形状稳定），代价见「已知限制」第 1 条 |

## 后果

- 十个图层组件共享一条生命周期实现：新增 kind 的成本是「一行 descriptor + 一张 surface 表」。
- 迁移影响：
  - `BDistrictLayer` / `BPanoramaCoverageLayer` 改用内核；`BDistrictLayer` 的构造项
    （`fillColor` / `kind` / `viewport`…）变化从「静默不生效」变为「**重建图层**」；
    新增 `adcode` prop；`BPanoramaCoverageLayer` 新增 `visible` prop（默认 `true`）。
  - `MapRuntime.layers` 的类型从 `OverlayRegistry` 变为 `LayerRegistry`（`MapContext.layers`）。
  - `core/composables/useLayerResource` 的签名为规格驱动（`toSpec` + `bind`），
    不再是 `LayerResourceAdapter`。旧的 adapter 形状**没有生产消费者**（只有 #22 的
    顺序用例），随本 issue 一起改写为等价断言。
- issue 的「预计变更区域」把注册表写成 `core/overlays/LayerRegistry.ts`，实现落在
  `core/layers/LayerRegistry.ts`（与本 ADR 决策 3 的「能力面在 Driver、内核只做投影」一致：
  `core/overlays/` 是覆盖物的家，图层规范与账本自成一个模块）。「预计」区域是提示，不是硬要求。
- 回滚：本 ADR 的改动集中在 `core/layers/**`、`core/composables/useLayerResource.ts`、
  `driver/**` 与 `components/layers/**`。回滚到 #22 的形态需要同时恢复
  `MapRuntime.layers` 的类型（`OverlayRegistry`）与 `driver/types/layers.ts` 的 `LayerKind`
  （3 种）——两处都由类型层锁住，漏一处编译不过。

## 非目标

- 不把 Native Visualization Layer 重复实现到本模块（它属于 `NativeLayerDriver` / M6）。
- 不假定所有 Layer 有相同的事件与数据接口（因此事件 props 与 `data` 都按 kind 给）。
- **不在 `map.addLayer` 之前执行依赖 map 的操作**：`zIndex` 一类写入只在挂载后发生
  （内核以「已挂载」为前置；未挂载时既不写也不记账）。
- 不做瓦片服务的可用性保证：CORS、坐标系、服务条款由使用方负责（文档给了排障顺序）。

## 已知限制

1. **要素集合只在 `raw` 上**：`BGeoJSONLayer` / `BDOMLayer` 的事件回调收到的是归一化
   `DriverEvent`，`features` 不是它的第一类字段，需要 `e.raw.features`。给 `DriverEvent`
   加 `features` 属于事件 facet 的改动（不在本 issue 范围），登记为欠账。
2. ~~`BDistrictLayer` 的三个事件在官方声明里没有 `addEventListener`~~ —— **本条已作废（第三轮
   评审核对）**：4.0.4 的 `layer/DistrictLayer.d.ts` **同时**声明了
   `addEventListener<K extends keyof DistrictLayerEventMap>` 与 `removeEventListener<…>`
   （两者都是泛型签名，早先按「方法名 + 左括号」扫成员时漏掉了它们）。因此
   `BDistrictLayer` 的三个事件是**完全有依据**的常规能力，`EventDriver.on()` 也满足订阅前提
   （两个入口齐备），不是欠账。保留这条是为了说明「成员核对要按类型包的**签名**读，
   而不是按命名规律或正则扫名字」。
3. **`GeoJSONLayer` 的层级语义不映射到 `zIndex`**：官方的 `level`（默认 -99）与其它图层的
   `zIndex` 不是同一个量，方向也未在文档里写死，因此本库**不猜**：`BGeoJSONLayer` /
   `BDistrictLayer` **不提供** `zIndex` / `opacity` 这两个 props（组件层拿不到入口）；
   直接调 `driver.layers.create(kind, { zIndex })` 时才会走 Driver 的「该 kind 没有这个槽位」
   分支并告警一次——两层都不是静默接受。
4. **`PanoramaCoverageLayer` 没有可核对的选项声明**：`BPanoramaCoverageLayer` 因此只声明
   `visible`（有确定语义的那个槽位）；上游补齐声明后按 augmentation 治理流程再放开。
5. **可变 option 从有值变回未表态 ⇒ 重建图层**：SDK 这批图层没有 unset 入口，本库也不猜默认值，
   因此 `edge: false → undefined` 这类变化会换一个新实例（构造期不传它），让它回到 SDK 自己的
   默认状态。代价是「清一个开关」带来一次重建——这是刻意的：另一种做法（停在旧值）会让声明与
   SDK 实际状态永久不一致。（PR #96 第一轮评审的发现 3；`v3-layer-suite.test.ts` 有回归。）
6. **网络图层的 loading / error 回调不在本 issue 内（已拆票）**：issue 实施步骤 4 要求「定义网络
   Layer 的 loading/error 回调」，但官方这批图层里 `addEventListener` **只**声明在
   `GeoJSONLayer` / `DOMLayer` 上（`TileLayer` 家族、`XYZLayer` / `WMSLayer` / `WMTSLayer` /
   `RasterTileLayer` 的类声明里都没有事件成员），按本库「不把未声明成员当契约」的口径，
   **不发明** `tileload` / `tileerror` 事件。当前唯一的可观测入口是官方的 `tileLoadFunction`
   （已在四个网络图层上透传：`BTileLayer` / `BWMSLayer` / `BWMTSLayer` / `BRasterLayer`）。
   承接方见 issue #97（需要先取证「真实 4.0 是否另派发未声明事件」，再决定是否补事件）。
7. **`data` 按引用去重**：同一份数据原地修改不会被感知（内核按引用比较 `data`，避免每次 props
   变化都深度序列化整份 `FeatureCollection`）。这是 Vue 的响应式约定本身，但值得写下来。
8. **嵌套在对象里的函数不被指纹感知**：两类处理都只覆盖「option **本身**就是回调」的形态
   （`url` / `tileLoadFunction` / 模板回调 / 函数型 style / `createDom`）。
   `markerStyle: { icon: () => … }` 这类**对象内部**的函数换了实现**不会**触发重建、也**不会**转发：
   `stableLayerValue` 对普通对象按值递归，而函数一律折叠成 `fn`
   —— 因此 `{ icon: fnA }` 与 `{ icon: fnB }` 的指纹相同，**换外层对象的引用也不会有任何变化**
   （这一点容易写错，第二轮评审的发现 4 就是针对它）。
   可行的替代：把 style 写成**函数**（`markerStyle: (props) => ({ … })`）——函数型 style 是身份
   敏感的，换引用即重建、既有要素会用新实现重解析；或者在 Vue 层用 `:key` 强制重挂载组件。
9. **`TrafficLayer` 不保证多实例隔离（延续 #22 §12 的技术结论）**：官方 `TrafficLayer` 是
   **页面级单实例**（原型本身就是已构造实例，`map` / 瓦片缓存 / 刷新 timer 在 `new TrafficLayer()`
   之间共享）。本库仍然提供 `BTrafficLayer`（issue #40 的验收清单点名要求），但**不承诺**
   「挂两个路况图层互不影响」——`autoRefresh` / `refreshInterval` 这类共享状态以最后一次写入为准。
   需要严格隔离时用一层 `<BMap>` 一个实例。
10. **瓦片是否真的画出来不由本库保证**：live smoke 的 `layer-tile` / `layer-traffic` /
    `layer-geojson` 断言的是「组件 → Driver → 真实 `Map.addLayer` 的调用发生了、且没有
    `console.error`」，与既有 `layer-district` 同一口径。

## 参考

- issue #40（`M7-LAYERS`）与总追踪 #12。
- `@baidumap/jsapi-v4-types@4.0.4` 的 `layer/*.d.ts`（逐成员核对的原始依据）。
- 官方参考实现 `huiyan-fe/react-bmap`（`src/components/Layer/**`、`src/utils/createComponent.tsx`、
  `src/drivers/v4Driver.ts`）：接口面与「哪些差异是有意的」的对照来源。
- ADR `2026-09-11-jsapi-v4-control-layer-facets`（#22：Control / Layer facet 基础）、
  `2026-09-12-jsapi-v4-service-panorama-native-layers`（#23：Native Layer 与本模块的分工）、
  `2026-09-14-map-handle-container-and-visibility`（#29：KeepAlive dispose 路径）。
