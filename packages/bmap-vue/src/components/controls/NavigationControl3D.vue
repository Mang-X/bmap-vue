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
  // 控件留白口径：`offset` 是**相对锚点**的留白，不是相对容器另一侧的边距。
  // 全库统一 18px（与 `LocationControl` / `CityListControl` 一致）——
  // 此前这里是 83，对一个 32px 宽的缩放按钮而言等于把它甩到容器中间。
  offset: () => ({ x: 18, y: 18 }),
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
