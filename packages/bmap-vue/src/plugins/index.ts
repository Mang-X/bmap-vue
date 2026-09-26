export { createBMapPlugin, bmapConfigKey } from "./createBMapPlugin";
export type { BMapPluginConfig, CreateBMapPluginOptions } from "./createBMapPlugin";
export {
  urlPluginDefinition,
  trackAnimationPlugin,
  mapVglPlugin,
  drawingManagerPlugin,
  geoUtilsPlugin,
  BUILTIN_PLUGIN_URLS,
} from "./builtins";
// 插件 Catalog（M8-PLUGIN-CORE / #42）：名字 → definition 的单一事实源，未知名字明确失败。
// `stringToPluginDefinitions` 从 `builtins.ts` 迁到这里（公共路径不变，仍是根入口那一个）。
export {
  BUILTIN_PLUGIN_CATALOG,
  BUILTIN_PLUGIN_NAMES,
  resolvePluginDefinition,
  stringToPluginDefinitions,
} from "./catalog";
export type { PluginCatalogEntry } from "./catalog";
// 共享宿主（M8-PLUGIN-CORE / #42）：`global` 作用域插件资源的持有者。
// `disposeDefaultPluginHost()` 是它唯一的释放入口（测试 / 热更新要一个干净起点时用）——
// 地图卸载**不是**释放入口，理由见 ADR 2026-09-14 的决策 4。
export { createPluginHost, getDefaultPluginHost, disposeDefaultPluginHost } from "../core/plugins/PluginHost";
export type { PluginHost, PluginHostEntryInspection } from "../core/plugins/PluginHost";
// 插件兼容 inventory（M3A3-07）：数据驱动，文档由 `pnpm generate:plugin-inventory` 生成。
export {
  PLUGIN_COMPAT_INVENTORY,
  PLUGIN_COMPAT_BY_ID,
  PLUGIN_EVIDENCE_BASIS_MEANING,
  PLUGIN_VERDICT_MEANING,
  // #43：五值词表的运行时清单（生成器与门禁用同一份来源，避免两处清单漂移）。
  PLUGIN_VERDICTS,
} from "./compat-inventory";
export type {
  BuiltinPluginName,
  PluginCompatEntry,
  PluginEvidenceBasis,
  PluginMigrationPath,
  PluginRuntimeReading,
  PluginVerdict,
  PluginVersionLock,
} from "./compat-inventory";
export type { BMapPluginDefinition } from "../core/plugins/PluginRegistry";

/* ==================================================================== *
 * 已导出插件 API 的**公共类型面**（issue #160）
 *
 * 这些名字出现在**已导出**的签名里（`createBMapPlugin()` 的 `BMapPluginConfig.defaults`
 * 是 `BMapLoadOptions`、`BMapPluginDefinition.scope` 是 `PluginScope`、
 * `PluginHostEntryInspection.status` 是 `PluginHostEntryStatus` …），却没有被本子入口导出
 * —— 消费方调得到、却没法为参数或结果**命名**。判据是「消费方能不能命名它」
 * （ADR 2026-09-25）；全部是纯数据 / 可命名的稳定形状，因此升为导出。
 *
 * 随附的 `export type` **不新增任何值导出**，值导出面仍由
 * `export-surface-freeze.test.ts` 的清单守着。
 * ==================================================================== */

