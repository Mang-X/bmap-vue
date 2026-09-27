/**
 * 公共入口(packages/bmap-vue)
 *
 * 仅导出稳定公共 API。core 内部实现不直接暴露。
 */
// 组件
export * from "./components/index";
// 业务层 composables
export * from "./composables/index";
// 插件/安装
export { createBMapPlugin, bmapConfigKey } from "./plugins/createBMapPlugin";
export type { BMapPluginConfig, CreateBMapPluginOptions } from "./plugins/createBMapPlugin";
// 内置插件 definitions
export {
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  geoUtilsPlugin,
  urlPluginDefinition,
  BUILTIN_PLUGIN_URLS,
} from "./plugins/builtins";
// 插件 Catalog（M8-PLUGIN-CORE / #42）：名字 → definition 的单一事实源。
// `resolvePluginDefinition` 对未知名字抛 `BMAP_PLUGIN_UNKNOWN`（不再静默降级成空实现）。
export {
  BUILTIN_PLUGIN_CATALOG,
  BUILTIN_PLUGIN_NAMES,
  resolvePluginDefinition,
  stringToPluginDefinitions,
} from "./plugins/catalog";
export type { PluginCatalogEntry } from "./plugins/catalog";
// Provider:结构化的 v4 家族在 `./advanced` 子入口公开（M3A3-REMOVE-LEGACY / #26 之后根入口
// 不再导出任何 Provider factory——原先那三个是 legacy 的 `baiduCdnProvider` 家族；
// #44 取消 `./core` 后落点是 `./advanced`）。根入口不导出它们，见 export-surface-freeze.test.ts。
// Resolver
export { BMapResolver } from "./resolver/index";
// 公开类型(与组件 props 对齐,单一来源 src/types/components.ts)
export type {
  MapProps,
  MapTypeIdName,
  MarkerProps,
  InfoWindowProps,
  CircleProps,
  PolylineProps,
  LabelProps,
  LabelStyle,
  PolygonProps,
  RectangleProps,
  BezierCurveProps,
  PrismProps,
  GroundOverlayProps,
  GroundOverlayType,
  GroundOverlayUrl,
  DataComponentProps,
  MarkerListProps,
  MarkerClusterProps,
  MarkerClusterEngine,
  ClusterPick,
  ClusterChange,
  PointCollectionProps,
  PointIconLayerProps,
  PointLayerProps,
  PointPick,
  FeaturePick,
  StyleExpression,
  LineLayerStyle,
  FillLayerStyle,
  NativeLayerCommonProps,
  NativeLayerPickOptions,
  LineLayerProps,
  FillLayerProps,
  HeatmapLayerProps,
  TrackLineLayerProps,
  TrackLineObserved,
  TrackLineLayerExpose,
  // #166：官方 4.0.5 `visualization/PolygonLayer` / `PolylineLayer`
  // （官方指定的 `FillLayer` / `LineLayer` 替代）的公共类型。
  PolygonLayerProps,
  PolygonLayerStyle,
  PolylineLayerProps,
  PolylineLayerStyle,
  VisualizationStyleValue,
  VisualizationLayerCommonProps,
  VisualizationPickOptions,
  VisualizationZoomCtorOptions,
  // #166 第二刀：官方 4.0.5 `visualization/TextLayer`（批量文字标注）的公共类型。
  TextLayerProps,
  TextLayerStyle,
  TextLayerPick,
  TextLayerAnchor,
  /* --- issue #165 第三批：`Marker.label` / `Label.anchor` / 聚合图标来源的公共类型。
   *
   * 这三个**必须**是公共导出而不是 `ae-forgotten-export`：它们出现在已导出的
   * `MarkerProps.label` / `LabelProps.anchor` / `MarkerClusterProps.clusterIcon` 的签名里，
   * 消费方因此**无法命名**它们（`import type { … }` 取不到）——按 ADR
   * `2026-09-25-public-export-surface-freeze` 的二选一走**第一条**（升为公共导出）。
   *
   * 与 `MarkerIcon` / `LabelStyle` 同一层理由：它们是 props 上**公开可传**的形状，
   * 调用方组装 props 时要的就是这个类型。
   */
  MarkerLabelSpec,
  OverlayAnchor,
  ClusterPointIconSource,
} from "./types/components";
// core 领域类型(供业务使用)
export type { MapContext, MapReadyContext, MapStatus } from "./core/context/types";
export { useMapContext, useMapReady, useMap } from "./composables/useMap";
// Client Context(服务类 composable 默认依赖,无需 Map 即可使用)
export {
  bmapClientContextKey,
  createClientContext,
  defaultClientDefinitionKey,
  useOptionalClientContext,
  useRequiredClientContext,
} from "./core/context/client";
export type { BMapClientContext, ClientStatus } from "./core/context/client";
// Target Context(嵌套挂载目标)
export { targetContextKey, useParentOverlayHandle } from "./core/context/target";
export type { TargetContext, TargetKind } from "./core/context/target";
// 统一资源生命周期
export { useSdkResource } from "./core/composables/useSdkResource";
export type { SdkResourceSpec, SdkResourceStatus } from "./core/composables/useSdkResource";
// 要素状态命令面（M6 / #36）：`<LineLayer>` / `<FillLayer>` / `<PointCollection>` 的 ref expose
// 拿到的是这个类型。只导出**类型**——创建它需要 Driver 与句柄，那是内核的职责。
export type {
  FeatureStateApi,
  FeatureStateKeys,
  FeatureStateKeysOf,
  FeatureStateKeyDomain,
  FeatureStateUpdateOptions,
} from "./core/data/featureState";
export { mvtFeatureStateKey } from "./core/data/featureState";
// 声明式覆盖物生命周期（M5-SPEC-MARKER / #30）：组件只声明 OverlaySpec，其余由这里驱动
export { useOverlaySpec } from "./core/composables/useOverlaySpec";
export { dynamicEmit } from "./core/composables/dynamicEmit";
export type {
  OverlayPositionModel,
  UseOverlaySpecOptions,
  UseOverlaySpecResult,
} from "./core/composables/useOverlaySpec";
export type {
  OverlayEventSpec,
  OverlayFieldMap,
  OverlayFieldUpdate,
  OverlayFieldWatch,
  OverlaySpec,
} from "./core/overlays/OverlaySpec";
// 覆盖物事件矩阵（M5-VECTORS / #31）：按 kind 的事件面、载荷档与「需要编辑能力」的单一事实源。
// 与 map 事件 Catalog 同一分工——组件的 emits、内核的订阅、文档表格都从这里出发。
export {
  OVERLAY_EVENT_MATRIX,
  OVERLAY_KINDS_WITHOUT_EVENT_MATRIX,
  overlayEventOf,
  overlayEventsOf,
  overlayPointerFallback,
} from "./core/overlays/overlayEventCatalog";
export type {
  OverlayEventDefinition,
  OverlayEventMatrixEntry,
  OverlayEventMatrixKey,
  OverlayEventPayloadKind,
} from "./core/overlays/overlayEventCatalog";
// 覆盖物事件的公共载荷（三档：必填坐标 / 坐标可缺 / 只有底座）
export type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "./driver/types/events";
export type { OverlayKind } from "./driver/types/overlays";
export { ResourceScope } from "./core/lifecycle/ResourceScope";
export type { Disposer, ResourceScopeOptions } from "./core/lifecycle/ResourceScope";
export type { BMapProviderProps } from "./components/provider/BMapProvider.vue";

