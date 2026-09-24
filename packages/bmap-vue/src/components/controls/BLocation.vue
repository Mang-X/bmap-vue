<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BLocationProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * BLocation —— 定位控件（官方 `GeolocationControl`）
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）。两个 SDK 事件经 spec 的 `events`
 * 绑定，随**实例 scope** 释放（ADR 2026-09-11 §6：先解绑业务事件、再由 Map 移除控件）。
 *
 * 显隐用 SDK 的 `show()` / `hide()`：`visible=false` 只是把控件藏起来，**不会**顺带停下
 * 持续性定位跟踪——那是 `removeControl` 的语义（Driver 的 `remove` 会先调
 * `stopLocationTrace()`），属于「卸载」而不是「隐藏」。
 */
const props = withDefaults(defineProps<BLocationProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 18, y: 18 }),
  visible: true,
});

const emit = defineEmits<{
  locationSuccess: [e: unknown];
  locationError: [e: unknown];
}>();

const spec: ControlSpec<BLocationProps> = {
  kind: "location",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
  events: () => [
    ["locationSuccess", (event: unknown) => emit("locationSuccess", event)],
    ["locationError", (event: unknown) => emit("locationError", event)],
  ],
};

useControlResource(props, spec);

defineOptions({ name: "BLocation" });
</script>

<template>
  <slot />
</template>
