<script setup lang="ts">
/**
 * BPolygon —— 多边形（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`path`（根引用 + `pathVersion`）、填充/描边、
 * `isBoundary`（构造期 → 变化即重建）、`enableEditing`（成对开关）全部由 `polygonSpec` 声明。
 *
 * 事件面（17 个）与 Polyline 相同（上游同为 `GraphEventMap`）；`defineEmits` 与矩阵的一致性由
 * `v3-overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { BPolygonProps } from "../../types/components";
import { createPolygonSpec } from "./polygonSpec";

export type { BPolygonProps };

const props = withDefaults(defineProps<BPolygonProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  isBoundary: false,
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

defineOptions({ name: "BPolygon" });

useOverlaySpec(props, createPolygonSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
