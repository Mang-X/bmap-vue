<script setup lang="ts">
/**
 * Rectangle —— 矩形（M5-VECTORS / issue #31 新增：v4 的 `Rectangle` 覆盖物）
 *
 * 矩形由**对角两点**定义的 `bounds` 描述（上游 `new Rectangle(bounds, options)`）。
 * 组件只做两件事：**声明 spec** + **渲染 slot**；`bounds` 走内容指纹判等（父级传内联字面量不会
 * 产生多余命令），样式与编辑开关由 `rectangleSpec` 声明。
 *
 * 事件面（17 个，含编辑六件套）与 Circle / Polygon 相同（上游同为 `GraphEventMap`）；
 * `defineEmits` 与矩阵的一致性由 `overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { RectangleEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { RectangleProps } from "../../types/components";
import { createRectangleSpec } from "./rectangleSpec";

export type { RectangleProps };

const props = withDefaults(defineProps<RectangleProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  enableMassClear: true,
  enableEditing: false,
  // 上游 `enableClicking` 默认 `true`：不显式给默认值会被 Vue 的布尔转换写成 `false`
  enableClicking: true,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（issue #165 图形族补齐）：`linkRight` 的官方 `@default`
  // 是 `false`，与 Vue 的 `Boolean` 未给值**值上一致**，但仍钉成 `undefined`——
  // 让「没给」只有**一个**表示，否则父级传 `:link-right="undefined"` 会触发一次
  // **内容完全没变**的重建（`recreate` 类）。
  // ⚠️ 这里**刻意没有** `strokeLineCap` / `strokeLineJoin`：官方 `RectangleOptions` 里没有这两项
  // （只有 `PolylineOptions` / `PolygonOptions` 有）。`coordType` / `dashArray` 非 `Boolean`，
  // 无 absent 陷阱，**不**在此声明。
  linkRight: undefined,
});

const emit = defineEmits<RectangleEmits>();

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
defineOptions({ name: "Rectangle" });

const { commands } = useOverlaySpec(props, createRectangleSpec(), { emit: emitDynamic });
/**
 * 命令面（#165 Class 3 / TASK 2）：官方**没有对应 prop** 的动作 + 读回族。
 *
 * 直接展开 `commands`（而不是挂成 `commands.xxx`）：调用方拿到的就是官方同名方法本身
 * （`polyline.setPositionAt(i, pt)` / `circle.getRadius()`），与官方参考实现的形状一致。
 * 逐条依据与「刻意不做」的清单见 `core/overlays/OverlaySpec.ts` 的 `expose` 与
 * `core/overlays/overlayCommands.ts`。
 *
 * `commands` 为 `null` 时（该组件没有命令面）`defineExpose(undefined)` 等价于不 expose，
 * 因此**不要**为此写分支。
 */
defineExpose(commands ?? undefined);

</script>

<template>
  <slot />
</template>
