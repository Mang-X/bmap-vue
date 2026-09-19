---
"baidu-map-gl-vue": minor
---

新增四个原生批量可视化图层、要素状态命令面与统一的拾取载荷（M6 / #36）。

**新组件**（JSAPI 4.0 原生图层）：

- `BLineLayer` / `BFillLayer`：官方 `LineLayer` / `FillLayer`（4.0.4 有完整声明）。强类型 `style`
  （逐字段对应官方 `LineStyle` / `FillLayerStyle`），`data` 走 `setData` **不重建**，`style` 走
  `setStyleOptions + doOnceDraw` **不重建**，`visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom`
  走字段级 setter，构造期项（`idKey` / `crs` / `enablePicked` / 拾取矩形 / `autoSelect` /
  `selectedColor`）变化才换实例；
- `BHeatmapLayer`：官方扩展 API `Heatmap`（无类声明）。只声明驱动已登记的入口（`data` / `style` /
  `visible`）——`style` 是原样透传的键值袋，因为**没有可核对的声明**可用来做字段级强类型；
- `BTrackLineLayer`：官方扩展 API `TrackLine` 的**基线**（只有 `data` / `visible`）。播放控制与页面
  可见性联动**未实现**（需先取证，见下）。

**要素状态命令面**（`update` / `remove` / `clear` / `replace` / `get`）：通过组件 `ref` 的
`featureState` 使用，与官方 `updateState` / `removeState` / `clearState` / `replaceAllState` /
`getAllState` 一一对应。身份口径是**业务 id**（`idKey` 字段的值）：非法 id 在任何 SDK 调用之前失败；
`get()` 走 SDK 的公开读回；未就绪时命令不排队（告警一次并跳过）。`BPointCollection` 也通过同一个
命令面暴露（它同时迁移到了新的共享内核）。

**拾取载荷**（`BMapPointPick`，`BLineLayer` / `BFillLayer` / `BPointCollection` 共用）新增 `id`
字段，并把三个字段的语义写死：`hit` = 官方是否命中（未命中也派发事件）、`id` = 业务身份
（认不出**如实为 `null`**，不猜官方默认 `idKey`）、`item` = 命中的业务项（未命中为 `null`）。
`BMapFeaturePick` 是线 / 面图层的载荷别名（业务项就是要素的 `properties`）。

**驱动层**：`NativeLayerDriver` 增加 `replaceState` / `getState` 两个归一化操作（官方四类专页图层
的声明成员），扩展 API 的四种 kind 仍然显式失败（`BMAP_CAPABILITY_UNSUPPORTED`）。

**`data` 的三个取值承担三件事**：有对象 ⇒ `setData()`（不重建）；**`null` ⇒ 没有数据**（这一族
没有公开的清空入口，因此**换一个没有数据的实例**，`BHeatmapLayer` / `BTrackLineLayer` 同样）；
**`undefined` ⇒ 不表态**（不产生任何 SDK 调用）。卸载只有「解绑监听 → `removeLayer`」两步，
**不调用** `clearData`——官方专页四类的公开方法里没有它（上游声明与仓库内官方参考都是 `setData` /
`getData`）。

**要素状态要求声明可用的 `idKey`**：没有声明（或声明为空字符串）时五个命令一律拒绝并告警一次
（不让「按 id 定位」悄悄落回 SDK 的默认身份，与拾取如实返回 `id: null` 是同一条口径）。
「已声明身份」的判定只有一处（非空字符串才算），构造期选项 / 命令前置 / 拾取读取三处共用。

**不表态的数据会跨实例继承**：`data: undefined` 在换实例时（构造期项变化、扩展 API 图层的
「隐藏 → 显示」）会把上一代成功送出的数据补齐到新实例——否则一个与 `data` 无关的变化会让画面上的
数据凭空消失，且拾取兜底账本会与真实实例分叉。

**未包含（登记为欠账，见 ADR `2026-09-19-native-data-layer-components`）**：`BMVTLayer` 基线
（缺口在「怎么把它挂上地图」的机制，不在声明）；TrackLine 播放控制与页面可见性联动（官方类型包没有
该类声明，方法名必须先由真实运行时探针取证）。`BGeoJSONLayer` 基线已于 #40 落地，本 PR 不重复实现。
