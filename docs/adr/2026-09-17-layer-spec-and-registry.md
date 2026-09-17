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
「DOM 元素被抹掉后定时器回调还在」就是这么来的）。内核按槽位记账指纹，未变化的槽位不重复写
——但**指纹必须在写入之前先失效**（它代表的是「SDK 当前值」，见决策 6）。

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

**记账分两本，判据与「推进时机」都刻意不同**（第二轮发现 1/3 + 第四轮发现 2 + 第五轮发现 1
收口到这里）：

| 账本 | 何时推进 | 用来回答 |
| --- | --- | --- |
| 去重指纹（`appliedSlots` / `appliedMutableKey` / `appliedData`） | **调用之前先失效、成功返回之后才提交** | 「**SDK 现在的值**是不是就是我要写的」⇒ 决定要不要再调一次 |
| 「可能已写入」集合（`possiblyAppliedSlots` / `possiblyAppliedOptions`） | **在调用之前**（单调只增） | 「这个键/槽位有没有可能已经改过 SDK」⇒ 决定「变回未表态」时是否必须重建 |

两本必须分开，因为 SDK 允许**在抛错之前已经产生副作用**（与 `mountAttempted` 同一条理由）：

- 去重若按「尝试过」记账 ⇒ 一次失败的更新被记成完成，后续同值更新被指纹跳过、**永不重试**；
- 移除检测若按「成功过」记账 ⇒ 一次**部分成功**（`TrafficLayer` 的 `setOptions` 是逐 setter 调用、
  不是事务：`setColors` 已写进 SDK、`setEdge` 抛错）会让那个已经生效的键在账本上「从没写过」，
  之后它变回未表态就不重建，SDK **永久保留旧值**。

**去重指纹为什么必须「先失效」**：它代表的是「SDK 当前值」，而不只是「我调过成功一次」。只做到
「成功后推进」还不够——`{colors: A, edge: false}` 成功 ⇒ 指纹 = `fp(A,false)`；改成
`{colors: B, edge: true}` 时 SDK 已经写进 B、随后 `setEdge` 抛错 ⇒ 指纹仍停在 `fp(A,false)`；
用户把 props **改回 `{colors: A, edge: false}`** 时指纹正好相同、被跳过，而 SDK 里是 B
——声明与实现**永久分叉**，且此后没有任何变化会纠正它。同形的还有按引用的 `data` 与整袋槽位。
因此规则是：**任何一次可能产生副作用的调用之前，先把对应指纹置为「未应用」；成功返回后再提交。**
（第五轮评审发现 1；§12 三条用例分别覆盖 mutable / 整袋槽位 / `data`。）

未挂载时不写、也**不记**（两本都不动）。这一点是 PR #96 第一轮评审的发现 1——先记账再判断
`mountState === "attached"` 会把「挂载期间设的值」记成已应用，切回可见时指纹相同直接跳过，
值就永久丢了（`<BTrafficLayer :visible="false" :edge="false" />` 是最小复现）。

顺着同一条规则，**写过的键 / 槽位从有值变回未表态 ⇒ 重建图层**（见已知限制 5）：SDK 没有
unset 入口，本库也不猜默认值，换一个新实例（构造期不传它）才是回到「SDK 自己的默认状态」的唯一
办法。这条对**统一槽位**同样成立（`zIndex: 5 → undefined`、DOM 的 `minZoom: 3 → undefined`…），
唯一例外是 `data`：它有 `null = 清空` 的显式语义，`undefined` 表示「不表态（保持现状）」。
（第二轮评审发现 2。）

这条保守侧有代价，明写出来：**替身 / 真实 SDK 里「改之前抛错」与「改之后抛错」无法区分**，
因此一次失败的写入之后再移除该键，会多付一次重建（`v3-layer-suite.test.ts` §11 两条分别钉住
「改之后抛错必须重建」与「改之前抛错也保守重建」）。选保守侧的理由是：多一次重建的代价是确定的
一次重挂，而漏掉重建的代价是声明与 SDK 永久分叉、且没有任何后续事件会把它纠正回来。

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

### 12. 永久销毁的清理：按**清空操作的作用域**决定，临时摘挂不清

