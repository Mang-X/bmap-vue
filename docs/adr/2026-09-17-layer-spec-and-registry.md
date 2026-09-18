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

**⚠️ 「再显示」要换新实例（issue #98 的 live 读数，后补的决策）**：`visible=false` 仍然是
「摘掉」（不重建），但**重新可见不能把旧实例挂回去**——真实 4.0 的 `removeLayer` 会清空图层持有的
Map 引用，那个实例**再也渲染不了**。严格按内核的 `addLayer → setData` 顺序实测（`DOMLayer`）：

| 步骤 | 节点连在文档 |
| --- | --- |
| 挂载 + `setData` | 2 |
| `removeLayer` | 0 |
| **再 `addLayer`** | **0 —— 内容不会自己回来** |
| 再补一次 `setData` | 0，且调用**抛错**（`Cannot read properties of null (reading 'coordinate')`）|
| 对照：**换新实例** | **2** |

`GeoJSONLayer` 的 `getData()` 集合在同样路径下**还在**（2 条），但「集合在」不等于「覆盖物回到图上」
——那一点没有公开手段可观测（`Map` 上没有列出覆盖物的方法），因此**不构成「复用可行」的证据**。
既然没有任何 kind 的「摘掉之后复用」被证实可行，就不去猜：**重新可见一律重建**
（`needsRemountRebuild`，纯判定，放在任何就地写入之前）。

代价与边界：一次重建（与「构造期选项变化」同级，只发生在 hide → show 这条不热的路径上）；
好处是这条路不再依赖任何未取证前提——原来它依赖「重复摘除安全」+「重挂载会重渲染」两条，
现在两条都不需要了。若将来某个 kind 的复用被证实可行，可以按证据把这条放宽为按 kind 判定。

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

### 12. 永久销毁的清理：走统一清空入口，**不判挂载状态**（依据已由 live 取证更正）

清理的入口映射不变：Driver 用 `clearEntry` 把 `GeoJSONLayer.clearData()` 与 `DOMLayer.removeAllOverlays()`
归一化成同一个领域操作 `clearData`，内核因此不需要按 kind 分支。**只在永久销毁时做**
（`visible=false` 的临时摘挂不清——切回可见时数据照旧，不用补 `setData`）；清理失败不阻断摘除，
但经 `logger.warn` 可观测。

历史上这里还有一层「**要不要执行**」的判定：曾经建模成三态能力面
`LayerDriver.clearScope(kind): "map-bound" | "unknown" | "none"`（第六 / 七轮评审的产物），
用来表达「官方要求图层仍在图上」与「官方没有说明」。**issue #98 的 live 取证把它的地基拆了**：

| 读数（`scripts/probe-layer-detached.mts`，4.0 / `BMap.version === "gl"`） | 值 | 对判定的影响 |
| --- | --- | --- |
| `GeoJSONLayer`：`removeLayer` 之后 `getData()` | 2 条（未被清） | — |
| 同上，此时再调 `clearData()` | **2 → 0 条，未抛错** | 「得在 `removeLayer` **之前**调」**不成立** ⇒ `"map-bound"` 的依据消失 |
| `DOMLayer`：`removeLayer` 之后 `isConnected` / `getCustomOverlays()` | **2 → 0** | 节点由 `removeLayer` 自己摘掉 ⇒ detached 的清空是 no-op，但**没有残留风险** |
| 同上，此时再调 `removeAllOverlays()` | **未抛错** | 调用安全 |

两条合起来的结论是：**清空入口与挂载状态无关**。既然没有任何 kind 有这个前置条件，`clearScope`
就是一个**没有消费者的抽象**（本仓库的口径：没有当前消费者的扩展面不加），而且它的存在会让
「attached 时清、detached 时不清」这个**基于错句子的行为**继续生效。因此该能力面与内核里的判定
一并**撤掉**，恢复成「支持 `clearData` 就调一次」。

**承诺的边界**（不再笼统写「保证最终清空」，也不写「一定不在图上」）：正常返回后不残留；
**清理 / 摘除失败时只保证可观测**（`logger.warn` / `resource:error`），不保证无残留——已知限制 12
就是它的反例。`getData()` 集合在 detached 路径上会被清掉（实测有效），不再是例外。

