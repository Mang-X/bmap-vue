export { BMapError } from "./errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "./errors/BMapError";
export { logger, redactAk, setAkForLogger } from "./logger";
export type { Logger } from "./logger";
export { ResourceScope } from "./lifecycle/ResourceScope";
export type { Disposer, DisposeContext, ResourceScopeOptions } from "./lifecycle/ResourceScope";
export { useResourceScope } from "./lifecycle/useResourceScope";
export { createFrameScheduler } from "./scheduler/FrameScheduler";
export type { FrameScheduler } from "./scheduler/FrameScheduler";
export {
  bindSdkEvent,
  bindSdkEvents,
  extractSdkEventNames,
  normalizeMapEvent,
} from "./events/EventBridge";
export type { BMapSdkEventTarget, NormalizedMapEvent } from "./events/EventBridge";
export { createMapEventBus } from "./events/MapEventBus";
export type { MapEventBus, InternalMapEvents } from "./events/MapEventBus";
export {
  BaiduJsapiV4Provider,
  CustomScriptV4Provider,
  ExistingGlobalV4Provider,
  baiduJsapiV4Provider,
  createLoadedJsapiV4,
  customScriptV4Provider,
  existingGlobalV4Provider,
  loadJsapiV4Script,
  readJsapiV4Global,
  reuseExistingJsapiV4,
} from "./loader/providers/index";
export type {
  BaiduJsapiV4ProviderOptions,
  CreateLoadedJsapiV4Input,
  CustomScriptV4ProviderOptions,
  JsapiV4Engine,
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4Namespace,
  JsapiV4Provider,
  JsapiV4ProviderId,
  JsapiV4ProviderOptions,
  JsapiV4ScriptMode,
  JsapiV4VersionSource,
  LoadJsapiV4ScriptInput,
  LoadedJsapiV4,
  ReuseExistingJsapiV4Input,
} from "./loader/providers/index";
export { ScriptLoader, getScriptKey, scriptOptions } from "./loader/ScriptLoader";
export { assertLoadedSdk, isLoadedSdk } from "./loader/loaded";
export type { LoadedSdk } from "./loader/loaded";
export type {
  ScriptJsonpModeOptions,
  ScriptLoadModeOptions,
  ScriptLoaderBaseOptions,
  ScriptLoaderMode,
  ScriptLoaderOptions,
  ScriptRuntimeOptions,
} from "./loader/ScriptLoader";
export { SharedLoadTask } from "./loader/SharedLoadTask";
export type { SharedLoadTaskHooks, SharedLoadTaskState } from "./loader/SharedLoadTask";
export { SdkRegistry, getProcessSdkRegistry, resetProcessSdkRegistryForTests } from "./loader/SdkRegistry";
export type {
  SdkConflictInfo,
  SdkConflictPolicy,
  SdkLoader,
  SdkRegistryLoadRequest,
  SdkRegistryOptions,
} from "./loader/SdkRegistry";
export {
  DEFAULT_API_URL,
  DEFAULT_CALLBACK_PARAM,
  DEFAULT_VERSION,
  appendCallback,
  createBaiduSdkUrl,
  createCallbackName,
  fingerprintApiUrl,
  fingerprintConfig,
  hash,
  normalizeApiUrl,
  resolveBaseUrl,
  resolveBrowserUrl,
} from "./loader/url";
export type { BMapLoadOptions, CrossOriginValue } from "./loader/url";
export { MapRuntime } from "./runtime/MapRuntime";
export type { MapRuntimeOptions } from "./runtime/MapRuntime";
export { useMapResource } from "./composables/useMapResource";
export type { SdkResourceAdapter, UseMapResourceResult } from "./composables/useMapResource";
export { useSdkResource } from "./composables/useSdkResource";
export type {
  SdkResourceSpec,
  SdkResourceStatus,
  UseSdkResourceOptions,
  UseSdkResourceResult as UseUnifiedSdkResourceResult,
} from "./composables/useSdkResource";
// 控件层底座（M7-CONTROL-PANORAMA / #41）：`ControlSpec` + 统一 adapter。
// 库内 11 个控件组件的唯一入口；`buildControlOptions` / `bindControlEvents`（#22 的临时
// 帮手，无任何消费者）随这次替换删除。
export { useControlResource } from "./controls/useControlResource";
export type { UseControlResourceResult } from "./controls/useControlResource";
export { changedOptionKeys, optionKey, optionSnapshot } from "./controls/optionKey";
export type { OptionSnapshot } from "./controls/optionKey";
export type {
  ControlBaseProps,
  ControlCreateInput,
  ControlMountInput,
  ControlSpec,
  ControlVisibleInput,
} from "./controls/spec";
export { useLayerResource } from "./composables/useLayerResource";
export type {
  LayerResourceBindInput,
  LayerResourceHooks,
  UseLayerResourceResult,
} from "./composables/useLayerResource";
export { createLayerRegistry } from "./layers/LayerRegistry";
export type { LayerRecord, LayerRegistry } from "./layers/LayerRegistry";
export type { LayerProbe, LayerSpec } from "./layers/LayerSpec";
// 全景底座（M7-CONTROL-PANORAMA / #41）：独立的 PanoramaContext（**不并入 MapContext**，
// 见文件头注释）+ v4 全景面的可检查收窄点。
export {
  createPanoramaContext,
  jsapiV4PanoramaOf,
  panoramaContextKey,
  useOptionalPanoramaContext,
  useRequiredPanoramaContext,
} from "./panorama";
export type { PanoramaContext, PanoramaReadyContext, PanoramaStatus } from "./panorama";
export type {
  MapContext,
  MapReadyContext,
  MapRuntimeShape,
  MapRuntimeStatus,
  MapStatus,
} from "./context/types";
export { mapContextKey, overlayContextKey } from "./context/types";
export { useOptionalMapContext, useRequiredMapContext } from "./context/inject";
export { targetContextKey, createStaticTarget, useResolvedTarget, useOptionalTargetContext, useParentOverlayHandle } from "./context/target";
export type { TargetContext, TargetKind } from "./context/target";
export {
  bmapClientContextKey,
  createClientContext,
  defaultClientDefinitionKey,
  useOptionalClientContext,
  useRequiredClientContext,
} from "./context/client";
export type { BMapClientContext, ClientStatus, CreateClientContextOptions } from "./context/client";
export { diffData, getItemKey, shouldFullReplace } from "./data/diffData";
export type { DataDiff, ItemKeyFn } from "./data/diffData";
export { gridCluster } from "./data/gridCluster";
export type { Cluster, ClusterOptions } from "./data/gridCluster";
export {
  normalizeIconDescriptor,
  iconCacheKey,
  createLruIconCache,
  DEFAULT_ICON_CACHE_SIZE,
} from "./icons/iconCache";
export type { IconCache, IconDescriptor } from "./icons/iconCache";
// 内置 Marker 图标：descriptor + 单一事实源（M5-SPEC-MARKER / #30）
export {
  BUILTIN_MARKER_ICON_NAMES,
  MARKER_ICON_HD_SCALE,
  MARKER_ICON_SPRITE_SIZE,
  MARKER_ICON_SPRITE_URL,
  builtinMarkerIconDescriptor,
  isBuiltinMarkerIconName,
  resolveMarkerIconDescriptor,
} from "./icons/markerIcon";
export type { BuiltinMarkerIconName, MarkerIconInputLike } from "./icons/markerIcon";
export { DataLayerManager } from "./data/DataLayerManager";
export type { DataLayerHost, DataLayerOptions } from "./data/DataLayerManager";
export { createOverlayRegistry } from "./overlays/OverlayRegistry";
export type {
  OverlayRecord,
  OverlayRegistry,
  ResourceRegistration,
  ResourceRegistrationInput,
} from "./overlays/OverlayRegistry";
// 声明式覆盖物生命周期（M5-SPEC-MARKER / #30，M5-VECTORS / #31 扩展）
export type {
  OverlayEventSpec,
  OverlayFieldMap,
  OverlayFieldUpdate,
  OverlayFieldWatch,
  OverlaySpec,
} from "./overlays/OverlaySpec";
export {
  OVERLAY_EVENT_MATRIX,
  OVERLAY_KINDS_WITHOUT_EVENT_MATRIX,
  overlayEventOf,
  overlayEventsOf,
  overlayPointerFallback,
} from "./overlays/overlayEventCatalog";
export type {
  OverlayEventDefinition,
  OverlayEventMatrixEntry,
  OverlayEventPayloadKind,
} from "./overlays/overlayEventCatalog";
export {
  DEPRECATED_EVENT_ALIAS_CODE,
  DEPRECATED_PROP_ALIAS_CODE,
  OVERLAY_EVENT_ALIASES,
  OVERLAY_PROP_ALIASES,
  createDeprecationWarner,
  describeDeprecation,
  eventAliasesOf,
  propAliasesOf,
} from "./deprecations";
export type {
  DeprecationNotice,
  DeprecationWarner,
  OverlayEventAlias,
  OverlayPropAlias,
} from "./deprecations";
export { useOverlaySpec } from "./composables/useOverlaySpec";
export { dynamicEmit } from "./composables/dynamicEmit";
export type {
  OverlayPositionModel,
  UseOverlaySpecOptions,
  UseOverlaySpecResult,
} from "./composables/useOverlaySpec";
export { createPluginRegistry } from "./plugins/PluginRegistry";
export type {
  BMapPluginDefinition,
  PluginRecord,
  PluginRegistry,
  PluginStatus,
} from "./plugins/PluginRegistry";
// 工具函数(v3 独立 utils,api 参数化,无全局 BMapGL)
export {
  toSdkPoints,
  toSdkPoint,
  toSdkSize,
  toSdkXYSize,
} from "./utils/geometry";
export type { PointLike, SizeLike, XYLike } from "./utils/geometry";
export { isDef, isObjDef, isString, isArray, isPointLike, isClient } from "./utils/guards";
