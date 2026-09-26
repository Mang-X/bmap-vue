<script setup lang="ts">
/**
 * Polyline —— 折线（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。字段级更新（`points` 走根引用 + `pathVersion`、
 * 样式走各自的 setter、`enableEditing` 走成对开关）全部由 `polylineSpec` 声明、由
 * `useOverlaySpec` 落地——组件里不再有 8 个手写 watcher。
 *
 * 事件面（17 个，含编辑六件套）由 `GraphEventMap` 派生；`defineEmits` 与矩阵的一致性由
 * `overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { PolylineEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { PolylineProps } from "../../types/components";
import { createPolylineSpec } from "./polylineSpec";

export type { PolylineProps };

const props = withDefaults(defineProps<PolylineProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  enableMassClear: true,
  enableEditing: false,
  visible: true,
});

const emit = defineEmits<PolylineEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Polyline" });

const { commands } = useOverlaySpec(props, createPolylineSpec(), { emit: emitDynamic });
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
