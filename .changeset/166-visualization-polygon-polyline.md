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
`fillTextureUrl` / `strokeTextureUrl` 一族），样式更新语义也不同（`setStyleOptions` + merge +
`doOnceDraw` vs `setOptions` 整袋替换），且 `PolygonLayer` 的 `strokeWeight` 默认 `0`
（**不描边**）而 `FillLayer.border` 默认 `true`。旧组件的开发期告警文案与 `@deprecated`
JSDoc 已同步更新为「替代品已提供 + 迁移口径」。

## 逐成员依据

完整的成员级核对（每条带 `visualization/<X>.d.ts` 行号 + live 读数）见
`docs/zh-CN/contributing/166-visualization-alignment-audit.md`。三条值得单独说的：

- **`hitTest` 不开面**：官方**声明**了，**live 实测运行时没有**（`prototype.hitTest` 为 `false`）。
  放开门面就是假支持。
- **`setOpacity` 不开面**：反过来——**运行时**有，官方**声明**里没有。跟随 #165 对
  `PointLayer` 的同一裁决「不把未声明成员当契约」。代价：`PolylineLayerOptions.opacity`
  只能经 `style` 袋整袋下发。
- **注入时机**：这两族**随主包注入**（`BMap.Map` 就绪时构造器已在位），与扩展 API 那四类不同，
  因此不进「运行时注入」名单。
