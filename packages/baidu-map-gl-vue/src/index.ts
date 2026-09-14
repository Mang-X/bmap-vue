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
export type { MapMouseEvent } from "./driver/types/events";
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