依据是仓库自己的 4.0 清理口径（`.agents/skills/bmap-jsapi-v4/references/data-layers.md`），
而它对两种「清空」的**前置条件**说法不同——这条差异是决策的起点，而且**其中一条根本没有说法**：

| 清空入口 | 文档原文 | 作用域 |
| --- | --- | --- |
| `GeoJSONLayer.clearData()` | 「**先从 Map 移除**这些覆盖物并清空集合」；且 `map.removeLayer()` 会「清空图层持有的 Map 引用」，官方因此明确「**要真正清空 `getData()` 集合，得在 `removeLayer` 之前调用 `clearData()`**」 | `"map-bound"`：官方**明确要求**仍在图上 |
| `DOMLayer.removeAllOverlays()` | 「`setData(null)` 只清空数据引用，不会移除已经渲染出来的 overlays；清空时必须显式调用 `removeAllOverlays()`」，且「资源清理」把它列为**必要步骤**——但**没有**说它是否要求仍在图上 | `"unknown"`：官方**没有说明**（**未知不等于不需要**） |

因此它被建模成**三态能力面** `LayerDriver.clearScope(kind): "map-bound" | "unknown" | "none"`
（事实源在描述符的 `clearScope` 字段；`"none"` ⟺ 没有清空入口，用例有双向一致性断言）。
内核据此决定「这次清空要不要执行」——关键是把**能力事实**与**行为策略**分开：

- `"map-bound"` 且图层**在图上**（含 `addLayer` 失败补偿那条路径）：执行，正是文档推荐的
  `clearData()` → `removeLayer()` 顺序；
- `"map-bound"` 且已经 **detached**（此前 `visible=false` 已成功摘过一次）或 `unknown`：
  **跳过**——官方说那次调用没有效果（`removeLayer` 之后图层不再持有 Map 引用），留着只会把
  「已经清空了」变成一句看起来有保证的假话。可见资源并不残留：同一段说明写明 `removeLayer`
  **本身已经摘掉覆盖物**。这条路径**不会再摘一次**：官方没有承诺「对已经摘掉的图层重复
  `removeLayer` 是安全的」，本库不猜；
- `"unknown"`：**能力面如实记「未知」，由内核选一个策略并写出来**——本库选 **best-effort 尝试**
  （跳过会真的残留真实 DOM 节点，而失败经 `logger.warn` 可观测）。这一档**不声称**「与挂图无关」，
  取证见已知限制 13（issue #98）。

**`visible=false` 的临时摘挂一律不清**（切回可见时数据照旧，不用补 `setData`）。
清理失败不阻断摘除，但经 `logger.warn` 可观测。

**承诺的边界要说准**——不再笼统写「保证最终清空」，也不再写「一定不在图上」：

- **正常路径**（清理与摘除都成功返回）：清理动作按作用域执行——attached 时 `clearData()` 清，
  detached 时（GeoJSON）由那一次 `removeLayer` 自己摘；DOM 的节点由 `removeAllOverlays()` 清
  （其 detached 有效性待取证，见已知限制 13）。**正常返回后不残留。**
- **失败路径**：清理 / 摘除**失败时只保证可观测**（`logger.warn` / `resource:error`），
  **不保证无残留**——已知限制 12 就是它的反例（最后一次 `removeLayer` 失败时收口交给 SDK 自己的
  `map.destroy()`）。把它写成「一定不在图上」会与同一条已知限制互斥。
- `getData()` 集合在 detached 路径上**不会被清**（官方明说那要在 `removeLayer` 之前做）。
  该集合是随实例一起丢弃的内存状态，**不是**需要释放的 SDK 资源——所以这条不构成残留。

`v3-layer-suite.test.ts` §11 / §13 用**真实调用次数**与「清空发生时图层在不在图上」
（替身的 `attachedAtClear`）把这个前提钉住，而不是只写在注释里。
（第三轮评审发现 2；第四轮补测建议 + 第五轮发现 3 修正了「第二次摘除」的错误表述；
第六轮发现 1 把作用域差异建出来；**第七轮发现 1** 指出「布尔 + `"layer"`」等于把**未知**重新编码成
「确定不需要」，因此改成三态——**能力事实只说到证据允许的程度，策略另说**。）

### 12b. 前提：`map.removeLayer()` 对**已经摘掉**的图层是安全的（**未取证**）

