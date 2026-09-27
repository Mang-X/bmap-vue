# #166 对齐审计：官方 4.0.5 `visualization/PolygonLayer` / `PolylineLayer`

> 本页是 #166 落地前的**成员级对齐审计**（issue 要求「先做对齐审计」）。
> 每一行都能追到 `visualization/<X>.d.ts` 的行号；带「实测」的还能追到 live 探针的读数。
> 读数来源：`scripts/probe-runtime-members.mts`（#166 新增 case 3b / 3c / 3d），
> 真实 `https://api.map.baidu.com/api?v=4.0`，SDK `version: "gl"`，2026-09-27。

## 一、结论摘要

| 判据 | `PolygonLayer` | `PolylineLayer` |
| --- | --- | --- |
| 官方类声明 | 有（`visualization/PolygonLayer.d.ts:125`，247 行） | 有（`visualization/PolylineLayer.d.ts:162`，280 行） |
| 构造器**在 `BMap.Map` 可用的那一刻**已在位 | **是**（`injectionTiming.PolygonLayerAtMapReady === "function"`） | **是** |
| `Map#addLayer` / `removeLayer` 真接受 | **实测接受**（挂上 → `setZIndex(3)` 不抛 → 读回 `3` → 重复 `removeLayer` 不抛） | 同左 |
| 声明里有、**运行时没有**的成员 | `hitTest` | `hitTest` |
| 样式入口 | `setOptions`（`:181`），**没有** `setStyleOptions` / `doOnceDraw` | `setOptions`（`:213`），同 |
| `setOpacity`（图层级） | 运行时在位但**像素读数证明不生效** ⇒ **不登记**（选项表亦无 `opacity`） | 声明 `:131` + `setOptions` 转发 `:209` + 像素**生效** ⇒ **登记**（豁免表） |
| 与已封装的旧类 | 弃用 `FillLayer` 的**官方指定替代** | 弃用 `LineLayer` 的**官方指定替代** |

⚠️ **注入时机与扩展 API 那四类不同**：`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`
在官方口径里是「首次加载时可视化实现异步注入」（`native-layers.ts` 的
`RUNTIME_INJECTED_LAYER_CTORS` 登记它们，`ctorFor` 走 `requireRuntimeCtor`）。而实测
**`PolygonLayer` / `PolylineLayer` 在 `BMap.Map` 刚就绪时就已经是 `function`** ⇒ 它们随主包注入，
**不登记进 `RUNTIME_INJECTED_LAYER_CTORS`**，`ctorFor` 走 `namespaceCtor`。
这条是三个独立判断里的第三个（另两个是 `declared` / `styleMember`），不得凭同族类推。

## 二、逐成员核对（`PolygonLayer`；`PolylineLayer` 括号内为行号，差异逐条单列）

