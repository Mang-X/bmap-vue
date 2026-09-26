<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";
import type { Point } from "../../driver/types/geometry";

/**
 * 城市切换的结果（官方 `CityListControlChangeResult` 的领域投影）。
 *
 * 逐字段取自 `@baidumap/jsapi-v4-types@4.0.4` 的 `control/CityListControlOptions.d.ts`：
 * `city: string` / `code: string | number` / `title?: string` / `uid?: string` /
 * `point?: Point | ''` / `level?: number`。
 *
 * ⚠️ `point` 官方声明是 `Point | ''`——**空串**与「没有坐标」同形。本库原样保留
 * （`""` 归一成 `null` 才是猜测上游语义），消费方据此自行判断。
 */
export interface CityListChangeResult {
  city: string;
  code: string | number;
  title?: string;
  uid?: string;
  point?: Point | "";
  level?: number;
}

export interface CityListControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  expand?: boolean;
  visible?: boolean;
}

/**
 * CityListControl —— 城市列表控件
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。`expand` 是**可就地更新**的选项
 * （官方只有成对的 `open()` / `close()`，Driver 的分类表把它映射成 `choice`），因此改它
 * 不会重建控件、控件内部的展开动画与高亮状态都保留。
 */
const props = withDefaults(defineProps<CityListControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 18, y: 18 }),
  expand: false,
  visible: true,
});

/**
 * 事件面（issue #165 Class 3 / TASK 3 + 4：官方 6 个构造回调，此前 **0** 条事件）。
 *
 * 官方 `CityListControlOptions` 的六个回调全部**只在构造期注册**（`CONTROL_OPTION_SPECS`
 * 的 `city-list` 逐条记着「回调只在构造期注册」），而组件此前**一个都没暴露**——
 * 也就是说「用户切了城市」这个事实在本库**完全不可观测**。
 *
 * | 事件 | 官方键 | 官方类型 |
 * | --- | --- | --- |
 * | `changeBefore` | `onChangeBefore?: () => void` | 无载荷 |
 * | `changeAfter`  | `onChangeAfter?: () => void`  | 无载荷 |
 * | `changeSuccess` | `onChangeSuccess?: (poi: CityListControlChangeResult) => void` | 有载荷 |
 * | `open`          | `onOpen?: () => void`          | 无载荷 |
 * | `close`         | `onClose?: () => void`         | 无载荷 |
 *
 * ## 为什么做成**事件**而不是 prop
 *
 * 官方把它们叫「构造回调」是因为它们是 `setOptions` 袋里的键；而在本库的 Vue 口径下，
 * 「父组件想在某件事发生时做点什么」正是**事件**。做成 prop 会踩两条已知的坑：
 * ① `ControlSpec.options` 的变化键对函数值按**存在性**比较，换一个内联箭头**不算变化**
 *   （见 `core/controls/spec.ts` 的注释）——于是父级换一个闭包控件**不会重建**；
 * ② 即便重建，也只是让 SDK 调一个没人听回调的函数，而不是「事件派发」。
 *
 * 折中：构造期**仍然**把这六个键交给 SDK（官方读它们才会在正确的时机调），
 * 同时本组件**自己**订阅官方会派发的同名事件并原样转发——`ControlSpec.events` 就是
 * 干这个的（`LocationControl` 的 `locationSuccess` 同款）。
 *
 * ⚠️ **只有 `changeSuccess` 带载荷**（官方 `onChangeSuccess(poi)`），其余四个官方声明就是
 * 无参的，因此载荷是 `undefined`——不编一个 `{ city: "" }` 之类的东西。
 */
const emit = defineEmits<{
  changeBefore: [];
  changeAfter: [];
  /** 官方 POI 形状取不到时为 `null`（不编一个空 POI 冒充「切换到了空城市」）。 */
  changeSuccess: [result: CityListChangeResult | null];
  open: [];
  close: [];
}>();

/**
 * 从归一化事件里取出官方的 `CityListControlChangeResult`。
 *
 * ## 为什么经 `raw` 取，而不是直接用事件的顶层字段
 *
 * 控件事件与地图 / 覆盖物事件走**同一条** `normalizeDriverEvent` 路径（`driver/jsapi-v4/events.ts`），
 * 它按**地图**事件的形状重建载荷（`{type, point, pixel, zoom, raw, …}`）。官方
 * `onChangeSuccess(poi)` 给的是一个**普通 POI 对象**（`{city, code, point, …}`），不在那套形状里
 * ——直接读事件顶层会得到 `point: undefined`。`raw` 逃生口正是为此存在的（见
 * `driver/types/events.ts` 的 `DriverEvent.raw` 注释）。
 *
 * 归一化重建**不修改** `raw`（它就是 SDK 给的那个对象），因此从 `raw` 取到的就是官方原样。
 * 取不到时返回 `null` 而不是编一个 `{ city: "" }`——「没给」与「空」在上游没有可区分的证据。
 */
function readChangeResult(event: unknown): CityListChangeResult | null {
  const raw = (event as { raw?: unknown } | null)?.raw;
  const record = (raw ?? event) as Record<string, unknown> | null;
  if (!record || typeof record !== "object") return null;
  const city = record.city;
  const code = record.code;
  if (typeof city !== "string" || (typeof code !== "string" && typeof code !== "number")) {
    return null;
  }
  const result: CityListChangeResult = { city, code };
  if (typeof record.title === "string") result.title = record.title;
  if (typeof record.uid === "string") result.uid = record.uid;
  // `point` 官方声明是 `Point | ''` —— 空串与「没有坐标」同形，原样保留，不归一成 null
  if (record.point && typeof record.point === "object") {
    const point = record.point as { lng?: unknown; lat?: unknown };
    if (typeof point.lng === "number" && typeof point.lat === "number") {
      result.point = { lng: point.lng, lat: point.lat };
    }
  } else if (record.point === "") {
    result.point = "";
  }
  if (typeof record.level === "number") result.level = record.level;
  return result;
}

const spec: ControlSpec<CityListControlProps> = {
  kind: "city-list",
  options: (p) => ({ anchor: p.anchor, offset: p.offset, expand: p.expand }),
  events: () => [
    ["changeBefore", () => emit("changeBefore")],
    ["changeAfter", () => emit("changeAfter")],
    ["changeSuccess", (event: unknown) => emit("changeSuccess", readChangeResult(event))],
    ["open", () => emit("open")],
    ["close", () => emit("close")],
  ],
};

useControlResource(props, spec);

defineOptions({ name: "CityListControl" });
</script>

<template>
  <slot />
</template>
