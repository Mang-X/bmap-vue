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
  stringToPluginDefinitions,
  urlPluginDefinition,
  BUILTIN_PLUGIN_URLS,
} from "./plugins/builtins";
// Provider(公开 factory)
export {
  baiduCdnProvider,
  customScriptProvider,
  existingGlobalProvider,
} from "./core/loader/Provider";
export type { BMapProvider } from "./core/loader/Provider";
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
  AnyBMapProviderLike,
  BMapClient,
  BMapDriverFactory,
  BMapDriverInput,
  BMapProviderLike,
  CreateBMapClientOptions,
  LooseBMapProviderLike,
} from "./client/types";
export type { LoadedLegacySdk, LoadedSdk } from "./core/loader/loaded";
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
