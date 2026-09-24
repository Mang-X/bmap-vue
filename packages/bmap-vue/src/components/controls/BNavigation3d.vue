<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BNavigation3dProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * BNavigation3d —— 3D 视角导航控件（官方 `NavigationControl3D`）
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。
 */
const props = withDefaults(defineProps<BNavigation3dProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const spec: ControlSpec<BNavigation3dProps> = {
  kind: "navigation-3d",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
};

useControlResource(props, spec);

defineOptions({ name: "BNavigation3d" });
</script>

<template>
  <slot />
</template>