三态收敛（决策 14）在 `unknown` ⇒ 期望可见时要「先 best-effort 摘一次、再挂」，这一步会对一个
**可能已经不在图上**的图层再调一次 `removeLayer`。上游**没有**任何关于「重复摘除是否安全」的说明。

这条前提无法回避：任何「保证它不在图上」的动作都只能是 `removeLayer`；区别只在于什么时候调。
因此本库不假装它已被证明，而是：

- 把它**显式登记**为本条前提（已知限制 14）；
- 在替身里建出**悲观契约**（`FakeV4Map.failRemoveLayerWhenDetached`：目标不在图上时 `removeLayer`
  抛错），并用一条用例钉住退化行为——**收敛不保证发生**（图层停在 `unknown`、仍不在地图上），
  但**可观测**（`resource:error`）且**绝不会**因为「猜已经下去了」去 `add` 而出现两份；
- **正式拆票承接**：issue **#98**（`probe-layer-detached` 取证票）记录两个读数——真实 4.0 上
  「`removeLayer(已摘下的 layer)` 是否抛错」与「`DOMLayer.removeAllOverlays()` 在 detached 实例上
  是否生效」。拿到结论后把 P 升级为已证事实，或据此换恢复机制。
  （第六轮评审发现 2 要求「不要在 `Closes #40` 之后让这条运行时契约债失去工作项」。）


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

### 14. 挂载状态是**三态**（`attached` / `detached` / `unknown`），且失败后靠「确定性的同步」收敛

`addLayer` / `removeLayer` 都允许「副作用已经产生、然后抛错」，而调用方唯一能观测的证据就是
「调用有没有成功返回」。因此挂载状态**不能**用布尔表示：

- 记「还挂着」⇒ 真实可能已经 detached，于是 `visible=true` 早退、**再也挂不回来**（图层从图上消失
  而账本说它在）；
- 记「已经下去了」⇒ 真实可能还在图上，再 `add` 一次会让**同一个实例在图上出现两份**
  （`addLayer` 不去重）。

两条路都错，所以失败之后留 `unknown`，由一个**同步动作**收敛（`syncMounted`）：

| 当前状态 | 期望可见 | 动作 |
| --- | --- | --- |
| `attached` | 可见 | 什么都不做 |
| `detached` | 可见 | `add` ⇒ `attached` |
| `unknown` | 可见 | **先 best-effort `remove` 一次（把未知变确定），再 `add`** ⇒ `attached` |
| 任意 | 不可见 | `unmount`（成功 ⇒ `detached`；失败 ⇒ `unknown`） |

收敛动作不是免费的（多一次 SDK 调用），但它只在「上一次调用抛过错」之后才发生。

**这里有一条前提，而且它未被上游证明**：`unknown` 行里的那次 `remove` 是对一个**可能已经不在图上**
的图层调用的，而官方对「重复摘除是否安全」**没有**任何说明。因此本库**不**声称这是「确定性收敛」，
只声称「在前提 P（重复 `removeLayer` 安全）下收敛，并且前提不成立时的退化是有界且可观测的」：

- 前提 P 成立（替身的默认行为、也是最可能的真实行为）⇒ 收敛到「恰好挂一份」；
- 前提 P 不成立 ⇒ **收敛不会发生**（状态停在 `unknown`、图层仍不在地图上），但失败经
  `resource:error` 交出，且**绝不会**因为「猜已经下去了」去 `add` 而出现两份。

前提 P 的登记与取证方式见决策 12b、已知限制 14；悲观契约下的退化行为有用例钉住（§13）。
（第五轮评审发现 2；第六轮评审发现 2 指出原先「确定性收敛」的表述过强。）

记账的复位时点：`mountState = "detached"` 与 `mountAttempted = false` 都放在 `driver.layers.remove()`
**成功返回之后**。先复位的后果不是「少摘一次」，而是**永远不再摘**——`mountAttempted` 变成「从未挂过」，
组件卸载 / 重建 / Map 销毁三条永久销毁路径都会在 `if (!state.mountAttempted) return;` 处直接返回，
SDK 上留下一个再也没人认领的孤儿。保留记账 = 保留「仍需 best-effort 摘除」的所有权。
（第四轮评审发现 1。）

