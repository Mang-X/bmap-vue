# 图层总览

图层组件共用**同一个生命周期内核**：一份「图层规格」（种类 + 构造选项 + 统一槽位）驱动
`create → addLayer → 就地更新 / 重建 → removeLayer`，释放顺序统一为「先解绑业务监听、
再由 Map 摘除 SDK 资源」。

```ts
import {
  BDistrictLayer, BPanoramaCoverageLayer,
  BTileLayer, BTrafficLayer, BGeoJSONLayer, BDOMLayer,
  BXYZLayer, BWMSLayer, BWMTSLayer, BRasterLayer,
} from 'bmap-vue'
```

## 选哪个图层

| 场景 | 用哪个 |
| --- | --- |
| 行政区划（省 / 市 / 县区） | `BDistrictLayer` |
| 自有瓦片，数据**已是**百度坐标系（BD09MC） | `BTileLayer` |
| 第三方标准瓦片（XYZ / WMTS / WMS / TMS） | `BXYZLayer`（内置 EPSG:3857 → BD09MC 转换） |
| 栅格瓦片（子域轮询 / TMS 翻转 / 四至裁剪） | `BRasterLayer` |
| WMS 服务 | `BWMSLayer` |
| WMTS 服务 | `BWMTSLayer` |
| 实时路况 | `BTrafficLayer` |
| GeoJSON 数据（点 / 线 / 面） | `BGeoJSONLayer` |
| 批量线 / 面 / 热力 / 轨迹线（数据驱动 + 要素状态） | `BLineLayer` / `BFillLayer` / `BHeatmapLayer` / `BTrackLineLayer`（见[原生批量可视化图层](./native-visual-layers)） |
| 自定义 DOM 覆盖物 | `BDOMLayer` |
| 全景覆盖 | `BPanoramaCoverageLayer`（搭配 `BPanoramaControl`） |

> 上面大半是**底图家族**（走 `LayerDriver`：行政区 / 瓦片 / 路况 / GeoJSON / DOM / 全景覆盖），
> 它们的「显隐」统一表达为**挂上 / 摘掉**。四个原生批量可视化图层走的是另一条 Facet
> （`NativeLayerDriver`）：数据、样式、要素状态与拾取是一等公民，`visible` 在有 `setVisible` 的
> kind 上表达为 setter（隐藏 ≠ 释放数据）。两族的取舍见[原生批量可视化图层](./native-visual-layers)。

## 统一槽位与更新口径

| 槽位 | 语义 | 落地方式 |
| --- | --- | --- |
| `visible` | 是否在地图上 | 挂上 / 摘掉（所有图层一致，**不**用 `hide()`） |
| `opacity` / `minZoom` / `maxZoom` | 透明度 / 显示层级范围 | 构造选项；官方这批图层没有对应 setter，变化时**重建** |
| `zIndex` | 层叠顺序 | 有 setter 的图层就地更新；没有的（如 `BDistrictLayer`）不支持该槽位 |
| `data` | 数据（仅数据驱动图层） | 就地 `setData()`；`null` = 清空 |

> 非目标之一：**不在 `map.addLayer` 之前执行依赖地图的操作**。层级一类的写入只在挂载后发生。

## 关于 `options` 的缺省语义

- **不传就是「不表态」**：没传的 option 不会出现在构造选项里，也不会调用对应 setter。
  这一条对布尔开关尤其重要——Vue 会把「缺省」的 `boolean` prop 转成 `false`，本库在组件里
  显式关掉了这个转换，因此 `edge` 一类 SDK 默认值为 `true` 的开关不会被你「没写」的代码改掉。
- **统一槽位不进 `options`**：`visible` / `opacity` / `minZoom` / `maxZoom` / `zIndex` / `data`
  请用同名 props；写进 `options` 不会被接受（`visible` 会在 Driver 层告警一次）。
- **`visible` 之外的可写项**：有 setter 的（`zIndex`、数据图层的 `data`、`colors` / `edge` /
  `offsetX`… 这类可变 option）就地更新，其余变化**重建**。

## 回调型 option

回调分两类，判据是「SDK 什么时候调用它」：

| 类别 | 例子 | 换实现时的行为 |
| --- | --- | --- |
| **每个瓦片 / 每次请求都会再调用** | `url`（`BRasterLayer`）、`tileLoadFunction`、XYZ/WMTS 的 `xTemplate` / `yTemplate` / `zTemplate` / `bTemplate` | **立即生效，不重建**（本库交给 SDK 的是身份稳定、每次调用读最新 prop 的包装函数） |
| **只在解析数据时求一次** | GeoJSON 的 `markerStyle` / `polylineStyle` / `polygonStyle`、`BDOMPLayer` 的 `createDom` | **重建图层**（既有要素 / DOM 只能靠重新解析数据换实现） |

