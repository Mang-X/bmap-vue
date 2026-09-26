<script setup lang="ts">
/**
 * Circle —— 圆形（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`center` 是**位置字段**（走 `setPosition`
 * 专用入口，Driver 内部映射到 `setCenter`），`radius` 与样式走各自的 setter，
 * `enableClicking` 是构造期属性（变化即重建）——全部由 `circleSpec` 声明。
 *
 * 事件面（17 个）由 `GraphEventMap` 派生；`defineEmits` 与矩阵的一致性由
 * `overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { CircleEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { CircleProps } from "../../types/components";
import { createCircleSpec } from "./circleSpec";

export type { CircleProps };

const props = withDefaults(defineProps<CircleProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  enableMassClear: true,
  enableEditing: false,
  enableClicking: true,
  visible: true,
});

const emit = defineEmits<CircleEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Circle" });

const { commands } = useOverlaySpec(props, createCircleSpec(), { emit: emitDynamic });
/**
 * 命令面（#165 Class 3 / TASK 2）：官方**没有对应 prop** 的动作 + 读回族。
 *
 * 直接展开 `commands`（而不是挂成 `commands.xxx`）：调用方拿到的就是官方同名方法本身
 * （`polyline.setPositionAt(i, pt)` / `circle.getRadius()`），与官方参考实现的形状一致。
 * 逐条依据与「刻意不做」的清单见 `core/overlays/OverlaySpec.ts` 的 `expose` 与
 * `core/overlays/overlayCommands.ts`。
 *
 * `commands` 为 `null` 时（该组件没有命令面）`defineExpose(undefined)` 等价于不 expose，
 * 因此**不要**为此写分支。
 */
defineExpose(commands ?? undefined);

</script>

<template>
  <slot />
</template>
