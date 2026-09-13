<script setup lang="ts">
/**
 * BPlaceAutocomplete —— 官方 UI Kit `PlaceAutocomplete` 的 Vue 薄封装（R25-D / issue #73）
 *
 * 只做三件事：host 容器、构造前提（Map ready）、props → 已验证 setter / 事件 DTO。
 * 输入框、建议下拉、键盘导航、防抖与城市限定全部由 `@baidumap/jsapi-ui-kit` 渲染。
 *
 * 刻意不做（issue 实施步骤 5「不承诺完整 v-model:query」）：
 * - **没有 `v-model:query`**：上游 `1.1.2` 没有公开的「输入变化」事件契约（`on()` 只接受
 *   `suggest` / `select` / `highlight`），单方面造一个 v-model 会把「用户在打字」与
 *   「组件主动 setInputValue」混成同一个信号。需要读当前值请调用公开动作 `getInputValue()`。
 * - **不 querySelector 上游内部输入框**：那是对上游内部 DOM 的隐式依赖，上游改结构就断。
 * - **不接 headless `Autocomplete` 服务**：同一份建议只应来自 UI Kit 一条通道
 *   （issue 验收「单次交互不重复发出 UI/两套请求」）。
 *
 * 构造期选项 vs 运行期 setter：只有 `location` / `citylimit` / `types` 有已验证的公开 setter，
 * 因此只有它们支持挂载后变更；`placeholder` / `debounce` / `minLength` / `showSuggestion` /
 * `suggestionCount` / `display` 是构造期选项，变更需重新挂载（给组件加 `:key`）。
 */
import { ref, watch } from "vue";
import { useUiKitWidget } from "../useUiKitWidget";
import { toHighlightDTO, toSuggestionDTO, toSuggestionList } from "../points";
import type {
  PlaceAutocompleteDisplayDTO,
  PlaceHighlightDTO,
  PlaceSuggestionDTO,
  UiKitAutocompleteWidget,
} from "../types";

export interface BPlaceAutocompleteProps {
  /** 输入框 placeholder，默认由上游决定（`搜索地点`）。构造期选项。 */
  placeholder?: string;
  /** 输入防抖毫秒数，默认 300。构造期选项。 */
  debounce?: number;
  /** 检索城市限定（如 `北京`）；不传则由地图当前视野中心解析城市。运行期可改。 */
  location?: string;
  /** 是否严格限定在 `location` 城市范围内，默认 false。运行期可改。 */
  citylimit?: boolean;
  /** 结果类型过滤，默认 `all`。运行期可改。 */
  types?: "all" | "city";
  /** 触发检索的最小字符数，默认 1。构造期选项。 */
  minLength?: number;
  /** 是否展示建议下拉列表，默认 true。构造期选项。 */
  showSuggestion?: boolean;
  /** 建议条数上限；不传时移动端 6、桌面端不限制。构造期选项。 */
  suggestionCount?: number;
  /** 下拉列表字段显隐。构造期选项。 */
  display?: PlaceAutocompleteDisplayDTO;
}

/**
 * 布尔 props 必须给**显式默认值**，且默认值取上游的默认值。
 *
 * Vue 对 `Boolean` 类型的 prop 有「缺省即 false」的转换（`resolvePropValue` 里
 * `isAbsent && !hasDefault → false`），所以声明了 `showSuggestion?: boolean` 而不给默认值时，
 * 用户没传也会拿到 `false`；照直透传给上游就会把官方默认的 `true` 静默改成 `false`。
 * 给上默认值后 `hasDefault` 为真、布尔转换不再介入，透传语义与官方一致（见用例
 * `v3-ui-kit-events.test.ts` 的「缺省布尔 props 不得把上游默认值改掉」）。
 */
const props = withDefaults(defineProps<BPlaceAutocompleteProps>(), {
  citylimit: false,
  showSuggestion: true,
});

const emit = defineEmits<{
  /** 建议列表更新（真实回包数组） */
  suggest: [suggestions: PlaceSuggestionDTO[]];
  /** 用户选中某条建议 */
  select: [suggestion: PlaceSuggestionDTO];
  /** 高亮项变化 */
  highlight: [item: PlaceHighlightDTO];
}>();

