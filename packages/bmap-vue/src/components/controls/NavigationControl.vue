<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface NavigationControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  /** 控件类型，官方 `BMAP_NAVIGATION_CONTROL_*`（LARGE / SMALL / PAN / ZOOM） */
  type?: string;
  /** 是否显示级别提示信息（官方 `showZoomInfo`，只有构造期生效） */
  showZoomInfo?: boolean;
  /** 控件是否集成定位功能（官方 `enableGeolocation`，只有构造期生效） */
  enableGeolocation?: boolean;
  visible?: boolean;
}

/**
 * NavigationControl —— 平移缩放控件（官方 `NavigationControl`）
 *
 * M7-CONTROL-PANORAMA / issue #41：`kind: "navigation"` 在 #22 已进 Driver 的能力面，本组件
 * 把它开放给使用者。
 *
 * `type` 是**可就地更新**的（官方 `setType`）；`showZoomInfo` / `enableGeolocation` 只有构造期
 * 生效，变化时统一 adapter 会**重建控件**并把新值交给构造期（真实 4.0 的 `setType` 要求控件
 * 已挂载，因此重建后的写入顺序始终是 create → add → setOptions）。
 */
const props = withDefaults(defineProps<NavigationControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 30, y: 10 }),
  // 两个布尔选项都显式给出官方声明的默认值（`@default true` / `@default false`）：
  // Vue 对布尔 prop 有「缺省即 false」的转换，不显式声明会让「用户显式传 false」与
  // 「用户没传」不可区分（见 `MapTypeControl` 的同一条注释）。
  showZoomInfo: true,
  enableGeolocation: false,
  visible: true,
});

const spec: ControlSpec<NavigationControlProps> = {
  kind: "navigation",
  // `undefined` 的键在 Driver 侧被跳过（不会把 SDK 默认值覆盖成 undefined）
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    type: p.type,
    showZoomInfo: p.showZoomInfo,
    enableGeolocation: p.enableGeolocation,
  }),
};

useControlResource(props, spec);

defineOptions({ name: "NavigationControl" });
</script>

<template>
  <slot />
</template>
