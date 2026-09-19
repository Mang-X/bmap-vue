<script setup lang="ts">
/**
 * BHeatmapLayer —— 原生热力图层（官方 4.0 扩展 API `Heatmap`）
 *
 * ## 为什么能力面这么窄
 *
 * `Heatmap` 属官方**扩展 API**：`@baidumap/jsapi-v4-types@4.0.4` **没有**类声明，官方明确
 * 「首次加载时可视化实现是异步注入的」。因此本库只暴露驱动已登记（并逐条核对过）的三个入口：
 * `setData` / `clearData` / `setStyle`（Driver 按 kind 把它映射到整袋 `setOptions`）。
 *
 * 于是本组件**只声明三个 prop**：`data` / `style` / `visible`。
 *
 * - **没有** `opacity` / `zIndex` / `minZoom` / `maxZoom`：官方这些图层不公开对应 setter，声明了
 *   也只是静默忽略（issue 的非目标：「不让所有 Layer 共用错误的同一构造参数模型」）；
 * - `style` 是**原样透传的键值袋**：没有可核对的声明，本库不复刻一份没有依据的字段表。
 *   需要强类型样式的用 `BLineLayer` / `BFillLayer`（它们有官方声明）；
 * - `visible` 用**挂上 / 摘掉**表达（该 kind 没有 `setVisible`），因此**重新可见时会换实例**——
 *   依据是 #98 的 live 实测：`removeLayer` 之后的实例再也渲染不了。隐藏 ≠ 释放数据这一点在这里
 *   不成立（数据会随实例重建重新下发），文档里如实写明。
 *
 * ## 没有拾取事件
 *
 * 驱动的登记面里 `Heatmap` 没有 `setEnablePicked` / `hitTest`，也没有可核对的事件表断言命中语义，
 * 因此本组件**不声明**拾取事件（声明了却收不到 = 假支持）。
 */
import { useVisualLayer } from "./useVisualLayer";
import type { BHeatmapLayerProps } from "../../types/components";

const props = withDefaults(defineProps<BHeatmapLayerProps>(), {
  visible: true,
});

/**
 * 只装配生命周期，**不 expose 任何命令面**：`Heatmap` 没有状态入口（驱动登记面里没有
 * `updateState` 一族），挂一个「每次调用都会抛 `BMAP_CAPABILITY_UNSUPPORTED`」的方法只是假面。
 * 需要要素状态命令面的用 `BLineLayer` / `BFillLayer` / `BPointCollection`。
 */
useVisualLayer<BHeatmapLayerProps>(props, {
  kind: "heatmap",
  component: "BHeatmapLayer",
  // 该 kind 没有拾取面（也没有可核对的事件表）⇒ 不绑任何事件
});

defineOptions({ name: "BHeatmapLayer" });
</script>

<template>
  <slot />
</template>