（第三轮评审发现 2 建起「永久销毁要清」这条要求；第四 / 五轮修正了「第二次摘除」的错误表述；
第六 / 七轮把作用域建模成能力面；**#98 的 live 取证推翻其依据，第八轮之后撤掉该能力面**。）


### 12b. 前提 P（`map.removeLayer()` 对**已经摘掉**的图层是安全的）：**已由 live 取证成立**

三态挂载收敛（决策 14）在 `unknown` ⇒ 期望可见时要做「先 best-effort 摘一次、再挂」，这一步会对一个
**可能已经不在图上**的图层再调一次 `removeLayer`。上游对此没有任何说明，因此它长期被登记为
**未取证前提**（已知限制 14），并在替身里用悲观契约钉住退化行为。

**issue #98 的 live 探针取证结果：前提 P 成立。** 实测（`scripts/probe-layer-detached.mts`）
三个 kind 家族对**已摘下**的实例重复 `removeLayer` **均未抛错**：

| 家族 | `removeLayer#1`（在图上） | `removeLayer#2`（已摘下） |
| --- | --- | --- |
| `GeoJSONLayer` | 未抛错 | **未抛错** |
| `DOMLayer` | 未抛错 | **未抛错** |
| `TileLayer`（瓦片家族代表） | 未抛错 | **未抛错** |

覆盖范围要说准：探针覆盖上述三个家族；其余 kind 走的是**同一个** `map.removeLayer` 入口
（`driver.layers.remove` 对所有 kind 都是 `callMap.removeLayer(raw)`，见驱动实现），因此结论按
「入口一致」外推，而不是逐 kind 实测。

**拿到结论之后本库怎么做**（这是「取证」的意义所在）：

- 前提 P 从「未取证」升级为**已证事实**（已知限制 14 相应改写为「已取证」，不再要求「不要写成已确定」）；
- 三态收敛与它的措辞**保持原样**（它本来就设计成「前提成立时保证收敛」）——现在前提成立了，
  于是「`unknown` ⇒ 先摘再挂 ⇒ 恰好挂一份」在真实 4.0 上是**成立的行为**，不再是「有条件的」；
- 悲观契约与那条用例**保留**，但身份从「我们依赖的假设」变成**防御性不变量**：万一将来某个 kind
  或某个 SDK 版本不成立，退化必须仍然有界（不重复挂载）且可观测（`resource:error`）。

**读数只有在「产生它的那一步真的成功了」时才能当依据**（第六轮行内发现 1，判定层已落实）：
探针的结论是从**后续 snapshot** 推出来的，而 snapshot 只说明「那一刻的状态」——若
`kernel.show.addLayer` 自己抛错，`kernel.shown.connected === 0` 就不能读成「重挂之后内容不会回来」，
那是**实验步骤失败**，不是 SDK 语义。因此判定层给每个实验声明**前置 attempt**
（`unmetPrerequisites()`，要求 `threwOf(id) === false`）：

| 实验 | 前置 attempt |
| --- | --- |
| 前提 P（重复摘除） | `{geojson,dom,tile}.removeLayer#1`（否则 `#2` 测的不是「已摘下」的实例） |
| DOM / GeoJSON 生命周期（内核顺序） | `*.mount.addLayer` + `*.mount.setData` + `*.hide.removeLayer` + `*.show.addLayer` |
| 两个「换新实例」对照 | `*.rebuild.setData` + `*.rebuild.addLayer` |
| DOM detached 清空 | `dom.removeLayer#1`（否则 `dom.detached` 根本不是 detached 状态） |
| GeoJSON detached clearData | `geojson.removeLayer#1` |

任一缺失 / 抛错 ⇒ 该结论落**第三态**并点名是哪一步。此外，**「没抛错」不等于「副作用发生了」**：DOM 生命周期那组还要一个**中间正证**
`kernel.hidden.connected === 0`——`removeLayer` 返回成功但节点没摘掉时，`shown > 0` 只能说明
「内容从来没消失过」，与「重挂能不能把内容带回来」无关，必须落第三态。（第八轮评审发现 1。）
「补一次 `data` 写入能不能救回来」那条实验**复用同一条正证**，并额外要求「修之前内容**确实还没回来**」
（`shown === 0`）：`shown > 0` 时这次 `setData` 就不是必需的，「修法可行 / 不可行」都失去意义。
⚠️ 同一个 `shown` 读数在两条里用法**不同、而且是有意的**：DOM 生命周期那条把它当**结论**
（`shown > 0` ⇒「内容自己回来了」），修法那条把它当**前提**。（第九轮评审发现。）

