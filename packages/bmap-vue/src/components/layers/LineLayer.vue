<script setup lang="ts">
/**
 * LineLayer —— 原生批量线图层（官方 `BMap.LineLayer`，4.0）
 *
 * ## ⚠️ 官方已在 4.0.5 弃用 `BMap.LineLayer`
 *
 * `@baidumap/jsapi-v4-types@4.0.5` 给 `LineLayer` 这个类加了一条
 * `@deprecated 已废弃，建议使用 {@link PolylineLayer} 替代`，替代品在 4.0.5 新增的
 * `visualization/` 命名空间里。
 *
 * **本组件的处置**（#165 决策，与 `FillLayer` / `PointIconLayer` 一致）：
 *
 * - **保留组件、保留行为**。替代组件（`PolylineLayer`）**还不存在**（见 #166），
 *   删掉等于让现有用户无路可走。
 * - **不改名、不留别名垫片**（#165 §3.6 禁止 compat shim；「别名指向新名」正是那条要禁的东西）。
 * - **把弃用讲清楚**：开发期告警一次（`warnDeprecatedLayerOnce`，见该函数文件头为什么去重要放
 *   在模块级）+ 类型层 `@deprecated` + 文档。
 *
 * 官方声明（`@baidumap/jsapi-v4-types` 的 `LineLayer` / `LineLayerOptions` / `LineStyle`）
 * 给出了完整的方法面，本组件逐条对应：
 *
 * | prop 变化 | 路径 | 依据 |
 * | --- | --- | --- |
 * | `data`（有值） | `setData()`，**不重建** | `LineLayer#setData` 是一等公民 |
 * | `data` → `null` | **换一个没有数据的实例** | 官方声明里**没有** `clearData`（只有 `setData`/`getData`）：SDK 侧无法 unset，本库不假装调一个不存在的入口 |
 * | `data` → `undefined` | 不表态：不产生任何 SDK 调用 | 与 `LayerSpec` 同一条口径 |
 * | `style` | `setStyleOptions()` + `doOnceDraw()`，**不重建** | 官方是 merge 且「修改后需 `doOnceDraw()` 才可见」 |
 * | `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter，**不重建** | `setVisible` / `setOpacity` / `setZIndex` / `setMinZoom` / `setMaxZoom` 都在声明里 |
 * | `idKey` / `crs` / `enablePicked` / `pickWidth` / `pickHeight` / `autoSelect` / `selectedColor` | **换实例** | 它们是构造选项；官方只有整袋 `setBaseOptions`（且不自动重绘） |
 *
 * 事件按声明绑定（`LineLayerEventMap` = `NormalLayerEventMap<LineLayer>`）：`click` / `dblclick` /
 * `rightclick` / `mousemove`。**没有** mouseover / mouseout——官方不派发，本组件也不声明。
 *
 * 拾取载荷见 `FeaturePick`：**未命中也会派发事件**（`hit: false`，`dataIndex: -1`），
 * 身份认不出来时 `id` / `item` 如实为 `null`。
 *
 * Feature State（要素状态）是**命令面**而不是 prop：通过组件 ref 的
 * `featureState.update / remove / clear / replace / get` 调用（按 `idKey` 字段的值定位要素）。
 * **没有声明 `idKey` 时这些命令会被拒绝**（告警一次）——身份未知时「按 id 定位」没有意义，
 * 而放它过去就等于悄悄依赖 SDK 的默认 `idKey`（与拾取如实给 `id: null` 是同一条口径）。
 */
import { NATIVE_LAYER_PICK_EVENTS, pickEmitterFor, useVisualLayer } from "./useVisualLayer";
import { warnDeprecatedLayerOnce } from "../../core/layers/deprecatedLayerWarning";
import type { LineLayerProps, FeaturePick } from "../../types/components";

/** 组件**创建**时（不是模块 import 时）报一次官方弃用；生产环境静默。 */
warnDeprecatedLayerOnce(
  "LineLayer:deprecated-class",
  "[LineLayer] 官方 `BMap.LineLayer` 已在 @baidumap/jsapi-v4-types@4.0.5 标记 @deprecated，" +
    "官方建议改用 `BMap.PolylineLayer`（4.0.5 新增的 visualization 命名空间）。" +
    "本组件继续可用、行为不变；替代组件 `PolylineLayer` 本库尚未提供（见 #166），" +
    "在此之前若你依赖 `LineLayer` 的既有行为可以继续使用。" +
    "详见 docs/zh-CN/components/layer/native-visual-layers.md",
);

const props = withDefaults(defineProps<LineLayerProps>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换。
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
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

const { resource } = useVisualLayer<LineLayerProps>(props, {
  kind: "line",
  component: "LineLayer",
  pickEvents: NATIVE_LAYER_PICK_EVENTS,
  emitPick,
});

defineExpose({
  /**
   * 要素状态命令面（按业务 id = `idKey` 指向的字段定位）。
   *
   * 官方入口：`updateState` / `removeState` / `clearState` / `replaceAllState` / `getAllState`。
   * 未就绪时命令不排队（告警一次并跳过）；`get()` 走 SDK 的公开读回。
   */
  featureState: resource.featureState,
});

defineOptions({ name: "LineLayer" });
</script>

<template>
  <slot />
</template>
