<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface ZoomControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * ZoomControl —— 缩放控件
 *
 * 创建 / 挂载 / 卸载 / anchor / offset / visible / options / 事件八件事全部由统一
 * `ControlSpec` + `useControlResource` 承担（M7-CONTROL-PANORAMA / issue #41），本文件只声明
 * 「这个控件是什么」。`anchor` / `offset` 与 `visible` 随 props 变化**即时下发**
 * （此前只在构造期生效）。
 */
const props = withDefaults(defineProps<ZoomControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  // 控件留白口径：`offset` 是**相对锚点**的留白，不是相对容器另一侧的边距。
  // 全库统一 18px（与 `LocationControl` / `CityListControl` 一致）——
  // 此前这里是 83，对一个 32px 宽的缩放按钮而言等于把它甩到容器中间。
  offset: () => ({ x: 18, y: 18 }),
  visible: true,
});

const spec: ControlSpec<ZoomControlProps> = {
  kind: "zoom",
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
defineOptions({ name: "ZoomControl" });
</script>

<template>
  <slot />
</template>
