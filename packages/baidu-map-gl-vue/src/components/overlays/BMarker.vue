<script setup lang="ts">
/**
 * BMarker —— 图像标注（M5-SPEC-MARKER / issue #30 的样板组件）
 *
 * 这个组件只做三件事：**声明 spec** + **渲染 slot** + 把整体句柄经旧 key 暴露给子组件。
 * 创建 / 挂载 / 就地更新 / 重建 / 卸载、实例 child scope、Registry 记账、Target provide、
 * SDK 事件绑定全部由 `useOverlaySpec` 按声明驱动——组件里不再有生命周期代码，也不再手写 9 个
 * watcher。每个公开属性的更新策略（以及它与 Driver 属性描述符的对应）见 `./markerSpec.ts` 的表。
 *
 * ## 事件面（11 个 + 1 个历史别名）
 *
 * 主事件面来自 `marker` 的事件矩阵（上游 `MarkerEventMap`），`markerSpec` 只覆盖 `dragend`
 * 的处置方式（先转发、再回写位置模型）。**历史别名 `drag-end` 不由组件发**：它登记在集中弃用层
 * （`core/deprecations`），由内核在派发 `dragend` 之后补发一次并告警一次——组件里因此不再出现
 * 旧名字（issue #28 明令禁止「组件各自兼容」）。
 */
import { provide } from "vue";
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec, type OverlayPositionModel } from "../../core/composables/useOverlaySpec";
import { overlayContextKey } from "../../core/context/types";
import type {
  OverlayEventPayload,
  OverlayPointerEvent,
} from "../../driver/types/events";
import { createMarkerSpec } from "./markerSpec";
import type { BMarkerProps } from "../../types/components";

export type { BMarkerProps };

const props = withDefaults(defineProps<BMarkerProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  visible: true,
  title: "",
  enableClicking: true,
  enableDragging: false,
});

const emit = defineEmits<{
  click: [event: OverlayPointerEvent];
  dblclick: [event: OverlayPointerEvent];
  rightclick: [event: OverlayPointerEvent];
  mousedown: [event: OverlayPointerEvent];
  mouseup: [event: OverlayPointerEvent];
  mouseover: [event: OverlayPointerEvent];
  mouseout: [event: OverlayPointerEvent];
  dragstart: [event: OverlayPointerEvent];
  dragging: [event: OverlayPointerEvent];
  dragend: [event: OverlayPointerEvent];
  /** @deprecated 历史别名（kebab 拼写）；规范名是 `dragend`。由集中弃用层补发。 */
  "drag-end": [event: OverlayPointerEvent];
  remove: [event: OverlayEventPayload];
  "update:position": [position: { lng: number; lat: number }];
}>();

const emitDynamic = dynamicEmit(emit);

/**
 * 位置模型句柄：spec 的回调在**运行时**读取它（`dragend` 处理器在 setup 之后才被调用），
 * 因此可以在 spec 里先声明、拿到结果后再回填。
 */
let positionModel: OverlayPositionModel | null = null;

const markerSpec = createMarkerSpec({
  emit: emitDynamic,
  position: () => positionModel,
});

const { resource, position } = useOverlaySpec(props, markerSpec, { emit: emitDynamic });
positionModel = position;

defineOptions({ name: "BMarker" });

/**
 * 旧的整体句柄 key 保持兼容（函数式读取）。
 *
 * 新代码请用 `targetContextKey` 的 `TargetContext`：它由 `useOverlaySpec` **自动 provide**，
 * 且带 `kind` 与响应式 `target`（`BContextMenu` 走的是新的那条）。
 */
provide(overlayContextKey, () => resource.value);
</script>

<template>
  <slot />
</template>
