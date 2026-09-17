/**
 * v3 公开入口(packages/baidu-map-gl-vue)
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
// Provider:结构化的 v4 家族在 `./core` 子入口公开（M3A3-REMOVE-LEGACY / #26 之后根入口
// 不再导出任何 Provider factory——原先那三个是 legacy 的 `baiduCdnProvider` 家族）。
// Resolver
export { Vue3BaiduMapGlResolver, componentTypeNames } from "./resolver/index";
// 公开类型(与组件 props 对齐,单一来源 src/types/components.ts)
export type {
  BMapProps,
  BMarkerProps,
  BInfoWindowProps,
  BCircleProps,
  BPolylineProps,
} from "./types/components";
// core 领域类型(供业务使用)
export type { MapContext, MapReadyContext, MapRuntimeStatus, MapStatus } from "./core/context/types";
export { useBMapContext, useMapReady, useBMap } from "./composables/useBMap";
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
export {
  targetContextKey,
  createStaticTarget,
  useResolvedTarget,
  useOptionalTargetContext,
  useParentOverlayHandle,
} from "./core/context/target";
export type { TargetContext, TargetKind } from "./core/context/target";
// 统一资源生命周期
export { useSdkResource } from "./core/composables/useSdkResource";
export type { SdkResourceSpec, SdkResourceStatus } from "./core/composables/useSdkResource";
// 声明式覆盖物生命周期（M5-SPEC-MARKER / #30）：组件只声明 OverlaySpec，其余由这里驱动
export { useOverlaySpec } from "./core/composables/useOverlaySpec";
export type {
  OverlayPositionModel,
  UseOverlaySpecOptions,
  UseOverlaySpecResult,
} from "./core/composables/useOverlaySpec";
export type {
  OverlayEventSpec,
  OverlayFieldMap,
  OverlayFieldUpdate,
  OverlaySpec,
} from "./core/overlays/OverlaySpec";
export { useResourceScope } from "./core/lifecycle/useResourceScope";
export { ResourceScope } from "./core/lifecycle/ResourceScope";
export type { Disposer, DisposeContext, ResourceScopeOptions } from "./core/lifecycle/ResourceScope";
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
export type { LoadedSdk } from "./core/loader/loaded";
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
} from "./driver/types/handles";
// Map 命令面与暂停原因（M4-HANDLE-UX / issue #29）
//
// `BMapExpose` 是 `<BMap ref>` 拿到的**组件级命令面**（常用 get/set/pan/fit/checkResize/supports
// + 生命周期 + 暂停策略），`MapHandle` 是 Driver 层的 SDK 句柄 —— 两者分工见
// `src/types/mapExpose.ts` 的命名对照表。raw SDK 对象只经 `./advanced` 的 `unwrapRaw()`。
export type { BMapExpose } from "./types/mapExpose";
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
// `<BMap>` 的 emits、`useMapEvent` 的订阅名解析与文档表格都从这里出发。
export {
  BMAP_COMPONENT_EVENT_ALIASES,
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
  BMapComponentEmitName,
  BMapComponentEventName,
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
  PlaceSuggestion,
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
  GeometryDriver,
  OverlayDriver,
  ControlDriver,
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

// 组件公开类型(与 SFC 内 export 对齐,供类型使用)
export type { ContextMenuItem, ContextMenuSeparator } from "./components/overlays/BContextMenu.vue";
export type { MarkerIcon, MarkerIconName, MarkerCustomIcon } from "./types/components";

// 运行时枚举(供模板/脚本使用)
export { DistrictType } from "./types/components";
export type { DistrictTypeValue } from "./types/components";

export type { PointLike, SizeLike, XYLike } from "./core/utils/geometry";
export type { MapMaskShowRegion } from "./types/components";