| 成员 | 声明 | 实测运行时 | 本库处置 |
| --- | --- | --- | --- |
| `constructor(options?)` | `:154` | 构造成功 | **对齐**（`create()`） |
| `setData(geojson)` | `:164` | 有 | **对齐**（`setData`） |
| `getData()` | `:169` | 有，`typeof === "object"` | **不投影**：无消费者（#104「没有消费者的扩展面一律不加」）；官方四条 `getX` 同样不投影 |
| `clearData()` | `:174` | 有 | **登记在 Driver，但组件不调用**（与 `TrackLineLayer` 同一口径，见下） |
| `setOptions(options)` | `:181` | 有 | **对齐**（`setStyle` 落到它，Driver 逐 kind 决定） |
| `getOptions()` | `:186` | 有 | **不投影**（同上） |
| `setEnablePicked(enable)` | `:192` | 有 | **对齐**（`setEnablePicked` 落到它） |
| `getEnablePicked()` | `:194` | 有 | **不投影** |
| `hitTest(x, y)` | `:201` | ⚠️ **无**（`protoHas` 为 `false`） | **不登记**（声明有、运行时没有 ⇒ 放开门面就是假支持，与 `Heatmap` 的 `setGradient` / `setRadius` 同一处置） |
| `setVisible(visible)` | `:204` | 有 | **对齐**（`setVisible`） |
| `getVisible()` | `:206` | 有 | **不投影** |
| `setZIndex(zIndex)` | `:208` | 有 | **对齐**（`setZIndex`） |
| `getZIndex()` | `:210` | 有 | **不投影** |
| `setRenderStage(stage)` | `:212` | 有 | **不投影**：无组件消费者（`point` / `cluster` / `heatmap` / `track-line` 四类同样关闭，口径一致） |
| `getRenderStage()` | `:214` | 有 | **不投影** |
| `setRefCenter(center)` | `:216` | 有 | **不投影**（同上） |
| `getRefCenter()` | `:218` | 有 | **不投影** |
| `addEventListener` / `removeEventListener` | `:226` / `:233` | 有 | **对齐**（经 `driver.events.on(handle, …)`；六个事件名见下） |
| `setStyle` / `setStyleOptions` / `setBaseOptions` | **无** | **无** | `styleMember: "setOptions"`（`layer/` 家族才有的三个不得跨族断言） |
| `setMinZoom` / `setMaxZoom` | **无** | **无** | `minZoom` / `maxZoom` 是**构造选项**（`:108` / `:112`），无字段级 setter ⇒ 不登记 `setZoomRange` |

### `PolylineLayer` 的差异（其余与上表同构）

| 成员 / 选项 | 声明 | 实测 | 说明 |
| --- | --- | --- | --- |
| `hitTest` | `:233` | ⚠️ **无** | 同 `PolygonLayer` |
| `opacity`（**图层级**透明度） | `:131` @default 1，且 `setOptions`（`:209`）文档明写转发给对应 setter ⇒ **契约成员** | `setOpacity` **有**（实测）且**像素读数证明生效** ⇒ **登记** | ⚠️ `PolygonLayer` 的选项表**没有** `opacity`，它同样有 `setOpacity` 方法但**不生效** ⇒ **不登记**。两族**同族不同面**，见 §三 |
| `strokeOpacity`（线透明度） | `:39` @default 1 | — | 走 `setOptions` 整袋；与 `opacity` **相乘** |
| `dashArray` / `strokeStyle` / `strokeTexture*` / `strokeLineJoin` / `strokeLineCap` | `:47`–`:92` | — | 全部走 `setOptions` 整袋 |

## 三、`setOpacity`：❌ 本节原有结论已被第三轮推翻（登记依据是「生效」，不是「在位」）

> **本节原文（保留）**：「两族的 `setOpacity` 都是**声明里没有、运行时有**（`protoHas` 为
> `true`）……本项按『运行时实测在位』登记。」——**「登记依据是在位」这一句是错的**，
> 它只对 `PolylineLayer` 碰巧成立，对 `PolygonLayer` 直接导致错误的登记。

**声明侧复核**（重克隆 `github.com/baidu-maps/jsapi-v4-types`，`main` 分支，
HEAD `5ba67f4dda11b0a4b54fc631278d3e39e11667c3` = "update 4.0.5"，2026-09-24；
**逐文件读完**而非 grep 到名字就下结论）：

| 文件 | `setOpacity` | `getOpacity` | 选项表有 `opacity`？ |
| --- | --- | --- | --- |
| `visualization/PolygonLayer.d.ts` | **0 命中** | **0 命中** | **没有**（19 个字段逐条读过） |
| `visualization/PolylineLayer.d.ts` | **0 命中** | **0 命中** | **有**：`:131` @default 1 |
| `visualization/TextLayer.d.ts` | `:296` | `:298` | 有（`:179`） |

⇒ 「两族都未声明 `setOpacity`」**是真的**，但**它解释不了处置的不对称**。真正的根因在
`PolylineLayer.d.ts:209` 的 `setOptions` 文档：明写 `opacity` / `visible` / `zIndex` /
`renderStage` / `referCenter` / `enablePicked` **转发到对应 setter** ⇒ `opacity` 是**契约成员**；
`PolygonLayer` 对 `opacity` **零命中**，连声明的入口都没有。

