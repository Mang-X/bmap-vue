---
title: 组件总览
lang: zh-CN
---

# 组件总览

56 个组件，按「它解决什么问题」分组。先在下面找到你那一类，再点进具体页面。

<div align="center">
  <img src="/screenshots/components-marker.jpg" alt="Marker 与 InfoWindow 的实际效果" width="760" />
</div>

```ts
import { Map, Marker, NavigationControl } from 'bmap-vue'
```

## 先选对：覆盖物还是图层

这是最容易选错的一步，两者的代价差别很大：

| | 覆盖物（Overlay） | 图层（Layer） |
| --- | --- | --- |
| 资源数量 | **每个实例一个** SDK 对象 | 整个图层**一个** SDK 资源 |
| 1000 个点 | 1000 个 Marker 对象 | 1 个批量图层 |
| 适合 | 需要逐个交互、需要独立样式 | 大批量渲染、统一样式、要素状态 |
| 组件 | `Marker` / `Circle` / `Polyline` … | `PointCollection` / `LineLayer` / `GeoJSONLayer` … |

**默认用覆盖物**（直观、可交互）；点数上千或需要要素状态时再换图层。
需要鼠标拾取且数据量大时，[原生批量可视化图层](/zh-CN/components/layer/native-visual-layers)
提供 `setData` 与要素状态，不重建实例。

## 地图与上下文

| 组件 | 用途 |
| --- | --- |
| [Map](/zh-CN/components/map) | 地图本体。`v-model:center/zoom/heading/tilt`，承载所有子组件 |
| [BMapProvider](/zh-CN/components/provider) | 客户端上下文。给子树提供 `ak` / Client，服务 composable 也能在其中单独使用 |

## 覆盖物

单个实例对应一个 SDK 对象，适合需要独立交互的元素。

| 组件 | 用途 |
| --- | --- |
| [Marker](/zh-CN/components/overlay/marker) | 点标注 |
| [InfoWindow](/zh-CN/components/overlay/infowindow) | 信息窗口 |
| [Label](/zh-CN/components/overlay/label) | 文本标注 |
| [Circle](/zh-CN/components/overlay/circle) | 圆形 |
| [Polyline](/zh-CN/components/overlay/polyline) | 折线 |
| [Polygon](/zh-CN/components/overlay/polygon) | 多边形 |
| [Rectangle](/zh-CN/components/overlay/rectangle) | 矩形 |
| [BezierCurve](/zh-CN/components/overlay/bezierCurve) | 贝塞尔曲线 |
| [GroundOverlay](/zh-CN/components/overlay/ground-overlay) | 地面叠加层（图片 / 视频 / canvas） |
| [GroundPoint](/zh-CN/components/overlay/ground-point) | 贴地点。地理坐标 + 离地高度，几何入口是 `point` |
| [Prism](/zh-CN/components/overlay/prism) | 3D 棱柱 |
| [Marker3D](/zh-CN/components/overlay/marker3d) | 带高度的点 |
| [MapMask](/zh-CN/components/overlay/mapMask) | 地图掩膜 |
| [CustomOverlay](/zh-CN/components/overlay/custom-overlay) | 自定义 DOM 覆盖物 |
| [ContextMenu](/zh-CN/components/control/context-menu) | 上下文菜单（含 `MenuItem` / `MenuSeparator`） |

所有覆盖物的**事件矩阵**（Vue 事件名 ↔ SDK 事件名 ↔ 载荷形状）见
[覆盖物事件矩阵](/zh-CN/components/overlay/events)。

## 数据与批量可视化

数据是一等公民的组件。`data` / `itemKey` / `getPosition` / `dataVersion` / `visible`
这套取数面在同族组件之间完全一致，业务代码可以平移。

| 组件 | 落地成 |
| --- | --- |
| [MarkerList](/zh-CN/components/data) | **每项一个** Marker（中小规模、逐点交互） |
| [MarkerCluster](/zh-CN/components/data) | 一个原生聚合图层（`engine` 可切到 markers 模式拿回业务项） |
| [PointCollection](/zh-CN/components/data) | 一个原生图层，散点画几何图形 |
| [PointIconLayer](/zh-CN/components/data) | 一个原生图层，散点画图标 |
| [PointLayer](/zh-CN/components/data) | 一个原生图层，「有图标用图标、没有画图形」（扩展 API，`experimental`） |
| [LineLayer](/zh-CN/components/layer/native-visual-layers) | 线 |
| [FillLayer](/zh-CN/components/layer/native-visual-layers) | 面 |
| [HeatmapLayer](/zh-CN/components/layer/native-visual-layers) | 热力 |
| [TrackLineLayer](/zh-CN/components/layer/native-visual-layers) | 轨迹线，带播放命令面与进度观察 |

后四个的**要素状态与拾取**见[原生批量可视化图层](/zh-CN/components/layer/native-visual-layers)。

## 控件

| 组件 | 用途 |
| --- | --- |
| [NavigationControl](/zh-CN/components/control/navigation) | 平移 + 缩放 |
| [NavigationControl3D](/zh-CN/components/control/navigation3d) | 3D 视角 |
| [ZoomControl](/zh-CN/components/control/zoom) | 缩放 |
| [ScaleControl](/zh-CN/components/control/scale) | 比例尺 |
| [MapTypeControl](/zh-CN/components/control/map-type) | 地图类型切换 |
| [OverviewMapControl](/zh-CN/components/control/overview) | 鹰眼 |
| [CityListControl](/zh-CN/components/control/citylist) | 城市列表 |
| [LocationControl](/zh-CN/components/control/location) | 定位 |
| [CopyrightControl](/zh-CN/components/control/copyright) | 版权 |
| [PanoramaControl](/zh-CN/components/control/panorama-control) | 全景切换 |
| [CustomControl](/zh-CN/components/control/custom) | 自定义控件 |

