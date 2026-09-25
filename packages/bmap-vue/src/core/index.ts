export { BMapError } from "./errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "./errors/BMapError";
export { logger, redactAk, setAkForLogger } from "./logger";
export type { Logger } from "./logger";
export { ResourceScope } from "./lifecycle/ResourceScope";
export type { Disposer, ResourceScopeOptions } from "./lifecycle/ResourceScope";
export { createFrameScheduler } from "./scheduler/FrameScheduler";
export type { FrameScheduler } from "./scheduler/FrameScheduler";
export {
  bindSdkEvent,
  bindSdkEvents,
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
  BaiduJsapiV4ProviderInternalOptions,
  BaiduJsapiV4ProviderOptions,
  CreateLoadedJsapiV4Input,
  CustomScriptV4ProviderInternalOptions,
  CustomScriptV4ProviderOptions,
  JsapiV4Engine,
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4Namespace,
  JsapiV4Provider,
  JsapiV4ProviderId,
  JsapiV4ProviderInternalOptions,
  JsapiV4ScriptMode,
  JsapiV4VersionSource,
  LoadJsapiV4ScriptInput,
  LoadedJsapiV4,
  ReuseExistingJsapiV4Input,
} from "./loader/providers/index";
export { ScriptLoader, getScriptKey, scriptOptions } from "./loader/ScriptLoader";
export { assertLoadedSdk, isLoadedSdk } from "./loader/loaded";
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
// `#104` 第三批（`./core` 冻结前的出口复核）：这里只留**生产者真的用得到**的名字。
// - `resetProcessSdkRegistryForTests` 已从出口摘掉：它是测试辅助（"for tests" 写在名字里），
//   仓库内测试一直按相对路径直接 import 源文件，公共声明面里不该出现它；
// - `conflictPolicy` / `onConflict` / `SdkConflictPolicy` / `SdkConflictInfo` 已删除：
//   三个 Provider 一律不传 ⇒ 只有 `SdkRegistry` 单测可达，属于「没有人用的公共开关」。
export { SdkRegistry, getProcessSdkRegistry } from "./loader/SdkRegistry";
export type { SdkLoader, SdkRegistryLoadRequest, SdkRegistryOptions } from "./loader/SdkRegistry";
export {
  DEFAULT_API_URL,
  DEFAULT_CALLBACK_PARAM,
  DEFAULT_VERSION,
  appendCallback,
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
// `useMapResource` / `SdkResourceAdapter` / `UseMapResourceResult` 已删除（`#104` 第三批）：
// 零生产消费者，且它自己的继任者（下面这个 `useSdkResource`）的文件头写着「替代行为各异的
// useMapResource / useOverlayResource / useControlResource / useLayerResource」。
// 它的单测只测它自己 ⇒ 留在出口上等于把一个已经被取代的旧底座冻结进 3.0。
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
  MapStatus,
} from "./context/types";
export { mapContextKey } from "./context/types";
export { useOptionalMapContext, useRequiredMapContext } from "./context/inject";
export { targetContextKey, useParentOverlayHandle } from "./context/target";
export type { TargetContext, TargetKind } from "./context/target";
export {
  bmapClientContextKey,
  createClientContext,
  defaultClientDefinitionKey,
  useOptionalClientContext,
  useRequiredClientContext,
} from "./context/client";
export type { BMapClientContext, ClientStatus, CreateClientContextOptions } from "./context/client";
export { diffData, getItemKey } from "./data/diffData";
export type { DataDiff, ItemKeyFn } from "./data/diffData";
export { scanValidItems, isUsableItemKey, itemKeyReader } from "./data/itemScan";
export type { ItemProblem, ItemProblemKind, ItemScanOptions, ScannedItem } from "./data/itemScan";
export { createProblemReporter } from "./data/problems";
export type { DataProblem, DataProblemKind, ProblemReporter } from "./data/problems";
export { readValidPoint } from "./data/points";
export type { PointProblemReason, PointReadResult } from "./data/points";
export { createItemIndex } from "./data/itemIndex";
export type { IndexedItem, ItemIndex } from "./data/itemIndex";
export { adaptPoints, resolveIdField, GENERATED_ID_FIELD } from "./data/geojsonAdapter";
export type {
  AdaptedPoints,
  GeoJsonAdaptOptions,
  GeoJsonFeatureCollection,
  GeoJsonPointFeature,
  GeoJsonProblem,
  GeoJsonProblemKind,
} from "./data/geojsonAdapter";
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
export type { DataLayerHost, DataLayerManagerOptions, DataLayerSync } from "./data/DataLayerManager";
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
// 工具函数（独立 utils，api 参数化，不碰全局 SDK）
export {
  toSdkPoints,
  toSdkPoint,
  toSdkSize,
  toSdkXYSize,
} from "./utils/geometry";
export type { PointLike, SizeLike, XYLike } from "./utils/geometry";
export { isDef, isObjDef, isString, isArray, isPointLike, isClient } from "./utils/guards";
