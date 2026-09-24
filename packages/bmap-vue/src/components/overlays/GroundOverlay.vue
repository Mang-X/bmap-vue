<script setup lang="ts">
/**
 * GroundOverlay —— 地面叠加层（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。
 *
 * 两处与迁移前不同的公开契约（都在 `groundOverlaySpec` 的注释里写清了理由）：
 *
 * - **`bounds` 取代 `startPoint` + `endPoint`**：与上游 `createGroundOverlay(bounds, options)` 同形。
 *   旧名仍可用（集中弃用层的读取层解析，新 API 优先 + 同实例一次告警），因此**没有破坏性变更**；
 * - **`url` 的惰性工厂**：值投影在交给 SDK 之前求值一次，绝不把函数交给 `setImage`。
 *
 * 事件面（11 个）由 `GroundOverlayEventMap` 派生。该族的事件载荷在上游**全部字段可缺**
 * （`GroundOverlayMouseEvent`），因此指针类事件的 `point` 是可选的——Driver 不做 `(0,0)` 兜底，
 * 「没有坐标」与「在原点」因此可以区分。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPartialPointerEvent,
} from "../../driver/types/events";
import type { GroundOverlayProps } from "../../types/components";
import { createGroundOverlaySpec } from "./groundOverlaySpec";

export type { GroundOverlayProps };

const props = withDefaults(defineProps<GroundOverlayProps>(), {
  opacity: 1,
  autoCenter: true,
  visible: true,
});

const emit = defineEmits<{
  click: [event: OverlayPartialPointerEvent];
  dblclick: [event: OverlayPartialPointerEvent];
  rightclick: [event: OverlayPartialPointerEvent];
  rightdblclick: [event: OverlayPartialPointerEvent];
  mousedown: [event: OverlayPartialPointerEvent];
  mouseup: [event: OverlayPartialPointerEvent];
  mouseover: [event: OverlayPartialPointerEvent];
  mouseout: [event: OverlayPartialPointerEvent];
  mousemove: [event: OverlayPartialPointerEvent];
  remove: [event: OverlayEventPayload];
  lineupdate: [event: OverlayEventPayload];
}>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "GroundOverlay" });

useOverlaySpec(props, createGroundOverlaySpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