由此有两条要注意的：

- **函数型 style 请传稳定引用**（`computed` / 模块常量）：它按**引用**比较，内联箭头函数会因引用
  每次变化而触发重建。**对象** style 仍按值比较，同内容的新对象不会重建。
- **对象内部**的函数（例如 `markerStyle: { icon: () => … }`）不在覆盖范围内：`{ icon: fnA }` 与
  `{ icon: fnB }` 指纹相同，**换外层对象也没用**。可行的替代是把 style 写成**函数**
  （`markerStyle: (props) => ({ … })`），或在 Vue 层用 `:key` 强制重挂载。
- 任何回调 prop 换成 `undefined`（或不传）都会改变构造指纹 ⇒ 重建图层（`url` 从回调换回字符串模板同理）。

## 显隐与就地更新的时序

- `visible=false` 期间对可变 option（`colors` / `edge` / `offsetX`…）的设置**不会丢失**：切回可见时
  会补写一次（未挂载时既不写也不记账）。
- 已经写入过的**可变 option 与统一槽位**（`zIndex` / `minZoom` 一类）由有值变回 `undefined` 时，
  图层会**重建**——SDK 没有 unset 入口，重建是回到「SDK 自己的默认值」的唯一办法（本库不猜默认值）。
  例外是 `data`：`null` 表示清空，`undefined` 表示「不表态（保持现状）」。
- 就地更新失败（例如整袋 `setStyleOptions` 抛错）**不会**被记成已写入：下一次任何变化都会把这个
  值一起重试；失败本身经 `resource:error` 交出。
  注意「去重」与「移除检测」用的是**两本账**：前者只认成功写入过的值，后者认「**尝试过**写入」的键
  ——因为 SDK 允许在抛错**之前**已经改了状态（`TrafficLayer` 的 `setOptions` 就是逐 setter 调用，
  不是事务：`setColors` 已生效、`setEdge` 抛错）。所以一次失败的写入之后再把这个键置回 `undefined`，
  会**重建一次**（保守侧）：多一次重建的代价是确定的一次重挂，漏掉的代价是声明与 SDK 永久分叉。
- **「已经写过了」的判据会在写入之前先失效**：它代表的是「**SDK 当前值**」，不只是「成功调过一次」。
  因此一次「已经写进去了、然后抛错」的调用之后，把 prop **改回上一次成功的取值**也会真的重写一遍
  （否则指纹恰好相同、会被误判成已写过，而 SDK 还停在失败那次的值）。
- `addLayer` 抛错时（哪怕副作用已经产生）图层会被 best-effort 摘掉，错误经 `resource:error`
  交出；失败之后仍可重试挂载。
- `removeLayer` 抛错时，**挂载状态是未知的**（SDK 可能已经摘掉、也可能没有）——两种猜测都危险：
  猜「还挂着」会让真实已摘掉的实例**再也挂不回来**，猜「已经下去了」会让仍在图上的实例被挂第二份。
  内核因此把状态记成「未知」，并在下一次 props 变化 / 永久销毁时**尝试**用「先 best-effort 摘一次、
  再挂」把它推回确定状态（能否真的收敛取决于下面那条前提）；同时**保留**「仍需摘除」的记账，
  后续的永久销毁（组件卸载 / 重建 / Map 销毁）会**再试一次**，
  不会把实例永远留在图上。如果**最后一次**摘除也失败，则只剩 `logger.warn` 可观测（真实收口在 SDK
  自己的 `map.destroy()`）。
  注意「先摘一次」这一步依赖一条**未经官方证明**的前提：对已经摘掉的图层重复 `removeLayer` 是安全的
  （官方对此没有任何说明）。前提不成立时收敛**不会发生**（图层停在未知、仍不在地图上），但失败会经
  `resource:error` 交出，且**绝不会**出现两份。

## 加载诊断：观察瓦片什么时候加载、什么时候失败

官方这批网络图层的**类声明里没有任何事件成员**，live 取证也确认运行时**不派发**常见事件名
（`tileload` / `tileerror` / …）——所以本库不发明事件，改为提供一个**观察面**：

```vue
<BTileLayer
  tile-url-template="https://yourhost/tile?x={X}&y={Y}&z={Z}"
  :tile-load-observer="{
    onRequest: ({ url }) => console.log('要加载', url),
    onError: ({ url }) => failures.push(url),
  }"
/>
```

