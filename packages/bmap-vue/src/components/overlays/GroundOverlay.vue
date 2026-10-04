<script setup lang="ts">
/**
 * GroundOverlay —— 地面叠加层（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。
 *
 * 一处与迁移前不同的公开契约（理由写在 `groundOverlaySpec` 的注释里）：
 *
 * - **`url` 的惰性工厂**：值投影在交给 SDK 之前求值一次，绝不把函数交给 `setImage`。
 *   显示区域只有 `bounds` 一种写法（与上游 `createGroundOverlay(bounds, options)` 同形）。
 *
 * 事件面（11 个）由 `GroundOverlayEventMap` 派生。该族的事件载荷在上游**全部字段可缺**
 * （`GroundOverlayMouseEvent`），因此指针类事件的 `point` 是可选的——Driver 不做 `(0,0)` 兜底，
 * 「没有坐标」与「在原点」因此可以区分。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
// #138：事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { GroundOverlayEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { GroundOverlayProps } from "../../types/components";
import { createGroundOverlaySpec } from "./groundOverlaySpec";

export type { GroundOverlayProps };

const props = withDefaults(defineProps<GroundOverlayProps>(), {
  opacity: 1,
  autoCenter: true,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（#168 item 2）：下面两项的**官方默认是 `true`**
  // （官方 `GroundOverlayOptions` 的 `@default true`）。`Boolean` 类型的 prop 在**未给**时
  // 会被转成 `false`，于是「用户没给」与「用户显式关掉」变得不可区分——而 SDK 侧的
  // 默认是 `true`，两者语义相反。因此这里必须显式写 `undefined`（**不是** `true`）：
  // `undefined` 让该键不进入构造选项，SDK 沿用它自己的 `true` 默认。
  //
  // `top` 的官方默认是 `false`。它同样要显式写 `undefined`：Vue 的 `Boolean` prop 在未给时
  // 是 `false`，而 `top` 是 `recreate` 类——「未给」若有两个表示（`false` 与 `undefined`），
  // 父级一次 `:top="undefined"` 就会触发一次内容没变的重建。钉成 `undefined` 让「没给」唯一。
  top: undefined,
  enableMassClear: undefined,
  enableClicking: undefined,
});

const emit = defineEmits<GroundOverlayEmits>();

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
defineOptions({ name: "GroundOverlay" });

useOverlaySpec(props, createGroundOverlaySpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