// —— Client 与 Provider（`BMapPluginConfig.provider` / `createBMapPlugin` 的选项）
export type { BMapProviderLike, CreateBMapClientOptions } from "../client/types";
// `BMapClient` / `BMapDriverFactory` / 各 Driver 门面 / Capability 表 / `MapHandle` 等
// 由 `./advanced` 那一处装配面导出（它本来就是这些类型的正主）。这里转出是为了让
// `PluginContext.client` / `BMapProviderLike` 的返回类型在**本**子入口可命名
// （issue #160）——`./advanced` 已是它们的名副其实的出口，不新增第二份定义。
// —— `PluginContext.client` 的类型：完整 `BMapClient`（插件确实要经它驱动 SDK）
export type { BMapClient } from "../client/types";
export type { BMapDriver, BMapEngine } from "../driver/types/bmap";
export type { Capability, CapabilityFamily, CapabilityStatus } from "../driver/capability/catalog";
export type { CapabilityExplanation, CapabilityReason, CapabilityRegistry } from "../driver/capability/registry";
export type { CapabilityDescriptor } from "../driver/capability";
export type { ControlDriver } from "../driver/types/controls";
export type { EventDriver } from "../driver/types/events";
export type { GeometryDriver } from "../driver/types/geometry";
export type { LayerDriver } from "../driver/types/layers";
export type { MapDriver } from "../driver/types/map";
export type { OverlayDriver } from "../driver/types/overlays";
export type { PanoramaDriver } from "../driver/types/panorama";
export type { ServiceDriver } from "../driver/types/services";
export type { UnsupportedBehavior } from "../driver/capability";
export type { LoadedJsapiV4 } from "../core/loader/providers/types";
export type { BMapDriverFactory, BMapDriverInput } from "../client/types";
// —— 句柄与服务 options / result（`PluginContext.map`、`BMapProviderLike` 暴露）
export type {
  CircleHandle,
  ControlHandle,
  InfoWindowHandle,
  LayerHandle,
  LabelHandle,
  MapHandle,
  MarkerHandle,
  OverlayHandle,
  PolygonHandle,
  PolylineHandle,
  SdkHandle,
  ServiceHandle,
} from "../driver/types/handles";
export type { Bounds, Pixel, Point, Size } from "../driver/types/geometry";
export type { ControlKind, ControlOptions, ControlOptionStatus, CopyrightEntry } from "../driver/types/controls";
export type { InitialMapOptions, MapInteraction, MapStyleInput, MapType, MapView } from "../driver/types/map";
export type {
  CustomOverlayOptions,
  InfoWindowOptions,
  LabelOptions,
  MarkerIconInput,
  MarkerOptions,
  OverlayPropertyPolicy,
  OverlayTarget,
  PathOptions,
} from "../driver/types/overlays";
export type {
  LayerCreateOptions,
  LayerData,
  LayerKind,
  LayerOperation,
  LayerSurface,
} from "../driver/types/layers";
export type {
  NativeLayerFeatureKeys,
  NativeLayerFeatureState,
  NativeLayerFeatureStateMap,
} from "../driver/types/native-layers";
export type {
  AutocompleteUpdateOptions,
  DrivingRouteOptions,
  LocalSearchOptions,
  RidingRouteOptions,
  TransitRouteOptions,
  WalkingRouteOptions,
} from "../driver/types/services";
export type { ViewAnimationCancelOutcome } from "../driver/types/map";
// —— Provider 家族字段（`BMapProviderLike` / `PluginContext` 的加载面）
export type {
  JsapiV4Engine,
  JsapiV4LoadMetadata,
  JsapiV4LoadMode,
  JsapiV4Namespace,
  JsapiV4ProviderId,
  JsapiV4ScriptMode,
  JsapiV4VersionSource,
} from "../core/loader/providers/types";
// —— 策略常量（值与类型同名）：插件的 `load()` 常要按出行方式选策略。
export { DrivingPolicy, IntercityPolicy, TransitPolicy, TransitVehiclePolicy } from "../driver/types/services";
// —— Autocomplete / 路线构造选项的内部投影（`BMapProviderLike` 的服务面会引用它们）
export type { AutocompleteOptions } from "../driver/types/services";
export type { LocalSearchRenderOptions, RouteRenderOptions, RouteRenderState, RouteState } from "../driver/types/services";
export type { LayerCtorSlot } from "../driver/types/layers";
// —— 加载配置（`BMapPluginConfig.defaults`；`ak` / `apiUrl` / `timeout` …）
export type { BMapLoadOptions, CrossOriginValue } from "../core/loader/url";
// —— 插件定义与上下文（`BMapPluginDefinition` / `PluginHost`）
export type { PluginContext, PluginScope } from "../core/plugins/PluginRegistry";
export type { PluginHostEntryStatus } from "../core/plugins/PluginHost";
export type { PluginUrlKey } from "./compat-inventory";
// —— 释放句柄（`BMapPluginDefinition.setup?` 的返回类型）
//
// 刻意**不**导出 `ResourceScope`：它带 `private disposers` / `private _disposed`，仓库之外
// 既不能构造也不能实现，放进公共面就是 ADR 2026-09-25 决策 5 说的「假支持」。插件 API 里
// 真正需要命名的只有 `Disposer`（一个 `() => void`）与 `BMapPluginDefinition.scope` 的
// `"global" | "map"` 字面量，两者都不依赖 `ResourceScope`。
export type { Disposer } from "../core/lifecycle/ResourceScope";
// —— 错误类按值导出：`<RoutePlan>` / 服务 / 加载失败都抛它，消费方要能 catch / instanceof。
export { BMapError } from "../core/errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "../core/errors/BMapError";