边界（登记为已知限制 12）：重试的机会来自**还有后续的 dispose 路径**。如果**最后一次**摘除本身
失败（组件卸载那一刻），账本记录已经一次性作废、组件也已经消失——没有任何一侧还能再试，真实 SDK
里收口的是 `map.destroy()` 自己。此时唯一的承诺是「经 `logger.warn` 可观测」，不是「无残留」。

### 16. 网络图层的加载诊断走**观察面**，不发明事件（issue #97）

issue #40 的实施步骤 4 要「定义网络 Layer 的 loading/error 回调」。PR #96 当时按**声明面**推迟了它
（那些类的 `.d.ts` 里没有任何事件成员，本库的口径是「不把未声明成员当契约」）。**issue #97 的 live
探针把运行时面补齐了**（`scripts/probe-layer-events.mts`，真实 4.0 / `BMap.version === "gl"`）：

| 读数 | 值 |
| --- | --- |
| 六个家族都暴露 `addEventListener` / `removeEventListener` | 是（声明里没有，运行时原型上有） |
| 十个候选事件名（`tileload` / `tileerror` / `tilesloaded` / `load` / `error` …）在**请求确实发生过**时是否触发 | **一个都没有**（tile 12 次、raster / wms / wmts 各 20 次请求） |
| 底图基线（同页从百度主机取到的资源数） | 24（证明页面真的在渲染，读数有意义） |
| 设了 `tileLoadFunction` 但函数里什么都不做 ⇒ 那块瓦片最终 | `complete=true, naturalWidth=0`（**SDK 不再自己加载**） |
| 设了它、函数里自己赋 `tile.src = url` ⇒ 那块瓦片最终 | `naturalWidth=256`（加载真的发生了） |

**覆盖面要说准**：`TrafficLayer` 本轮窗口内没有发出瓦片请求（它需要授权的路况服务），因此**未参与**
「无事件」结论；探针会把这一点打印在「适用范围」一行，不靠读者去数。

因此本库的处置是：

- **不发明事件**：既然运行时也不派发，补一套 `@tile-load` / `@tile-error` 就是假支持；
- 提供**加载观察面** `tileLoadObserver`（`onRequest` / `onLoaded` / `onError`），实现在
  `components/layers/tileLoadObserver.ts`：SDK 手上是一个包装函数，它先回调观察者，再完成加载
  （**必须在内部完成**——`tileLoadFunction` 是接管式的，不补这一步用户会静默失去瓦片）。
  与官方 `tileLoadFunction` **正交**：两者同时给时，加载交给调用方，本库只在旁边观察；
- **不给观察者时这个 option 保持缺席**（`undefined`）：没有观察需求就不得改变任何行为。

口径（写进组件 props 的 JSDoc，别让调用方猜）：`onRequest` 是「SDK 要求加载这张瓦片」而不是「成功」；
`onLoaded` / `onError` **以图片元素为单位**，回调里的 `url` 是元素**当前**的 `src`（官方没有暴露单次
请求的身份，本库不做归属推断）；`onError` **不带失败原因**（DOM 的 `error` 事件不提供原因）——可诊断的
是「哪个 URL 失败了、几次」，不是「为什么失败」。观察者回调抛错不影响加载（捕获 + `devWarn`）。

**非目标**（延续 #97 票面）：不实现重试 / 缓存策略（官方构造选项已透传）；不把「瓦片真的画出来」变成
库的保证（CORS / 坐标系 / 服务条款由使用方负责，排障见文档站图层总览）。

### 15. 「Registry 读数」与「地图上挂着几个」是两个口径