GeoJSON 一侧**没有**对应控件，而且不是遗漏：它的读数是 `getData()` 集合条数，本来就不受
`removeLayer` 影响（live 是 2 → **2** → 2 → 2），「覆盖物有没有从图上消失」没有公开手段可观测——
那一侧能用的正证控件只有 `mounted > 0`。同理，`GeoJSONLayer` 那条的判定要求
**消费 `geojson.clearData.已detached` 的 `threw`**（「抛错但已产生副作用」对内核策略是决定性的），
且 **`after === 0` 才算「完整清空」**——`after !== before` 太弱，2 → 1 只是部分清理。
（第六轮行内发现 2。）


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

**这里曾经有一条未取证前提，现在已被 live 取证解掉**：`unknown` 行里的那次 `remove` 是对一个
**可能已经不在图上**的图层调用的，而官方对「重复摘除是否安全」没有说明。因此第六 / 七轮把表述
收成「在前提 P 下收敛」。**issue #98 的探针实测：前提 P 成立**（GeoJSON / DOM / Tile 三个家族重复摘除
均未抛错，读数见决策 12b）⇒ 到今天为止可以按**成立的行为**陈述：

- 前提 P 成立（**实测**）⇒ 收敛到「恰好挂一份」；
- 前提 P 万一对某个 kind / 某个 SDK 版本不成立 ⇒ 退化仍然**有界且可观测**：收敛不会发生
  （状态停在 `unknown`、图层仍不在地图上），失败经 `resource:error` 交出，且**绝不会**因为
  「猜已经下去了」去 `add` 而出现两份。这条退化路径由悲观契约的用例继续钉住（§13）——
  它现在的身份是**防御性不变量**，不是一个我们在依赖的假设。

同一条不变量也约束**换实例**路径。会创建新实例的路径有**三条**：构造指纹变化（`layerRebuildKey`）、
重新可见（`needsRemountRebuild`）、已写入的槽位 / option 变回未表态（`detectRemovedState`）。
三条都必须过同一关，因此封装成**唯一入口** `replaceAfterDetached()`——分头调用正是「补了一条、
漏了另一条」的来源：

```text
replaceAfterDetached(state, ready)
  ├─ tryConvergeToDetached(state, context)
  │    ├─ 已 detached ⇒ 直接放行（不需要动 SDK，也就不需要先解绑）
  │    ├─ releaseListeners(state)        ← 先解绑本代业务监听（unbind -> sdk-remove）
  │    └─ unmount(state, context)        ← 可失败的 removeLayer；失败 ⇒ 中止
  └─ replace()                           ← 此处 dispose 内的摘除已是 no-op、scope 解绑已幂等
```

**顺序**（第四轮行内发现 1）：收敛那一次 `removeLayer` **必须先解绑业务监听**。常规两条销毁路径由
`LayerRecord.dispose()` 保证这条顺序（见 `useResourceTeardown.test.ts`），理由是 **SDK 可能在
`removeLayer` 期间同步派发事件**，那时业务回调已经开始拆解了。收敛**不能**走 `dispose()`——
`LayerRegistry` 会在那里把记录**永久删除**，之后组件卸载 / 重建 / Map 销毁三条永久销毁路径都不会
再重试摘除那个实例（正是上面要避免的「失去账本所有权」）。所以顺序由内核自己补上
（`releaseListeners()`，幂等）。

**代价（有意取舍，写在这里）**：收敛**失败**时监听已经解绑、而实例仍留在图上——它保持渲染但不再
响应业务事件（`@click` 一类），直到下一次 props 变化（届时重试收敛）或永久销毁。宁可让一个**待替换**
的实例暂时失去监听，也不在「业务监听还活着」时去调 `removeLayer`。失败经 `resource:error` 可观测。

