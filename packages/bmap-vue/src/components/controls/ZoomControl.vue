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

defineOptions({ name: "ZoomControl" });
</script>

<template>
  <slot />
</template>