**运行时侧**：`getOpacity` 与 `setOpacity` **同时**在位 ⇒ 「调用成功」与「画面变了」可分。
`getOpacity` 读得回**零信息量**（setter 与 getter 共用同一份状态）。判据只能是像素：
`preserveDrawingBuffer: true` + `readPixels` 数哨兵色像素。

| 类 | `setOpacity` 序列 | 判定 |
| --- | --- | --- |
| `PolygonLayer` | 五态（`1→0→1` / `setOptions` / 构造期）**全部同值** | **present-but-ineffective** ⇒ **不登记** |
| `PolylineLayer` | 4229 → **0** → 4229 → **0** → 4229 | **可观测地生效** ⇒ **登记**（运行时豁免表） |

同批读数里的**阳性/阴性对照**证明测量通道是活的（面族同一次运行：`setVisible(false)` → 0、
`setOptions({fillOpacity: 0})` → 0、复原 → 148243、换色到画布不可能存在的品红 → 0），
所以面族那组同值**不是**「量不出来」。

**⇒ 修正后的口径**：判据是「**可观测地生效**」，既不是「成员在不在」，也不是「声明有没有写」。
本票三处「声明 / 运行时不一致」各占一个方向，**不可互相照抄**：

| 形状 | 例子 | 处置 |
| --- | --- | --- |
| 声明有、运行时**无** | 两族的 `hitTest` | 不登记（假支持） |
| 运行时在、**不生效** | `PolygonLayer#setOpacity` | 不登记（比假支持更难排查） |
| 声明无、运行时在、**生效** | `PolylineLayer#setOpacity` | 登记（`RUNTIME_ONLY_REGISTERED` 豁免） |
| （本票之外）声明有、未 settle 时读成不在 | `Marker#setAnchor` | 判「在位」必须 **settle 之后**取样 |

**残留代价**（本轮未裁决，是**范围选择**不是缺陷）：`PolylineLayer` 现在 Driver 登记了
`setOpacity` 却**没有组件消费者**——与 #104「没有消费者的扩展面一律不加」存在张力。
是否给 `<PolylineLayer>` 开 `opacity` prop 留给后续。两组件**都未暴露**该 prop，
所以组件行为未变，只有**理由**换了。

逐条读数与踩坑见
[`165-runtime-audit-2026-09-27`](./165-runtime-audit-2026-09-27)「第三轮」。

## 四、`clearData` 的口径：登记但组件不调用

`PolygonLayer.d.ts:174` / `PolylineLayer.d.ts:206` 都**明确**声明了 `clearData()`
（注释还写明「清空数据与 GPU 缓冲」，面图层注明「含内部描边」）。因此 Driver 侧的
声明一致性门禁要求登记它（`native-layers.test.ts` 的「visualization 四类：官方声明了
`clearData`，登记面因此保留它」那条会覆盖到新 kind）。

组件**仍不调用**：与 `TrackLineLayer` 同一口径——同一个 `data: null` prop 在不同 kind 上
换语义（有的调 `clearData`、有的换实例）是使用者最难预期的一类差异。`data: null`
统一走「换一个没有数据的实例」。`clearData` 登记着是为了**声明一致性**与给下游
`session()` 命令面留入口，不是为了让组件用它。

## 五、事件面

两族都声明 `PolygonLayerEventMap` / `PolylineLayerEventMap`（`:239` / `:271`），
六个事件：`click` / `dblclick` / `rightclick` / `mousemove` / `mouseover` / `mouseout`。
载荷是 `VisualPickEvent<Layer, Item>`（`visualization/common.d.ts:18`）——
`value` 是 `PolygonLayerItem` / `PolylineLayerItem`（**有声明的具名形状**：含
`properties` / `feature` / `id` / `index` / 几何缓存），与四类专页图层
`value: object | null | undefined` 的模糊形状不同。

