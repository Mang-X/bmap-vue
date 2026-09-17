<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BCityListProps {
  anchor?: string;
  offset?: { x: number; y: number };
  expand?: boolean;
  visible?: boolean;
}

/**
 * BCityList —— 城市列表控件
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。`expand` 是**可就地更新**的选项
 * （官方只有成对的 `open()` / `close()`，Driver 的分类表把它映射成 `choice`），因此改它
 * 不会重建控件、控件内部的展开动画与高亮状态都保留。
 */
const props = withDefaults(defineProps<BCityListProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 18, y: 18 }),
  expand: false,
  visible: true,
});

const spec: ControlSpec<BCityListProps> = {
  kind: "city-list",
  options: (p) => ({ anchor: p.anchor, offset: p.offset, expand: p.expand }),
};

useControlResource(props, spec);

defineOptions({ name: "BCityList" });
</script>

<template>
  <slot />
</template>
