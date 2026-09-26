<script setup lang="ts">
/**
 * PolygonLayer —— 批量面图层（官方 `BMap.PolygonLayer`，4.0.5 `visualization/` 新增）
 *
 * ## 它是什么
 *
 * 官方在 4.0.5 把 `BMap.FillLayer` 标了 `@deprecated` 并**指名**本类为替代
 * （`visualization/FillLayer.d.ts` 的 `@deprecated 已废弃，建议使用 {@link PolygonLayer} 替代`）。
 * 因此它与 `<FillLayer>` 的关系是**弃用替代**，而**不是**字段改名：
 * `<FillLayer>` 的 `style` 走 `FillLayerStyle`（`patternUrl` / `borderWeight` / `borderCovered`
 * 那一族），本组件的 `style` 走 `PolygonLayerStyle`（`fillTextureUrl` / `strokeWeight` 那一族），
 * 两者**字段不重叠**。迁移时样式要按 `PolygonLayerStyle` 重写。
 *
 * `<FillLayer>` **继续可用、行为不变**（#165 决策：弃用是上游的事，1.0 不引入 compat shim，
 * §3.6 禁止迁移垫片）。
 *
 * ## 与其它可视化图层的四处差异（与 `<HeatmapLayer>` / `<TrackLineLayer>` 同装配）
 *
 * 1. **样式走 `setOptions`（整袋替换），不是 `setStyleOptions` + `doOnceDraw`**
 *    （官方声明 `visualization/PolygonLayer.d.ts:181`）。官方注释写明「仅更新已声明的
 *    样式键，未知键忽略并告警一次」⇒ **没写的键回到官方默认值**（不是 merge）。
 * 2. **显隐 / 层级**走 `setVisible`（`:204`）/ `setZIndex`（`:208`），因此**重新可见不换实例**。
 * 3. **没有** `opacity` prop：官方**声明**里没有 `setOpacity`（live 实测运行时有——
 *    但本库的口径是「不把未声明成员当契约」，与 #165 对 `PointLayer` 的同一裁决）。
 *    需要整层透明度请经 `style` 袋下发 `fillOpacity` / `strokeOpacity`。
 * 4. **缩放范围是构造选项**（`minZoom` / `maxZoom`，`:108` / `:112`）：官方**没有**
 *    `setMinZoom` / `setMaxZoom`（live 实测运行时的这两个方法也不存在）⇒ 变化**换实例**。
 *
 * ## 刻意不开的面（逐条依据见 `docs/zh-CN/contributing/166-visualization-alignment-audit.md`）
 *
 * - **`hitTest`**：官方**声明**有（`:201`），live 探针读到运行时**没有** ⇒ 不开面；
 * - **`setRenderStage` / `setRefCenter`**：声明有、运行时有，但**无组件消费者**（四个兄弟
 *   kind 同样关闭，见 #104「没有消费者的扩展面一律不加」）；
 * - **七条 `getX` 读回**（`getOptions` / `getData` / `getEnablePicked` / `getVisible` /
 *   `getZIndex` / `getRenderStage` / `getRefCenter`）：无消费者；
 * - **`mouseover` / `mouseout` 事件**：官方声明了（`PolygonLayerEventMap`，`:239-245`），
 *   但它们是**成对**的进入 / 离开语义，与本库现有四个组件的领域事件面不同构，且无消费者。
 * - **`clearData()`**：Driver 侧**登记**了它（官方逐条声明，见 `:174`），但**本组件不调用**——
 *   同一个 `data: null` 在不同 kind 上换语义（有的调 `clearData`、有的换实例）是使用者最难
 *   预期的一类差异。`data: null` 统一走「换一个没有数据的实例」（与 `HeatmapLayer` /
 *   `TrackLineLayer` 同一口径）。
 *
 * ## 为什么**没有** `defineExpose`
 *
 * 本票采用的规则（记在 `docs/zh-CN/contributing/166-visualization-alignment-audit.md` §六）：
 * **官方有同名公开方法、且该语义不是某个已暴露 prop 的受控写入 ⇒ 必须可从 ref 到达。**
 * 逐条套下来：数据（`data` prop）、样式（`style` prop）、显隐（`visible`）、
 * 层级（`zIndex`）**全都是受控 prop**；`clearData` / `hitTest` / 七条 `getX` 都不开面；
 * 要素状态五件套这两族**没有**（官方声明里没有 `updateState` 一族）。
 * ⇒ 没有任何一条落进「必须 expose」，因此本组件**不** `defineExpose`
 * （留一个空壳比不留更糟：`FillLayer` expose 的 `featureState` 在这两族上每条命令都会拒绝）。
 */
import { NATIVE_LAYER_PICK_EVENTS, pickEmitterFor, useVisualLayer } from "./useVisualLayer";
import type { FeaturePick, PolygonLayerProps } from "../../types/components";

const props = withDefaults(defineProps<PolygonLayerProps>(), {
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
  // ⚠️ 官方 `mouseStyleChange` 默认 `true`，而 Vue 对可选 `Boolean` prop 会转成 `false` ⇒
  // 显式写 `undefined` 关闭那个转换，让「没传」真的等于「没传」。这是本库第四次踩到同一个坑
  // （见 `docs/zh-CN/contributing/165-runtime-verification.md` 结论六）。
  mouseStyleChange: undefined,
  // 官方默认 `false`，与 Vue 缺省一致 ⇒ 可以让转换生效。
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

useVisualLayer<PolygonLayerProps>(props, {
  kind: "polygon",
  component: "PolygonLayer",
  pickOptionSet: "visualization",
  pickEvents: NATIVE_LAYER_PICK_EVENTS,
  emitPick,
  // 缩放范围是**构造选项**（官方无字段级 setter）⇒ 进选项袋，自动参与重建指纹
  extraCtorOptions: (p) => {
    const bag: Record<string, unknown> = {};
    if (p.minZoom !== undefined) bag.minZoom = p.minZoom;
    if (p.maxZoom !== undefined) bag.maxZoom = p.maxZoom;
    return bag;
  },
});

defineOptions({ name: "PolygonLayer" });
</script>

<template>
  <slot />
</template>
