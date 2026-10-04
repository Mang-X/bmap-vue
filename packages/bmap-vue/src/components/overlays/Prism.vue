<script setup lang="ts">
/**
 * Prism —— 3D 棱柱（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`path` 用内容指纹（建筑底面轮廓是小数组，
 * 且组件没有 `pathVersion`），`altitude` / 顶面与侧面填充走各自的 setter，
 * `isBoundary` / `autoCenter` 是构造期透传（变化即重建）。
 *
 * 事件面（11 个）由 `GraphEventMap` 去掉编辑六件套得到：官方参考明确 Prism 不实现编辑能力，
 * 因此本组件不暴露 `enableEditing`。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { PrismEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { PrismProps } from "../../types/components";
import { createPrismSpec } from "./prismSpec";

export type { PrismProps };

const props = withDefaults(defineProps<PrismProps>(), {
  topFillColor: "#fff",
  topFillOpacity: 0.5,
  sideFillColor: "#fff",
  sideFillOpacity: 0.8,
  isBoundary: false,
  autoCenter: true,
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<PrismEmits>();

const emitDynamic = dynamicEmit(emit);

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
defineOptions({ name: "Prism" });

useOverlaySpec(props, createPrismSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