- `onRequest`：SDK **要求加载**一张瓦片（请求，不代表成功）——想数请求次数用它；
- `onLoaded` / `onError`：该图片元素加载成功 / 失败。**以元素为单位**：回调里的 `url` 是元素**当前**
  的 `src`（官方没有暴露单次请求的身份，本库**不做逐请求归因**——想知道「哪次请求失败了」请用
  `onRequest` 的顺序配合自己的计数）；`onError` **不带失败原因**（浏览器的 `error` 事件不提供），
  可诊断的是「哪个 URL 失败了、几次」；
- **结果归谁**：以**最近一次**向这块元素发起加载的那个观察者为准（SDK 会复用元素，图层重建 / 换观察者
  时归属随之转移）。若最近那次加载**没有观察者**（只给了 `tileLoadFunction`，或观察者被置空），
  这块元素就**没有归属**——事件不会回调任何观察者，也不会回落到上一个拥有者。
- **不需要自己接管加载**：本库在内部完成默认加载。官方 `tileLoadFunction` 是**接管式**的（实测：
  设了它、函数里什么都不做，那张瓦片永远不会有像素），所以观察面把它包起来了；
- 与官方 `tileLoadFunction` **同时给**时：加载交给你的函数（接管），本库只在旁边观察；
- 观察者回调抛错不影响加载（捕获 + 开发期告警）。

`BXYZLayer` 的官方构造选项里**没有** `tileLoadFunction`，因此它没有观察面（只有 `addLayer` 的调用
可由使用方从自己的网络面板观察）。

## 排障：图层挂上了但看不到东西

按下面的顺序查，能覆盖绝大多数「瓦片不显示」的问题：

1. **CORS**：第三方瓦片服务通常要求开启跨域（`Access-Control-Allow-Origin`）。浏览器会拦截
   图片以外的读取（拾取、绘制到 canvas）。本库只负责发起请求，**不保证源服务可用**。
2. **坐标系**：`BTileLayer` 的坐标**必须**是 BD09MC；第三方标准服务（EPSG:3857 / WGS84 /
   GCJ02）用 `BXYZLayer` / `BRasterLayer` / `BWMSLayer` / `BWMTSLayer`。用错的表现是**整体偏移**
   而不是报错。GeoJSON 数据要按 `reference` 声明来源坐标系。
3. **占位符写法**：`BXYZLayer` 用方括号 `[z]` / `[x]` / `[y]`；`BRasterLayer` 用花括号
   `{z}` / `{x}` / `{y}`（TMS 用 `{-y}`）；`BTileLayer` 用花括号 `{X}` / `{Y}` / `{Z}`。
   写错的表现是「图层挂得好好的，但瓦片全 404」。
4. **掩膜与范围**：`boundary` / `showRegion` / `extent` / `bounds` 会把瓦片裁到某个范围内，
   范围写错时图层在视野内是空的。
5. **服务条款与配额**：第三方瓦片服务有使用限制，请自行确认授权。

## 生命周期与释放

- **显隐**：`visible=false` 是「摘掉图层」（`removeLayer`），不是 `hide()`——所有图层一种口径。
  **再次 `visible=true` 会重建实例**：真实 4.0 的图层被摘掉之后，那个实例再也渲染不了
  （它持有的 Map 引用已被清空，重挂载不恢复内容、补 `setData` 还会内部抛错），所以「重新可见」
  等价于「摘掉 + 换一个新实例」。代价是一次重建；不这么做的话，真实环境里隐藏再显示会**内容消失**。
- **重建**：构造期选项（URL、`params`、`transparentPng`…）变化会**换一个实例**：旧实例先摘掉、
  旧监听随它那一代的作用域释放，因此不会有「旧图层的请求/回调影响新图层」。
- **数据**：`BGeoJSONLayer` / `BDOMLayer` 的 `data` 变化只调 `setData()`，**不重建**
  （重建会让所有覆盖物重做，DOM 图层会肉眼可见地闪）。
- **释放**：组件卸载、地图销毁（含 `keepAliveBehavior="dispose"` 的停用）都会摘掉图层并释放
  监听；诊断计数归零有测试锁住。数据驱动图层在永久销毁时走一次统一的「清空」入口
  （`GeoJSONLayer.clearData()` / `DOMLayer.removeAllOverlays()`），**与图层当时挂没挂上无关**
  ——依据是 4.0 上的实测（issue #98）：`clearData()` 在 `removeLayer` **之后**调用仍然有效；
  而 `DOMLayer` 的节点本来就由 `removeLayer` 自己摘掉，摘掉后再清是安全的 no-op。
  若 `visible=false` 已经先摘过一次，永久销毁**只清空、不会**再调一次 `removeLayer`
  （官方没有承诺「对已经摘掉的图层重复摘除是安全的」——实测三个 kind 家族都不抛错，但本库
  只按「一次摘除」写，重复摘除只出现在挂载状态未知时的收敛动作里）。
