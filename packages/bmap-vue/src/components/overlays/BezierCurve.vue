<script setup lang="ts">
/**
 * BezierCurve —— 贝塞尔曲线（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`path` 与 `controlPoints` 是**两个大数组**，
 * 各有自己的版本令牌（`pathVersion` / `controlPointsVersion`）：根引用变化或对应版本递增都会
 * 下发一次，不做内容指纹（上万点数组的 O(n) 序列化不可接受）。
 *
 * 事件面（11 个）由 `GraphEventMap` **去掉编辑六件套**得到（上游 Omit，SDK 没有 `enableEditing`）——
 * 因此本组件既不暴露 `enableEditing`，也不声明编辑事件。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { BezierCurveEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { BezierCurveProps } from "../../types/components";
import { createBezierCurveSpec } from "./bezierCurveSpec";

export type { BezierCurveProps };

const props = withDefaults(defineProps<BezierCurveProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 1,
  strokeStyle: "solid",
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<BezierCurveEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "BezierCurve" });

useOverlaySpec(props, createBezierCurveSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
