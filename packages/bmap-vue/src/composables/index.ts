export * from "./useMap";
export * from "./useControllableState";
export * from "./useGeolocation";
export * from "./useViewAnimation";
export * from "./useMarkerIcons";
export * from "./useAreaBoundary";
export * from "./useIpLocation";
export * from "./useGeocoder";
export * from "./useGeocodeDetail";
export * from "./useConvertor";
export * from "./useLocalSearch";
export * from "./useDrivingRoute";
export * from "./useWalkingRoute";
export * from "./useRidingRoute";
export * from "./useTransitRoute";
export * from "./usePanoramaService";
export { useMapEvent } from "./useMapEvent";
export type { MapEventHandler, MapEventPayloadForName, UseMapEventOptions } from "./useMapEvent";
export { useMapStatus } from "./useMapStatus";
export type { MapStatusRefs, UseMapStatusOptions } from "./useMapStatus";
// 订阅源类型：`resolveMapEventSource` / `readEventSource` 是内部接线（要在 setup 里 inject），
// 不公开——调用方要的就是「显式给一个 source」，不需要自己解析。
export type { EventSourceClient, MapEventSource, MapEventSourceInput } from "./mapEventSource";
// ⚠️ **不要**改回 `export * from "./resolveMapContext"`：那个模块里还有
// `resolveInternalMapContext`（完整 `MapContext`，组件与 serviceTask 用）。`export *`
// 会把它一并转进公共出口，于是 `MapContext` 及其内层闭包（`MapRuntimeShape` → `MapDriver`
// / `OverlayDriver` / `ServiceDriver` …）整串被 `ae-forgotten-export` 点名（issue #160）。
// 需要完整上下文的库内代码请从 `./internalMapContext` import。
export { resolveMapContext } from "./resolveMapContext";
export type { PublicBMapClient, PublicMapContext } from "./resolveMapContext";

/* ==================================================================== *
 * 已导出 composable 签名的**公共类型面**（issue #160）
 *
 * 这些名字此前都出现在**已导出**的 composable 签名里（`useLocalSearch().search()` 的
 * 参数、`useDrivingRoute().data` 的类型、`useMap().client` …），却没有被本子入口导出
 * —— 于是消费方调得到、却没法为任何一个参数或结果**命名**：`check:api` 的
 * `ae-forgotten-export` 正是为这种「引用得到、名字拿不到」的情况亮的灯。
 *
 * 判据是**消费方能不能命名它**（ADR 2026-09-25）。有三件事刻意**没有**做：
 *
 * 1. **不导出内部运行时**：`MapContext` / `MapRuntimeShape` / `MapEventBus` /
 *    `ResourceScope` 带私有成员，仓库之外既不能构造也不能实现。为此
 *    `resolveMapContext()` / `useMapContext()` 返回的是窄面 `PublicMapContext`，
 *    `MapEventSource.resources` / `.client` 也只声明用得到的那几个方法
 *    （`internalMapContext.ts` 有完整说明）。
 * 2. **不导出私有数据表**：`BuiltinMarkerIconName` 改成显式联合，不再是
 *    `keyof typeof MARKER_ICON_SPRITES`，否则那张从不进 API report 的常量表会被
 *    以「未导出符号」之名带进公共声明（`core/icons/markerIcon.ts` 有说明）。
 * 3. 随附的 `export type` **不新增任何值导出**，值导出面仍由
 *    `export-surface-freeze.test.ts` 的清单守着。
 * ==================================================================== */

// —— 路线（`routeServices.ts` 自己声明的那两个）
export type { BMapRouteLocation, BMapRouteRenderOptions } from "./routeServices";

// —— 检索 / 路线 / 服务的请求与结果（`driver/types/services.ts`）
export type {
  AutocompleteOptions,
  AutocompleteUpdateOptions,
  DrivingRouteEndpoint,
  DrivingRouteOptions,
  DrivingRouteResult,
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
  RouteResult,
  RouteState,
  RouteStep,
  RouteTaxiFare,
  RouteTaxiFareDetail,
  ServiceCallStatus,
  ServiceErrorInfo,
  ServiceResult,
  TransitLineSegment,
  TransitRouteOptions,
  TransitRoutePlan,
  TransitRouteResult,
  TransitRouteSegment,
  TransitWalkSegment,
  WalkingRouteOptions,
  WalkingRouteResult,
} from "../driver/types/services";

