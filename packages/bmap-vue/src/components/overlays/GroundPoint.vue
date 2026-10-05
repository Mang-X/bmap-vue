<script setup lang="ts">
/**
 * GroundPoint —— 贴地点覆盖物（issue #178）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。
 *
 * - **几何入口是 `point`**（构造器的第一个位置参数），不是 `<GroundOverlay>` 的 `bounds`——
 *   官方 `GroundPoint.d.ts:19` 是 `constructor(point: Point, opts?: GroundPointOptions)`。
 * - **`size` / `anchor` / `offset` 收 `{ width, height }`**（官方 `Size` 形状），不是图形族
 *   偏移那套 `{ x, y }`——理由见 `groundPointSpec.ts` 的文件头。
 * - **位置更新走 `setPoint`**（不是 `setPosition`）：由描述符的 `point → setPoint` 映射解析。
 *
 * 事件面（11 个）由 `GroundOverlayEventMap` 派生：`GroundPoint extends GroundOverlay`
 * （`GroundPoint.d.ts:5`），SDK **没有**为它单独声明事件表。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
// 事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { GroundPointEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { GroundPointProps } from "../../types/components";
import { createGroundPointSpec } from "./groundPointSpec";

export type { GroundPointProps };

const props = withDefaults(defineProps<GroundPointProps>(), {
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**：下面三项的**官方默认是 `true`**（`enableMassClear` /
  // `enableClicking`，见 `GroundOverlayOptions` 的 `@default true`）。`Boolean` 类型的 prop
  // 在**未给**时会被 Vue 转成 `false`，与官方默认**相反**——「用户没给」会变成「显式关掉」。
  // 因此这里显式写 `undefined`（**不是** `true`）：`undefined` 让该键不进入构造选项，
  // 由 SDK 沿用它自己的默认。与 `GroundOverlay.vue` 是同一条理由、同一个坑。
  //
  // `top` 的官方默认是 `false`，同样钉成 `undefined`：它是 `recreate` 类，「未给」若有两个
  // 表示（`false` 与 `undefined`），父级一次 `:top="undefined"` 就会触发一次内容没变的重建。
  enableMassClear: undefined,
  enableClicking: undefined,
  top: undefined,
});

const emit = defineEmits<GroundPointEmits>();

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
defineOptions({ name: "GroundPoint" });

useOverlaySpec(props, createGroundPointSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
