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
  // ⚠️ **Vue Boolean-absent 陷阱**（issue #165 图形族补齐）。
  //
  // 官方 `BezierCurveOptions.enableClicking` 的 `@default` 是 `true`，而 `Boolean` 类型的 prop
  // 在**未给**时编译产物里的运行时值是 `false`——与官方默认**相反**。因此必须显式写
  // `undefined`（**不是** `true`）：`undefined` 让该键**不进入**构造选项，SDK 沿用它自己的 `true`。
  //
  // ⚠️ 这与 `<Circle>` / `<Rectangle>` 写 `enableClicking: true` **不同**：那两处是**既有行为**
  // （值与官方默认一致，本次不改）；这里此前**根本没有**这个 prop，官方默认与 Vue 转换**相反**，
  // 属新增，必须按 `#GroundOverlay` / `#CustomOverlay` 的同款处置写 `undefined`。
  //
  // `dashArray` 不是 `Boolean` ⇒ 无 absent 陷阱，**不**在此声明。
  enableClicking: undefined,
});

const emit = defineEmits<BezierCurveEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "BezierCurve" });

useOverlaySpec(props, createBezierCurveSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
