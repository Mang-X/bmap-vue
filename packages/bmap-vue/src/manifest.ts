/**
 * 组件 manifest(单一事实源)
 *
 * 由 scripts/generate-manifest-artifacts.mts 读取此清单,生成
 * - components/index.ts(可选)
 * - Volar GlobalComponents
 * - resolver 合法组件列表
 */
export const componentManifest = [
  {
    name: "BMapProvider",
    exportName: "BMapProvider",
    category: "core",
    source: "./components/provider/BMapProvider.vue",
  },
  { name: "Map", exportName: "Map", category: "core", source: "./components/map/Map.vue" },
  {
    name: "Marker",
    exportName: "Marker",
    category: "overlay",
    source: "./components/overlays/Marker.vue",
  },
  {
    name: "InfoWindow",
    exportName: "InfoWindow",
    category: "overlay",
    source: "./components/overlays/InfoWindow.vue",
  },
  {
    name: "Circle",
    exportName: "Circle",
    category: "overlay",
    source: "./components/overlays/Circle.vue",
  },
  {
    name: "Polyline",
    exportName: "Polyline",
    category: "overlay",
    source: "./components/overlays/Polyline.vue",
  },
  {
    name: "Polygon",
    exportName: "Polygon",
    category: "overlay",
    source: "./components/overlays/Polygon.vue",
  },
  {
    name: "Rectangle",
    exportName: "Rectangle",
    category: "overlay",
    source: "./components/overlays/Rectangle.vue",
  },
  {
    name: "Label",
    exportName: "Label",
    category: "overlay",
    source: "./components/overlays/Label.vue",
  },
  {
    name: "ContextMenu",
    exportName: "ContextMenu",
    category: "overlay",
    source: "./components/overlays/ContextMenu.vue",
  },
  // 声明式菜单项（M5-CUSTOM-MENU / #33）：两者都不渲染 DOM，只把「这里有一条菜单项 / 分隔线」
  // 注册给父级 <ContextMenu>。它们进 manifest 是为了让插件注册与 Volar 补全一致——
  // 声明式写法下调用方通常不 import 子组件。
  {
    name: "MenuItem",
    exportName: "MenuItem",
    category: "overlay",
    source: "./components/overlays/MenuItem.vue",
  },
  {
    name: "MenuSeparator",
    exportName: "MenuSeparator",
    category: "overlay",
    source: "./components/overlays/MenuSeparator.vue",
  },
  {
    name: "CustomOverlay",
    exportName: "CustomOverlay",
    category: "overlay",
    source: "./components/overlays/CustomOverlay.vue",
  },
  {
    name: "Prism",
    exportName: "Prism",
    category: "overlay",
    source: "./components/overlays/Prism.vue",
  },
  {
    name: "GroundOverlay",
    exportName: "GroundOverlay",
    category: "overlay",
    source: "./components/overlays/GroundOverlay.vue",
  },
  {
    name: "BezierCurve",
    exportName: "BezierCurve",
    category: "overlay",
    source: "./components/overlays/BezierCurve.vue",
  },
  {
    name: "MapMask",
    exportName: "MapMask",
    category: "overlay",
    source: "./components/overlays/MapMask.vue",
  },
  {
    name: "Marker3D",
    exportName: "Marker3D",
    category: "overlay",
    source: "./components/overlays/Marker3D.vue",
  },
  {
    name: "Autocomplete",
    exportName: "Autocomplete",
    category: "overlay",
    source: "./components/autocomplete/Autocomplete.vue",
  },
  {
    name: "PanoramaControl",
    exportName: "PanoramaControl",
    category: "control",
    source: "./components/controls/PanoramaControl.vue",
  },
  {
    name: "CustomControl",
    exportName: "CustomControl",
    category: "control",
    source: "./components/controls/CustomControl.vue",
  },
  {
    name: "MarkerList",
    exportName: "MarkerList",
    category: "data",
    source: "./components/data/MarkerList.vue",
  },
  {
    name: "PointCollection",
    exportName: "PointCollection",
    category: "data",
    source: "./components/data/PointCollection.vue",
  },
  {
    name: "PointIconLayer",
    exportName: "PointIconLayer",
    category: "data",
    source: "./components/data/PointIconLayer.vue",
  },
  {
    name: "PointLayer",
    exportName: "PointLayer",
    category: "data",
    source: "./components/data/PointLayer.vue",
  },
  {
    name: "MarkerCluster",
    exportName: "MarkerCluster",
    category: "data",
    source: "./components/data/MarkerCluster.vue",
  },
  {
    name: "ZoomControl",
    exportName: "ZoomControl",
    category: "control",
    source: "./components/controls/ZoomControl.vue",
  },
  {
    name: "NavigationControl",
    exportName: "NavigationControl",
    category: "control",
    source: "./components/controls/NavigationControl.vue",
  },
  {
    name: "MapTypeControl",
    exportName: "MapTypeControl",
    category: "control",
    source: "./components/controls/MapTypeControl.vue",
  },
  {
    name: "OverviewMapControl",
    exportName: "OverviewMapControl",
    category: "control",
    source: "./components/controls/OverviewMapControl.vue",
  },
  {
    name: "ScaleControl",
    exportName: "ScaleControl",
    category: "control",
    source: "./components/controls/ScaleControl.vue",
  },
  {
    name: "CityListControl",
    exportName: "CityListControl",
    category: "control",
    source: "./components/controls/CityListControl.vue",
  },
  {
    name: "LocationControl",
    exportName: "LocationControl",
    category: "control",
    source: "./components/controls/LocationControl.vue",
  },
  {
    name: "NavigationControl3D",
    exportName: "NavigationControl3D",
    category: "control",
    source: "./components/controls/NavigationControl3D.vue",
  },
  {
    name: "CopyrightControl",
    exportName: "CopyrightControl",
    category: "control",
    source: "./components/controls/CopyrightControl.vue",
  },
  {
    name: "DistrictLayer",
    exportName: "DistrictLayer",
    category: "layer",
    source: "./components/layers/DistrictLayer.vue",
  },
  {
    name: "PanoramaCoverageLayer",
    exportName: "PanoramaCoverageLayer",
    category: "layer",
    source: "./components/layers/PanoramaCoverageLayer.vue",
  },
  {
    name: "TileLayer",
    exportName: "TileLayer",
    category: "layer",
    source: "./components/layers/TileLayer.vue",
  },
  {
    name: "TrafficLayer",
    exportName: "TrafficLayer",
    category: "layer",
    source: "./components/layers/TrafficLayer.vue",
  },
  {
    name: "GeoJSONLayer",
    exportName: "GeoJSONLayer",
    category: "layer",
    source: "./components/layers/GeoJSONLayer.vue",
  },
  {
    name: "DOMLayer",
    exportName: "DOMLayer",
    category: "layer",
    source: "./components/layers/DOMLayer.vue",
  },
  {
    name: "XYZLayer",
    exportName: "XYZLayer",
    category: "layer",
    source: "./components/layers/XYZLayer.vue",
  },
  {
    name: "WMSLayer",
    exportName: "WMSLayer",
    category: "layer",
    source: "./components/layers/WMSLayer.vue",
  },
  {
    name: "WMTSLayer",
    exportName: "WMTSLayer",
    category: "layer",
    source: "./components/layers/WMTSLayer.vue",
  },
  {
    name: "RasterTileLayer",
    exportName: "RasterTileLayer",
    category: "layer",
    source: "./components/layers/RasterTileLayer.vue",
  },
  {
    name: "MVTLayer",
    exportName: "MVTLayer",
    category: "layer",
    source: "./components/layers/MVTLayer.vue",
  },
  // M6 / issue #36：原生批量可视化图层（数据驱动，走 NativeLayerDriver 而不是 LayerDriver）。
  {
    name: "LineLayer",
    exportName: "LineLayer",
    category: "layer",
    source: "./components/layers/LineLayer.vue",
  },
  {
    name: "FillLayer",
    exportName: "FillLayer",
    category: "layer",
    source: "./components/layers/FillLayer.vue",
  },
  {
    name: "HeatmapLayer",
    exportName: "HeatmapLayer",
    category: "layer",
    source: "./components/layers/HeatmapLayer.vue",
  },
  {
    name: "TrackLineLayer",
    exportName: "TrackLineLayer",
    category: "layer",
    source: "./components/layers/TrackLineLayer.vue",
  },
  {
    name: "Panorama",
    exportName: "Panorama",
    category: "panorama",
    source: "./components/panorama/Panorama.vue",
  },
  {
    name: "PanoramaLabel",
    exportName: "PanoramaLabel",
    category: "panorama",
    source: "./components/panorama/PanoramaLabel.vue",
  },
] as const;
