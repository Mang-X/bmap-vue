/**
 * `./advanced` 公开入口
 *
 * raw SDK 只从这里提供逃生口；普通组件与业务 composable 不应直接 import。
 * 稳定公开（root）只导出类型，不导出这些实现函数。
 */
export { createJsapiV4Driver } from "./driver";
export type { CreateJsapiV4DriverInput } from "./driver";
export { assertLoadedSdk, isLoadedSdk } from "./core/loader/loaded";
export { unwrapRaw, createHandle, HANDLE_BRAND } from "./driver/types/handles";
export {
  createCapabilityRegistry,
  UnsupportedCapabilityError,
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
} from "./driver/capability";
export { normalizeProvider, createBMapClientDefinition } from "./client";
export { createBMapClient, jsapiV4DriverFactory } from "./client/createBMapClient";
/**
 * SDK 装配面：v4 Provider 家族（#44）。
 *
 * `./core` 子路径已取消（它 105 个值导出里只有这 4 个有**真实**公开消费者 —— `docs/zh-CN/guide/config.md`
 * 与 `docs/zh-CN/expand/offline-map.md` 的自定义加载器示例、`fixtures/consumer` 的 tarball smoke），
 * 这四个名字因此并入 `./advanced` 这一处装配面，与 `normalizeProvider` / `createBMapClientDefinition` 同处。
 * 根入口仍**不**导出任何 Provider factory（#26 起，见 ADR 2026-09-14）。
 *
 * 三个工厂在这里是**窄一层的包装**：返回契约收成导出的 `JsapiV4Provider`，选项收成外部
 * **能自己构造**的形状（`registry` / 自研 `ScriptLoader` 只留在内部与测试注入里）。
 * 直接 re-export 内部工厂会把 `SdkRegistry` / `ScriptLoader` 这两个带私有成员的类型带进
 * 公共签名：消费方赋不了值、API report 里也只剩一个名字 ⇒ 假支持（ADR 2026-09-25 决策 5）。
 */
import {
  baiduJsapiV4Provider as createBaiduJsapiV4Provider,
  customScriptV4Provider as createCustomScriptV4Provider,
  existingGlobalV4Provider as createExistingGlobalV4Provider,
} from "./core/loader/providers";
import type {
  BaiduJsapiV4ProviderOptions,
  CustomScriptV4ProviderOptions,
  JsapiV4Provider,
} from "./core/loader/providers";

/** 默认在线 Provider 工厂（官方 `@baidumap/jsapi-loader`）；AK 经 `load` 的 options 传入。 */
export const baiduJsapiV4Provider: (options?: BaiduJsapiV4ProviderOptions) => JsapiV4Provider = (
  options,
) => createBaiduJsapiV4Provider(options);

/** 企业自托管 / 私有入口 Provider 工厂。 */
export const customScriptV4Provider: (
  scriptSrc: string,
  options?: CustomScriptV4ProviderOptions,
) => JsapiV4Provider = (scriptSrc, options) =>
  createCustomScriptV4Provider(scriptSrc, options);

/** 复用宿主页面已存在的 JSAPI 4.0 全局的 Provider 工厂（没有可注入的加载配置）。 */
export const existingGlobalV4Provider: () => JsapiV4Provider = () =>
  createExistingGlobalV4Provider();

export { createLoadedJsapiV4 } from "./core/loader/providers";
export type {
  BaiduJsapiV4ProviderOptions,
  CustomScriptV4ProviderOptions,
  JsapiV4Provider,
};
// `OfficialJsapiLoader` / `OfficialJsapiLoadOptions` 是 `BaiduJsapiV4ProviderOptions.loader`
// 的类型（外部真的能实现它）；`JsapiV4ScriptMode` 是 `CustomScriptV4ProviderOptions.mode` 的取值。
export type {
  CreateLoadedJsapiV4Input,
  LoadedJsapiV4,
  OfficialJsapiLoadOptions,
  OfficialJsapiLoader,
} from "./core/loader/providers";

