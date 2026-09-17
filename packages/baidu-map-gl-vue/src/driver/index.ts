/**
 * Driver 工厂与领域类型出口
 *
 * M3A1-CLIENT（issue #18）把默认客户端收口到 `jsapi-v4`；M3A3-REMOVE-LEGACY（issue #26）
 * 删掉旧引擎之后，这里不再有「engine 猜测」（原 `detectEngine`）与多 engine 分派
 * （原 `createDriver`）：构造 Driver 的唯一入口是 `createJsapiV4Driver`，它需要调用方
 * 显式给出 SDK 运行时版本（来自结构化加载结果），不再猜。
 *
 * 需要从 raw 命名空间手工装 Driver 的高级用法见 `./advanced`。
 */
export { createJsapiV4Driver } from "./createJsapiV4Driver";
export type { CreateJsapiV4DriverInput } from "./createJsapiV4Driver";

export * from "./types/handles";
export * from "./types/geometry";
export type { MapType, MapInteraction, MapStyleInput, InitialMapOptions, MapView, MapDriver } from "./types/map";
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
} from "./types/overlays";
export type { ControlKind, ControlOptionStatus, ControlOptions, CopyrightEntry, ControlDriver } from "./types/controls";
export type { LayerKind, LayerDriver } from "./types/layers";
export type {
  NativeLayerData,
  NativeLayerDriver,
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerHandle,
  NativeLayerKind,
  NativeLayerOperation,
  NativeLayerPick,
  NativeLayerZoomRange,
} from "./types/native-layers";
export type {
  AutocompleteOptions,
  BoundaryRequest,
  ConvertorRequest,
  CoordinateFromType,
  CoordinateToType,
  GeocodeRequest,
  GeocodedAddress,
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
  JsapiV4ServiceDriver,
  LocalCityFix,
  PlaceSuggestion,
  ReverseGeocodeRequest,
  ServiceCall,
  ServiceCallOptions,
  ServiceCallSettle,
  ServiceCallStatus,
  ServiceDriver,
  ServiceErrorInfo,
  ServiceInvocationDriver,
  ServiceResult,
} from "./types/services";
export type {
  PanoramaDataInfo,
  PanoramaDriver,
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
} from "./types/panorama";
export type { MapMouseEvent, EventDriver } from "./types/events";
export type { BMapDriver, BMapEngine, JsapiV4Driver } from "./types/bmap";
export type {
  Capability,
  CapabilityDescriptor,
  CapabilityExplanation,
  CapabilityFamily,
  CapabilityReason,
  CapabilityRegistry,
  CapabilityStatus,
} from "./capability";
export {
  CAPABILITY_CATALOG,
  CAPABILITY_FAMILIES,
  CAPABILITY_IDS,
  CAPABILITY_STATUSES,
  createCapabilityRegistry,
  UnsupportedCapabilityError,
} from "./capability";
export type { UnsupportedBehavior } from "./capability";
export {
  normalizeMapMouseEvent,
  normalizeDriverEvent,
  toPoint,
  isPointLike,
  toPlainPoint,
  toPlainPoints,
} from "./normalize";