⚠️ 但 `VisualPickEvent` **没有** `latLng`，只有 `point`；而本库
`readNativeLayerPick` 的退化路径读 `raw.latLng`（`nativeLayerPick.ts:62`）。
`point` 那条已经在主路径（Driver 归一化后的 `point`），因此**不影响**——
但这一点记在案上，避免后来者以为两族载荷完全同构。

本组件**先只派发四个**（`click` / `dblclick` / `rightclick` / `mousemove`，与
`NATIVE_LAYER_PICK_EVENTS` 同一白名单）；`mouseover` / `mouseout` 属于**成对**的
进入 / 离开语义，与本库现有四个组件的领域事件面不同构，且没有消费者 ⇒ **登记为缺口**，
不假支持（见 §七）。

## 六、`defineExpose` 的规则（本票采用）

**规则**（记在 `native-layers.ts` 与组件文件头）：

> 官方有**同名的公开方法**，且该语义**不是某个已暴露 prop 的受控写入** ⇒ 必须可从 ref 到达。
> 反之，若组件已经用 prop 表达了同一语义的**受控**通道，则**不**再复制一份命令面。

逐条套到两族：

| 官方方法 | 组件里有没有对应 prop | 结论 |
| --- | --- | --- |
| `setData(geojson)` | 有（`data` prop，受控） | **不**重复 expose |
| `clearData()` | 无（`data: null` 换实例） | **不** expose（理由见 §四） |
| `setOptions(options)` | 有（`style` prop，受控） | **不**重复 expose |
| `getOptions()` / `getData()` / `getEnablePicked()` / `getVisible()` / `getZIndex()` / `getRenderStage()` / `getRefCenter()` | — | **不** expose：全部是**读回**，无消费者（#104） |
| `setVisible` / `setZIndex` | 有 | **不**重复 expose |
| `setOpacity` | 无（两族都不暴露 `opacity` prop） | **不** expose；⚠️ 理由**按族不同**：`PolylineLayer` 是**范围决策**（已登记但暂无组件消费者），`PolygonLayer` 是**选项表里根本没有** `opacity`。见 §三 |
| `hitTest(x, y)` | — | **不** expose：运行时没有（§二） |
| 要素状态五件套（`updateState` / …） | `featureState`（`LineLayer` / `FillLayer` / `PointCollection` 已有） | **不** expose：两族**没有**状态 API（声明里没有） |

⇒ **两个组件的 `defineExpose` 只有 `featureState`**（与 `FillLayer` / `LineLayer` 同一形状）。
它此时**恒为空壳**（`featureState` 需要 `identity` 才不拒绝，而 `idKey` 声明存在），
所以本票**不** expose 它——理由写进组件注释，避免留一个「每次调用都拒绝命令」的空壳面
（与 `HeatmapLayer` 的注释同一口径）。

## 七、本票明确不做的事

1. **`hitTest` 不开面**（运行时没有）。
2. **`setRenderStage` / `setRefCenter` 不开面**（无消费者；四个兄弟 kind 同样关闭）。
3. **七条 `getX` 读回不开面**（无消费者）。
4. **`mouseover` / `mouseout` 不派发**（成对语义、与现有四组件的领域面不同构、无消费者）。
5. **缩放范围**（`minZoom` / `maxZoom`）**只作构造选项**，不投影成 prop、不登记
   `setZoomRange`（官方无字段级 setter）。
6. **不删除** `<FillLayer>` / `<LineLayer>`：弃用是上游的事，#165 §3.6 禁止 compat shim；
   本票只是让「官方建议的替代品」**真的存在**。
7. ⚠️ **两族都不暴露 `opacity` prop**——但这**不是** §三 早期那条「未声明所以不开面」的
   结论（那条已被推翻）。`PolygonLayer` 因选项表无此项而**不可能**有；`PolylineLayer` 是
   **范围决策**（Driver 已登记、暂无组件消费者），留给后续裁决。
