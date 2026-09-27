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
  // 官方 `CircleOptions.enableClicking` 的 `@default` 是 `true`。**既有行为**：这里显式写
  // `true`（值与官方默认一致，只是**来源**是本库）——与 `<Rectangle>` / `<Marker>` 同款，
  // 本次**不改**（改它属于「调整既有 prop 的缺省表示」，不在 #165 图形族补齐范围内）。
  enableClicking: true,
  visible: true,
  // ⚠️ 这里**刻意没有** `linkRight` / `clip` / `strokeLineCap` / `strokeLineJoin`：
  // 官方 `CircleOptions` 的 12 个键里**一个都没有**它们（圆形的几何是「圆心 + 半径」，
  // 没有「跨经度的路径」也没有「两点怎么连」的问题）。加了就是假支持。
  // `coordType` / `dashArray` 是 issue #165 补的两个，非 `Boolean` ⇒ 无 absent 陷阱，
  // 未给时真的是 `undefined` ⇒ 键不进构造选项。
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
