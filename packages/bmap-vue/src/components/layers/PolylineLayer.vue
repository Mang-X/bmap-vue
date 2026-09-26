<script setup lang="ts">
/**
 * PolylineLayer —— 批量折线图层（官方 `BMap.PolylineLayer`，4.0.5 `visualization/` 新增）
 *
 * ## 它是什么
 *
 * 官方在 4.0.5 把 `BMap.LineLayer` 标了 `@deprecated` 并**指名**本类为替代
 * （`visualization/LineLayer.d.ts` 的 `@deprecated` 注释）。它与 `<LineLayer>` 的关系是
 * **弃用替代**、**不是**字段改名：`<LineLayer>` 的 `style` 走 `LineLayerStyle`
 * （`patternUrl` / `borderWeight` / `patternScale` 那一族），本组件的 `style` 走
 * `PolylineLayerStyle`（`strokeTextureUrl` / `strokeTextureSpaced` 那一族）。
 * 迁移时样式要按 `PolylineLayerStyle` 重写。`<LineLayer>` **继续可用、行为不变**。
 *
 * 几何支持 `LineString` / `MultiLineString`；渲染支持实线 / 虚线 / 纹理贴图三种模式。
 *
 * ## 与 `<PolygonLayer>` 完全同构（同一份装配 `useVisualLayer`）
 *
 * 逐条依据（声明行号 / live 实测）见 `PolygonLayer.vue` 的文件头与
 * `docs/zh-CN/contributing/166-visualization-alignment-audit.md`；两者的差异只有四处：
 * kind、样式类型、以及 `PolylineLayerOptions` 特有的纹理一族。
 *
 * ⚠️ **一个本票特有的代价**：`PolylineLayerOptions.opacity`（`:131` @default 1）是官方
 * **声明的**选项（图层级透明度），而官方**没有** `setOpacity` 的**声明**（live 实测运行时有，
 * 但本库不把未声明成员当契约）⇒ 它只能经 `style` 袋经 `setOptions` 整袋下发，
 * **没有字段级 setter 的入口**。`PolygonLayerOptions` 根本没有 `opacity` 这一项，
 * 因此不存在这条不对称。
 *
 * ## 为什么**没有** `defineExpose`
 *
 * 规则见 `PolygonLayer.vue` 的文件头与审计文档 §六：数据 / 样式 / 显隐 / 层级**全部**是
 * 受控 prop，其余官方成员要么不开面（`hitTest` / 七条 `getX` / `setRenderStage` /
 * `setRefCenter`），要么这一族没有（要素状态五件套）⇒ 无一条落进「必须 expose」。
 */
import { NATIVE_LAYER_PICK_EVENTS, pickEmitterFor, useVisualLayer } from "./useVisualLayer";
import type { FeaturePick, PolylineLayerProps } from "../../types/components";

const props = withDefaults(defineProps<PolylineLayerProps>(), {
  visible: true,
  // 与官方默认值（false）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
  // ⚠️ 官方默认 `true` ⇒ 显式 `undefined` 关闭 Vue 的「缺省即 false」转换。
  mouseStyleChange: undefined,
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

useVisualLayer<PolylineLayerProps>(props, {
  kind: "polyline",
  component: "PolylineLayer",
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

defineOptions({ name: "PolylineLayer" });
</script>

<template>
  <slot />
</template>
