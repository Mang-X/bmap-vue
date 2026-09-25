---
title: 组件总览
lang: zh-CN
---

# 组件总览

52 个组件，按「它解决什么问题」分组。先在下面找到你那一类，再点进具体页面。

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
