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
- `BDOMLayer` **不提供交互事件**（没有 `@click` / `@mouseover` / `@mouseout`）：官方 4.0.4 的
  `DOMLayer` 只声明了 `addEventListener`、没有 `removeEventListener`，而本库的事件订阅要求两者
  同时存在才生效（缺一个就告警 + no-op）—— 也就是说这类订阅绑上就解不掉。需要交互时在
  `createDom` 里给元素自己挂监听（元素随数据/图层销毁）。
- **回调型 option 分两类**（判据是「SDK 什么时候调用它」）：
  - 每个瓦片 / 每次请求都会再调用（`url` / `tileLoadFunction` / XYZ·WMTS 模板回调）：换实现
    **立即生效、不重建**（交给 SDK 的是转发到当前 prop 的稳定包装）；
  - 只在解析数据时求一次（GeoJSON 的 `markerStyle` / `polylineStyle` / `polygonStyle`）：换**引用**
    会**重建图层**，以便既有要素用新实现重新解析 —— 这类请传稳定引用（`computed` / 模块常量），
    内联箭头会因引用每次变化而重建。对象型 style 仍按值比较（同内容不重建）。
  - **对象内部**的函数（`{ icon: fn }`）不在覆盖范围内：指纹把嵌套函数折叠成 `fn`，换外层对象
    也没用 ⇒ 把 style 写成函数，或在 Vue 层用 `:key` 强制重挂载。
  - `BDOMLayer` 的 `createDom` 按官方参考实现的 `useLatest` 语义处理：**不重建**，但下一次数据
    解析（`setData`，含重新赋值 `data`）会用新实现。
- **`visible=false` 期间设置的可变 option 不会丢**：切回可见时补写一次。
- **可变 option 与统一槽位由有值变回 `undefined` 都会重建图层**，以便回到 SDK 自己的默认值。
  例外是 `data`：`null` = 清空，`undefined` = 保持现状。
- **永久销毁（卸载 / 重建 / Map 销毁）保证最终清空 + 摘除**数据驱动图层（`clearData` →
  `removeLayer`，即 `DOMLayer` 的 `removeAllOverlays()`）；**不承诺**所有路径都是这一个固定顺序
  （例如 `visible=false` 先摘过一次、之后才卸载时，清空发生在第二次摘除之前）。临时摘挂
  （`visible=false`）**不清**，切回可见时数据照旧。
- **就地更新的记账分两本**：「去重」只认成功写入过的值；「变回未表态 ⇒ 重建」的判据认
  **尝试过**写入的键/槽位。这样一次**部分成功**的写入（`TrafficLayer` 的 `setOptions` 是逐
  setter 调用、不是事务）不会让已经生效的键在账本上凭空消失，从而在它被移除时漏掉重建。
- **`removeLayer` 失败不会把「挂过」的记账一起复位**：后续的永久销毁会再试一次摘除，不会因为
  一次摘除失败就把实例永远留在图上。`addLayer` / `removeLayer` 的补偿都保留**原错误**优先。
- **`LayerRegistry.size` 的语义收窄**：它是「这张地图**拥有**的存活图层实例数」（含暂时隐藏 /
  摘下的），**不是**「地图上此刻挂着几个」——`visible=false` 时 `size` 仍为 1 而 attached 为 0。
- 就地更新失败（整袋 `setStyleOptions` 抛错等）不会被记成已写入，后续更新会自动重试；
  同一次更新里「已判定必须重建」的状态不会被另一步的就地写入异常挡住。
