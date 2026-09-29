<script setup lang="ts">
/**
 * GroundPoint —— 贴地点覆盖物（issue #178）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。
 *
 * - **几何入口是 `point`**（构造器的第一个位置参数），不是 `<GroundOverlay>` 的 `bounds`——
 *   官方 `GroundPoint.d.ts:19` 是 `constructor(point: Point, opts?: GroundPointOptions)`。
 * - **`size` / `anchor` / `offset` 收 `{ width, height }`**（官方 `Size` 形状），不是图形族
 *   偏移那套 `{ x, y }`——理由见 `groundPointSpec.ts` 的文件头。
 * - **位置更新走 `setPoint`**（不是 `setPosition`）：由描述符的 `point → setPoint` 映射解析。
 *
 * 事件面（11 个）由 `GroundOverlayEventMap` 派生：`GroundPoint extends GroundOverlay`
 * （`GroundPoint.d.ts:5`），SDK **没有**为它单独声明事件表。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
// 事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { GroundPointEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { GroundPointProps } from "../../types/components";
import { createGroundPointSpec } from "./groundPointSpec";

export type { GroundPointProps };

const props = withDefaults(defineProps<GroundPointProps>(), {
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**：下面三项的**官方默认是 `true`**（`enableMassClear` /
  // `enableClicking`，见 `GroundOverlayOptions` 的 `@default true`）。`Boolean` 类型的 prop
  // 在**未给**时会被 Vue 转成 `false`，与官方默认**相反**——「用户没给」会变成「显式关掉」。
  // 因此这里显式写 `undefined`（**不是** `true`）：`undefined` 让该键不进入构造选项，
  // 由 SDK 沿用它自己的默认。与 `GroundOverlay.vue` 是同一条理由、同一个坑。
  //
  // `top` 的官方默认是 `false`，同样钉成 `undefined`：它是 `recreate` 类，「未给」若有两个
  // 表示（`false` 与 `undefined`），父级一次 `:top="undefined"` 就会触发一次内容没变的重建。
  enableMassClear: undefined,
  enableClicking: undefined,
  top: undefined,
});

const emit = defineEmits<GroundPointEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "GroundPoint" });

useOverlaySpec(props, createGroundPointSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
