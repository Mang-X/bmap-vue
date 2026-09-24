<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface NavigationControl3DProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * NavigationControl3D —— 3D 视角导航控件（官方 `NavigationControl3D`）
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。
 */
const props = withDefaults(defineProps<NavigationControl3DProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const spec: ControlSpec<NavigationControl3DProps> = {
  kind: "navigation-3d",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
};

useControlResource(props, spec);

defineOptions({ name: "NavigationControl3D" });
</script>

<template>
  <slot />
</template>
