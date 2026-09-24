<script setup lang="ts">
/**
 * Rectangle —— 矩形（M5-VECTORS / issue #31 新增：v4 的 `Rectangle` 覆盖物）
 *
 * 矩形由**对角两点**定义的 `bounds` 描述（上游 `new Rectangle(bounds, options)`）。
 * 组件只做两件事：**声明 spec** + **渲染 slot**；`bounds` 走内容指纹判等（父级传内联字面量不会
 * 产生多余命令），样式与编辑开关由 `rectangleSpec` 声明。
 *
 * 事件面（17 个，含编辑六件套）与 Circle / Polygon 相同（上游同为 `GraphEventMap`）；
 * `defineEmits` 与矩阵的一致性由 `v3-overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { RectangleProps } from "../../types/components";
import { createRectangleSpec } from "./rectangleSpec";

export type { RectangleProps };

const props = withDefaults(defineProps<RectangleProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  enableMassClear: true,
  enableEditing: false,
  // 上游 `enableClicking` 默认 `true`：不显式给默认值会被 Vue 的布尔转换写成 `false`
  enableClicking: true,
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

defineOptions({ name: "Rectangle" });

useOverlaySpec(props, createRectangleSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
