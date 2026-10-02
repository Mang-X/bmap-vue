<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface PanoramaControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * PanoramaControl —— 切换至全景地图的控件
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。
 *
 * 显隐走 SDK 基类的 `show()` / `hide()`；官方 4.0.5 里 `PanoramaControl extends Control`，
 * 因此这两个成员存在。Driver 仍按**结构性调用**处理（缺成员时告警一次而不是假装成功）——
 * 官方文档对 PanoramaControl 的描述是「由全景模块提供」，个别运行时版本未必带齐基类成员。
 */
const props = withDefaults(defineProps<PanoramaControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_RIGHT",
  offset: () => ({ x: 10, y: 10 }),
  visible: true,
});

const spec: ControlSpec<PanoramaControlProps> = {
  kind: "panorama",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
};

useControlResource(props, spec);

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
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<string, never>): any;
}>();
defineOptions({ name: "PanoramaControl" });
</script>

<template>
  <slot />
</template>
