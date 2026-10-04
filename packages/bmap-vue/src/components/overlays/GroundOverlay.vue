<script setup lang="ts">
/**
 * GroundOverlay —— 地面叠加层（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。
 *
 * 一处与迁移前不同的公开契约（理由写在 `groundOverlaySpec` 的注释里）：
 *
 * - **`url` 的惰性工厂**：值投影在交给 SDK 之前求值一次，绝不把函数交给 `setImage`。
 *   显示区域只有 `bounds` 一种写法（与上游 `createGroundOverlay(bounds, options)` 同形）。
 *
 * 事件面（11 个）由 `GroundOverlayEventMap` 派生。该族的事件载荷在上游**全部字段可缺**
 * （`GroundOverlayMouseEvent`），因此指针类事件的 `point` 是可选的——Driver 不做 `(0,0)` 兜底，
 * 「没有坐标」与「在原点」因此可以区分。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
// #138：事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { GroundOverlayEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { GroundOverlayProps } from "../../types/components";
import { createGroundOverlaySpec } from "./groundOverlaySpec";

export type { GroundOverlayProps };

const props = withDefaults(defineProps<GroundOverlayProps>(), {
  opacity: 1,
  autoCenter: true,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（#168 item 2）：下面两项的**官方默认是 `true`**
  // （官方 `GroundOverlayOptions` 的 `@default true`）。`Boolean` 类型的 prop 在**未给**时
  // 会被转成 `false`，于是「用户没给」与「用户显式关掉」变得不可区分——而 SDK 侧的
  // 默认是 `true`，两者语义相反。因此这里必须显式写 `undefined`（**不是** `true`）：
  // `undefined` 让该键不进入构造选项，SDK 沿用它自己的 `true` 默认。
  //
  // `top` 的官方默认是 `false`。它同样要显式写 `undefined`：Vue 的 `Boolean` prop 在未给时
  // 是 `false`，而 `top` 是 `recreate` 类——「未给」若有两个表示（`false` 与 `undefined`），
  // 父级一次 `:top="undefined"` 就会触发一次内容没变的重建。钉成 `undefined` 让「没给」唯一。
  top: undefined,
  enableMassClear: undefined,
  enableClicking: undefined,
});

const emit = defineEmits<GroundOverlayEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "GroundOverlay" });

useOverlaySpec(props, createGroundOverlaySpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
