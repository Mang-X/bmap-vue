<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface OverviewMapControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  /** 缩略地图尺寸（官方 `size`，领域口径是 Pixel；可就地更新，走 `setSize()`） */
  size?: { x: number; y: number };
  /** 挂载后的开合状态（官方 `isOpen`，只有构造期生效） */
  isOpen?: boolean;
  /** 鹰眼与主图的缩放级别差（官方 `zoomInterval`，只有构造期生效） */
  zoomInterval?: number;
  /** 鹰眼与主图之间的空隙像素（官方 `padding`，只有构造期生效） */
  padding?: number;
  visible?: boolean;
}

/**
 * OverviewMapControl —— 缩略地图控件 / 鹰眼（官方 `OverviewMapControl`）
 *
 * M7-CONTROL-PANORAMA / issue #41。
 *
 * `isOpen` 刻意走**重建**：官方只提供 `changeView()` 的**切换**语义（没有幂等 `setOpen`），
 * 就地更新会变成「点两次才回到目标状态」。重建时把 `isOpen` 交给构造期是最确定的表达，
 * 代价是控件内部状态重置——所以不要让它频繁抖动（Driver 的 `setOptions` 对构造期项会告警
 * 一次并把决定留给调用方，统一 adapter 的选择就是重建）。
 */
const props = withDefaults(defineProps<OverviewMapControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  // 此前是 `{ x: 0, y: 0 }`：鹰眼面板宽高由 `size` 决定（示例里 180×180），
  // 贴着 `BOTTOM_RIGHT` 锚点落下来就**紧贴容器右缘与下缘**（实测 gap = 0/0），
  // 视觉上像被裁掉一截。给它与其它 `BOTTOM_RIGHT` 控件一致的留白。
  offset: () => ({ x: 10, y: 10 }),
  // 官方声明的默认值（`@default false`）：显式写出，避免 Vue 的布尔转换让「用户显式传
  // false」与「用户没传」不可区分（见 `MapTypeControl` 的同一条注释）。
  isOpen: false,
  visible: true,
});

const spec: ControlSpec<OverviewMapControlProps> = {
  kind: "overview",
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    size: p.size,
    isOpen: p.isOpen,
    zoomInterval: p.zoomInterval,
    padding: p.padding,
  }),
};

useControlResource(props, spec);

defineOptions({ name: "OverviewMapControl" });
</script>

<template>
  <slot />
</template>
