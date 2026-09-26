<script setup lang="ts">
/**
 * PlaceAutocomplete —— 官方 UI Kit `PlaceAutocomplete` 的 Vue 薄封装（R25-D / issue #73）
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
 * 两类 props 的处置不同（口径与官方 react-bmap 的 `ctorKey` 一致）：
 * - **构造期选项**（`placeholder` / `debounce` / `minLength` / `showSuggestion` /
 *   `suggestionCount` / `display`）：上游没有对应 setter，**变更即重建 widget**，
 *   不会静默保留旧值；
 * - **有已验证 setter 的选项**（`location` / `citylimit` / `types`）：走 setter 镜像，
 *   不重建。唯一的例外是 `location` 由「有值」变回「未设置」—— 上游没有公开、也没有被
 *   验证过的「清除城市限定」入口（`setLocation("")` 的语义未知），所以这种情况按
 *   构造期输入变化处理（重建），不去猜隐藏语义。
 */
import { ref, watch } from "vue";
import { useUiKitWidget } from "../useUiKitWidget";
import { toHighlightChangeDTO, toSuggestionDTO, toSuggestionList } from "../points";
import type {
  PlaceAutocompleteDisplayDTO,
  PlaceAutocompleteExpose,
  PlaceHighlightChangeDTO,
  PlaceSuggestionDTO,
  UiKitAutocompleteWidget,
} from "../types";

export interface PlaceAutocompleteProps {
  /** 输入框 placeholder，默认由上游决定（`搜索地点`）。构造期选项，变更会重建 widget。 */
  placeholder?: string;
  /** 输入防抖毫秒数，默认 300。构造期选项，变更会重建 widget。 */
  debounce?: number;
  /** 检索城市限定（如 `北京`）；不传则由地图当前视野中心解析城市。运行期可改（走 setter）。 */
  location?: string;
  /** 是否严格限定在 `location` 城市范围内，默认 false。运行期可改（走 setter）。 */
  citylimit?: boolean;
  /** 结果类型过滤，默认 `all`。运行期可改（走 setter）；改回未设置会恢复上游默认 `all`。 */
  types?: "all" | "city";
  /** 触发检索的最小字符数，默认 1。构造期选项，变更会重建 widget。 */
  minLength?: number;
  /** 是否展示建议下拉列表，默认 true。构造期选项，变更会重建 widget。 */
  showSuggestion?: boolean;
  /** 建议条数上限；不传时移动端 6、桌面端不限制。构造期选项，变更会重建 widget。 */
  suggestionCount?: number;
  /** 下拉列表字段显隐。构造期选项，变更会重建 widget。 */
  display?: PlaceAutocompleteDisplayDTO;
}

/**
 * 布尔 props 必须给**显式默认值**，且默认值取上游的默认值。
 *
 * Vue 对 `Boolean` 类型的 prop 有「缺省即 false」的转换（`resolvePropValue` 里
 * `isAbsent && !hasDefault → false`），所以声明了 `showSuggestion?: boolean` 而不给默认值时，
 * 用户没传也会拿到 `false`；照直透传给上游就会把官方默认的 `true` 静默改成 `false`。
 * 给上默认值后 `hasDefault` 为真、布尔转换不再介入，透传语义与官方一致（见用例
 * `ui-kit-events.test.ts` 的「缺省布尔 props 不得把上游默认值改掉」）。
 */
const props = withDefaults(defineProps<PlaceAutocompleteProps>(), {
  citylimit: false,
  showSuggestion: true,
});

const emit = defineEmits<{
  /** 建议列表更新（真实回包数组） */
  suggest: [suggestions: PlaceSuggestionDTO[]];
  /** 用户选中某条建议 */
  select: [suggestion: PlaceSuggestionDTO];
  /** 高亮项变化（上游的 `{ from, to }` 变更对，`from` 首次高亮时为 `null`） */
  highlight: [change: PlaceHighlightChangeDTO];
}>();

/**
 * 构造期选项的键名表（单一来源：`constructorOptions()` 与 `constructionKey` 都从这里取，
 * 新增 prop 时不会出现「只加了一边」导致静默不重建）。
 */