const hostRef = ref<HTMLElement | null>(null);

const { status, withWidget, applyIfReady } = useUiKitWidget<UiKitAutocompleteWidget>({
  component: "BPlaceAutocomplete",
  host: hostRef,
  buildOptions: () => {
    // 只透传「显式给过」的选项：把 undefined 也传下去会覆盖上游的默认值。
    const options: Record<string, unknown> = {};
    if (props.placeholder !== undefined) options.placeholder = props.placeholder;
    if (props.debounce !== undefined) options.debounce = props.debounce;
    if (props.location !== undefined) options.location = props.location;
    if (props.citylimit !== undefined) options.citylimit = props.citylimit;
    if (props.types !== undefined) options.types = props.types;
    if (props.minLength !== undefined) options.minLength = props.minLength;
    if (props.showSuggestion !== undefined) options.showSuggestion = props.showSuggestion;
    if (props.suggestionCount !== undefined) options.suggestionCount = props.suggestionCount;
    if (props.display !== undefined) options.display = props.display;
    return options;
  },
  create: (module, host, options) => new module.PlaceAutocomplete(host, options),
  bind: () => [
    {
      event: "suggest",
      handler: (...args: unknown[]) => emit("suggest", toSuggestionList(args[0])),
    },
    {
      event: "select",
      handler: (...args: unknown[]) => {
        const suggestion = toSuggestionDTO(args[0]);
        if (suggestion) emit("select", suggestion);
      },
    },
    {
      event: "highlight",
      handler: (...args: unknown[]) => {
        const item = toHighlightDTO(args[0]);
        if (item) emit("highlight", item);
      },
    },
  ],
});

// 已验证的公开 setter → 运行期 props 镜像。未就绪时不需要补调用：构造选项已带上当前值。
watch(
  () => props.location,
  (value) => {
    if (value === undefined) return;
    applyIfReady((widget) => widget.setLocation(value));
  },
);
watch(
  () => props.citylimit,
  (value) => {
    if (value === undefined) return;
    applyIfReady((widget) => widget.setCitylimit(value));
  },
);
watch(
  () => props.types,
  (value) => {
    if (value === undefined) return;
    applyIfReady((widget) => widget.setTypes(value));
  },
);

/** 程序化检索。构造是异步的，因此动作会等待 widget 就绪；已卸载则拒绝。 */
function search(keyword: string): Promise<void> {
  return withWidget((widget) => widget.search(keyword));
}

/** 写入输入框（不触发检索）。 */
function setInputValue(value: string): Promise<void> {
  return withWidget((widget) => widget.setInputValue(value));
}

/** 读取输入框当前值。 */
function getInputValue(): Promise<string> {
  return withWidget((widget) => widget.getInputValue());
}

/** 运行时改写检索城市。 */
function setLocation(location: string): Promise<void> {
  return withWidget((widget) => widget.setLocation(location));
}

/** 运行时改写城市严格限定。 */
function setCitylimit(citylimit: boolean): Promise<void> {
  return withWidget((widget) => widget.setCitylimit(citylimit));
}

/** 运行时改写结果类型过滤。 */
function setTypes(types: "all" | "city"): Promise<void> {
  return withWidget((widget) => widget.setTypes(types));
}

/** 展开建议下拉。 */
function show(): Promise<void> {
  return withWidget((widget) => widget.show());
}

/** 收起建议下拉。 */
function hide(): Promise<void> {
  return withWidget((widget) => widget.hide());
}

defineExpose({
  /** 桥的状态：`idle` / `loading` / `ready` / `error` / `disposed` */
  status,
  search,
  setInputValue,
  getInputValue,
  setLocation,
  setCitylimit,
  setTypes,
  show,
  hide,
});

defineOptions({ name: "BPlaceAutocomplete" });
</script>

<template>
  <!-- host 只提供挂载点：输入框与建议下拉的 DOM 全部由官方 UI Kit 渲染。 -->
  <div ref="hostRef" class="b-place-autocomplete"></div>
</template>
