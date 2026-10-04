<script setup lang="ts">
/**
 * TrafficLayer —— 实时路况图层（官方 `BMap.TrafficLayer`，4.0）
 *
 * 官方把它定义为「预配置的 `TileLayer`」，因此构造选项与 `TileLayer` 一致（`opacity` /
 * `zIndex`），另外多两个**可就地更新**的开关：`colors`（`setColors`）与 `edge`（`setEdge`）。
 * 后两者变化时不会重建图层，也不会丢掉已加载的瓦片。
 *
 * `autoRefresh` / `refreshInterval` 只有构造期生效（官方没有对应 setter）：改变它们会重建
 * 图层——这是有意的，因为「刷新间隔」是图层内部的定时器，就地改不了。
 *
 * ⚠️ **不承诺多实例隔离**：官方 `TrafficLayer` 是**页面级单实例**（原型本身就是已构造实例，
 * `map` / 瓦片缓存 / 刷新 timer 在所有 `new TrafficLayer()` 之间共享，见 ADR
 * `2026-09-11-jsapi-v4-control-layer-facets` §12 的技术结论）。挂两个路况图层时，
 * `autoRefresh` 一类共享状态以最后一次写入为准；需要严格隔离就一个 `<Map>` 一个实例。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface TrafficLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
  /** 图层透明度，0 - 1。 */
  opacity?: number;
  /** 图层层叠顺序（官方有 `setZIndex`，可就地更新）。 */
  zIndex?: number;
  /** 是否自动刷新路况数据。 */
  autoRefresh?: boolean;
  /** 路况自动刷新间隔（毫秒）。 */
  refreshInterval?: number;
  /** 路况颜色，顺序为 `[畅通, 缓行, 拥堵, 严重拥堵]`（可就地更新）。 */
  colors?: string[];
  /** 是否展示白色描边（可就地更新）。 */
  edge?: boolean;
}

const props = withDefaults(defineProps<TrafficLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  autoRefresh: undefined,
  edge: undefined,
});

useLayerResource<TrafficLayerProps>(props, {
  component: "TrafficLayer",
  toSpec: (p) => ({
    kind: "traffic",
    visible: p.visible,
    opacity: p.opacity,
    zIndex: p.zIndex,
    // `colors` / `edge` 会被 Driver 分类为「可就地更新」，因此它们的变化不会重建图层；
    // `autoRefresh` / `refreshInterval` 是构造期选项，变化 ⇒ 重建。
    options: pickLayerOptions(p, ["autoRefresh", "refreshInterval", "colors", "edge"]),
  }),
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
defineOptions({ name: "TrafficLayer" });
</script>

<template>
  <slot />
</template>
