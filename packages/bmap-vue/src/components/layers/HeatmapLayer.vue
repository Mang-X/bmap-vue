<script setup lang="ts">
/**
 * HeatmapLayer —— 原生热力图层（官方 4.0 扩展 API `Heatmap`）
 *
 * ## 为什么能力面这么窄
 *
 * `Heatmap` 属官方**扩展 API**：`@baidumap/jsapi-v4-types@4.0.5` 才补上类声明（4.0.4 没有），
 * 官方明确「首次加载时可视化实现是异步注入的」。因此本库只暴露驱动已登记（并逐条对照官方声明
 * 核对过）的入口：`setData` / `setStyle`（Driver 按 kind 把样式映射到整袋 `setOptions`）。
 *
 * 于是本组件**只声明三个 prop**：`data` / `style` / `visible`。
 *
 * - **没有** `opacity` / `zIndex` / `minZoom` / `maxZoom`：前两个 4.0.5 确实声明了
 *   （`visualization/Heatmap.d.ts:157`/`:161`）但本组件**刻意不开面**——`style` 已经是官方的
 *   整袋 `HeatmapOptions` 透传口，图层级字段要单独开就是为它们另造一套更新路径；
 *   `minZoom` / `maxZoom` 官方**没有**字段级 setter（是构造选项），声明了只是静默忽略；
 * - `style` 是**原样透传的键值袋**：需要强类型样式的用 `LineLayer` / `FillLayer`
 *   （它们有官方声明）；
 * - `visible` 走 `setVisible`（4.0.5 声明，`visualization/Heatmap.d.ts:153`），因此**重新可见
 *   不换实例**。此前走挂上 / 摘掉、重新显示要换实例（依据是 #98 的 live 实测：
 *   `removeLayer` 之后的实例再也渲染不了）；4.0.5 之后那条前提不再适用；
 * - `data: null` 走**换一个没有数据的实例**（与四个组件同一口径）。驱动虽然为这个 kind 登记了
 *   `clearData`（官方声明里有），本组件**不调用它**：同一个 `null` 在不同 kind 上换语义会变成
 *   使用者最难预期的差异；而重建对 `null` 这种离散动作没有实质代价。
 *
 * ## 没有拾取事件
 *
 * 驱动的登记面里 `Heatmap` 没有 `setEnablePicked` / `hitTest`，也没有可核对的事件表断言命中语义，
 * 因此本组件**不声明**拾取事件（声明了却收不到 = 假支持）。
 */
import { useVisualLayer } from "./useVisualLayer";
import type { HeatmapLayerProps } from "../../types/components";

const props = withDefaults(defineProps<HeatmapLayerProps>(), {
  visible: true,
});

/**
 * 只装配生命周期，**不 expose 任何命令面**：`Heatmap` 没有状态入口（驱动登记面里没有
 * `updateState` 一族），挂一个「每次调用都会抛 `BMAP_CAPABILITY_UNSUPPORTED`」的方法只是假面。
 * 需要要素状态命令面的用 `LineLayer` / `FillLayer` / `PointCollection`。
 */
useVisualLayer<HeatmapLayerProps>(props, {
  kind: "heatmap",
  component: "HeatmapLayer",
  // 该 kind 没有拾取面（也没有可核对的事件表）⇒ 不绑任何事件
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
 * 同样没有索引签名，`typo` 会真的报 `TS2339`，而 Volar 对两者的 emit 完全一致。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "HeatmapLayer" });
</script>

<template>
  <slot />
</template>
