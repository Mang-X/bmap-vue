<script setup lang="ts">
/**
 * PanoramaCoverageLayer —— 全景覆盖图层（官方 `BMap.PanoramaCoverageLayer`，4.0）
 *
 * 4.0.5 的类型包**没有** `PanoramaCoverageLayer` 的类声明（官方 Skill 明确它是 4.0 公开
 * 图层），因此 Driver 按结构探测构造器：运行时没有它时报 `BMAP_CAPABILITY_UNSUPPORTED`
 * 并告警一次，而不是静默降级成一个空图层。
 *
 * 行为依据：
 * - 该图层没有可核对的 `Options` 声明，因此本组件**不声明**构造选项 props（否则就是
 *   「传了被忽略」的假支持）；统一槽位里只有 `visible` 有确定语义（挂上 / 摘掉）；
 * - 单独使用它是看不到全景的，要用 `<PanoramaControl>` 打开全景入口。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";

export interface PanoramaCoverageLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
}

const props = withDefaults(defineProps<PanoramaCoverageLayerProps>(), { visible: true });

useLayerResource<PanoramaCoverageLayerProps>(props, {
  component: "PanoramaCoverageLayer",
  toSpec: (p) => ({ kind: "panorama-coverage", visible: p.visible }),
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
defineOptions({ name: "PanoramaCoverageLayer" });
</script>

<template>
  <slot />
</template>
