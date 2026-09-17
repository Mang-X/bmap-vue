<script setup lang="ts">
/**
 * BMarker —— 图像标注（M5-SPEC-MARKER / issue #30 的样板组件）
 *
 * 这个组件现在只做两件事：**声明 spec** + **渲染 slot**。创建 / 挂载 / 就地更新 / 重建 /
 * 卸载、实例 child scope、Registry 记账、Target provide、SDK 事件绑定全部由
 * `useOverlaySpec` 按声明驱动——组件里不再有生命周期代码，也不再手写 9 个 watcher。
 * 每个公开属性的更新策略（以及它与 Driver 属性描述符的对应）见 `./markerSpec.ts` 的表，
 * 声明与描述符的一致性由 `tests/behavior/v3-overlay-spec.test.ts` 交叉锁定。
 *
 * 事件与 `v-model:position` 的行为依据见 ADR `2026-09-17-overlay-spec-and-marker`。
 */
import { provide } from "vue";
import { useOverlaySpec, type OverlayPositionModel } from "../../core/composables/useOverlaySpec";
import { overlayContextKey } from "../../core/context/types";
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
  click: [e: unknown];
  dblclick: [e: unknown];
  rightclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
  dragstart: [e: unknown];
  dragging: [e: unknown];
  dragend: [e: unknown];
  "drag-end": [e: unknown];
  remove: [e: unknown];
  "update:position": [position: { lng: number; lat: number }];
}>();

/** 事件转发入口：`spec.events` 里只写事件名，动态名在这里集中收窄一次（不让 `as` 扩散）。 */
const emitDynamic = emit as unknown as (name: string, payload: unknown) => void;

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
