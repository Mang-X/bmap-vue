<script setup lang="ts">
/**
 * Label —— 文本标注（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。创建 / 挂载 / 就地更新 / 重建 / 卸载、
 * 实例 child scope、Registry 记账、Target provide、SDK 事件绑定全部由 `useOverlaySpec`
 * 按 `labelSpec` 驱动——组件里不再有生命周期代码，也不再手写 6 个 watcher。
 *
 * 事件面（8 个）由 `label` 的事件矩阵（`LabelEventMap`）派生；`defineEmits` 与矩阵的一致性由
 * `v3-overlay-suite.test.ts` 的门禁锁定（SFC 编译器解析不了 `keyof typeof <大对象>`，
 * 因此这一侧必须显式写名字，用门禁而不是 mapped type 来防漂移）。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type {
  OverlayEventPayload,
  OverlayPointerEvent,
} from "../../driver/types/events";
import type { LabelProps, LabelStyle } from "../../types/components";
import { createLabelSpec } from "./labelSpec";

export type { LabelProps, LabelStyle };

const props = withDefaults(defineProps<LabelProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [event: OverlayPointerEvent];
  dblclick: [event: OverlayPointerEvent];
  rightclick: [event: OverlayPointerEvent];
  mousedown: [event: OverlayPointerEvent];
  mouseup: [event: OverlayPointerEvent];
  mouseover: [event: OverlayPointerEvent];
  mouseout: [event: OverlayPointerEvent];
  remove: [event: OverlayEventPayload];
}>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Label" });

useOverlaySpec(props, createLabelSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
