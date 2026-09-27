---
"bmap-vue": patch
---

补齐 #165 第三批：`<Marker>` / `<Label>` / `<MarkerCluster>` 官方已声明而本库未暴露的选项

## 补了哪些（逐条的分类依据在 `tests/behavior/marker-label-cluster-options.test.ts` 的文件头表）

**`<Marker>`** —— 官方 `MarkerOptions` 的 **16 个键至此全部**有了出口：

| 键 | 分类 | 依据 |
| --- | --- | --- |
| `label` | **就地更新**（`setLabel`） | 官方 `overlay/Marker.d.ts:110` / `:115` 声明成对的 `setLabel` / `getLabel`；live 读数（settle 之后）确认二者在原型链 layer 1、真调不抛、`getLabel().getContent()` 读回改后的文案 |
| `autoFollowHeadingChanged` | **构造期** | `Marker.d.ts` 成员表无对应 setter；live：整条原型链 layer = **-1** |
| `startAnimation` | **构造期** | 同上（官方也未声明任何候选动画名，因此收普通 `string` 而非枚举） |

`label` 收的是**本库领域形状** `{ content, position?, offset?, style? }` 而不是官方那个 raw
`BMap.Label`——组件面不构造 SDK 对象，Driver 在边界内造出来再 `setLabel`；从属 Label 随 Marker
一起释放，不另建 Registry 记账。

**`<Label>`** —— 官方 `LabelOptions` 7 个键至此全部：

| 键 | 分类 | 依据 |
| --- | --- | --- |
| `anchor` | **就地更新**（`setAnchor`） | 此前**描述符里早有** `mutateBy("setAnchor")` 却**组件面从不暴露** ⇒ 那条更新路径一次都没被触发过（同一类洞的第二个实例）。live 读数判它**可观察地生效**：同一经纬度上默认 / `anchor:8` / `anchor:2` 三个 Label 的 DOM 分别是 `(top 90, left 263)` / `(69, 217)` / `(69, 263)`，对第二个调 `setAnchor(0)` 之后移回 `(90, 263)` |
| `width` | **构造期** | 官方 `Label.d.ts` **没有** `setWidth` / `getWidth`；live：settle 之后整条原型链 layer = -1、真调抛 `setWidth is not a function`。构造期确实生效（不给 = DOM `14px` 自适应，给 `77` = `77px`） |

`anchor` 收**官方常量名**（`BMAP_ANCHOR_*` 九选一），换算复用控件那一族的**同一张**
`ANCHOR_VALUES`（`driver/jsapi-v4/controls.ts` 导出、`overlays.ts` 消费）——两张表一旦漂移，
同一个锚点名会在 `<ZoomControl>` 与 `<Label>` 上落到不同的角。

**`<MarkerCluster>`（`engine: "native"`）** —— 官方 `ClusterLayerOptions` 此前遗漏的六个
聚合 / 交互选项：`tileSize` / `fitViewMargin` / `updateRealTime` / `waitTime` / `clusterIcon` /
`clusterIconSize`。此前**没有**书面理由被省略，而同族的另外六个就在同一个 props 接口里。

六个**全部是构造期**：判据是「官方**没有**公开的**逐字段**更新入口」——官方 `ClusterLayer` 上
没有 `setZoomRange` / `setMinZoom` / `setMaxZoom`（live：整条原型链 layer = -1），而
`setOptions` 是**整袋**入口、且本库的 `setStyle` **也**落到它，两条通道共用一个成员 ⇒ 认成
「可就地更新」会让聚合参数与样式互相踩。这与本票已落地的 21 个图形族构造期选项同一口径。
live 读数确认这些键**本身有效**（同样 `clusterRadius: 300`、只把 `tileSize` 从 256 改到 1024，
三团近点的簇数从 1 变 2），只是没有逐字段入口。

## 刻意**不加**的（各带理由，且都有门禁）

- `ClusterLayerOptions.minZoom` / `maxZoom`：官方**确实**声明了它们，但官方 `ClusterLayer` 上
  **没有**对应的更新入口 ⇒ 收下就是「改 prop 悄悄不生效」。与 `<PointLayer>` /
  `<HeatmapLayer>` 早已有的同一裁决一致。
- 拾取面（`enablePicked` / `mouseStyleChange` / `pickTolerance`）：`enablePicked: true` 的硬编码
  **仍然成立**——官方默认本就是 `true`，Driver 也确实登记了 `setEnablePicked`（live：原型链
  layer 0），但本库**没有**「关掉拾取」的消费者，而关掉等于 `cluster-click` 永远不触发
  （自断交互不是能力）。按 #104「没有消费者的扩展面一律不加」否决。

## `<HeatmapLayer>` 的窄口径维持不变，但理由已更正

此前记录的理由是「官方扩展 API 只公开整袋 `setOptions`，**且没有可核对的声明**」。4.0.5 已经
**补上了类声明**，那半句已失效。重新核过（live，2026-09-27）后的理由更准：官方 `Heatmap` 的
成员表只为这六个键里的**两个**声明了字段级 setter——`setGradient(gradient)` 与
**`setRadius(radius)`**（setter 名是 `setRadius` 而构造键名是 `size`，按名字推导的通道会打空）；
其余五个在运行时原型链上**任何一层都没有**。而 `style` 这个整袋口**已经能到达全部六个**，
再开六个逐项 prop 等于给同一个值开两条通道。**结论不变**（仍只暴露 `data` / `style` / `visible`），
理由已写进文档与描述符注释。

## 公共类型面

新增三个公共类型（ADR `2026-09-25-public-export-surface-freeze` 的**第一条**处置：升为公共导出，
因为它们出现在已导出签名里、消费方因此无法命名）：`MarkerLabelSpec` / `OverlayAnchor` /
`ClusterPointIconSource`。`etc/**` 三类基线的漂移由维护者在 `pnpm generate:api` 时一并提交。
