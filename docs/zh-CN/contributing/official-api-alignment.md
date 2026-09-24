<!-- Generated file. Do not edit directly. -->

# 公开 API 对照（vs 官方 React 参考）

> 由 `scripts/generate-api-diff.mts` 生成，请勿手工编辑。刷新：`pnpm generate:api-diff`，CI `--check`。

> **对照物**：维护者指定对齐 **[`huiyan-fe/react-bmap`](https://github.com/huiyan-fe/react-bmap)**（`@baidumap/react-bmap@2.0.6`，commit `fde5bbd3e5b4`），**不是**仍在开发中的 `@baidumap/vue-bmap`。

## 口径

- **本库**：根入口（`bmap-vue`）公开导出 = `componentManifest` ∪ `src/index.ts` ∪ `composables/index`；`./ui-kit` 子路径单独计数。
- **官方**：`src/index.ts` 上的重导出（与官方 barrel 同一口径）。
- **不含** deprecation 别名（#136 清理前本就不提供旧 `B*` 名）。
- 历史 ADR / migration 文档中的旧名**不**参与本表。

## 汇总

| 口径 | 数量 |
| --- | --- |
| 官方根入口导出 | 402 |
| 本库根入口导出 | 394 |
| 名称对齐（交集） | 110 |
| 仅官方有 | 292 |
| 仅本库有 | 284 |
| `./ui-kit` 子路径导出 | 55 |
| 手写语义例外 | 37 |

### 交集按面分布

component 45 · hook 14 · type 51

## 名称对齐

两侧同名的导出（组件 / hooks / 类型 / 常量）。

| 名称 | 面 | 本库 | 官方 React |
| --- | --- | --- | --- |
| `BezierCurve` | component | ✓ | ✓ |
| `BMapProvider` | component | ✓ | ✓ |
| `Circle` | component | ✓ | ✓ |
| `CityListControl` | component | ✓ | ✓ |
| `ContextMenu` | component | ✓ | ✓ |
| `CopyrightControl` | component | ✓ | ✓ |
| `CustomControl` | component | ✓ | ✓ |
| `CustomOverlay` | component | ✓ | ✓ |
| `DistrictLayer` | component | ✓ | ✓ |
| `DOMLayer` | component | ✓ | ✓ |
| `FillLayer` | component | ✓ | ✓ |
| `GeoJSONLayer` | component | ✓ | ✓ |
| `GroundOverlay` | component | ✓ | ✓ |
| `InfoWindow` | component | ✓ | ✓ |
| `Label` | component | ✓ | ✓ |
| `LineLayer` | component | ✓ | ✓ |
| `LocationControl` | component | ✓ | ✓ |
| `Map` | component | ✓ | ✓ |
| `MapMask` | component | ✓ | ✓ |
| `MapTypeControl` | component | ✓ | ✓ |
| `Marker` | component | ✓ | ✓ |
| `Marker3D` | component | ✓ | ✓ |
| `MenuItem` | component | ✓ | ✓ |
| `MVTLayer` | component | ✓ | ✓ |
| `NavigationControl` | component | ✓ | ✓ |
| `NavigationControl3D` | component | ✓ | ✓ |
| `OverviewMapControl` | component | ✓ | ✓ |
| `Panorama` | component | ✓ | ✓ |
| `PanoramaControl` | component | ✓ | ✓ |
| `PanoramaCoverageLayer` | component | ✓ | ✓ |
| `PanoramaLabel` | component | ✓ | ✓ |
| `PointCollection` | component | ✓ | ✓ |
| `PointIconLayer` | component | ✓ | ✓ |
| `Polygon` | component | ✓ | ✓ |
| `Polyline` | component | ✓ | ✓ |
| `Prism` | component | ✓ | ✓ |
| `RasterTileLayer` | component | ✓ | ✓ |
| `Rectangle` | component | ✓ | ✓ |
| `ScaleControl` | component | ✓ | ✓ |
| `TileLayer` | component | ✓ | ✓ |
| `TrafficLayer` | component | ✓ | ✓ |
| `WMSLayer` | component | ✓ | ✓ |
| `WMTSLayer` | component | ✓ | ✓ |
| `XYZLayer` | component | ✓ | ✓ |
| `ZoomControl` | component | ✓ | ✓ |
| `useConvertor` | hook | ✓ | ✓ |
| `useDrivingRoute` | hook | ✓ | ✓ |
| `useGeocoder` | hook | ✓ | ✓ |
| `useGeolocation` | hook | ✓ | ✓ |
| `useLocalSearch` | hook | ✓ | ✓ |
| `useMap` | hook | ✓ | ✓ |
| `useMapContext` | hook | ✓ | ✓ |
| `useMapEvent` | hook | ✓ | ✓ |
| `useMapReady` | hook | ✓ | ✓ |
| `useMapStatus` | hook | ✓ | ✓ |
| `usePanoramaService` | hook | ✓ | ✓ |
| `useRidingRoute` | hook | ✓ | ✓ |
| `useTransitRoute` | hook | ✓ | ✓ |
| `useWalkingRoute` | hook | ✓ | ✓ |
| `BezierCurveProps` | type | ✓ | ✓ |
| `BMapDriver` | type | ✓ | ✓ |
| `BMapProviderProps` | type | ✓ | ✓ |
| `Bounds` | type | ✓ | ✓ |
| `Capability` | type | ✓ | ✓ |
| `CircleProps` | type | ✓ | ✓ |
| `ContextMenuProps` | type | ✓ | ✓ |
| `ControlHandle` | type | ✓ | ✓ |
| `CustomOverlayProps` | type | ✓ | ✓ |
| `DrivingPolicy` | type | ✓ | ✓ |
| `DrivingRouteOptions` | type | ✓ | ✓ |
| `DrivingRouteResult` | type | ✓ | ✓ |
| `FillLayerProps` | type | ✓ | ✓ |
| `FillLayerStyle` | type | ✓ | ✓ |
| `GroundOverlayProps` | type | ✓ | ✓ |
| `InfoWindowProps` | type | ✓ | ✓ |
| `LabelProps` | type | ✓ | ✓ |
| `LayerHandle` | type | ✓ | ✓ |
| `LineLayerProps` | type | ✓ | ✓ |
| `LineLayerStyle` | type | ✓ | ✓ |
| `LocalSearchOptions` | type | ✓ | ✓ |
| `LocalSearchRenderOptions` | type | ✓ | ✓ |
| `MapHandle` | type | ✓ | ✓ |
| `MapMouseEvent` | type | ✓ | ✓ |
| `MapProps` | type | ✓ | ✓ |
| `MarkerProps` | type | ✓ | ✓ |
| `MenuItemProps` | type | ✓ | ✓ |
| `MVTLayerProps` | type | ✓ | ✓ |
| `OverlayHandle` | type | ✓ | ✓ |
| `PanoramaOptions` | type | ✓ | ✓ |
| `PanoramaPov` | type | ✓ | ✓ |
| `Pixel` | type | ✓ | ✓ |
| `Point` | type | ✓ | ✓ |
| `PointCollectionProps` | type | ✓ | ✓ |
| `PointIconLayerProps` | type | ✓ | ✓ |
| `PolygonProps` | type | ✓ | ✓ |
| `PolylineProps` | type | ✓ | ✓ |
| `PrismProps` | type | ✓ | ✓ |
| `RectangleProps` | type | ✓ | ✓ |
| `RidingRouteOptions` | type | ✓ | ✓ |
| `RidingRouteResult` | type | ✓ | ✓ |
| `RoutePlan` | type | ✓ | ✓ |
| `ServiceHandle` | type | ✓ | ✓ |
| `Size` | type | ✓ | ✓ |
| `TransitPolicy` | type | ✓ | ✓ |
| `TransitRouteOptions` | type | ✓ | ✓ |
| `TransitRouteResult` | type | ✓ | ✓ |
| `UnsupportedBehavior` | type | ✓ | ✓ |
| `ViewAnimationKeyFrames` | type | ✓ | ✓ |
| `WalkingRouteOptions` | type | ✓ | ✓ |
| `WalkingRouteResult` | type | ✓ | ✓ |

## 语义例外（手写）

| 本库 | 官方 | 类型 | 说明 |
| --- | --- | --- | --- |
| `MapExpose` | `MapRef` | renamed | 官方叫 `MapRef`；本库 expose 面是 `createExpose()` 拼出的只读命令集，命名对齐组件而非 ref 类型别名。 |
| `useMapContext` | `useBMapContext` | renamed | 官方仍保留 `useBMapContext`；#135 将 hooks 统一去 `BMap` 前缀，与 `useMap` / `Map` 组件一致。 |
| `useAreaBoundary` | `useBoundary` | renamed | 官方叫 `useBoundary`；本库语义是「行政区域边界」（AreaBoundary），与 `BoundaryResult` 成对。 |
| `Autocomplete` | — | ours-only | 官方只有 `useAutocomplete` hook，没有同名组件；本库有声明式 `<Autocomplete>` 薄封装。 |
| `MarkerCluster` | — | ours-only | 官方 React 封装没有聚合组件（参考清单 0 命中）。 |
| `MarkerList` | — | ours-only | 官方没有 `MarkerList`；本库数据组件。 |
| — | `useMapRef` | official-only | 官方专用 ref hook；本库等价路径是 `<Map>` ref + `MapExpose`（不另设 `useMapRef`）。 |
| — | `useCapabilities` | official-only | 官方 capability 读取 hook；本库能力目录在 `CAPABILITY_*` / `advanced` 入口，不镜像该 hook。 |
| — | `useDriver` | official-only | 官方 driver 逃生 hook；本库逃生口是 `./advanced` 的 `createJsapiV4Driver` / `unwrapRaw`。 |
| — | `BMapErrorBoundary` | official-only | React error boundary 形态；Vue 对应物是插件级错误上报，不提供同名组件。 |
| — | `PlaceDetail` | official-only | 官方根入口的详情面板；本库在 `bmap-vue/ui-kit` 子路径（根入口不碰 optional peer）。 |
| `PlaceSearch` | — | ours-only | 标准 UI 在 `./ui-kit` 子路径；官方 React 根清单未导出同名组件（它用 `RoutePlan` 类型名占位）。 |
| `BMapClient` | — | ours-only | Client 句柄类型；官方无同名导出。#135 只对齐组件 / hook / 基础类型名，不镜像本库 Client 面。 |
| `BMapClientContext` | — | ours-only | Client 注入上下文；官方无同名导出。保留 `BMap*` 前缀以区别于地图实例上下文。 |
| `BMapDriverFactory` | — | ours-only | Driver 工厂类型；#135 不把 raw-SDK 边界类型改名（会与 `BMapDriver` 断开）。 |
| `BMapDriverInput` | — | ours-only | Driver 构造入参；同上，raw-SDK 边界类型保留 `BMap*`。 |
| `BMapEngine` | — | ours-only | 引擎 id 判别类型（`"jsapi-v4"`）；官方无对应导出。 |
| `BMapDrivingRouteOptions` | — | ours-only | 路线服务选项；官方 hook 选项形态不同，不镜像同名 type。 |
| `BMapRidingRouteOptions` | — | ours-only | 骑行路线选项；同上。 |
| `BMapWalkingRouteOptions` | — | ours-only | 步行路线选项；同上。 |
| `BMapTransitRouteOptions` | — | ours-only | 公交路线选项；同上。 |
| `BMapGeolocationOptions` | — | ours-only | 定位选项；官方 hook 不导出同名 options。 |
| `BMapGeoResult` | — | ours-only | 地理编码结果 DTO；官方无同名 type。 |
| `BMapIpLocationResult` | — | ours-only | IP 定位结果 DTO；官方无同名 type。 |
| `BMapLocalSearchOptions` | — | ours-only | 本地检索 options；本库 service 层独立状态机，官方无同名 type。 |
| `BMapLocalSearchRenderOptions` | — | ours-only | 本地检索绘制 options；同上。 |
| `BMapLocalSearchOperation` | — | ours-only | 本地检索在飞操作标识；#104 归属模型的一部分，官方无对应。 |
| `BMapServiceStatus` | — | ours-only | 服务状态口径（`idle`/`loading`/…）；ADR 2026-09-14 单一事实源，不改名以免与 `ServiceCallStatus` 混淆。 |
| `BMapPluginConfig` | — | ours-only | 插件配置；官方无同名导出。 |
| `BMapProviderLike` | — | ours-only | Provider 结构类型；与组件 `BMapProvider` 成对，官方根 barrel 无同名 type。 |
| `CreateBMapClientOptions` | — | ours-only | `createBMapClient` 入参；Client 装配面不在 #135 组件 / hook 对齐范围。 |
| `CreateBMapPluginOptions` | — | ours-only | `createBMapPlugin` 入参；插件装配面不在 #135 组件 / hook 对齐范围。 |
| `bmapClientContextKey` | — | ours-only | Client 上下文 InjectionKey；Vue DI 键，官方 React 无对应。 |
| `bmapConfigKey` | — | ours-only | 插件配置 InjectionKey；同上。 |
| — | `BMapContextValue` | official-only | 官方 React context value 类型；Vue 对应是 `useMapContext` 返回面 / `MapContext*`。 |
| — | `BMapEvent` | official-only | 官方事件对象类型；本库 typed emits + `MapComponentEvent*` 矩阵。 |
| — | `BMapVersion` | official-only | 官方 SDK 版本类型；本库经 `BMapEngine` / loader 元数据表达。 |

## 仅官方有

官方 React 根入口导出、本库根入口没有的名字。含官方 `BMAP_*` 常量重导出（本库经 Driver 归一，不镜像裸常量面）。

| 名称 | 面 | 说明 |
| --- | --- | --- |
| `BaiduLayer` | component | — |
| `CanvasLayer` | component | — |
| `CAPABILITY_MATRIX` | component | — |
| `CustomLayer` | component | — |
| `FeatureLayer` | component | — |
| `GeolocationControl` | component | — |
| `GroundPoint` | component | — |
| `Hotspot` | component | — |
| `Icon` | component | — |
| `IconSequence` | component | — |
| `LogoControl` | component | — |
| `NormalLayer` | component | — |
| `PixelLayer` | component | — |
| `PlaceDetail` | component | 官方根入口的详情面板；本库在 `bmap-vue/ui-kit` 子路径（根入口不碰 optional peer）。 |
| `PlaceDetailPanel` | component | — |
| `PointShapeLayer` | component | — |
| `RawControl` | component | — |
| `RawOverlay` | component | — |
| `SimpleInfoWindow` | component | — |
| `Symbol` | component | — |
| `ThreeLayer` | component | — |
| `useAutocomplete` | hook | — |
| `useBMapContext` | hook | 官方仍保留 `useBMapContext`；#135 将 hooks 统一去 `BMap` 前缀，与 `useMap` / `Map` 组件一致。 |
| `useBoundary` | hook | 官方叫 `useBoundary`；本库语义是「行政区域边界」（AreaBoundary），与 `BoundaryResult` 成对。 |
| `useBusLineSearch` | hook | — |
| `useCapabilities` | hook | 官方 capability 读取 hook；本库能力目录在 `CAPABILITY_*` / `advanced` 入口，不镜像该 hook。 |
| `useDriver` | hook | 官方 driver 逃生 hook；本库逃生口是 `./advanced` 的 `createJsapiV4Driver` / `unwrapRaw`。 |
| `useIcon` | hook | — |
| `useLocalCity` | hook | — |
| `useMapRef` | hook | 官方专用 ref hook；本库等价路径是 `<Map>` ref + `MapExpose`（不另设 `useMapRef`）。 |
| `useOverlayTarget` | hook | — |
| `usePlaceDetail` | hook | — |
| `useRawControl` | hook | — |
| `useRawOverlay` | hook | — |
| `useSymbol` | hook | — |
| `useTruckRoute` | hook | — |
| `BMAP_ANCHOR_BOTTOM_CENTER` | constant | — |
| `BMAP_ANCHOR_BOTTOM_LEFT` | constant | — |
| `BMAP_ANCHOR_BOTTOM_RIGHT` | constant | — |
| `BMAP_ANCHOR_CENTER` | constant | — |
| `BMAP_ANCHOR_MIDDLE_LEFT` | constant | — |
| `BMAP_ANCHOR_MIDDLE_RIGHT` | constant | — |
| `BMAP_ANCHOR_TOP_CENTER` | constant | — |
| `BMAP_ANCHOR_TOP_LEFT` | constant | — |
| `BMAP_ANCHOR_TOP_RIGHT` | constant | — |
| `BMAP_ANIMATION_BOUNCE` | constant | — |
| `BMAP_ANIMATION_DROP` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_CONGESTION` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_CONGESTION_PAY` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_HIGHWAYS` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_CONGESTION` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_CONGESTION_PAY` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_HIGHWAYS_PAY` | constant | — |
| `BMAP_DRIVING_POLICY_AVOID_PAY` | constant | — |
| `BMAP_DRIVING_POLICY_DEFAULT` | constant | — |
| `BMAP_DRIVING_POLICY_DESTANCE` | constant | — |
| `BMAP_DRIVING_POLICY_DISTANCE_PRIORITY` | constant | — |
| `BMAP_DRIVING_POLICY_FIRST_HIGHWAYS` | constant | — |
| `BMAP_DRIVING_POLICY_HIGHWAYS_AVOID_CONGESTION` | constant | — |
| `BMAP_DRIVING_POLICY_TIME_PRIORITY` | constant | — |
| `BMAP_EARTH_MAP` | constant | — |
| `BMAP_HYBRID_MAP` | constant | — |
| `BMAP_LANG_CN` | constant | — |
| `BMAP_LANG_EN` | constant | — |
| `BMAP_MAPTYPE_CONTROL_DROPDOWN` | constant | — |
| `BMAP_MAPTYPE_CONTROL_HORIZONTAL` | constant | — |
| `BMAP_MAPTYPE_CONTROL_MAP` | constant | — |
| `BMAP_NAVIGATION_CONTROL_LARGE` | constant | — |
| `BMAP_NAVIGATION_CONTROL_PAN` | constant | — |
| `BMAP_NAVIGATION_CONTROL_SMALL` | constant | — |
| `BMAP_NAVIGATION_CONTROL_ZOOM` | constant | — |
| `BMAP_NORMAL_MAP` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_ARROW` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_ARROW_TAIL` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_CIRCLE` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_CROSS` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_DIAMOND` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_SQUARE` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_STAR` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_TRIANGLE` | constant | — |
| `BMAP_POINT_SHAPE_LAYER_WATERDROP` | constant | — |
| `BMAP_SATELLITE_MAP` | constant | — |
| `BMAP_SHAPE_CIRCLE` | constant | — |
| `BMAP_SHAPE_RECTANGLE` | constant | — |
| `BMAP_STATUS_CITY_LIST` | constant | — |
| `BMAP_STATUS_INVALID_KEY` | constant | — |
| `BMAP_STATUS_INVALID_REQUEST` | constant | — |
| `BMAP_STATUS_PERMISSION_DENIED` | constant | — |
| `BMAP_STATUS_SERVICE_UNAVAILABLE` | constant | — |
| `BMAP_STATUS_SUCCESS` | constant | — |
| `BMAP_STATUS_TIMEOUT` | constant | — |
| `BMAP_STATUS_UNKNOWN_LOCATION` | constant | — |
| `BMAP_STATUS_UNKNOWN_ROUTE` | constant | — |
| `BMAP_TRANSIT_POLICY_AVOID_SUBWAYS` | constant | — |
| `BMAP_TRANSIT_POLICY_FIRST_SUBWAYS` | constant | — |
| `BMAP_TRANSIT_POLICY_LEAST_TIME` | constant | — |
| `BMAP_TRANSIT_POLICY_LEAST_TRANSFER` | constant | — |
| `BMAP_TRANSIT_POLICY_LEAST_WALKING` | constant | — |
| `BMAP_TRANSIT_POLICY_RECOMMEND` | constant | — |
| `BMAP_UNIT_IMPERIAL` | constant | — |
| `BMAP_UNIT_METRIC` | constant | — |
| `AddressComponent` | type | — |
| `Animation` | type | — |
| `AutocompleteHookResult` | type | — |
| `AutocompleteOptions` | type | — |
| `AutocompleteResult` | type | — |
| `AutocompleteResultPoi` | type | — |
| `BaiduLayerOptions` | type | — |
| `BaiduLayerProps` | type | — |
| `BezierCurveOptions` | type | — |
| `BMapContextValue` | type | 官方 React context value 类型；Vue 对应是 `useMapContext` 返回面 / `MapContext*`。 |
| `BMapErrorBoundary` | type | React error boundary 形态；Vue 对应物是插件级错误上报，不提供同名组件。 |
| `BMapEvent` | type | 官方事件对象类型；本库 typed emits + `MapComponentEvent*` 矩阵。 |
| `BMapVersion` | type | 官方 SDK 版本类型；本库经 `BMapEngine` / loader 元数据表达。 |
| `BoundaryHookResult` | type | — |
| `BoundaryResult` | type | — |
| `BusLine` | type | — |
| `BusLineSearchHookResult` | type | — |
| `BusLineSearchOptions` | type | — |
| `BusListItem` | type | — |
| `BusListResult` | type | — |
| `BusStation` | type | — |
| `CanvasLayerOptions` | type | — |
| `CanvasLayerProps` | type | — |
| `CircleOptions` | type | — |
| `CityListControlOptions` | type | — |
| `CityListControlProps` | type | — |
| `ControlAnchor` | type | — |
| `ConvertorHookResult` | type | — |
| `CopyrightControlOptions` | type | — |
| `CopyrightControlProps` | type | — |
| `CopyrightItem` | type | — |
| `CustomControlProps` | type | — |
| `CustomLayerOptions` | type | — |
| `CustomLayerProps` | type | — |
| `CustomOverlayOptions` | type | — |
| `DisplayOptions` | type | — |
| `DistrictLayerOptions` | type | — |
| `DistrictLayerProps` | type | — |
| `DOMLayerOptions` | type | — |
| `DOMLayerProps` | type | — |
| `DrivingRouteHookResult` | type | — |
| `FeatureLayerOptions` | type | — |
| `FeatureLayerProps` | type | — |
| `FillLayerOptions` | type | — |
| `GeocoderHookResult` | type | — |
| `GeocoderResult` | type | — |
| `GeoJSONLayerOptions` | type | — |
| `GeoJSONLayerProps` | type | — |
| `GeolocationControlOptions` | type | — |
| `GeolocationControlProps` | type | — |
| `GeolocationHookResult` | type | — |
| `GeolocationResult` | type | — |
| `GroundOverlayOptions` | type | — |
| `GroundPointOptions` | type | — |
| `GroundPointProps` | type | — |
| `HotspotOptions` | type | — |
| `HotspotProps` | type | — |
| `IconOptions` | type | — |
| `IconProps` | type | — |
| `IconSequenceHandle` | type | — |
| `IconSequenceProps` | type | — |
| `InfoWindowOptions` | type | — |
| `LabelOptions` | type | — |
| `Language` | type | — |
| `LengthUnit` | type | — |
| `LineLayerOptions` | type | — |
| `LoadKeyComponents` | type | — |
| `LocalCityHookResult` | type | — |
| `LocalCityResult` | type | — |
| `LocalResult` | type | — |
| `LocalResultPoi` | type | — |
| `LocalSearchHookResult` | type | — |
| `LocationControlOptions` | type | — |
| `LocationControlProps` | type | — |
| `LogoControlOptions` | type | — |
| `LogoControlProps` | type | — |
| `MapContextValue` | type | — |
| `MapCustomArea` | type | — |
| `MapEvent` | type | — |
| `MapLabel` | type | — |
| `MapMaskOptions` | type | — |
| `MapMaskProps` | type | — |
| `MapMoveEvent` | type | — |
| `MapPanes` | type | — |
| `MapRef` | type | 官方叫 `MapRef`；本库 expose 面是 `createExpose()` 拼出的只读命令集，命名对齐组件而非 ref 类型别名。 |
| `MapSnapshot` | type | — |
| `MapStyleConfig` | type | — |
| `MapStyleV2Options` | type | — |
| `MapTypeControlOptions` | type | — |
| `MapTypeControlProps` | type | — |
| `MapTypeControlType` | type | — |
| `MapTypeId` | type | — |
| `MapZoomEvent` | type | — |
| `Marker3DOptions` | type | — |
| `Marker3DProps` | type | — |
| `MarkerOptions` | type | — |
| `MVTLayerOptions` | type | — |
| `NavigationControl3DOptions` | type | — |
| `NavigationControl3DProps` | type | — |
| `NavigationControlOptions` | type | — |
| `NavigationControlProps` | type | — |
| `NavigationControlType` | type | — |
| `NormalLayerOptions` | type | — |
| `NormalLayerProps` | type | — |
| `OpResult` | type | — |
| `OverlayReactProps` | type | — |
| `OverlayTargetContextValue` | type | — |
| `OverviewMapControlOptions` | type | — |
| `OverviewMapControlProps` | type | — |
| `PanoramaControlOptions` | type | — |
| `PanoramaControlProps` | type | — |
| `PanoramaCoverageLayerProps` | type | — |
| `PanoramaData` | type | — |
| `PanoramaLabelProps` | type | — |
| `PanoramaProps` | type | — |
| `PanoramaRef` | type | — |
| `PanoramaServiceHookResult` | type | — |
| `PixelLayerOptions` | type | — |
| `PixelLayerProps` | type | — |
| `PlaceDetailHookResult` | type | — |
| `PlaceDetailOptions` | type | — |
| `PlaceDetailPanelProps` | type | — |
| `PlaceDetailProps` | type | — |
| `PlaceDetailRenderOptions` | type | — |
| `PlainIcon` | type | — |
| `PointCollectionOptions` | type | — |
| `PointIconLayerOptions` | type | — |
| `PointIconStyle` | type | — |
| `PointShapeLayerOptions` | type | — |
| `PointShapeLayerProps` | type | — |
| `PointShapeLayerShapeType` | type | — |
| `PointShapeStyle` | type | — |
| `PolygonOptions` | type | — |
| `PolylineOptions` | type | — |
| `PredictDate` | type | — |
| `PrismOptions` | type | — |
| `Projection` | type | — |
| `RasterTileLayerOptions` | type | — |
| `RasterTileLayerProps` | type | — |
| `RawControlProps` | type | — |
| `RawOverlayProps` | type | — |
| `RectangleOptions` | type | — |
| `RenderOptions` | type | — |
| `RidingRouteHookResult` | type | — |
| `Route` | type | — |
| `ScaleControlOptions` | type | — |
| `ScaleControlProps` | type | — |
| `ServiceStatus` | type | — |
| `ShapeType` | type | — |
| `SimpleInfoWindowOptions` | type | — |
| `SimpleInfoWindowProps` | type | — |
| `Step` | type | — |
| `SymbolIcon` | type | — |
| `SymbolOptions` | type | — |
| `SymbolProps` | type | — |
| `SymbolShapeType` | type | — |
| `TaxiFare` | type | — |
| `TaxiFareDetail` | type | — |
| `ThreeLayerHook` | type | — |
| `ThreeLayerInstance` | type | — |
| `ThreeLayerOptions` | type | — |
| `ThreeLayerProps` | type | — |
| `ThreeLayerRef` | type | — |
| `ThreeObject` | type | — |
| `TileLayerOptions` | type | — |
| `TileLayerProps` | type | — |
| `TrafficLayerOptions` | type | — |
| `TrafficLayerProps` | type | — |
| `TransitLine` | type | — |
| `TransitPlan` | type | — |
| `TransitRouteHookResult` | type | — |
| `TranslateResults` | type | — |
| `TruckRouteHookResult` | type | — |
| `TruckRouteOptions` | type | — |
| `UnsupportedCapabilityError` | type | — |
| `ViewAnimation` | type | — |
| `ViewAnimationOptions` | type | — |
| `Viewport` | type | — |
| `ViewportOptions` | type | — |
| `WalkingRouteHookResult` | type | — |
| `WMSLayerOptions` | type | — |
| `WMSLayerProps` | type | — |
| `WMTSLayerOptions` | type | — |
| `WMTSLayerProps` | type | — |
| `XYZLayerOptions` | type | — |
| `XYZLayerProps` | type | — |
| `ZoomControlOptions` | type | — |
| `ZoomControlProps` | type | — |
| `createDriver` | other | — |
| `getSdkConstant` | other | — |
| `tryOp` | other | — |

## 仅本库有

本库扩展面（服务底座、聚合 / 列表组件、事件矩阵、能力目录、插件 catalog 等）。官方清单没有对应物不等于能力缺失——见 Capability Catalog。

| 名称 | 面 | 说明 |
| --- | --- | --- |
| `Autocomplete` | component | 官方只有 `useAutocomplete` hook，没有同名组件；本库有声明式 `<Autocomplete>` 薄封装。 |
| `HeatmapLayer` | component | — |
| `MarkerCluster` | component | 官方 React 封装没有聚合组件（参考清单 0 命中）。 |
| `MarkerList` | component | 官方没有 `MarkerList`；本库数据组件。 |
| `MenuSeparator` | component | — |
| `PointLayer` | component | — |
| `TrackLineLayer` | component | — |
| `useAreaBoundary` | hook | 官方叫 `useBoundary`；本库语义是「行政区域边界」（AreaBoundary），与 `BoundaryResult` 成对。 |
| `useControllableState` | hook | — |
| `useGeocodeDetail` | hook | — |
| `useIpLocation` | hook | — |
| `useMarkerIcons` | hook | — |
| `useOptionalClientContext` | hook | — |
| `useOverlaySpec` | hook | — |
| `useParentOverlayHandle` | hook | — |
| `useRequiredClientContext` | hook | — |
| `useSdkResource` | hook | — |
| `useServiceTask` | hook | — |
| `useViewAnimation` | hook | — |
| `BMAP_COMPONENT_EVENT_ALIASES` | constant | — |
| `BMAP_COMPONENT_EVENT_CATALOG` | constant | — |
| `BMapClientContext` | type | Client 注入上下文；官方无同名导出。保留 `BMap*` 前缀以区别于地图实例上下文。 |
| `BMapDrivingRouteOptions` | type | 路线服务选项；官方 hook 选项形态不同，不镜像同名 type。 |
| `BMapGeolocationOptions` | type | 定位选项；官方 hook 不导出同名 options。 |
| `BMapGeoResult` | type | 地理编码结果 DTO；官方无同名 type。 |
| `BMapIpLocationResult` | type | IP 定位结果 DTO；官方无同名 type。 |
| `BMapLocalSearchOptions` | type | 本地检索 options；本库 service 层独立状态机，官方无同名 type。 |
| `BMapLocalSearchRenderOptions` | type | 本地检索绘制 options；同上。 |
| `BMapRidingRouteOptions` | type | 骑行路线选项；同上。 |
| `BMapServiceStatus` | type | 服务状态口径（`idle`/`loading`/…）；ADR 2026-09-14 单一事实源，不改名以免与 `ServiceCallStatus` 混淆。 |
| `BMapTransitRouteOptions` | type | 公交路线选项；同上。 |
| `BMapWalkingRouteOptions` | type | 步行路线选项；同上。 |
| `CapabilityStatus` | type | — |
| `CircleHandle` | type | — |
| `ClientStatus` | type | — |
| `ContextMenuSelectPayload` | type | — |
| `ControlOptionStatus` | type | — |
| `CreateBMapClientOptions` | type | `createBMapClient` 入参；Client 装配面不在 #135 组件 / hook 对齐范围。 |
| `CreateBMapPluginOptions` | type | `createBMapPlugin` 入参；插件装配面不在 #135 组件 / hook 对齐范围。 |
| `createClientContext` | type | — |
| `DataComponentProps` | type | — |
| `DisposeContext` | type | — |
| `FeatureStateUpdateOptions` | type | — |
| `GeocodeDetailItemResult` | type | — |
| `GeocodeDetailResult` | type | — |
| `GeocodeItemResult` | type | — |
| `HeatmapLayerProps` | type | — |
| `InfoWindowHandle` | type | — |
| `InitialMapOptions` | type | — |
| `LabelHandle` | type | — |
| `LocalSearchResult` | type | — |
| `MapContext` | type | — |
| `MapEventPayload` | type | — |
| `MapLoadEvent` | type | — |
| `MapLoadPayload` | type | — |
| `MapPointerEvent` | type | — |
| `MapReadyContext` | type | — |
| `MapResizeEvent` | type | — |
| `MapResizePayload` | type | — |
| `MapRuntimeStatus` | type | — |
| `MapStatus` | type | — |
| `MapTypeChangeEvent` | type | — |
| `MapTypeChangePayload` | type | — |
| `MarkerClusterProps` | type | — |
| `MarkerHandle` | type | — |
| `MarkerListProps` | type | — |
| `MVTLayerBaseEvent` | type | — |
| `MVTLayerMouseEvent` | type | — |
| `MVTLayerMouseMoveEvent` | type | — |
| `MVTLayerPickEvent` | type | — |
| `NativeLayerCommonProps` | type | — |
| `NativeLayerPickOptions` | type | — |
| `OverlayEventPayload` | type | — |
| `OverlayPartialPointerEvent` | type | — |
| `OverlayPointerEvent` | type | — |
| `PanoramaLabelHandle` | type | — |
| `PanoramaLabelOptions` | type | — |
| `PointLayerProps` | type | — |
| `PolygonHandle` | type | — |
| `PolylineHandle` | type | — |
| `ResolvedMapEvent` | type | — |
| `resolveMapContext` | type | — |
| `ResourceScopeOptions` | type | — |
| `RouteRenderOptions` | type | — |
| `RouteResult` | type | — |
| `RouteServiceHandle` | type | — |
| `SdkResourceStatus` | type | — |
| `ServiceCallStatus` | type | — |
| `ServiceInvokeContext` | type | — |
| `ServiceResult` | type | — |
| `TargetContext` | type | — |
| `TrackLineLayerProps` | type | — |
| `UseControllableStateOptions` | type | — |
| `UseMapEventOptions` | type | — |
| `UseMapStatusOptions` | type | — |
| `UseOverlaySpecOptions` | type | — |
| `UseOverlaySpecResult` | type | — |
| `UseServiceTaskOptions` | type | — |
| `UseViewAnimationOptions` | type | — |
| `ViewAnimationStatus` | type | — |
| `AreaBoundary` | other | — |
| `BMapClient` | other | Client 句柄类型；官方无同名导出。#135 只对齐组件 / hook / 基础类型名，不镜像本库 Client 面。 |
| `bmapClientContextKey` | other | Client 上下文 InjectionKey；Vue DI 键，官方 React 无对应。 |
| `bmapConfigKey` | other | 插件配置 InjectionKey；同上。 |
| `BMapDriverFactory` | other | Driver 工厂类型；#135 不把 raw-SDK 边界类型改名（会与 `BMapDriver` 断开）。 |
| `BMapDriverInput` | other | Driver 构造入参；同上，raw-SDK 边界类型保留 `BMap*`。 |
| `BMapEngine` | other | 引擎 id 判别类型（`"jsapi-v4"`）；官方无对应导出。 |
| `BMapLocalSearchOperation` | other | 本地检索在飞操作标识；#104 归属模型的一部分，官方无对应。 |
| `BMapPluginConfig` | other | 插件配置；官方无同名导出。 |
| `BMapProviderLike` | other | Provider 结构类型；与组件 `BMapProvider` 成对，官方根 barrel 无同名 type。 |
| `BoundaryRings` | other | — |
| `BUILTIN_PLUGIN_CATALOG` | other | — |
| `BUILTIN_PLUGIN_NAMES` | other | — |
| `BUILTIN_PLUGIN_URLS` | other | — |
| `CapabilityDescriptor` | other | — |
| `CapabilityExplanation` | other | — |
| `CapabilityFamily` | other | — |
| `CapabilityRegistry` | other | — |
| `ClusterChange` | other | — |
| `ClusterPick` | other | — |
| `ContextMenuItem` | other | — |
| `ContextMenuSeparator` | other | — |
| `ControlDriver` | other | — |
| `ControlKind` | other | — |
| `ControllableMode` | other | — |
| `ControllableState` | other | — |
| `CoordinatesFromType` | other | — |
| `CoordinatesToType` | other | — |
| `createBMapClientDefinition` | other | — |
| `createBMapPlugin` | other | — |
| `createDeprecationWarner` | other | — |
| `defaultClientDefinitionKey` | other | — |
| `DEPRECATED_EVENT_ALIAS_CODE` | other | — |
| `DEPRECATED_PROP_ALIAS_CODE` | other | — |
| `DeprecationNotice` | other | — |
| `DeprecationWarner` | other | — |
| `describeDeprecation` | other | — |
| `Disposer` | other | — |
| `DistrictType` | other | — |
| `DistrictTypeValue` | other | — |
| `drawingManagerPlugin` | other | — |
| `DrivingRouteEndpoint` | other | — |
| `DrivingRouteRequest` | other | — |
| `dynamicEmit` | other | — |
| `EqualFn` | other | — |
| `eventAliasesOf` | other | — |
| `EventDriver` | other | — |
| `FeaturePick` | other | — |
| `FeatureStateApi` | other | — |
| `FeatureStateKeyDomain` | other | — |
| `FeatureStateKeys` | other | — |
| `FeatureStateKeysOf` | other | — |
| `GeocodedAddress` | other | — |
| `GeocodedAddressComponents` | other | — |
| `GeocodeDetailAddressComponents` | other | — |
| `GeometryDriver` | other | — |
| `GeoPoint` | other | — |
| `geoUtilsPlugin` | other | — |
| `GroundOverlayType` | other | — |
| `GroundOverlayUrl` | other | — |
| `IntercityPolicy` | other | — |
| `JsapiV4Driver` | other | — |
| `LabelStyle` | other | — |
| `LayerDriver` | other | — |
| `LoadedSdk` | other | — |
| `LocalSearchBounds` | other | — |
| `LocalSearchInBoundsRequest` | other | — |
| `LocalSearchKeyword` | other | — |
| `LocalSearchLocation` | other | — |
| `LocalSearchNearbyRequest` | other | — |
| `LocalSearchPoi` | other | — |
| `LocalSearchSearchOption` | other | — |
| `MAP_EVENT_CATALOG` | other | — |
| `MAP_EVENT_EMIT_ALIASES` | other | — |
| `MAP_EVENT_NAMES` | other | — |
| `MAP_SUSPEND_REASONS` | other | — |
| `MapCommands` | other | — |
| `MapComponentEmitName` | other | — |
| `MapComponentEventName` | other | — |
| `MapDriver` | other | — |
| `MapEventDefinition` | other | — |
| `MapEventHandler` | other | — |
| `MapEventMap` | other | — |
| `MapEventName` | other | — |
| `MapEventPayloadForName` | other | — |
| `MapEventPayloadKind` | other | — |
| `MapEventPayloadOf` | other | — |
| `MapEventSdkName` | other | — |
| `MapEventSource` | other | — |
| `MapEventSourceInput` | other | — |
| `MapExpose` | other | 官方叫 `MapRef`；本库 expose 面是 `createExpose()` 拼出的只读命令集，命名对齐组件而非 ref 类型别名。 |
| `MapInteraction` | other | — |
| `MapMaskShowRegion` | other | — |
| `MapStatusRefs` | other | — |
| `MapStyleInput` | other | — |
| `MapSuspendReason` | other | — |
| `MapType` | other | — |
| `mapVglPlugin` | other | — |
| `MapView` | other | — |
| `MarkerClusterEngine` | other | — |
| `MarkerCustomIcon` | other | — |
| `MarkerIcon` | other | — |
| `MarkerIconName` | other | — |
| `mvtFeatureStateKey` | other | — |
| `MVTLayerEntity` | other | — |
| `MVTLayerStyle` | other | — |
| `MVTLayerStyleEntry` | other | — |
| `NativeLayerDriver` | other | — |
| `NativeLayerKind` | other | — |
| `NativeLayerOperation` | other | — |
| `normalizeEventKey` | other | — |
| `OVERLAY_EVENT_ALIASES` | other | — |
| `OVERLAY_EVENT_MATRIX` | other | — |
| `OVERLAY_KINDS_WITHOUT_EVENT_MATRIX` | other | — |
| `OVERLAY_PROP_ALIASES` | other | — |
| `OverlayDriver` | other | — |
| `OverlayEventAlias` | other | — |
| `OverlayEventDefinition` | other | — |
| `OverlayEventMatrixEntry` | other | — |
| `OverlayEventMatrixKey` | other | — |
| `overlayEventOf` | other | — |
| `OverlayEventPayloadKind` | other | — |
| `overlayEventsOf` | other | — |
| `OverlayEventSpec` | other | — |
| `OverlayFieldMap` | other | — |
| `OverlayFieldUpdate` | other | — |
| `OverlayFieldWatch` | other | — |
| `OverlayKind` | other | — |
| `overlayPointerFallback` | other | — |
| `OverlayPositionModel` | other | — |
| `OverlayPropAlias` | other | — |
| `OverlaySpec` | other | — |
| `PanoramaDataInfo` | other | — |
| `PanoramaDriver` | other | — |
| `PanoramaPoiType` | other | — |
| `PanoramaSceneType` | other | — |
| `PanoramaViewerDriver` | other | — |
| `PluginCatalogEntry` | other | — |
| `PointInput` | other | — |
| `PointLike` | other | — |
| `PointPick` | other | — |
| `propAliasesOf` | other | — |
| `resolveMapEventName` | other | — |
| `resolvePluginDefinition` | other | — |
| `ResourceScope` | other | — |
| `RouteEndpoint` | other | — |
| `RouteEndpointInfo` | other | — |
| `RouteEndpointPoi` | other | — |
| `RouteLeg` | other | — |
| `RouteRenderState` | other | — |
| `RouteRequest` | other | — |
| `RouteServiceKind` | other | — |
| `RouteState` | other | — |
| `RouteStep` | other | — |
| `RouteTaxiFare` | other | — |
| `RouteTaxiFareDetail` | other | — |
| `SdkResourceSpec` | other | — |
| `ServiceCall` | other | — |
| `ServiceDriver` | other | — |
| `ServiceErrorInfo` | other | — |
| `ServiceInvocationDriver` | other | — |
| `ServiceTask` | other | — |
| `SizeLike` | other | — |
| `stringToPluginDefinitions` | other | — |
| `StyleExpression` | other | — |
| `SupersedeMode` | other | — |
| `SupersedePolicy` | other | — |
| `targetContextKey` | other | — |
| `TargetKind` | other | — |
| `toSdkEventName` | other | — |
| `toVueEventName` | other | — |
| `trackAnimationPlugin` | other | — |
| `TrackLineLayerExpose` | other | — |
| `TrackLineObserved` | other | — |
| `TransitLineSegment` | other | — |
| `TransitRoutePlan` | other | — |
| `TransitRouteRequest` | other | — |
| `TransitRouteSegment` | other | — |
| `TransitVehiclePolicy` | other | — |
| `TransitWalkSegment` | other | — |
| `urlPluginDefinition` | other | — |
| `UseViewAnimationReturn` | other | — |
| `Vue3BaiduMapGlResolver` | other | — |
| `XYLike` | other | — |

## `./ui-kit` 子路径

根入口**不**重导出 UI（ADR Official-first）。下列名字只从 `bmap-vue/ui-kit` 解析：

- `isUiKitLoaded`
- `loadUiKit`
- `PlaceAutocomplete`
- `PlaceAutocompleteDisplayDTO`
- `PlaceAutocompleteProps`
- `PlaceBoundsDTO`
- `PlaceDetail`
- `PlaceDetailDisplayDTO`
- `PlaceDetailDTO`
- `PlaceDetailPlaceInput`
- `PlaceDetailPlaceObject`
- `PlaceDetailProps`
- `PlaceHighlightChangeDTO`
- `PlaceHighlightDTO`
- `PlacePoiDTO`
- `PlacePointDTO`
- `PlaceSearch`
- `PlaceSearchDisplayDTO`
- `PlaceSearchProps`
- `PlaceSuggestionDTO`
- `RouteDriveSegmentDTO`
- `RoutePlanDrivingOptionsDTO`
- `RoutePlanDrivingPolicy`
- `RoutePlanDTO`
- `RoutePlanEndpointInput`
- `RoutePlanMode`
- `RoutePlanNavClickDTO`
- `RoutePlanPlanSelectDTO`
- `RoutePlanProps`
- `RoutePlanResultDTO`
- `RoutePlanSearchOptionsDTO`
- `RoutePlanTypeChangeDTO`
- `RoutePointDTO`
- `RouteRidingSegmentDTO`
- `RouteSegmentBaseDTO`
- `RouteSegmentDTO`
- `RouteSegmentType`
- `RouteTransitSegmentDTO`
- `RouteTransitSubType`
- `RouteWalkSegmentDTO`
- `UI_KIT_PACKAGE`
- `UI_KIT_STYLE_PATH`
- `UiKitAutocompleteWidget`
- `UiKitModule`
- `UiKitPlaceDetailWidget`
- `UiKitRoutePlanWidget`
- `UiKitSearchWidget`
- `UiKitSubscription`
- `UiKitWidgetHandle`
- `UiKitWidgetOptions`
- `UiKitWidgetStatus`
- `useUiKitWidget`
- `UseUiKitWidgetOptions`
- `UseUiKitWidgetResult`

## 刷新官方清单

官方清单是**快照**，不自动拉网。上游 bump 后：

1. clone `huiyan-fe/react-bmap` 到临时目录，checkout 对应 commit；
2. 抽取 `src/index.ts` 重导出与定义 `kind`，覆写 `scripts/api-diff/official-react-bmap-<version>.json`；
3. `pnpm generate:api-diff` 并提交 JSON + 文档。
