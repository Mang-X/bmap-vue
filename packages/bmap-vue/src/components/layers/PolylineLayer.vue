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
 * kind、样式类型、`PolylineLayerOptions` 特有的纹理一族，以及
 * **图层级 `opacity`（本族有、且实测生效；`PolygonLayer` 连选项表里都没有这一项）**。
 * ⚠️ 「同族」**不等于**「同面」：两族 `setOpacity` 的在位性读数完全一样，差别只在
 * 有没有接到渲染上，而那一条只能靠像素读，任何只看成员表的门禁都给不出。
 *
 * ⚠️ **图层级 `opacity` 为什么不作 prop**——这一条的理由**换过两次**，且每次都因为
 *   判据用错了：
 *   - ❌ 旧：「官方**没有** `setOpacity` 的声明 ⇒ 不把未声明成员当契约 ⇒ 只能经 `style` 袋
 *     经 `setOptions` 下发，**没有字段级 setter 的入口**」。**两半都是错的**：
 *     「没有字段级入口」在声明层面就不成立（`setOptions` 的文档自己写了转发，见下），
 *     而「不把未声明成员当契约」是**成员面**的口径，被误套到了**组件 prop** 上。
 *   - ❌ 中：「live 探针读到运行时有，但未声明 ⇒ 仍然只走 `style` 袋」。**前提被推翻**。
 *   - ✅ 现在：**声明 + 运行时 + 像素，三条都指向它是契约成员**——
 *     声明侧 `PolylineLayerOptions.opacity`（`:131` @default 1）**有**这一项，且
 *     `setOptions` 的注释（`:209`）明写「`opacity` / `visible` / `zIndex` / `renderStage` /
 *     `referCenter` / `enablePicked` **转发到对应 setter**」⇒ 官方**承诺**了字段级入口；
 *     运行时 `setOpacity` / `getOpacity` 在位且调得动；像素判决**可观测地生效**
 *     （哨兵像素 `1 → 0 → 1 → 0 → 1` = **4229 → 0 → 4229 → 0 → 4229**，可逆且重复一致）。
 *     ⇒ **Driver 登记了 `setOpacity`**（走 `RUNTIME_ONLY_REGISTERED` 豁免表：
 *     「声明没有的成员要登记，必须同时满足真在位、真生效、真没声明」）。
 *   ⇒ 所以 `<PolylineLayer>` **仍不**提供 `opacity` prop**不再是声明口径的必然**，
 *     而是一条**范围决策**：Driver 侧已登记的操作暂时**没有组件消费者**，
 *     与 #104「没有消费者的扩展面一律不加」存在张力。是否补 prop 留给后续裁决。
 *     （对照：`<PolygonLayer>` 那一族**没有** `opacity` 这一项，两者的不对称在这里是**事实**。）
 *   逐条依据见 `docs/zh-CN/contributing/165-runtime-audit-2026-09-27.md`「第三轮」。
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

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<string, never>): any;
}>();
defineOptions({ name: "PolylineLayer" });
</script>

<template>
  <slot />
</template>
