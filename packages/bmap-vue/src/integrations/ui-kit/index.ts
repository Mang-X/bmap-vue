/**
 * `./ui-kit` 子路径入口（R25-D / issue #73）
 *
 * 与根入口的关系（ADR 2026-09-13 决策 3、4）：
 * - 根入口**不**导出这两个组件，也不静态引入官方 UI Kit。理由有两条，缺一都会出问题：
 *   1. `@baidumap/jsapi-ui-kit` 是 **optional peer**：不用 UI 的消费者不会安装它。
 *      若根入口的产物图里出现对它的 import，消费方的打包器在解析阶段就会报错/告警，
 *      「可选依赖」就变成了「必须安装」；
 *   2. 上游包在模块求值期访问 `document`，进入根入口会让 SSR 直接崩在 import 上。
 * - 本入口自身也**只**在浏览器挂载后动态 import 上游包（见 `loadUiKit.ts`），
 *   因此 SSR / 离线 import 本入口是安全的、无副作用的。
 *
 * 样式由消费方显式引入（与 #70 冻结的口径一致）：
 *
 * ```ts
 * import { PlaceAutocomplete, PlaceSearch } from "bmap-vue/ui-kit";
 * import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
 * ```
 *
 * 四个标准 UI widget（`PlaceAutocomplete` / `PlaceSearch` / `PlaceDetail` / `RoutePlan`）都有
 * Vue 薄封装：`PlaceAutocomplete` / `PlaceSearch`（#73）与 `PlaceDetail` / `RoutePlan`（#75）。
 * 上游声明了但产物里**没有入口**的能力（例如 `PlaceDetailOptions.layout`）刻意不暴露 ——
 * 「传了不生效」属于假支持，理由与证据见 ADR 2026-09-13（`./ui-kit` 的详情 / 路线封装）。
 */
export { default as PlaceAutocomplete } from "./components/PlaceAutocomplete.vue";
export { default as PlaceSearch } from "./components/PlaceSearch.vue";
export { default as PlaceDetail } from "./components/PlaceDetail.vue";
export { default as RoutePlan } from "./components/RoutePlan.vue";
export type { PlaceAutocompleteProps } from "./components/PlaceAutocomplete.vue";
export type { PlaceSearchProps } from "./components/PlaceSearch.vue";
export type { PlaceDetailProps } from "./components/PlaceDetail.vue";
export type { RoutePlanProps } from "./components/RoutePlan.vue";

export { loadUiKit, isUiKitLoaded, UI_KIT_PACKAGE, UI_KIT_STYLE_PATH } from "./loadUiKit";

/**
 * 错误类按**值**导出（issue #160）。
 *
 * `<RoutePlan>` 的 `error` 事件载荷与 `search()` 的拒绝都是这个类的实例，带稳定的
 * `code` 联合（`BMapErrorCode`）——消费方要能 `catch` / `instanceof` / 读 `code`，
 * 只暴露一个「无法命名」的类型等于让人只能 `unknown` 接。
 *
 * 它是**同一份**实现：`./advanced`（`UnsupportedCapabilityError extends BMapError`）、
 * `./plugins` 与根入口导出的都是同一个类，因此跨入口 `instanceof` 成立
 * （由 `ui-kit-entry.test.ts` 对产物闭包断言）。
 */
export { BMapError } from "../../core/errors/BMapError";
export type { BMapErrorCode, BMapErrorOptions } from "../../core/errors/BMapError";
export { useUiKitWidget } from "./useUiKitWidget";
// 既是值也是类型：让调用方写 `policy: RoutePlanDrivingPolicy.AVOID_CONGESTION` 而不是魔法数字。
// 值导出同时携带类型含义，因此它**不在**下面的 `export type` 列表里（重复导出会报错）。
export { RoutePlanDrivingPolicy } from "./types";
export type {
  UiKitSubscription,
  UiKitWidgetStatus,
  UseUiKitWidgetOptions,
  UseUiKitWidgetResult,
} from "./useUiKitWidget";

export type {
  PlaceAutocompleteDisplayDTO,
  PlaceAutocompleteExpose,
  PlaceBoundsDTO,
  PlaceDetailDTO,
  PlaceDetailExpose,
  PlaceDetailDisplayDTO,
  PlaceDetailPlaceInput,
  PlaceDetailPlaceObject,
  PlaceHighlightChangeDTO,
  PlaceHighlightDTO,
  PlacePointDTO,
  PlacePoiDTO,
  PlaceSearchDisplayDTO,
  PlaceSearchExpose,
  PlaceSuggestionDTO,
  RouteDriveSegmentDTO,
  RoutePlanDTO,
  RoutePlanDrivingOptionsDTO,
  RoutePlanExpose,
  RoutePlanEndpointInput,
  RoutePlanMode,
  RoutePlanNavClickDTO,
  RoutePlanPlanSelectDTO,
  RoutePlanResultDTO,
  RoutePlanSearchOptionsDTO,
  RoutePlanTypeChangeDTO,
  RoutePointDTO,
  RouteRidingSegmentDTO,
  RouteSegmentBaseDTO,
  RouteSegmentDTO,
  RouteSegmentType,
  RouteTransitSegmentDTO,
  RouteTransitSubType,
  RouteWalkSegmentDTO,
  UiKitAutocompleteWidget,
  UiKitModule,
  UiKitPlaceDetailWidget,
  UiKitRoutePlanWidget,
  UiKitSearchWidget,
  UiKitWidgetHandle,
  UiKitWidgetOptions,
} from "./types";