## 图层

| 组件 | 用途 |
| --- | --- |
| [TileLayer](/zh-CN/components/layer/tile-layer) | 瓦片图层 |
| [TrafficLayer](/zh-CN/components/layer/traffic-layer) | 路况图层 |
| [DistrictLayer](/zh-CN/components/layer/district-layer) | 行政区 |
| [GeoJSONLayer](/zh-CN/components/layer/geojson-layer) | GeoJSON |
| [XYZLayer](/zh-CN/components/layer/xyz-layer) | 标准瓦片 |
| [WMSLayer](/zh-CN/components/layer/wms-layer) | WMS |
| [WMTSLayer](/zh-CN/components/layer/wmts-layer) | WMTS |
| [RasterTileLayer](/zh-CN/components/layer/raster-layer) | 栅格瓦片 |
| [MVTLayer](/zh-CN/components/layer/mvt-layer) | 矢量瓦片 |
| [DOMLayer](/zh-CN/components/layer/dom-layer) | DOM 图层 |
| [TextLayer](/zh-CN/components/layer/text-layer) | 批量文字标注 |
| [PolygonLayer](/zh-CN/components/layer/visualization-layers) | GeoJSON 面。官方 `FillLayer` 的指名替代 |
| [PolylineLayer](/zh-CN/components/layer/visualization-layers) | GeoJSON 线。官方 `LineLayer` 的指名替代 |
| [PanoramaCoverageLayer](/zh-CN/components/layer/panorama-coverage) | 全景覆盖范围 |

图层组件的共性与排障见[图层总览](/zh-CN/components/layer/)。

## 全景

| 组件 | 用途 |
| --- | --- |
| [Panorama](/zh-CN/components/panorama/) | 全景查看器 |
| [PanoramaLabel](/zh-CN/components/panorama/label) | 全景标注 |

## 检索

| 组件 | 用途 |
| --- | --- |
| [Autocomplete](/zh-CN/components/autoComplete/) | 输入建议 |

搜索结果列表、分页与详情面板这类**标准 UI** 由官方
[@baidumap/jsapi-ui-kit](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit) 提供，
本库不复制官方 UI——见[官方 UI Kit 集成](/zh-CN/guide/ui-kit)。

## 官方目录里我们没有的

对照官方 React 文档站的目录（<https://lbs.baidu.com/jsapi/react/docs/>，47 个组件），
下面这些**本库没有**。逐个说明了原因，避免「官方有所以应该有」的误读：

| 官方组件 | 为什么这里没有 |
| --- | --- |
| `Icon`（图标） | 不是独立组件：走 `<Marker :icon>`，接受预设名或自定义图标配置 |
| `PlaceDetail`（地点详情） | 在**官方 UI Kit** 里（`bmap-vue/ui-kit` 的 `<PlaceDetail>`），不在组件面 |
| `RawOverlay` / `RawControl` | 官方 React 的「逃生舱」：挂任意原生 SDK 对象。本库用 [`bmap-vue/advanced`](/zh-CN/guide/advanced) 的 `unwrapRaw()` + `createHandle` 覆盖同类需求 |
| `SimpleInfoWindow` | 官方 React 库自有封装，上游 SDK 没有这个类 |
| `ThreeLayer` | three.js 宿主集成（需自备 three.js）。本库用原生 [`TextLayer`](/zh-CN/components/layer/text-layer) / [`PolygonLayer`](/zh-CN/components/layer/visualization-layers) 覆盖多数场景 |
| `Symbol`（符号） | **本库尚未暴露该能力**，且**做不成组件**：官方 `overlay/Symbol.d.ts:13` 的 `class Symbol` **不继承** `BMap.Overlay`——它是一个矢量图标**值对象**（官方注明「可用作 Marker 的 icon 参数」），没有 `addOverlay` 入口，因此无法做成一个「挂到地图上」的组件。官方 `Symbol` 的 9 个成员（`setPath` / `setFillColor` / `setStrokeColor` / …）在本库**没有任何落地路径**；需要矢量图标时目前只能经 [`bmap-vue/advanced`](/zh-CN/guide/advanced) 的 `unwrapRaw()` 自行创建 |
| `IconSequence`（图标序列） | **官方已废弃**：`overlay/IconSequence.d.ts:4` 的类声明标了 `@deprecated 4.0 已废弃，请使用 PolylineOptions#strokeTexture 代替`（该类只有构造函数，没有实例方法）。本库已在 [`<Polyline :icons>`](/zh-CN/components/overlay/polyline) 上**如实透传**它（收下就静默忽略比不收更难排查），新代码请用 `strokeTexture` |

::: tip 曾经列的三条「真实能力缺口」，逐条复核后只有一条成立
`GroundPoint` 于 issue #178 补齐，见 [GroundPoint 贴地点](/zh-CN/components/overlay/ground-point)。

另外两条经对着 `@baidumap/jsapi-v4-types@4.0.5` 复核，**结论是「不补」**：
`Symbol` 是**不继承 `Overlay` 的值对象**（做成组件挂不上去），其能力在本库**尚无落地**；
`IconSequence` 官方**已 `@deprecated`** 且指向 `strokeTexture`。两条的共同点是：硬做成
组件只会得到「挂不上去」或「传了不生效」的假支持。
:::