为什么必须**先收敛**：`replace()` 释放旧实例最终经 `LayerRegistry.dispose()`，而 Registry 对摘除
失败的口径是「**吞掉异常 + 把记录永久删除**」（组件卸载 / Map 卸载必须继续走完，这个口径本身是对的）。
于是旧实例还在图上而直接换实例，会同时踩到两个坑：

1. 旧实例**失去账本所有权**——记录被删了，此后没有任何一侧还能重试摘除它；
2. 新实例照常 `addLayer` ⇒ 图上**同时两份**（`addLayer` 不去重）。

`tryConvergeToDetached()` 做一次**可失败**的 `unmount`：**只有确认收敛到 `detached` 才换**；
失败则不做任何会再加一份的动作，失败经 `resource:error` 交出、留到下一次 props 变化或永久销毁再试。

两个容易漏的前提条件，写在这里省得再犯：

- **不是只有 `unknown` 才危险**。`attached` 时这一次 `removeLayer` 本身就可能**在摘除前**失败
  （SDK 允许先产生副作用再抛错），所以三条路径**一律**先收敛，不能按「当前状态是 attached 就跳过」。
- **数据清空（`tearDownData`）落到摘除之后**：收敛那一步先把 `removeLayer` 做掉，于是 `replace()`
  内部 dispose 里那次摘除成为 no-op（`mountAttempted` 已复位），清空随之落到摘除**之后**，即走
  决策 12 的 **detached cleanup** 那条路（#98 实测：`clearData()` 在 `removeLayer` 之后仍有效、
  `DOMLayer` 的 `removeAllOverlays()` 是安全 no-op）。
  ⚠️ 这一条**只针对数据清空**：业务监听的解绑必须**先于**摘除，见上面的「顺序」段落。
  （第五轮修正：这一点上一轮写成「`visible=false` 这条常规路径也是摘除时 scope 还活着」——
  那个类比不成立：`visible=false` 只是临时摘挂、**不销毁资源**，而重建是销毁旧一代。）

§13 有三条回归用例钉住它：`unknown` 时连续两次 pre-detach 失败、**`attached` 时构造期 option 变化 +
摘除前失败**、以及「已写入槽位变回未表态 + 摘除前失败」——三条都断言 `attached` 绝不变成 2。
顺序那一条由 `useResourceTeardown.test.ts` 的「图层重建路径的卸载顺序」用例钉住
（构造期 option 变化 ⇒ `["unbind", "sdk-remove", "create:tile", "add-to-map"]`）。

（第五轮评审发现 2；第六轮评审发现 2 指出原先「确定性收敛」的表述过强；#98 取证之后前提成立；
第三轮评审发现 1 补上换实例路径的收敛前置；**第四轮评审发现 1** 指出当时只接在一条路径上，
遂收口成唯一入口；**第四轮行内发现 1** 指出收敛那次 `removeLayer` 把 `unbind -> sdk-remove`
的顺序反了，遂补 `releaseListeners()`。）

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
请求的身份，本库**不做逐请求归因**——「哪一次回调对应哪一次请求」是答不了的问题，需要逐请求计数请用
`onRequest` 的顺序）；`onError` **不带失败原因**（DOM 的 `error` 事件不提供原因）——可诊断的
是「哪个 URL 失败了、几次」，不是「为什么失败」。观察者回调抛错不影响加载（捕获 + `devWarn`）。

**归属（哪块元素的结果回调哪个观察者）用两本分开的账**，这是 #97 复审修掉的一处实例隔离缺陷：

| 账本 | 何时推进 | 回答 |
| --- | --- | --- |
| 监听登记（只增） | 首次给该元素挂 `load` / `error` 监听 | 「监听挂过没有」（避免重复挂 ⇒ 事件翻倍回调） |
| **归属**（`WeakMap`，可删） | 每次加载按**当前**包装器更新；**没有观察者时删除** | 「这块元素的结果该回调谁」 |

- 归属**不锁定首次注册者**：SDK 会复用元素（图层重建、观察者被换掉），锁死会让后来的拥有者收不到
  结果、而已经卸载的那一方还在被回调；
