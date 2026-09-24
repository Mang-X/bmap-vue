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
 * import { BPlaceAutocomplete, BPlaceSearch } from "bmap-vue/ui-kit";
 * import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
 * ```
 *
 * 四个标准 UI widget（`PlaceAutocomplete` / `PlaceSearch` / `PlaceDetail` / `RoutePlan`）都有
 * Vue 薄封装：`BPlaceAutocomplete` / `BPlaceSearch`（#73）与 `BPlaceDetail` / `BRoutePlan`（#75）。
 * 上游声明了但产物里**没有入口**的能力（例如 `PlaceDetailOptions.layout`）刻意不暴露 ——
 * 「传了不生效」属于假支持，理由与证据见 ADR 2026-09-13（`./ui-kit` 的详情 / 路线封装）。
 */
export { default as BPlaceAutocomplete } from "./components/BPlaceAutocomplete.vue";
export { default as BPlaceSearch } from "./components/BPlaceSearch.vue";
export { default as BPlaceDetail } from "./components/BPlaceDetail.vue";
export { default as BRoutePlan } from "./components/BRoutePlan.vue";
export type { BPlaceAutocompleteProps } from "./components/BPlaceAutocomplete.vue";
export type { BPlaceSearchProps, PlaceBoundsDTO } from "./components/BPlaceSearch.vue";
export type { BPlaceDetailProps } from "./components/BPlaceDetail.vue";
export type { BRoutePlanProps } from "./components/BRoutePlan.vue";

export { loadUiKit, isUiKitLoaded, UI_KIT_PACKAGE, UI_KIT_STYLE_PATH } from "./loadUiKit";
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
  PlaceDetailDTO,
  PlaceDetailDisplayDTO,
  PlaceDetailPlaceInput,
  PlaceDetailPlaceObject,
  PlaceHighlightChangeDTO,
  PlaceHighlightDTO,
  PlacePointDTO,
  PlacePoiDTO,
  PlaceSearchDisplayDTO,
  PlaceSuggestionDTO,
  RouteDriveSegmentDTO,
  RoutePlanDTO,
  RoutePlanDrivingOptionsDTO,
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
