---
"bmap-vue": minor
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
- **网络图层新增加载观察面 `tileLoadObserver`**（`BTileLayer` / `BWMSLayer` / `BWMTSLayer` /
  `BRasterLayer`）：给 `{ onRequest, onLoaded, onError }` 即可知道「SDK 什么时候要求加载哪张瓦片、
  它成功还是失败」，**不需要自己接管加载**（本库在内部完成）。依据是 live 取证：这些图层的类声明与
  运行时都**不派发**常见瓦片事件（所以本库仍不发明事件），而官方 `tileLoadFunction` 是**接管式**的
  （设了它 SDK 就不再自己加载）。不给观察者时该 option 保持缺席，行为与之前完全一致。
  `onLoaded` / `onError` **以图片元素为单位**，结果回调**最近一次**向该元素发起加载的那个观察者；
  若那次加载没有观察者，则该元素**没有归属**（不会回落到上一个拥有者）——不同图层 / 已卸载组件之间
  不会互相串结果。
- **`visible` 的语义**：`false` 是「摘掉」（`removeLayer`，不重建）；**但再次 `visible=true` 会
  **重建实例**——真实 4.0 的 `removeLayer` 会清空图层持有的 Map 引用，那个实例再也渲染不了
  （DOMLayer 实测：重挂载后节点仍为 0，补 `setData` 还内部抛错）。也就是说「隐藏再显示」现在等价于
  「摘掉 + 换一个新实例」，代价是一次重建，换来的是内容一定回来（旧实现在真实环境里会**内容消失**）。
- **`visible=false` 期间设置的可变 option 不会丢**：切回可见时补写一次。
- **可变 option 与统一槽位由有值变回 `undefined` 都会重建图层**，以便回到 SDK 自己的默认值。
  例外是 `data`：`null` = 清空，`undefined` = 保持现状。
- **永久销毁（卸载 / 重建 / Map 销毁）会 best-effort 清理并摘除**：正常返回后不残留；**最后一次 SDK
  摘除失败时只保证可观测**（`logger.warn`），不保证无残留。清理走 Driver 归一化后的统一「清空」入口
  （`GeoJSONLayer.clearData()` / `DOMLayer.removeAllOverlays()`），并**不再按挂载状态决定要不要执行**
  ——原先把「`clearData` 必须在 `removeLayer` 之前调」当成硬约束，issue #98 的 live 取证实测推翻它：
  摘掉之后 `getData()` 仍在（2 条），此时再 `clearData()` 仍能清空（→ 0 条）且不抛错；而 `DOMLayer`
  的节点本来就由 `removeLayer` 自己摘掉（`isConnected` 2 → 0），摘掉后再清是安全 no-op。
  临时摘挂（`visible=false`）**不清**，切回可见时数据照旧。
- **如果 `visible=false` 已经先成功摘过一次**，永久销毁只做 **detached cleanup**，**不会**再调一次
  `removeLayer`——重复摘除的安全性在真实 4.0 上**已实测成立**（GeoJSON / DOM / Tile 三个家族均未抛错，
  见 ADR 决策 12b），但常规销毁路径只按「一次摘除」写：重复摘除只出现在**挂载状态未知**时的收敛动作里。
- **去重指纹会在写入之前先失效**：「已经写过了」的判据代表的是「**SDK 当前值**」，因此任何一次
  可能产生副作用的调用之前先把它置为「未应用」，成功返回后再提交。只做到「成功后推进」不够——
  一次「已经写进去了、然后抛错」的调用会让它停留在陈旧值上，用户**改回上一次成功的取值**时会被
  误判成「已经写过了」而跳过，SDK 永久留在失败那次的值。
- **挂载状态是三态（`attached` / `detached` / `unknown`）**：`addLayer` / `removeLayer` 抛错之后
  状态是未知的——按「还挂着」记会让真实已摘掉的实例**再也挂不回来**，按「已经下去了」记会让仍在
  图上的实例被挂第二份。未知状态由「先 best-effort 摘一次、再挂」收敛。
  这条收敛依赖「对已经摘掉的图层重复 `removeLayer` 是安全的」这个前提，而 issue #98 的 live 探针
  已实测它**成立**（GeoJSON / DOM / Tile 三个家族重复摘除均未抛错；读数与覆盖范围见 ADR 决策 12b）。
  悲观契约（`FakeV4Map.failRemoveLayerWhenDetached`）与对应用例仍然保留，身份是**防御性不变量**：
  万一将来某个 kind / 版本不成立，退化必须仍然有界且可观测（`resource:error`），且**绝不会**出现两份。
- **换实例之前先确认旧实例真的下来了（三条重建路径统一走同一个入口）**：`replace()` 释放旧实例最终
  经过 `LayerRegistry.dispose()`，而 Registry 对摘除失败的口径是「吞掉异常 + 把记录永久删除」
  （卸载路径必须走完，这个口径本身是对的）。于是旧实例还在图上而直接换实例，就会同时变成
  「旧实例仍在图上、且再无账本可重试清理」+「新实例又挂一份」。因此**构造期 option 变化 / 重新可见 /
  已写入值变回未表态**这三条会创建新实例的路径统一走 `replaceAfterDetached()`：换实例前先做一次
  **可失败**的 `unmount`（`tryConvergeToDetached`），确认收敛到 `detached` 才换；否则不做任何会再加
  一份的动作、失败经 `resource:error` 交出，留到下一次 props 变化或永久销毁再试。
  ⚠️ 不只是「上一次摘除失败过（`unknown`）」那一种输入：`attached` 时这一次摘除本身就可能失败，
  所以三条路径**都要**过这一关。
  顺序上，收敛那一次 `removeLayer` 会**先解绑旧一代的业务监听**（`unbind -> sdk-remove`，与卸载
  路径同序；否则 SDK 在 `removeLayer` 期间同步派发的事件会打到正在拆解的业务回调上）。
  代价写在明面上：收敛**失败**时监听已解绑而实例仍在图上——它保持渲染、暂时不再响应业务事件
  （`@click` 一类），直到下一次 props 变化（重试收敛）或永久销毁；失败本身经 `resource:error` 可观测。
- **就地更新的记账分两本**：「去重」只认成功写入过的值；「变回未表态 ⇒ 重建」的判据认
  **尝试过**写入的键/槽位。这样一次**部分成功**的写入（`TrafficLayer` 的 `setOptions` 是逐
  setter 调用、不是事务）不会让已经生效的键在账本上凭空消失，从而在它被移除时漏掉重建。
- **`removeLayer` 失败不会把「挂过」的记账一起复位**：后续的永久销毁会再试一次摘除，不会因为
  一次摘除失败就把实例永远留在图上。`addLayer` / `removeLayer` 的补偿都保留**原错误**优先。
- **`LayerRegistry.size` 的语义收窄**：它是「这张地图**拥有**的存活图层实例数」（含暂时隐藏 /
  摘下的），**不是**「地图上此刻挂着几个」——`visible=false` 时 `size` 仍为 1 而 attached 为 0。
- 就地更新失败（整袋 `setStyleOptions` 抛错等）不会被记成已写入，后续更新会自动重试；
  同一次更新里「已判定必须重建」的状态不会被另一步的就地写入异常挡住。
