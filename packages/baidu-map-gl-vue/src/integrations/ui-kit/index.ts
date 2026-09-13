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
 * import { BPlaceAutocomplete, BPlaceSearch } from "baidu-map-gl-vue/ui-kit";
 * import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";
 * ```
 *
 * 详情（`PlaceDetail`）与路线（`RoutePlan`）本轮**不提供** Vue 封装——它们已在 #70 的原生
 * 探针里验证可用，但没有经过 Vue 层的生命周期与事件契约设计，我们不用「看起来像组件」
 * 的壳子冒充完成。需要时可用本入口导出的 `loadUiKit()` 原生构造，文档「详情与路线」一节
 * 给了示例与边界说明。
 */
export { default as BPlaceAutocomplete } from "./components/BPlaceAutocomplete.vue";
export { default as BPlaceSearch } from "./components/BPlaceSearch.vue";
export type { BPlaceAutocompleteProps } from "./components/BPlaceAutocomplete.vue";
export type { BPlaceSearchProps, PlaceBoundsDTO } from "./components/BPlaceSearch.vue";

export { loadUiKit, isUiKitLoaded, UI_KIT_PACKAGE, UI_KIT_STYLE_PATH } from "./loadUiKit";
export { useUiKitWidget } from "./useUiKitWidget";
export type {
  UiKitSubscription,
  UiKitWidgetStatus,
  UseUiKitWidgetOptions,
  UseUiKitWidgetResult,
} from "./useUiKitWidget";

export type {
  PlaceAutocompleteDisplayDTO,
  PlaceHighlightDTO,
  PlacePointDTO,
  PlacePoiDTO,
  PlaceSearchDisplayDTO,
  PlaceSuggestionDTO,
  UiKitAutocompleteWidget,
  UiKitModule,
  UiKitSearchWidget,
  UiKitWidgetHandle,
  UiKitWidgetOptions,
} from "./types";
