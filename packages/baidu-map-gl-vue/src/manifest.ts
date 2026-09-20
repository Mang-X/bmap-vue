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
  { name: "BMap", exportName: "BMap", category: "core", source: "./components/map/BMap.vue" },
  {
    name: "BMarker",
    exportName: "BMarker",
    category: "overlay",
    source: "./components/overlays/BMarker.vue",
  },
  {
    name: "BInfoWindow",
    exportName: "BInfoWindow",
    category: "overlay",
    source: "./components/overlays/BInfoWindow.vue",
  },
  {
    name: "BCircle",
    exportName: "BCircle",
    category: "overlay",
    source: "./components/overlays/BCircle.vue",
  },
  {
    name: "BPolyline",
    exportName: "BPolyline",
    category: "overlay",
    source: "./components/overlays/BPolyline.vue",
  },
  {
    name: "BPolygon",
    exportName: "BPolygon",
    category: "overlay",
    source: "./components/overlays/BPolygon.vue",
  },
  {
    name: "BRectangle",
    exportName: "BRectangle",
    category: "overlay",
    source: "./components/overlays/BRectangle.vue",
  },
  {
    name: "BLabel",
    exportName: "BLabel",
    category: "overlay",
    source: "./components/overlays/BLabel.vue",
  },
  {
    name: "BContextMenu",
    exportName: "BContextMenu",
    category: "overlay",
    source: "./components/overlays/BContextMenu.vue",
  },
  // 声明式菜单项（M5-CUSTOM-MENU / #33）：两者都不渲染 DOM，只把「这里有一条菜单项 / 分隔线」
  // 注册给父级 <BContextMenu>。它们进 manifest 是为了让插件注册与 Volar 补全一致——
  // 声明式写法下调用方通常不 import 子组件。
  {
    name: "BMenuItem",
    exportName: "BMenuItem",
    category: "overlay",
    source: "./components/overlays/BMenuItem.vue",
  },
  {
    name: "BMenuSeparator",
    exportName: "BMenuSeparator",
    category: "overlay",
    source: "./components/overlays/BMenuSeparator.vue",
  },
  {
    name: "BCustomOverlay",
    exportName: "BCustomOverlay",
    category: "overlay",
    source: "./components/overlays/BCustomOverlay.vue",
  },
  {
    name: "BPrism",
    exportName: "BPrism",
    category: "overlay",
    source: "./components/overlays/BPrism.vue",
  },
  {
    name: "BGroundOverlay",
    exportName: "BGroundOverlay",
    category: "overlay",
    source: "./components/overlays/BGroundOverlay.vue",
  },
  {
    name: "BBezierCurve",
    exportName: "BBezierCurve",
    category: "overlay",
    source: "./components/overlays/BBezierCurve.vue",
  },
  {
    name: "BMapMask",
    exportName: "BMapMask",
    category: "overlay",
    source: "./components/overlays/BMapMask.vue",
  },
  {
    name: "BMarker3d",
    exportName: "BMarker3d",
    category: "overlay",
    source: "./components/overlays/BMarker3d.vue",
  },
  {
    name: "BAutoComplete",
    exportName: "BAutoComplete",
    category: "overlay",
    source: "./components/autocomplete/BAutoComplete.vue",
  },
  {
    name: "BPanoramaControl",
    exportName: "BPanoramaControl",
    category: "control",
    source: "./components/controls/BPanoramaControl.vue",
  },
  {
    name: "BControl",
    exportName: "BControl",
    category: "control",
    source: "./components/controls/BControl.vue",
  },
  {
    name: "BMarkerList",
    exportName: "BMarkerList",
    category: "data",
    source: "./components/data/BMarkerList.vue",
  },
  {
    name: "BPointCollection",
    exportName: "BPointCollection",
    category: "data",
    source: "./components/data/BPointCollection.vue",
  },
  {
    name: "BPointIconLayer",
    exportName: "BPointIconLayer",
    category: "data",
    source: "./components/data/BPointIconLayer.vue",
  },
  {
    name: "BPointLayer",
    exportName: "BPointLayer",
    category: "data",
    source: "./components/data/BPointLayer.vue",
  },
  {
    name: "BMarkerCluster",
    exportName: "BMarkerCluster",
    category: "data",
    source: "./components/data/BMarkerCluster.vue",
  },
  {
    name: "BZoom",
    exportName: "BZoom",
    category: "control",
    source: "./components/controls/BZoom.vue",
  },
  {
    name: "BNavigation",
    exportName: "BNavigation",
    category: "control",
    source: "./components/controls/BNavigation.vue",
  },
  {
    name: "BMapType",
    exportName: "BMapType",
    category: "control",
    source: "./components/controls/BMapType.vue",
  },
  {
    name: "BOverview",
    exportName: "BOverview",
    category: "control",
    source: "./components/controls/BOverview.vue",
  },
  {
    name: "BScale",
    exportName: "BScale",
    category: "control",
    source: "./components/controls/BScale.vue",
  },
  {
    name: "BCityList",
    exportName: "BCityList",
    category: "control",
    source: "./components/controls/BCityList.vue",
  },
  {
    name: "BLocation",
    exportName: "BLocation",
    category: "control",
    source: "./components/controls/BLocation.vue",
  },
  {
    name: "BNavigation3d",
    exportName: "BNavigation3d",
    category: "control",
    source: "./components/controls/BNavigation3d.vue",
  },
  {
    name: "BCopyright",
    exportName: "BCopyright",
    category: "control",
    source: "./components/controls/BCopyright.vue",
  },
  {
    name: "BDistrictLayer",
    exportName: "BDistrictLayer",
    category: "layer",
    source: "./components/layers/BDistrictLayer.vue",
  },
  {
    name: "BPanoramaCoverageLayer",
    exportName: "BPanoramaCoverageLayer",
    category: "layer",
    source: "./components/layers/BPanoramaCoverageLayer.vue",
  },
  {
    name: "BTileLayer",
    exportName: "BTileLayer",
    category: "layer",
    source: "./components/layers/BTileLayer.vue",
  },
  {
    name: "BTrafficLayer",
    exportName: "BTrafficLayer",
    category: "layer",
    source: "./components/layers/BTrafficLayer.vue",
  },
  {
    name: "BGeoJSONLayer",
    exportName: "BGeoJSONLayer",
    category: "layer",
    source: "./components/layers/BGeoJSONLayer.vue",
  },
  {
    name: "BDOMLayer",
    exportName: "BDOMLayer",
    category: "layer",
    source: "./components/layers/BDOMLayer.vue",
  },
  {
    name: "BXYZLayer",
    exportName: "BXYZLayer",
    category: "layer",
    source: "./components/layers/BXYZLayer.vue",
  },
  {
    name: "BWMSLayer",
    exportName: "BWMSLayer",
    category: "layer",
    source: "./components/layers/BWMSLayer.vue",
  },
  {
    name: "BWMTSLayer",
    exportName: "BWMTSLayer",
    category: "layer",
    source: "./components/layers/BWMTSLayer.vue",
  },
  {
    name: "BRasterLayer",
    exportName: "BRasterLayer",
    category: "layer",
    source: "./components/layers/BRasterLayer.vue",
  },
  // M6 / issue #36：原生批量可视化图层（数据驱动，走 NativeLayerDriver 而不是 LayerDriver）。
  {
    name: "BLineLayer",
    exportName: "BLineLayer",
    category: "layer",
    source: "./components/layers/BLineLayer.vue",
  },
  {
    name: "BFillLayer",
    exportName: "BFillLayer",
    category: "layer",
    source: "./components/layers/BFillLayer.vue",
  },
  {
    name: "BHeatmapLayer",
    exportName: "BHeatmapLayer",
    category: "layer",
    source: "./components/layers/BHeatmapLayer.vue",
  },
  {
    name: "BTrackLineLayer",
    exportName: "BTrackLineLayer",
    category: "layer",
    source: "./components/layers/BTrackLineLayer.vue",
  },
  {
    name: "BPanorama",
    exportName: "BPanorama",
    category: "panorama",
    source: "./components/panorama/BPanorama.vue",
  },
  {
    name: "BPanoramaLabel",
    exportName: "BPanoramaLabel",
    category: "panorama",
    source: "./components/panorama/BPanoramaLabel.vue",
  },
] as const;
