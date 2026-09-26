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
| `opacity`（**图层级**透明度） | `:131` @default 1 | `setOpacity` **有**（实测） | ⚠️ `PolygonLayer` 的选项表**没有** `opacity`，而它同样有 `setOpacity` 方法。声明的「显示属性」一组里两族都**没有** `setOpacity`，但运行时**都**有 ⇒ 登记依据是**运行时实测**，与同族其它成员不同（见下） |
| `strokeOpacity`（线透明度） | `:39` @default 1 | — | 走 `setOptions` 整袋；与 `opacity` **相乘** |
| `dashArray` / `strokeStyle` / `strokeTexture*` / `strokeLineJoin` / `strokeLineCap` | `:47`–`:92` | — | 全部走 `setOptions` 整袋 |

## 三、`setOpacity` 是本次唯一的「运行时依据」登记项

两族的 `setOpacity` 都是**声明里没有、运行时有**（`protoHas` 为 `true`）。
仓库的口径是「不把**未声明**成员当契约」——但那条口径的对象是**官方没有承诺**的成员；
这里官方运行时**确实提供了**方法，且 `ClusterLayer` / `Heatmap` / `TrackLine` 早在 #165
Class 3 就按 4.0.5 声明登记了 `setOpacity`（它们的声明**有**）。本库对「声明与运行时不一致」
的一贯处置是**两边都记下**并在注释里写清依据，本项按「运行时实测在位」登记，同时在
`native-layers.test.ts` 的 `OPERATION_MEMBERS_BY_KIND` 显式覆写（否则默认表会拿
`layer/` 家族的 `setStyleOptions` 去断言它）。

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
| `setVisible` / `setOpacity` / `setZIndex` | 有 | **不**重复 expose |
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