export type {
  BMapClient,
  BMapDriverFactory,
  BMapDriverInput,
  BMapProviderLike,
  CreateBMapClientOptions,
} from "./client/types";
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
  SdkHandle,
} from "./driver/types/handles";
export type {
  Capability,
  CapabilityRegistry,
  CapabilityExplanation,
  CapabilityDescriptor,
  CapabilityFamily,
  CapabilityReason,
  CapabilityStatus,
} from "./driver/capability";
export type { UnsupportedBehavior } from "./driver/capability";
export type {
  Point,
  PointInput,
  Pixel,
  Size,
  Bounds,
  GeometryDriver,
} from "./driver/types/geometry";
export type {
  MapType,
  MapInteraction,
  MapStyleInput,
  InitialMapOptions,
  MapView,
  MapDriver,
} from "./driver/types/map";
export type {
  OverlayKind,
  MarkerIconInput,
  MarkerOptions,
  PathOptions,
  InfoWindowOptions,
  LabelOptions,
  CustomOverlayOptions,
  OverlayTarget,
  OverlayDriver,
  OverlayPropertyPolicy,
} from "./driver/types/overlays";
export type { ControlKind, ControlOptions, CopyrightEntry, ControlDriver } from "./driver/types/controls";
export type { LayerKind, LayerDriver } from "./driver/types/layers";
export type { AutocompleteOptions, ServiceDriver } from "./driver/types/services";
export type { PanoramaDriver } from "./driver/types/panorama";
export type { MapMouseEvent, DriverEvent, EventDriver } from "./driver/types/events";
export { normalizeMapMouseEvent, toPoint, isPointLike, toPlainPoint, toPlainPoints } from "./driver/normalize";

/* ==================================================================== *
 * 已导出装配面 API 的**公共类型面**（issue #160）
 *
 * 这里的每个名字此前都出现在**已导出**的签名里（`createJsapiV4Driver()` 返回
 * `JsapiV4Driver`、`normalizeProvider()` 返回 `NormalizedProvider`、
 * `CapabilityRegistry.planOptions()` 返回 `Record<string, ControlOptionStatus>`、
 * `ServiceDriver.createLocalSearch()` 的参数是 `LocalSearchOptions` …），却没有被导出 ——
 * 消费方能拿到值、却没法为它**命名**。判据是「消费方能不能命名它」（ADR 2026-09-25）。
 *
 * 每一组都属于下列之一：
 * - **装配面的正主**（Provider 家族 / Driver / Layer / Service 的 options 与 result）：
 *   外部真的能构造、有稳定语义 ⇒ 升为导出；
 * - **随签名必须可命名的结果形状**（`ControlOptionStatus` / `ViewAnimationCancelOutcome` …）。
 *
 * 刻意**不**导出的是 `MapRuntime` / `SdkRegistry` / `ScriptLoader` / `PluginRegistry`
 * 这类带私有成员的内部实现（`JsapiV4ProviderInternalOptions` 已经把它们挡在公共
 * 选项之外，见 `core/loader/providers/types.ts`）。
 * ==================================================================== */

// —— Provider 家族（`JsapiV4Provider` 的字段类型；`LoadedJsapiV4` 的成员类型）
export type {
  JsapiV4Engine,
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4Namespace,
  JsapiV4ProviderId,
  JsapiV4ScriptMode,
  JsapiV4VersionSource,
} from "./core/loader/providers/types";

// —— 加载配置：`JsapiV4Provider.getCacheKey/load` 与 `LoadedJsapiV4` 都直接暴露它
export type { BMapLoadOptions, CrossOriginValue } from "./core/loader/url";

// —— 官方 Loader 锁定的基线版本（`LoadedJsapiV4.version` 的取值域）
export type { OfficialJsapiV4Version } from "./core/loader/providers/official";

