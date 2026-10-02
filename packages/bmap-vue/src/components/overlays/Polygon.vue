<script setup lang="ts">
/**
 * Polygon —— 多边形（M5-VECTORS /  迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`points`（根引用 + `pathVersion`）、填充/描边、
 * `isBoundary`（构造期 → 变化即重建）、`enableEditing`（成对开关）全部由 `polygonSpec` 声明。
 *
 * 事件面（17 个）与 Polyline 相同（上游同为 `GraphEventMap`）；`defineEmits` 与矩阵的一致性由
 * `overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { PolygonEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { PolygonProps } from "../../types/components";
import { createPolygonSpec } from "./polygonSpec";

export type { PolygonProps };

const props = withDefaults(defineProps<PolygonProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  isBoundary: false,
  enableMassClear: true,
  enableEditing: false,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（ 图形族补齐）。
  //
  // `enableClicking` / `linkRight` 的**官方默认是 `true`**（官方 `PolygonOptions` 的
  // `@default true`：`enableClicking`「是否响应点击事件」）。`Boolean` 类型的 prop 在**未给**时，
  // 编译产物里的运行时值是 `false`——与官方默认**相反**。因此显式写 `undefined`
  // （**不是** `true`）：`undefined` 让该键**不进入**构造选项，SDK 沿用它自己的 `true`。
  //
  // `strokeLineCap` / `strokeLineJoin` / `coordType` / `dashArray` **不是** `Boolean`
  // ⇒ 没有这个陷阱，**不**在此声明。
  enableClicking: undefined,
  linkRight: undefined,
});

const emit = defineEmits<PolygonEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Polygon" });

const { commands } = useOverlaySpec(props, createPolygonSpec(), { emit: emitDynamic });
/**
 * 命令面（ / TASK 2）：官方**没有对应 prop** 的动作 + 读回族。
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
