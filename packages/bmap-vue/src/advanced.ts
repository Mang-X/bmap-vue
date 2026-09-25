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
  JsapiV4ScriptMode,
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