// Client/Driver 领域类型(稳定公开,raw SDK 只在 ./advanced)
export { createBMapClientDefinition } from "./client";
export type {
  BMapClient,
  BMapDriverFactory,
  BMapDriverInput,
  BMapProviderLike,
  CreateBMapClientOptions,
} from "./client/types";
export type { LoadedJsapiV4 } from "./core/loader/loaded";
export type { BMapDriver, BMapEngine } from "./driver/types/bmap";
export type {
  MapHandle,
  OverlayHandle,
  MarkerHandle,
  InfoWindowHandle,
  PolylineHandle,
  PolygonHandle,
  CircleHandle,
  LabelHandle,
  ControlHandle,
  LayerHandle,
  ServiceHandle,
  // 句柄基类：`ContextMenuSelectPayload.target` 用到它（目标可能是地图也可能是标注）
  SdkHandle,
} from "./driver/types/handles";
// Map 命令面与暂停原因（M4-HANDLE-UX / issue #29）
//
// `MapExpose` 是 `<Map ref>` 拿到的**组件级命令面**（常用 get/set/pan/fit/checkResize/supports
// + 生命周期 + 暂停策略），`MapHandle` 是 Driver 层的 SDK 句柄 —— 两者分工见
// `src/types/mapExpose.ts` 的命名对照表。raw SDK 对象只经 `./advanced` 的 `unwrapRaw()`。
export type { MapExpose } from "./types/mapExpose";
export type { MapCommands } from "./core/runtime/mapCommands";
export { MAP_SUSPEND_REASONS } from "./core/runtime/suspension";
export type { MapSuspendReason } from "./core/runtime/suspension";
export type {
  Point,
  PointInput,
  Pixel,
  Size,
  Bounds,
} from "./driver/types/geometry";
export type {
  Capability,
  CapabilityDescriptor,
  CapabilityFamily,
  CapabilityRegistry,
  CapabilityStatus,
  CapabilityExplanation,
} from "./driver/capability";
export type { UnsupportedBehavior } from "./driver/capability";
export type {
  MapLoadEvent,
  MapMouseEvent,
  MapResizeEvent,
  MapTypeChangeEvent,
} from "./driver/types/events";
// 事件 Catalog（M4-EVENTS / #28）：事件名、SDK 拼写与载荷类型的单一事实源。
// `<Map>` 的 emits、`useMapEvent` 的订阅名解析与文档表格都从这里出发。
export {
  BMAP_COMPONENT_EVENT_CATALOG,
  MAP_EVENT_CATALOG,
  MAP_EVENT_EMIT_ALIASES,
  MAP_EVENT_NAMES,
  normalizeEventKey,
  resolveMapEventName,
  toSdkEventName,
  toVueEventName,
} from "./core/events/eventCatalog";
export type {
  MapComponentEventName,
  MapEventDefinition,
  MapEventMap,
  MapEventName,
  MapEventPayload,
  MapEventPayloadKind,
  MapEventPayloadOf,
  MapEventSdkName,
  MapLoadPayload,
  MapPointerEvent,
  MapResizePayload,
  MapTypeChangePayload,
  ResolvedMapEvent,
} from "./core/events/eventCatalog";
// 服务归一化调用面的领域类型（#38 起 service composable 的公开签名用到它们）
export type {
  BoundaryRings,
  DrivingRouteEndpoint,
  DrivingRouteOptions,
  DrivingRouteRequest,
  DrivingRouteResult,
  GeocodedAddress,
  GeocodedAddressComponents,
  LocalSearchBounds,
  LocalSearchInBoundsRequest,
  LocalSearchKeyword,
  LocalSearchNearbyRequest,
  LocalSearchOptions,
  LocalSearchPoi,
  LocalSearchRenderOptions,
  LocalSearchResult,
  LocalSearchSearchOption,
  RidingRouteOptions,
  RidingRouteResult,
  RouteEndpoint,
  RouteEndpointInfo,
  RouteEndpointPoi,
  RouteLeg,
  RoutePlan,
  RouteRenderOptions,
  RouteRenderState,
  RouteRequest,
  RouteResult,
  RouteServiceHandle,
  RouteServiceKind,
  RouteState,
  RouteStep,
  RouteTaxiFare,
  RouteTaxiFareDetail,
  ServiceCallStatus,
  ServiceErrorInfo,
  ServiceInvocationDriver,
  TransitLineSegment,
  TransitRouteOptions,
  TransitRoutePlan,
  TransitRouteRequest,
  TransitRouteResult,
  TransitRouteSegment,
  TransitWalkSegment,
  WalkingRouteOptions,
  WalkingRouteResult,
} from "./driver/types/services";
// 路线策略常量（值 + 类型同名）：调用方不必写魔法数字，也不必去读 SDK 全局常量。
// 与官方 `BMAP_DRIVING_POLICY_*` / `BMAP_TRANSIT_POLICY_*` / `BMAP_INTERCITY_POLICY_*` /
// `BMAP_TRANSIT_TYPE_POLICY_*` 的逐成员对齐由 `src/driver/jsapi-v4/routes.test.ts` 解析上游
// `.d.ts` 的枚举成员后逐项断言（名字配错数字是类型层拦不住的，只有那条断言能拦）。
export {
  DrivingPolicy,
  IntercityPolicy,
  TransitPolicy,
  TransitVehiclePolicy,
} from "./driver/types/services";
export type { BMapServiceStatus } from "./core/services";
export type {
  MapType,
  MapInteraction,
  MapStyleInput,
  InitialMapOptions,
  MapView,
  MapDriver,
  // #165 回填：`getViewport` 的返回类型与 `flyTo` 的官方选项投影（`Viewport` 同时是
  // `MapCommands.getViewport()` 的返回类型，必须可从根入口取到）
  Viewport,
  FlyToOptions,
  // #171 补齐：五条视野命令的官方 `options` 投影。它们出现在**已导出**的
  // `MapCommands` / `MapDriver` 签名里 ⇒ 消费方要构造就得能命名（ADR 2026-09-25 的处置类别 ①）
  ViewCommandOptions,
  SetZoomOptions,
  PanToOptions,
  GeometryDriver,
  OverlayDriver,
  ControlDriver,
  ControlKind,
  ControlOptionStatus,
  LayerDriver,
  NativeLayerDriver,
  NativeLayerKind,
  NativeLayerOperation,
  ServiceDriver,
  ServiceResult,
  ServiceCall,
  JsapiV4Driver,
  EventDriver,
  PanoramaDriver,
} from "./driver";
// 全景的领域类型（M7-CONTROL-PANORAMA / #41）：`<Panorama>` 的 props 与
// `usePanoramaService` 的返回值用到它们，因此必须从根入口可取。
export type {
  // `PanoramaCaptureOptions` 是 `capture()` 的形参类型（issue #171 item I）
  // ⇒ 必须从根入口可取，否则消费方写不出自己的 `capture` 包装函数。
  PanoramaCaptureOptions,
  PanoramaDataInfo,
  PanoramaLabelHandle,
  PanoramaLabelOptions,
  // `PanoramaLink` 是 `linksChange` 的载荷类型 + `getLinks()` 的返回类型
  // （issue #165 Class 3 / TASK 5）⇒ 必须从根入口可取，否则消费方拿不到自己的 handler 参数类型。
  PanoramaLink,
  PanoramaOptions,
  PanoramaPoiType,
  PanoramaPov,
  PanoramaSceneType,
  PanoramaViewerDriver,
} from "./driver";

