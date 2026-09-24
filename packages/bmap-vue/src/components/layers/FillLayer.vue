<script setup lang="ts">
/**
 * FillLayer —— 原生批量面图层（官方 `BMap.FillLayer`，4.0）
 *
 * 与 `LineLayer` 同构（同一份装配 `useVisualLayer`），差别只有三处：
 *
 * 1. 图层种类是 `fill`（官方 `FillLayer`）；
 * 2. 样式是 `FillLayerStyle`（官方 `FillLayerStyle`：纯色 / 描边 / 纹理三套）；
 * 3. 构造选项多一个 `border`（官方 `FillLayerOptions.border`，**官方默认 `true`**）。
 *
 * `border` **刻意不给默认值**（`withDefaults` 里显式写 `undefined`）：Vue 对 `Boolean` 有
 * 「缺省即 `false`」的转换，不给默认值会让每个不传 `border` 的用户都隐式地关掉描边。写成
 * `undefined` 之后「没传」= 不表态，SDK 用自己声明的默认值。
 *
 * 其余语义（data `setData` 不重建 / style `setStyleOptions + doOnceDraw` / 字段级 setter /
 * 构造期项换实例 / 拾取载荷与未命中语义）与 `LineLayer` 完全一致。
 */
import { NATIVE_LAYER_PICK_EVENTS, pickEmitterFor, useVisualLayer } from "./useVisualLayer";
import type { FillLayerProps, FeaturePick } from "../../types/components";

const props = withDefaults(defineProps<FillLayerProps>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
  // 上游默认值是 `true`，但本库**不替上游表态**：显式写 `undefined` 关闭 Vue 对可选布尔属性的
  // 「缺省即 false」转换，让「没传」真的等于「没传」（见文件头）。
  border: undefined,
});

const emit = defineEmits<{
  /** 点击要素（含未命中）。 */
  click: [pick: FeaturePick];
  /** 双击要素（含未命中）。 */
  dblclick: [pick: FeaturePick];
  /** 右键点击要素（含未命中）。 */
  rightclick: [pick: FeaturePick];
  /** 鼠标在要素上移动。 */
  mousemove: [pick: FeaturePick];
}>();

const emitPick = pickEmitterFor({
  click: (pick) => emit("click", pick),
  dblclick: (pick) => emit("dblclick", pick),
  rightclick: (pick) => emit("rightclick", pick),
  mousemove: (pick) => emit("mousemove", pick),
});

const { resource } = useVisualLayer<FillLayerProps>(props, {
  kind: "fill",
  component: "FillLayer",
  pickEvents: NATIVE_LAYER_PICK_EVENTS,
  emitPick,
  extraCtorOptions: (p) => (p.border === undefined ? {} : { border: p.border }),
});

defineExpose({
  /** 要素状态命令面（按业务 id = `idKey` 指向的字段定位）。 */
  featureState: resource.featureState,
});

defineOptions({ name: "FillLayer" });
</script>

<template>
  <slot />
</template>