`LayerRegistry.size` = 这张地图**拥有**几个存活图层实例（含暂时隐藏 / 摘下的）；attached count
要读 SDK 侧。显隐统一表达为挂载状态（决策 8），所以 `size === 1` 与「一个图层都没挂」可以同时
成立——把两者写成同一个读数会让「测试全绿但地图上什么都没有」这类问题无从判定。
（第四轮评审发现 3。）

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
   Layer 的 loading/error 回调」，但**四个网络图层**（`TileLayer` 家族、`XYZLayer` / `WMSLayer` /
   `WMTSLayer` / `RasterTileLayer`）的类声明里**根本没有事件成员**，按本库「不把未声明成员当契约」
   的口径，**不发明** `tileload` / `tileerror` 事件。（声明了 `addEventListener` 的是
   `GeoJSONLayer` / `DistrictLayer` / `DOMLayer`，但只有前两者的**事件名**与网络加载无关；
   声明面的完整表格见决策 10。）当前唯一的可观测入口是官方的 `tileLoadFunction`
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
11. **摘除失败之后，挂载状态是「未知」直到下一次同步动作**：`removeLayer` 抛错时内核保留「仍需摘除」
    的记账、并把 `mountState` 置为 `unknown`（决策 14）。在那之后的第一个「同步动作」——也就是下一次
    props 变化（无论 `visible` 有没有变）或永久销毁——会把它收敛；在收敛之前，组件**不写就地更新**
    （状态不确定时调用层级 / 数据 setter 是未定义行为）。收敛的代价是一次额外的 `removeLayer`
    调用（`unknown` 时先摘再挂）。这条路径**有回归用例**（§11 与 §12 各一条，分别对应「摘之前抛」
    与「先摘后抛」两种形状）。
12. **最后一次摘除失败时只剩可观测性**：见决策 14 末尾。组件已经卸载、账本记录已一次性作废，
    没有任何一侧还能重试——真实 SDK 里收口的是 `map.destroy()` 自己。此时承诺的是
    「`logger.warn` 可见」，**不是**「无残留」；`v3-layer-suite.test.ts` §11 的窄角用例刻意**不**
    断言地图已空（详见决策 14）。
13. **`DOMLayer.removeAllOverlays()` 在 detached 实例上是否生效，没有上游依据**：官方只给了
    「先 `removeAllOverlays()` 再 `removeLayer()`」的顺序与「只调 `setData(null)` 会残留」的警告，
    **没有**说该入口是否要求图层仍在图上。因此能力面如实记 **`clearScope("dom") === "unknown"`**
    （**未知不等于不需要**——把它写成 `"layer"` 就是声称已被证明），而**行为策略**由内核显式选择：
    best-effort 尝试（它是移除真实 DOM 节点的唯一依据，跳过会真的残留；失败经 `logger.warn` 可观测）。
    策略**已被显式钉住**：替身记录 `attachedAtClear`（清空发生时图层在不在图上），§13 的用例断言
    detached 路径上它是 `false`——取证结论若推翻它，那条断言会红。
    承接方 **issue #98**（live 取证）；若上游确实要求「图层仍在图上」，症状是日志里多一条
    `DOM 销毁前的 clearData 失败` 且覆盖物残留（不阻断释放），届时按「显式失败」处理
    （永久销毁前先补挂再清再摘），不要静默降级。
14. **`map.removeLayer()` 对已经摘掉的图层是否安全，没有上游依据**（决策 12b 的前提 P）：
    三态收敛在 `unknown` 时会再调一次 `removeLayer`，这一步依赖重复摘除安全。上游对此**无任何说明**，
    且这条前提**无法回避**——任何「保证它不在图上」的动作都只能是 `removeLayer`。
    本库不假装它已被证明：悲观契约（`FakeV4Map.failRemoveLayerWhenDetached`）下的退化行为有用例
    钉住（§13：收敛不保证发生、可观测、绝不重复挂载）；承接方 **issue #98**。
    **拿到取证结论之前，不要在任何文档 / 注释里把它写成「已确定」或「幂等」**——这条口径与
    已知限制 13 是同一条：**能力事实只说到证据允许的程度，"我们选了哪个策略"另说**。

## 参考

- issue #40（`M7-LAYERS`）与总追踪 #12。
- `@baidumap/jsapi-v4-types@4.0.4` 的 `layer/*.d.ts`（逐成员核对的原始依据）。
- 官方参考实现 `huiyan-fe/react-bmap`（`src/components/Layer/**`、`src/utils/createComponent.tsx`、
  `src/drivers/v4Driver.ts`）：接口面与「哪些差异是有意的」的对照来源。
- ADR `2026-09-11-jsapi-v4-control-layer-facets`（#22：Control / Layer facet 基础）、
  `2026-09-12-jsapi-v4-service-panorama-native-layers`（#23：Native Layer 与本模块的分工）、
  `2026-09-14-map-handle-container-and-visibility`（#29：KeepAlive dispose 路径）。
