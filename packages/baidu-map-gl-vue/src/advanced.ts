/**
 * `./advanced` 公开入口
 *
 * raw SDK 只从这里提供逃生口；普通组件与业务 composable 不应直接 import。
 * 稳定公开（root）只导出类型，不导出这些实现函数。
 */
export { createJsapiV4Driver } from "./driver";
export type { CreateJsapiV4DriverInput } from "./driver";
export { assertLoadedSdk, isLoadedSdk } from "./core/loader/loaded";
export type { LoadedSdk } from "./core/loader/loaded";
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