const CONSTRUCTOR_OPTION_KEYS = [
  "placeholder",
  "debounce",
  "minLength",
  "showSuggestion",
  "suggestionCount",
  "display",
] as const satisfies readonly (keyof PlaceAutocompleteProps)[];

/**
 * 构造期选项（上游没有 setter 的那些）的值。
 *
 * 内容（而不是对象引用）决定是否重建：桥用 `canonicalKey()` 做排序序列化，
 * 保证「每次渲染传新的对象字面量、内容相同」不会触发重建。
 */
function constructorOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of CONSTRUCTOR_OPTION_KEYS) {
    const value = props[key];
    if (value !== undefined) options[key] = value;
  }
  return options;
}

/** 桥的 `buildOptions()`：只透传「显式给过」的选项（传 undefined 会覆盖上游默认值）。 */
function buildOptions(): Record<string, unknown> {
  const options = constructorOptions();
  if (props.location !== undefined) options.location = props.location;
  if (props.citylimit !== undefined) options.citylimit = props.citylimit;
  if (props.types !== undefined) options.types = props.types;
  return options;
}

const hostRef = ref<HTMLElement | null>(null);

const { status, withWidget, applyIfReady, rebuild } = useUiKitWidget<UiKitAutocompleteWidget>({
  component: "PlaceAutocomplete",
  host: hostRef,
  buildOptions,
  // 构造期选项（上游没有 setter）：内容变化由桥重建 widget。
  constructorOptions,
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
        // 上游载荷是变更对 `{ from, to }`（形状锁在 ui-kit-widget-contract.test.ts）。
        const change = toHighlightChangeDTO(args[0]);
        if (change) emit("highlight", change);
      },
    },
  ],
});

// 构造期输入变化 → 重建由桥负责（`constructorOptions`）。

// 已验证的公开 setter → 运行期 props 镜像（不回落成重建）。
watch(
  () => props.location,
  (value, previous) => {
    if (value === previous) return;
    if (value === undefined) {
      // **只有「有值 → 未设置」这一向**需要重建：上游没有公开、也没有被验证过的清除入口
      // （`setLocation("")` 的语义未知），不猜隐藏语义。
      rebuild();
      return;
    }
    // 「未设置 → 有值」与「有值 → 有值」都走已验证的 `setLocation()`。
    // 这里不能重建：那会清掉输入值 / 焦点 / 下拉展开 / 高亮项，而「异步拿到城市后再赋值
    // `location`」是常见用法。未就绪时不需要补调用 —— `buildOptions()` 已带上当前值。
    applyIfReady((widget) => widget.setLocation(value));
  },
);
watch(
  () => props.citylimit,
  (value) => {
    // `citylimit` 有显式默认值（`false`），runtime 拿不到 `undefined`，因此不需要「改回未设置」分支。
    applyIfReady((widget) => widget.setCitylimit(value));
  },
);
watch(
  () => props.types,
  (value) => {
    // 上游 `types` 的默认值就是 `all`，因此「改回未设置」= 恢复默认，是明确定义的 setter 调用。
    applyIfReady((widget) => widget.setTypes(value ?? "all"));
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

/**
 * 组件对外的命令面：具名接口 + 显式标注（issue #160）。
 *
 * 返回类型标注后，`defineExpose()` 推导出的实例类型就是 `PlaceAutocompleteExpose`；写成内联对象字面量时
 * `vue-tsc` 会把每个方法提升成顶层 `declare function`，在公共声明里留下「只有名字、
 * 消费方无法命名」的符号。`status` 用取值 getter（`defineExpose` 会被 `proxyRefs` 解包）。
 */
function createExpose(): PlaceAutocompleteExpose {
  return {
    get status() {
      return status.value;
    },
    search,
    setInputValue,
    getInputValue,
    setLocation,
    setCitylimit,
    setTypes,
    show,
    hide,
  };
}

defineExpose(createExpose());

defineOptions({ name: "PlaceAutocomplete" });
</script>

<template>
  <!-- host 只提供挂载点：输入框与建议下拉的 DOM 全部由官方 UI Kit 渲染。 -->
  <div ref="hostRef" class="b-place-autocomplete"></div>
</template>