- 「没有观察者」要读成**没有归属**，不是「沿用上一个拥有者」：后来的包装器只给了官方
  `tileLoadFunction`（或观察者 prop 被置空）时，那块元素上迟到的事件仍会落到**前一个** wrapper 的
  观察者——很可能是别的图层或已卸载的组件。清空归属**只删归属表**，监听与「登记过」的记账都不动，
  所以后来的观察者仍能重新取得归属（否则「先接管、后观察」这条路径会永久静默）。

（复审发现；两条判别用例 + 一条「清空不得退化成停用」的用例钉住，`tileLoadObserver.test.ts`。）

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
13. **（已取证解除）`DOMLayer` 的 detached 清空**：本条原先记的是「官方没有说明
    `removeAllOverlays()` 是否要求图层仍在图上」。**issue #98 的 live 探针已给出读数**：
    `removeLayer` 自己就把节点从文档摘掉（`isConnected` 2 → 0、`getCustomOverlays()` 2 → 0），
    之后再调 `removeAllOverlays()` **未抛错**。因此这一问题不再开放——「有没有残留风险」的答案是
    **没有**（清的理由是「摘掉之前那一轮已经清过」，摘掉之后那一次只是安全的 no-op）。
    相应地：`clearScope` 三态能力面与「detached 时跳过清空」的判定**一并撤掉**（决策 12），
    替身补上了 `removeLayer` 摘节点这条渲染生命周期（否则用例会在与真实相反的方向上成立）。
    §13 的两条用例改成断言实测行为（`attachedAtClear === false` + 集合被清空 / 不残留）。
14. **（已取证解除）`map.removeLayer()` 对已经摘掉的图层是否安全**：**前提 P 成立**——
    实测 GeoJSON / DOM / Tile 三个家族重复摘除**均未抛错**（决策 12b 有读数表与覆盖范围说明）。
    因此「`unknown` ⇒ 先摘再挂 ⇒ 恰好挂一份」在真实 4.0 上是成立的行为，不再是「有条件的」。
    悲观契约（`FakeV4Map.failRemoveLayerWhenDetached`）与 §13 的那条用例**保留**，但身份变成
    **防御性不变量**：万一将来某个 kind / SDK 版本不成立，退化必须仍有界且可观测。
    （原先那句「拿到取证前不要写成已确定」随本条一起失效——现在**可以**写成已确定，
    但仍要写清覆盖范围：三个家族实测 + 其余 kind 按「同一个 `map.removeLayer` 入口」外推。）


15. **`tileLoadObserver` 与「组件已卸载」之间的迟到事件**（#97 复审时 reviewer 明确同意**不列为**
    该 PR 的阻塞项）：结果监听挂在**图片元素**上（元素由 SDK 持有，不是本库的资源），所以某个
    `load` / `error` 在组件卸载**之后**才到达时，仍会回调最后持有归属的那个观察者。本库的处置是
    「**没有归属就不回调**」+「归属随加载转移」，但**不承诺**「卸载之后不再有任何回调」——
    要承诺那件事需要一条**显式 teardown**（卸载时主动清掉归属 / 摘掉监听），那会改变「元素的
    生命周期归 SDK」这条边界，属于单独的决策，不在本 issue 范围。调用方若在卸载后仍需安全
    （例如回调里写 store），请自行在那侧加「已卸载」守卫。

## 参考

- issue #40（`M7-LAYERS`）与总追踪 #12。
- `@baidumap/jsapi-v4-types@4.0.4` 的 `layer/*.d.ts`（逐成员核对的原始依据）。
- 官方参考实现 `huiyan-fe/react-bmap`（`src/components/Layer/**`、`src/utils/createComponent.tsx`、
  `src/drivers/v4Driver.ts`）：接口面与「哪些差异是有意的」的对照来源。
- issue **#98**（detached 图层的运行时契约取证）与探针
  `scripts/probe-layer-detached.mts`（复现：`BAIDU_MAP_AK=<ak> pnpm probe:layer-detached`）——
  决策 12 / 12b 与已知限制 13 / 14 的读数来源。
- ADR `2026-09-11-jsapi-v4-control-layer-facets`（#22：Control / Layer facet 基础）、
  `2026-09-12-jsapi-v4-service-panorama-native-layers`（#23：Native Layer 与本模块的分工）、
  `2026-09-14-map-handle-container-and-visibility`（#29：KeepAlive dispose 路径）。