// —— 地理编码 / 定位
export type { GeolocationAddressInfo } from "../driver/types/services";

// —— 策略常量（值与类型同名）：`import { DrivingPolicy } from "bmap-vue/composables"`
export { DrivingPolicy, IntercityPolicy, TransitPolicy, TransitVehiclePolicy } from "../driver/types/services";

// —— 全景
export type { PanoramaDataInfo, PanoramaDriver } from "../driver/types/panorama";

// —— 坐标与句柄
export type { Bounds, GeometryDriver, Pixel, Point, Size } from "../driver/types/geometry";
export type { CircleHandle, ControlHandle, InfoWindowHandle, LayerHandle, LabelHandle, MarkerHandle, MapHandle, OverlayHandle, PolygonHandle, PolylineHandle, ServiceHandle, SdkHandle } from "../driver/types/handles";

// —— Client 与各 Driver 门面：`useMap()` 把 Client 原样交回调用方，
//    `useMarkerIcons(client?)` 也直接收它 —— 这条真实的公共契约要求它们可命名。
export type { BMapClient } from "../client/types";
export type { BMapDriver, BMapEngine } from "../driver/types/bmap";
export type { CapabilityExplanation, CapabilityReason, CapabilityRegistry } from "../driver/capability/registry";
export type {
  Capability,
  CapabilityDescriptor,
  CapabilityFamily,
  CapabilityStatus,
} from "../driver/capability/catalog";
export type { ControlDriver } from "../driver/types/controls";
export type { ControlKind, ControlOptions, ControlOptionStatus, CopyrightEntry } from "../driver/types/controls";
export type { DriverEvent, EventDriver, MapLoadEvent, MapMouseEvent, MapResizeEvent, MapTypeChangeEvent } from "../driver/types/events";
export type { LayerDriver, LayerKind, LayerOperation, LayerData, LayerSurface, LayerCreateOptions, LayerCtorSlot } from "../driver/types/layers";
export type { NativeLayerFeatureKeys, NativeLayerFeatureState, NativeLayerFeatureStateMap } from "../driver/types/native-layers";
export type { MapDriver, MapInteraction, MapStyleInput, MapType, MapView, InitialMapOptions } from "../driver/types/map";
export type { OverlayDriver, OverlayTarget, OverlayPropertyPolicy, MarkerIconInput, MarkerOptions, PathOptions, InfoWindowOptions, CustomOverlayOptions, LabelOptions } from "../driver/types/overlays";
export type { ServiceDriver } from "../driver/types/services";
export type { ViewAnimationCancelOutcome } from "../driver/types/map";

// —— 地图事件 Catalog（`useMapEvent` / `useMapStatus` 的签名直接暴露）
// `MapEventName` 定义为 `keyof typeof MAP_EVENT_CATALOG`，因此那张表**必须**以值的形式
// 在本子入口可达 —— 否则它会以「未导出符号」之名留在门禁清单里。
//
// ⚠️ 它**必须**用下面的 `export {}` 而不是 `export type {}`：写成 `export type` 会让
// `dist/composables.d.ts` 声明成 `export declare const`，而运行时的
// `dist/composables.mjs` 里没有这个绑定 —— 消费方 `import { MAP_EVENT_CATALOG } from
// "bmap-vue/composables"` 类型检查通过、拿到 `undefined`。`#160` 评审查出的正是这个
// 幽灵导出；四个子入口的 `export declare const` 逐个对着 `.mjs` 核过，零幽灵。
export { MAP_EVENT_CATALOG } from "../core/events/eventCatalog";
export type {
  MapEventEmits,
  MapEventMap,
  MapEventName,
  MapEventPayload,
  MapEventPayloadOf,
  MapLoadPayload,
  MapPointerEvent,
  MapResizePayload,
  MapTypeChangePayload,
} from "../core/events/eventCatalog";

// —— 服务任务状态口径
export type { BMapServiceStatus } from "../core/services";
export type { MapStatus } from "../core/context/types";
export type { FrameScheduler } from "../core/scheduler/FrameScheduler";

// —— 内置图标名（`useMarkerIcons` / `MarkerIconName` 的取值域）
export type { BuiltinMarkerIconName } from "../core/icons/markerIcon";

// —— 地图上下文的**窄面**（完整 `MapContext` 是内部运行时，见文件头第 1 条）
