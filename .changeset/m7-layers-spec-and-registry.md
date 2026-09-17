---
"baidu-map-gl-vue": minor
---

新增图层套件（`M7-LAYERS` / #40）：十个图层组件共用同一个生命周期内核，并补齐瓦片 / 数据 /
路况 / 行政区 / 全景五类常用图层。

**新增组件**（八种）：`BTileLayer`、`BTrafficLayer`、`BGeoJSONLayer`、`BDOMLayer`、
`BXYZLayer`、`BWMSLayer`、`BWMTSLayer`、`BRasterLayer`。

**统一槽位与三条更新路径**：`visible` / `opacity` / `minZoom` / `maxZoom` / `zIndex` / `data`
由同一个内核处理——`visible` 表达为「挂上 / 摘掉」，可就地更新的槽位（有 setter 的 `zIndex`、
数据图层的 `data`、`colors` / `edge` 一类可变选项）在挂载后原地写入，其余槽位变化时**重建图层**
（旧实例先摘掉、旧监听随它那一代释放）。因此**改 URL 会换实例**，而改 `data` 不会。

**新增内核与账本**：`core/layers` 的 `LayerSpec` / `LayerRegistry`（`useLayerResource` 改为
规格驱动）。`MapRuntime.layers` 的类型从 `OverlayRegistry` 变为 `LayerRegistry`：地图销毁
（含 `keepAliveBehavior="dispose"` 的停用）时先摘掉仍挂着的图层、再销毁地图。

**能力清单**：新增 `layer.xyz` / `layer.wms` / `layer.wmts` / `layer.raster`
（四个都标 `experimental`——4.0 新增的独立构造器，只有类声明没有官方专页）。

**迁移注意**：

- `BDistrictLayer` 的构造项（`fillColor` / `kind` / `viewport`…）此前变化**静默不生效**，
  现在会**重建图层**（4.0 的 `DistrictLayer` 没有任何字段级 setter）；新增 `adcode` prop。
- `BPanoramaCoverageLayer` 新增 `visible` prop（默认 `true`）；原文档里那份 `anchor` / `offset`
  表格是复制残留，已删除。
- `BGeoJSONLayer` / `BDOMLayer` 的事件回调收到的是**归一化事件**：要素集合在 `e.raw.features`。
- `BGeoJSONLayer` 不提供 `opacity` / `zIndex`（官方该图层没有这两个语义），`BDistrictLayer`
  同样不提供 `opacity` / `zIndex`。
- 显隐统一走 `visible` prop（挂上 / 摘掉）；直接调 `driver.layers.create(kind, { visible })`
  时该键会被忽略并告警一次（组件层没有把 `visible` 放进 `options` 的入口）。
- `BTrafficLayer` **不承诺多实例隔离**（官方 `TrafficLayer` 是页面级单实例）。
- **回调型 option 换实现立即生效**（`url` / `tileLoadFunction` / 模板回调 / 函数型 style /
  `createDom`）：本库交给 SDK 的是转发到当前 prop 的稳定包装，因此换回调不会重建图层。
  对象内部的函数不在覆盖范围内（换外层对象的引用即可）。
- **`visible=false` 期间设置的可变 option 不会丢**：切回可见时补写一次。
- **可变 option 与统一槽位由有值变回 `undefined` 都会重建图层**，以便回到 SDK 自己的默认值
  （不再只告警）。例外是 `data`：`null` = 清空，`undefined` = 保持现状。
- **回调型 option 分两类**：每个瓦片 / 每次请求都会再调用的（`url` / `tileLoadFunction` / 模板
  回调）换实现立即生效且不重建；只在解析数据时求一次的（GeoJSON 函数型 style）换引用会**重建**，
  以便既有要素换样式 —— 这类请传稳定引用，内联箭头会因引用变化而重建。
- 就地更新失败（整袋 `setStyleOptions` 抛错等）不会被记成已写入，后续更新会自动重试。
