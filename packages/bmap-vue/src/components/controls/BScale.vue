<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BScaleProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * BScale —— 比例尺控件
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）：anchor / offset / visible 都随
 * props 即时下发。
 */
const props = withDefaults(defineProps<BScaleProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_LEFT",
  offset: () => ({ x: 10, y: 10 }),
  visible: true,
});

const spec: ControlSpec<BScaleProps> = {
  kind: "scale",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
};

useControlResource(props, spec);

defineOptions({ name: "BScale" });
</script>

<template>
  <slot />
</template>
