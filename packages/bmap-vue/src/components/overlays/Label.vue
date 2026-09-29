<script setup lang="ts">
/**
 * Label —— 文本标注（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。创建 / 挂载 / 就地更新 / 重建 / 卸载、
 * 实例 child scope、Registry 记账、Target provide、SDK 事件绑定全部由 `useOverlaySpec`
 * 按 `labelSpec` 驱动——组件里不再有生命周期代码，也不再手写 6 个 watcher。
 *
 * 事件面（8 个）由 `label` 的事件矩阵（`LabelEventMap`）派生；`defineEmits` 与矩阵的一致性由
 * `overlay-suite.test.ts` 的门禁锁定（SFC 编译器解析不了 `keyof typeof <大对象>`，
 * 因此这一侧必须显式写名字，用门禁而不是 mapped type 来防漂移）。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
// #138：事件面的类型声明是生成物（见 `scripts/generate-overlay-emits.mts`）。
import type { LabelEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { LabelProps, LabelStyle } from "../../types/components";
import { createLabelSpec } from "./labelSpec";

export type { LabelProps, LabelStyle };

const props = withDefaults(defineProps<LabelProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  enableMassClear: true,
  visible: true,
  // issue #165 第三批补的 `anchor` / `width` 都不在 `withDefaults` 里补值，两条理由不同：
  //
  // - `width`（`number`，官方 `@default 0` = 按内容自适应）：「未给」与「显式 0」在 SDK 侧
  //   **等价**，补 `0` 只会让「用户没表态」与「用户要求自适应」在构造 options 里分不开。
  // - `anchor`（官方常量名，无默认）：`undefined` 就是「沿用 SDK 自己的默认锚点」。
  //
  // 两者**都不是** `Boolean` ⇒ 没有「Vue 把未给编成 `false`」那个陷阱（同 `Marker.vue`
  // 顶部那段关于 `raiseOnDrag` 的注释）。若将来新增的 `Boolean` 项官方默认是 `true`，
  // 就必须在这里显式写 `undefined`——本 ticket 已因此翻车三次。
});

const emit = defineEmits<LabelEmits>();

const emitDynamic = dynamicEmit(emit);

defineOptions({ name: "Label" });

useOverlaySpec(props, createLabelSpec(), { emit: emitDynamic });
</script>

<template>
  <slot />
</template>
