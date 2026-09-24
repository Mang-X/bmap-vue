<script setup lang="ts">
/**
 * Prism —— 3D 棱柱（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`path` 用内容指纹（建筑底面轮廓是小数组，
 * 且组件没有 `pathVersion`），`altitude` / 顶面与侧面填充走各自的 setter，
 * `isBoundary` / `autoCenter` 是构造期透传（变化即重建）。
 *
 * 事件面（11 个）由 `GraphEventMap` 去掉编辑六件套得到：官方参考明确 Prism 不实现编辑能力，
 * 因此本组件不暴露 `enableEditing`。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { PrismProps } from "../../types/components";
import { createPrismSpec } from "./prismSpec";

export type { PrismProps };

const props = withDefaults(defineProps<PrismProps>(), {
  topFillColor: "#fff",
  topFillOpacity: 0.5,
  sideFillColor: "#fff",
  sideFillOpacity: 0.8,
  isBoundary: false,
  autoCenter: true,
  enableMassClear: true,
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
}>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Prism" });

useOverlaySpec(props, createPrismSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
