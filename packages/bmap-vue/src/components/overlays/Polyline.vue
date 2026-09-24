<script setup lang="ts">
/**
 * Polyline —— 折线（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。字段级更新（`path` 走根引用 + `pathVersion`、
 * 样式走各自的 setter、`enableEditing` 走成对开关）全部由 `polylineSpec` 声明、由
 * `useOverlaySpec` 落地——组件里不再有 8 个手写 watcher。
 *
 * 事件面（17 个，含编辑六件套）由 `GraphEventMap` 派生；`defineEmits` 与矩阵的一致性由
 * `v3-overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { PolylineProps } from "../../types/components";
import { createPolylineSpec } from "./polylineSpec";

export type { PolylineProps };

const props = withDefaults(defineProps<PolylineProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  enableMassClear: true,
  enableEditing: false,
  visible: true,
});

const emit = defineEmits<{
  click: [event: OverlayPointerEvent];
  dblclick: [event: OverlayPointerEvent];
  mousedown: [event: OverlayPointerEvent];
  mouseup: [event: OverlayPointerEvent];
  mouseover: [event: OverlayPointerEvent];
  mouseout: [event: OverlayPartialPointerEvent];
  mousemove: [event: OverlayPointerEvent];
  rightclick: [event: OverlayPointerEvent];
  rightdblclick: [event: OverlayPointerEvent];
  remove: [event: OverlayEventPayload];
  lineupdate: [event: OverlayEventPayload];
  editstart: [event: OverlayEventPayload];
  editend: [event: OverlayEventPayload];
  linevertexdragstart: [event: OverlayEventPayload];
  linevertexdragging: [event: OverlayEventPayload];
  linevertexdragend: [event: OverlayEventPayload];
  linevertexdel: [event: OverlayEventPayload];
}>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Polyline" });

useOverlaySpec(props, createPolylineSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
