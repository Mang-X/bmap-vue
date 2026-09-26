<script setup lang="ts">
/**
 * FillLayer —— 原生批量面图层（官方 `BMap.FillLayer`，4.0）
 *
 * ## ⚠️ 官方已在 4.0.5 弃用 `BMap.FillLayer`
 *
 * `@baidumap/jsapi-v4-types@4.0.5` 给 `FillLayer` 这个类加了一条
 * `@deprecated 已废弃，建议使用 {@link PolygonLayer} 替代`，替代品在 4.0.5 新增的
 * `visualization/` 命名空间里。
 *
 * **本组件的处置**（#165 决策，与 `LineLayer` / `PointIconLayer` 一致）：
 *
 * - **保留组件、保留行为**。本库是 1.0 清白面，但「官方弃用」不等于「本库可以删」——
 *   替代组件（`PolygonLayer`）**还不存在**（见 #166），删掉等于让现有用户无路可走。
 * - **不改名、不留别名垫片**。#165 §3.6 禁止 compat shim，而「别名指向新名」正是那条要禁的
 *   东西：两个名字长一样、行为不同，只会让调用方更难判断自己拿到的是哪一套语义。
 * - **把弃用讲清楚**：开发期告警一次（`warnDeprecatedLayerOnce`，见该函数文件头为什么去重要放
 *   在模块级）+ 类型层 `@deprecated` + 文档。
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
import { warnDeprecatedLayerOnce } from "../../core/layers/deprecatedLayerWarning";
import type { FillLayerProps, FeaturePick } from "../../types/components";

/** 组件**创建**时（不是模块 import 时）报一次官方弃用；生产环境静默。 */
warnDeprecatedLayerOnce(
  "FillLayer:deprecated-class",
  "[FillLayer] 官方 `BMap.FillLayer` 已在 @baidumap/jsapi-v4-types@4.0.5 标记 @deprecated，" +
    "官方建议改用 `BMap.PolygonLayer`（4.0.5 新增的 visualization 命名空间）。" +
    "本组件继续可用、行为不变；替代组件 `PolygonLayer` 本库尚未提供（见 #166），" +
    "在此之前若你依赖 `FillLayer` 的既有行为可以继续使用。" +
    "详见 docs/zh-CN/components/layer/native-visual-layers.md",
);

const props = withDefaults(defineProps<FillLayerProps>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
  // 上游默认值是 `true`，但本库**不替上游表态**：显式写 `undefined` 关闭 Vue 对可选布尔属性的
  // 「缺省即 false」转换，让「没传」真的等于「没传」（见文件头）。
  border: undefined,
  // 同理（#165 TASK 2）：官方 `popEvent` 默认 `true`，Vue 的缺省 `false` 会静默关掉事件冒泡。
  popEvent: undefined,
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
