---
"bmap-vue": minor
---

#166：封装官方 4.0.5 `visualization/` 的 `PolygonLayer` / `PolylineLayer`

官方 4.0.5 在 `visualization/` 命名空间新增了 13 个类，并**同时**把本库已封装的
`FillLayer` / `LineLayer` 标为 `@deprecated`、指名这两个类为替代品。本票落地其中
**与本库现有数据组件重合度最高的两个**（按 #166 §2 的范围裁决：
`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 已由 #165 覆盖）。

## 新增

- `<PolygonLayer>`：批量面图层。几何支持 `Polygon` / `MultiPolygon`（含洞），
  纯色填充与整张图平铺填充两套（`PolygonLayerStyle`）。
- `<PolylineLayer>`：批量折线图层。几何支持 `LineString` / `MultiLineString`，
  实线 / 虚线 / 纹理贴图三种渲染模式（`PolylineLayerStyle`）。
- 新增 `NativeLayerKind` 的 `polygon` / `polyline`；新增能力槽位 `layer.polygon` /
  `layer.polyline`（`status: "experimental"`、`runtimeOnly: false`）。
- 新增公共类型：`PolygonLayerProps` / `PolygonLayerStyle` / `PolylineLayerProps` /
  `PolylineLayerStyle` / `VisualizationStyleValue` / `VisualizationLayerCommonProps` /
  `VisualizationPickOptions` / `VisualizationZoomCtorOptions`。

两者复用既有的 `NativeLayerDriver` + `useNativeLayerResource`，**不新建第二套图层注册体系**
（`data` 三态、样式袋投影、字段级 setter、构造期换实例、拾取事件、释放路径全部与
`LineLayer` / `FillLayer` / `HeatmapLayer` / `TrackLineLayer` 同一份内核）。

## 与弃用替代的关系（重要）

`<LineLayer>` / `<FillLayer>` **继续可用、行为不变**——官方只标了弃用没有删除，而 1.0 是
clean-slate，#165 §3.6 禁止 compat shim，因此**不**加指向新名字的别名垫片。

⚠️ **迁移不是改名**：两族的 `style` 字段族不同（`patternUrl` / `borderWeight` 一族 vs
`fillTextureUrl` / `strokeTextureUrl` 一族），样式更新的重绘行为也不同（`setStyleOptions` 需要
跟着调 `doOnceDraw` 才可见；`setOptions` 本身即生效），且 `PolygonLayer` 的 `strokeWeight` 默认 `0`
（**不描边**）而 `FillLayer.border` 默认 `true`。旧组件的开发期告警文案与 `@deprecated`
JSDoc 已同步更新为「替代品已提供 + 迁移口径」。

## 逐成员依据

完整的成员级核对（每条带 `visualization/<X>.d.ts` 行号 + live 读数）见
`docs/zh-CN/contributing/166-visualization-alignment-audit.md`。三条值得单独说的：

- **`hitTest` 不开面**：官方**声明**了，**live 实测运行时没有**（`prototype.hitTest` 为 `false`）。
  放开门面就是假支持。
- **`setOpacity` 按「可观测地生效」逐族裁决**（复审后更正，**不是**「按是否声明」）：
  `PolylineLayer` **登记**（像素读数：一条 `strokeWeight: 20` 的纯蓝折线，
  `setOpacity` 使哨兵像素 `4229 → 0 → 4229` 可逆切换；`setOptions({opacity})` 亦然，
  两条路都生效）；`PolygonLayer` **不登记**（同样的成员表读数，但**接不到渲染**——
  该族选项表里根本没有图层级 `opacity`，唯一可用的是逐要素 `fillOpacity`）。
  ⚠️ 两族的**在位性读数完全相同**（`proto`/`inst` 都 true），差别只在像素，
  任何只看成员表的门禁都给不出这个区别。
- **注入时机**：这两族**随主包注入**（`BMap.Map` 就绪时构造器已在位），与扩展 API 那四类不同，
  因此不进「运行时注入」名单。