// —— 归一化结果：`normalizeProvider()` 的返回值（消费方要拿它当 Config 传给组件）
export type { NormalizedProvider } from "./client/createBMapClient";

// —— Capability 工厂的选项
export type { CreateCapabilityRegistryOptions } from "./driver/capability/registry";
// —— `CapabilityRegistry.planOptions()` 的结果元素
export type { ControlOptionStatus } from "./driver/types/controls";

// —— Driver 工厂的返回值（raw SDK 边界的正主）
export type { JsapiV4Driver } from "./driver/types/bmap";

// —— 图层 Driver 的参数 / 结果
export type {
  LayerCreateOptions,
  LayerCtorSlot,
  LayerData,
  LayerOperation,
  LayerSurface,
} from "./driver/types/layers";
export type {
  NativeLayerData,
  NativeLayerDriver,
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
  NativeLayerPick,
  NativeLayerZoomRange,
} from "./driver/types/native-layers";

// —— 服务 Driver 的构造选项（`createLocalSearch` / 四条路线 / Autocomplete）
export type {
  AutocompleteUpdateOptions,
  DrivingRouteOptions,
  JsapiV4ServiceDriver,
  BoundaryRequest,
  CoordinateFromType,
  CoordinateToType,
  DrivingRouteEndpoint,
  BoundaryRings,
  ConvertorRequest,
  DrivingRouteRequest,
  DrivingRouteResult,
  GeocodeRequest,
  GeocodedAddress,
  GeocodedAddressComponents,
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
  LocalCityFix,
  LocalSearchBounds,
  LocalSearchPoi,
  LocalSearchInBoundsRequest,
  LocalSearchKeyword,
  LocalSearchNearbyRequest,
  LocalSearchResult,
  LocalSearchSearchOption,
  ReverseGeocodeRequest,
  RidingRouteResult,
  RouteRequest,
  RouteEndpoint,
  RoutePlan,
  RouteResult,
  RouteEndpointInfo,
  RouteEndpointPoi,
  RouteLeg,
  RouteServiceHandle,
  RouteStep,
  RouteTaxiFare,
  RouteTaxiFareDetail,
  RouteServiceKind,
  ServiceCall,
  ServiceCallStatus,
  ServiceErrorInfo,
  ServiceInvocationDriver,
  ServiceResult,
  TransitRouteRequest,
  TransitRoutePlan,
  TransitRouteResult,
  TransitLineSegment,
  TransitRouteSegment,
  TransitWalkSegment,
  WalkingRouteResult,
  LocalSearchOptions,
  LocalSearchRenderOptions,
  RidingRouteOptions,
  RouteRenderOptions,
  RouteRenderState,
  RouteState,
  TransitRouteOptions,
  WalkingRouteOptions,
} from "./driver/types/services";

// —— `MapDriver.cancelViewAnimation()` 的结果（视角动画没有公开取消接口，见 ADR 决策）
export type { ViewAnimationCancelOutcome } from "./driver/types/map";
export type {
  PanoramaDataInfo,
  PanoramaHandle,
  PanoramaLabelHandle,
  PanoramaLabelOptions,
  PanoramaOptions,
  PanoramaPoiType,
  PanoramaPov,
  PanoramaSceneType,
  PanoramaServiceHandle,
  PanoramaSwitchOptions,
  PanoramaViewerDriver,
} from "./driver/types/panorama";
// 官方锁定的基线版本常量（`LoadedJsapiV4.version` 的取值域就是它的字面量类型）
export { OFFICIAL_V4_VERSION } from "./core/loader/providers/official";
// 路线策略常量（值与类型同名）：装配面要能收下这些值而不必去根入口拿。
export { DrivingPolicy, IntercityPolicy, TransitPolicy, TransitVehiclePolicy } from "./driver/types/services";

// —— 错误类按值导出：`UnsupportedCapabilityError extends BMapError`，消费方要能 catch。
export { BMapError } from "./core/errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "./core/errors/BMapError";
