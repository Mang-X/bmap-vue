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
 * 显隐走 SDK 基类的 `show()` / `hide()`；官方 4.0.4 里 `PanoramaControl extends Control`，
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

defineOptions({ name: "PanoramaControl" });
</script>

<template>
  <slot />
</template>
