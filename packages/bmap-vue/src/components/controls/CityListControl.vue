<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";
import { createCityListCommands } from "../../core/controls/controlCommands";
import type { Point } from "../../driver/types/geometry";
import type { CityListCommandApi } from "../../driver/types/controls";

/**
 * 城市切换的结果（官方 `CityListControlChangeResult` 的领域投影）。
 *
 * 逐字段取自 `@baidumap/jsapi-v4-types@4.0.5` 的 `control/CityListControlOptions.d.ts`：
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
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。`expand` 走官方成对的 `open()` / `close()`
 * （Driver 的分类表把它映射成 `choice`），因此改它不会重建控件。
 *
 * ⚠️ **`open()` / `close()` 的实际效果本轮未能判定**（`scripts/probe-165c-surface.mts`）：
 * 两者在稳定态**在位且不抛**，但 headless 环境下该控件**始终不渲染面板 DOM**
 * （`getTriggerDom()` 恒为 `undefined`，构造期 `expand: true` 也不出面板），
 * 因此「调用前后 DOM 无变化」**不能**当「它们是空操作」的证据——面板压根不存在。
 * 按 #165 的硬证据规则（取不到只能记「无法验证」），`choice` 分类**暂按官方声明保留**，
 * 但「它真的能展开面板」**尚未被任何读数证实**。证伪/证实之前不要把它改成 `recreate`。
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

const spec: ControlSpec<CityListControlProps, CityListCommandApi> = {
  kind: "city-list",
  options: (p) => ({ anchor: p.anchor, offset: p.offset, expand: p.expand }),
  events: () => [
    ["changeBefore", () => emit("changeBefore")],
    ["changeAfter", () => emit("changeAfter")],
    ["changeSuccess", (event: unknown) => emit("changeSuccess", readChangeResult(event))],
    ["open", () => emit("open")],
    ["close", () => emit("close")],
  ],
  // 命令面（#168 item 1）：`toggle()`（动作）与 `getCityName()`（读回）。
  //
  // ⚠️ 这两个成员**不是**「上一轮当缺口补上去的必然失败 API」（#165 审计最初这么记，并建议删除）——
  // live 复核否掉了那个前提：稳定态 `toggle` / `getCityName` **在原型与实例上都在、真调得动**
  // （`getCityName()` 读回 `"中国"`）。见 `scripts/probe-165c-surface.mts` §④。
  //
  // ⚠️ 但它们落在官方控件成员面的**后补批次**里：在 loader 判就绪之后约 150ms 内，
  // 实例上还没有它们（此时调用会得到 `BMAP_SDK_CALL_FAILED`）。命令面经
  // `useControlResource` 的 session 取句柄，因此**组件就绪并不蕴含成员面已就绪**——
  // 这一点与 `CopyrightControl` 的延后摘除是同一个成因。
  //
  // ⚠️ **刻意没有** `getTriggerDom()`：官方声明了它，但返回的是 raw `HTMLElement`，
  // 收窄投影不成立（逐条依据见 `driver/types/controls.ts` 的 `CityListCommandApi`）。
  expose: (exposeCtx) => createCityListCommands(exposeCtx),
};

const { commands, status } = useControlResource(props, spec);

defineExpose({
  ...(commands ?? {}),
  /**
   * 实例状态（`idle` / `creating` / `ready` / `error` / `disposing` / `disposed`）。
   *
   * 命令面在未就绪 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，因此必须有一个能先看状态的出口。
   */
  status,
});

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "CityListControl" });
</script>

<template>
  <slot />
</template>
