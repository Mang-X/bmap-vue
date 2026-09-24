<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BZoomProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * BZoom —— 缩放控件
 *
 * 创建 / 挂载 / 卸载 / anchor / offset / visible / options / 事件八件事全部由统一
 * `ControlSpec` + `useControlResource` 承担（M7-CONTROL-PANORAMA / issue #41），本文件只声明
 * 「这个控件是什么」。`anchor` / `offset` 与 `visible` 随 props 变化**即时下发**
 * （此前只在构造期生效）。
 */
const props = withDefaults(defineProps<BZoomProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const spec: ControlSpec<BZoomProps> = {
  kind: "zoom",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
};

useControlResource(props, spec);

defineOptions({ name: "BZoom" });
</script>

<template>
  <slot />
</template>
