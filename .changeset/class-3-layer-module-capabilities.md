---
"@mangax/bmap-vue": minor
---

#165 Class 3（图层模块）：补齐 4.0.5 已声明、但本库尚未登记 / 暴露的成员

`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 在 `@baidumap/jsapi-v4-types@4.0.4`
**没有**类声明，因此本库此前按「不把未声明成员当契约」只凭 live 取证放开了 `PointLayer` /
`ClusterLayer` 的 `setVisible`。4.0.5（git `5ba67f4`）给 `visualization/` 补上了类声明，那个前提
已经失效。范围**只限本库已封装的图层能力**——`visualization/` 下另外 9 个全新类是产品特性，
归 #166，本票一条都没做。

## 驱动面：四个 kind 的显示属性按声明登记

| kind | 新登记的归一化操作 | 官方声明行（`visualization/*.d.ts`） |
| --- | --- | --- |
| `point` | `setVisible` `setZIndex` | `PointLayer.d.ts:324` / `:328` |
| `cluster` | `setVisible` `setOpacity` `setZIndex` | `ClusterLayer.d.ts:260` / `:264` / `:268` |
| `heatmap` | `setVisible` `setOpacity` `setZIndex` | `Heatmap.d.ts:153` / `:157` / `:161` |
| `track-line` | `setVisible` `setOpacity` `setZIndex` + `clearData` | `TrackLine.d.ts:457` / `:461` / `:465` / `:358` |

`PointLayer` **没有** `setOpacity`（三个兄弟都有）——不登记。`clearData` 此前被「这一族没有清空
入口」的旧结论连坐，4.0.5 的声明四个类**都有**它，因此按声明补回（组件侧仍不调用它：
`data: null` 走换实例，与其它 kind 同一口径）。

仍然**不**登记的：状态 API、缩放范围（`minZoom` / `maxZoom` 是构造选项而非字段级 setter）、
`setRenderStage` / `setRefCenter`（声明里有，但当前没有组件消费者——#104 的口径是没有消费者的
扩展面不加）。

## 行为后果（不是文档问题）

`HeatmapLayer.visible` / `TrackLineLayer.visible` 此前走摘挂，**重新显示会换实例**
（依据是 #98 的 live 实测：`removeLayer` 之后的实例再也渲染不了）。4.0.5 声明了 `setVisible`，
显隐因此统一走 setter，**重新显示不再换实例**：

- `HeatmapLayer`：隐藏往返不再重建，数据自然不需要「重新下发」；
- `TrackLineLayer`：这是行为回归——**换实例会把播放进度与播放状态一起丢掉**，
  「播放到一半切后台再回来」原本会从头播。现在 `observed` 的播放位置扛得过隐藏往返。

## 门禁：操作面 ↔ 官方声明的检查扩到这四个类

`native-layers.test.ts` 的 `DECLARED_CTORS` 此前只列 `layer/` 下那四类，注释写「扩展 API 没有
声明」——4.0.5 已使该前提失效。现在四个 `visualization/` 类也进这条检查（逐条映射归一化操作到
声明里的成员）。它当场暴露了两处真实漂移并已修掉：

1. `setStyle` 落点**逐 kind 不同**：`layer/` 四类声明 `setStyleOptions` + `doOnceDraw`，
   `visualization/` 四类声明 `setOptions` 且**没有** `doOnceDraw`。原先一张表写死会在其中一族上
   断言一个它没有的成员。
2. `clearData` 的「这一族没有」结论此前被错误地扩到了 `visualization/` 四类（它们声明里有）。

## 构造期选项（TASK 2）

| 组件 | 新增 | 官方声明 |
| --- | --- | --- |
| `LineLayer` / `FillLayer` | `selectedIndex`、`popEvent` | `layer/LineLayer.d.ts:25`/`:70`、`FillLayer.d.ts:30`/`:75` |
| `DistrictLayer` | `onComplete` | `layer/DistrictLayer.d.ts:180` |
| `PointIconLayer` | `iconObj`、`visibility`、`sizes`、`userSizes`、逐要素 `featureOpacity` | `layer/PointIconLayer.d.ts:101`/`:105`/`:108`/`:117`/`:127`（官方 `PointIconStyle` 由 7 个补齐到 12 个） |
| `PointLayer` | `iconSize`、`mouseStyleChange`、`pickTolerance`、`pickThrough`、`referCenter`、`renderStage` | `visualization/PointLayer.d.ts:135`/`:153`/`:158`/`:163`/`:191`/`:196` |

`selectedColor` 此前是**半接线**的——官方用 `selectedIndex` 定「哪一条被选中」、用
`selectedColor` 定「选中长什么样」，此前只暴露了后者。`pickTolerance` / `pickThrough` 是
`PointLayer` 真正的拾取调优入口（官方没给它 `pickWidth` / `pickHeight`）。

`referCenter` 官方类型是 `BMap.Point`；组件收全库统一的纯数据 `{ lng, lat }`，由 **Driver 边界**
换算（组件层不构造 SDK 构造器）。

⚠️ 新增的布尔 prop 全部显式写 `undefined` 默认值：官方默认是 `true` 的那些
（`popEvent` / `userSizes` / `visibility` / `mouseStyleChange`）若落到 Vue 的「缺省即 `false`」
转换上，会对每个不传它的用户静默偏离上游默认。
