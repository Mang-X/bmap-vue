<script setup lang="ts">
/**
 * BezierCurve —— 贝塞尔曲线（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`path` 与 `controlPoints` 是**两个大数组**，
 * 各有自己的版本令牌（`pathVersion` / `controlPointsVersion`）：根引用变化或对应版本递增都会
 * 下发一次，不做内容指纹（上万点数组的 O(n) 序列化不可接受）。
 *
 * 事件面（11 个）由 `GraphEventMap` **去掉编辑六件套**得到（上游 Omit，SDK 没有 `enableEditing`）——
 * 因此本组件既不暴露 `enableEditing`，也不声明编辑事件。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { BezierCurveEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { BezierCurveProps } from "../../types/components";
import { createBezierCurveSpec } from "./bezierCurveSpec";

export type { BezierCurveProps };

const props = withDefaults(defineProps<BezierCurveProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 1,
  strokeStyle: "solid",
  enableMassClear: true,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（issue #165 图形族补齐）。
  //
  // 官方 `BezierCurveOptions.enableClicking` 的 `@default` 是 `true`，而 `Boolean` 类型的 prop
  // 在**未给**时编译产物里的运行时值是 `false`——与官方默认**相反**。因此必须显式写
  // `undefined`（**不是** `true`）：`undefined` 让该键**不进入**构造选项，SDK 沿用它自己的 `true`。
  //
  // ⚠️ 这与 `<Circle>` / `<Rectangle>` 写 `enableClicking: true` **不同**：那两处是**既有行为**
  // （值与官方默认一致，本次不改）；这里此前**根本没有**这个 prop，官方默认与 Vue 转换**相反**，
  // 属新增，必须按 `#GroundOverlay` / `#CustomOverlay` 的同款处置写 `undefined`。
  //
  // `dashArray` 不是 `Boolean` ⇒ 无 absent 陷阱，**不**在此声明。
  enableClicking: undefined,
});

const emit = defineEmits<BezierCurveEmits>();

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
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "BezierCurve" });

useOverlaySpec(props, createBezierCurveSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