// 组件公开类型(与 SFC 内 export 对齐,供类型使用)
//
// M5-CUSTOM-MENU / #33：`ContextMenuItem` / `ContextMenuSeparator` 从此前「从 .vue 导出」改为
// 从 `types/components.ts` 导出——`.vue` 的具名命名导出在纯 tsc 下解析不了（本文件头部的约定），
// 而菜单这一族现在还有 `MenuItemProps` / `ContextMenuSelectPayload` 要一起暴露。
export type {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSelectPayload,
  ContextMenuProps,
  MenuItemProps,
  CustomOverlayProps,
} from "./types/components";

// 覆盖物 / 控件的**命令面**类型（issue #165 Class 3 / TASK 2）。
//
// 这些是 `defineExpose` 推导出的实例类型的成员，父组件写 `ref` 时要用它们标注
// （`InstanceType<typeof Marker>` 也能拿，但手写 handler 参数时前者更直接）。
export type { OverlayCommandTypes } from "./core/overlays/overlayCommands";
// 控件的命令面（issue #168 item 1）。与 `OverlayCommandTypes` 同一理由：
// `ControlDriver.locationCommands()` / `cityListCommands()` 是**公共 Facet 面**上的方法，
// 它的返回类型因此出现在公共声明里——不显式导出就成了「未导出类型」
// （`ae-forgotten-export`，见 ADR 2026-09-25）。
//
// `ControlCommandTypes` 是**按组件名**的索引（键是 `LocationControl` / `CityListControl`），
// 与 `OverlayCommandTypes` 同一手法：调用方看到的是 `<LocationControl ref>`，不是 kind。
export type { ControlCommandTypes } from "./core/controls/controlCommands";
export type {
  CityListCommandApi,
  LocationAddressComponents,
  LocationCommandApi,
} from "./driver/types/controls";
export type { ContextMenuExpose } from "./core/overlays/ContextMenuSpec";
// MVTLayer 公开类型（#109：事件按官方 `MVTLayerEventMap` 分层 + feature-state 键域收窄）
export type {
  MVTLayerProps,
  MVTLayerStyle,
  MVTLayerStyleEntry,
  MVTLayerEntity,
  MVTLayerMouseEvent,
  MVTLayerPickEvent,
  MVTLayerMouseMoveEvent,
  MVTLayerBaseEvent,
} from "./types/components";
export type { MarkerIcon, MarkerIconName, MarkerCustomIcon } from "./types/components";

// 运行时枚举(供模板/脚本使用)
export { DistrictType } from "./types/components";
export type { DistrictTypeValue } from "./types/components";

export type { PointLike, SizeLike, XYLike } from "./core/utils/geometry";
export type { MapMaskShowRegion } from "./types/components";
