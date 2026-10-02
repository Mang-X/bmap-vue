<script setup lang="ts">
/**
 * Polyline —— 折线（M5-VECTORS /  迁移到 OverlaySpec）
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
  // ⚠️ **Vue Boolean-absent 陷阱**（ 图形族补齐）。
  //
  // 下面两项的**官方默认是 `true`**（官方 `PolylineOptions` 的 `@default true`：
  // `enableClicking`「是否响应点击事件」、`clip`「是否进行跨经度 180 度裁剪」）。
  // `Boolean` 类型的 prop 在**未给**时，编译产物里的运行时值是 `false`——与官方默认
  // **相反**。因此这里必须显式写 `undefined`（**不是** `true`）：`undefined` 让该键
  // **不进入**构造选项，SDK 沿用它自己的 `true`。
  //
  // `linkRight` / `geodesic` 的官方默认是 `false`，与 Vue 的未给值**值上一致**，
  // 但仍显式钉成 `undefined`：让「没给」只有**一个**表示，否则父级某次传
  // `:link-right="undefined"` 会触发一次**内容完全没变**的重建（这三项都是 `recreate`）。
  //
  // `strokeLineCap` / `strokeLineJoin` / `coordType` / `dashArray` / `icons` /
  // `strokeTexture` **不是** `Boolean` ⇒ 没有这个陷阱，**不**在此声明。
  enableClicking: undefined,
  clip: undefined,
  linkRight: undefined,
  geodesic: undefined,
});

const emit = defineEmits<PolylineEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Polyline" });

const { commands } = useOverlaySpec(props, createPolylineSpec(), { emit: emitDynamic });
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
