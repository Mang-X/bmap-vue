<script setup lang="ts">
/**
 * BPlaceSearch —— 官方 UI Kit `PlaceSearch` 的 Vue 薄封装（R25-D / issue #73）
 *
 * 结果列表（含条目点击、字段显隐）与检索本身全部由 `@baidumap/jsapi-ui-kit` 渲染；本组件只做
 * host 容器、Map ready 前提、props → 构造选项、事件 DTO 与公开动作。
 *
 * ⚠️ 翻页是**能力而不是内置 UI**：上游 `1.1.2` 只提供 `prevPage` / `nextPage` / `goToPage`
 * 这三个 API，**没有**会自动出现翻页按钮的控件。需要翻页按钮请自行渲染并调用本组件的同名动作。
 *
 * 刻意不做（issue 实施步骤 6）：
 * - **不使用本库 headless 的 `LocalSearch` 服务**。上游 `PlaceSearch` 自己走
 *   `api.map.baidu.com` 的 JSONP 通道（`qt=` 私有请求码），再叠一层 headless 检索会让
 *   一次交互发两次请求、结果还可能不一致。本组件唯一的数据来源是 UI Kit。
 * - **不承诺视野联动**：`options.map` 在调用期只被用来取 `getZoom()` / `getProjection()`，
 *   不做打点或视野跳转；需要联动请监听 `select` 事件后自行调用地图 API。
 *
 * props 都是**构造期选项**（上游没有对应 setter）：变更即重建 widget，不会静默保留旧值
 * （口径与官方 react-bmap 的 `ctorKey` 一致）。检索与翻页都是公开动作，不需要重建。
 */
import { ref } from "vue";
import { useUiKitWidget } from "../useUiKitWidget";
import { toPoiDTO, toPoiList } from "../points";
import type { PlacePointDTO, PlacePoiDTO, PlaceSearchDisplayDTO, UiKitSearchWidget } from "../types";

export interface BPlaceSearchProps {
  /** 每页结果条数，默认由上游决定（10）。构造期选项，变更会重建 widget。 */
  pageCapacity?: number;
  /** 请求的页码。构造期选项，变更会重建 widget。 */
  pageNum?: number;
  /** 结果列表字段显隐。构造期选项，变更会重建 widget。 */
  display?: PlaceSearchDisplayDTO;
}

const props = withDefaults(defineProps<BPlaceSearchProps>(), {});

const emit = defineEmits<{
  /** 一轮检索的完整结果（`load` 事件） */
  load: [pois: PlacePoiDTO[]];
  /** 用户点选某条结果 */
  select: [poi: PlacePoiDTO];
}>();

/** 检索范围：西南角 / 东北角。 */
export interface PlaceBoundsDTO {
  sw: PlacePointDTO;
  ne: PlacePointDTO;
}

const hostRef = ref<HTMLElement | null>(null);

/** 构造期选项的键名表（单一来源：`buildOptions()` 由它取值，桥按同一份内容判断是否重建）。 */
const CONSTRUCTOR_OPTION_KEYS = [
  "pageCapacity",
  "pageNum",
  "display",
] as const satisfies readonly (keyof BPlaceSearchProps)[];

/** 构造期选项：值透传给上游构造器；桥按内容的稳定串判断是否重建（内容相同的内联对象不触发）。 */
function buildOptions(): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const key of CONSTRUCTOR_OPTION_KEYS) {
    const value = props[key];
    if (value !== undefined) options[key] = value;
  }
  return options;
}

const { status, withWidget, toRawPoint } = useUiKitWidget<UiKitSearchWidget>({
  component: "BPlaceSearch",
  host: hostRef,
  buildOptions,
  // 本组件的 props 全是构造期选项，因此两份取的是同一个函数。
  constructorOptions: buildOptions,
  create: (module, host, options) => new module.PlaceSearch(host, options),
  bind: () => [
    {
      event: "load",
      handler: (...args: unknown[]) => emit("load", toPoiList(args[0])),
    },
    {
      event: "select",
      handler: (...args: unknown[]) => {
        const poi = toPoiDTO(args[0]);
        if (poi) emit("select", poi);
      },
    },
  ],
});

// 构造期选项变更 → 重建由桥负责（`constructorOptions`）。

/** 关键字检索；`city` 可限定城市。 */
function search(keyword: string, option?: { city?: string }): Promise<void> {
  return withWidget((widget) => widget.search(keyword, option));
}

/** 周边检索。坐标经 Driver 转 raw Point 后再交给上游（上游直接把它塞进请求）。 */
async function searchNearby(keyword: string, center: PlacePointDTO, radius?: number): Promise<void> {
  const rawCenter = await toRawPoint(center);
  await withWidget((widget) => widget.searchNearby(keyword, rawCenter, radius));
}

/** 范围检索（矩形西南 / 东北角）。 */
async function searchInBounds(keyword: string, bounds: PlaceBoundsDTO): Promise<void> {
  const rawSw = await toRawPoint(bounds.sw);
  const rawNe = await toRawPoint(bounds.ne);
  await withWidget((widget) => widget.searchInBounds(keyword, { sw: rawSw, ne: rawNe }));
}

/** 上一页。 */
function prevPage(): Promise<void> {
  return withWidget((widget) => widget.prevPage());
}

/** 下一页（沿用上次检索条件）。 */
function nextPage(): Promise<void> {
  return withWidget((widget) => widget.nextPage());
}

/** 跳转到指定页（从 1 开始）。 */
function goToPage(page: number): Promise<void> {
  return withWidget((widget) => widget.goToPage(page));
}

defineExpose({
  /**
   * 桥的状态：`idle` / `loading` / `ready` / `error` / `disposed`。
   *
   * 用取值 getter 而不是直接 expose 这个 ref：`defineExpose` 会被 Vue 的 `proxyRefs` 解包，
   * runtime 读到的本来就是取值；写成 ref 会让声明与 runtime 不一致（评审 #73 第 2 项）。
   */
  get status() {
    return status.value;
  },
  search,
  searchNearby,
  searchInBounds,
  prevPage,
  nextPage,
  goToPage,
});

defineOptions({ name: "BPlaceSearch" });
</script>

<template>
  <!-- host 只提供挂载点：结果列表的 DOM 全部由官方 UI Kit 渲染（翻页按钮需自行渲染并调动作）。 -->
  <div ref="hostRef" class="b-place-search"></div>
</template>
