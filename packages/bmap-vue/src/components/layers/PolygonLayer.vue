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
 * 1. **样式走 `setOptions`（merge），不是 `setStyleOptions` + `doOnceDraw`**
 *    （官方声明 `visualization/PolygonLayer.d.ts:181`）。官方注释写明「仅更新已声明的
 *    样式键，未知键忽略并告警一次」⇒ **只写你给的键，没写的保持原值**（与 `layer/`
 *    家族的 `setStyleOptions` 同一语义，见
 *    `core/layers/nativeLayerStyleOwnership.ts` 的文件头）。两族**真正**不同的只有
 *    重绘：`layer/` 家族要显式 `doOnceDraw()`，本族没有这个成员。
 * 2. **显隐 / 层级**走 `setVisible`（`:204`）/ `setZIndex`（`:208`），因此**重新可见不换实例**。
 * 3. **没有** `opacity` prop——⚠️ 这一条的**理由**被 2026-09-27 的像素级复跑换掉了，
 *    旧理由（「官方声明里没有 `setOpacity`，所以不把未声明成员当契约」）**已作废**。
 *    现在摆着的是**两件互不相同的事**：
 *    - `setOpacity` / `getOpacity` **运行时在位且调得动**，`setOpacity(0.25)` 读回 `0.25`
 *      （越界 `5` 被夹到 `1`）——但这**零信息量**：setter 与 getter 共用同一份状态。
 *    - 像素判决才是判据：`preserveDrawingBuffer: true` + `readPixels` 数哨兵色像素，
 *      `setOpacity` 走 `1 → 0 → 1`、`setOptions({opacity})` 走 `1 → 0 → 1`、构造期
 *      `opacity: 0`，**五态全部同值**；而同一次运行里 `setVisible(false)` /
 *      `setOptions({fillOpacity: 0})` 都能归零 ⇒ 不是「测不出来」，是**真·在位但不生效**
 *      （present-but-ineffective）。⇒ Driver **刻意不登记**它：登记等于开一个
 *      「调用成功但画面不变」的面，比假支持更难排查。
 *    根因在声明侧也成立：`PolygonLayerOptions` 逐条读过**根本没有 `opacity` 这一项**
 *    （`PolylineLayer.d.ts:131` 有），所以面族连**声明的入口**都没有。
 *    需要逐要素透明度请经 `style` 袋下发 `fillOpacity` / `strokeOpacity`（**这两条实测生效**）。
 * 4. **缩放范围是构造选项**（`minZoom` / `maxZoom`，`:108` / `:112`）：官方**没有**
 *    `setMinZoom` / `setMaxZoom`（live 实测运行时的这两个方法也不存在）⇒ 变化**换实例**。
 *
 * ### 「在位 / 声明 / 生效」是**三条**判据，不可互换
 *
 * 本票三处「不一致」恰好各占一个方向，别互相照抄理由：
 *
 * | 形状 | 例子 | 处置 |
 * | --- | --- | --- |
 * | 声明有、运行时**无** | `PolygonLayer#hitTest` | 不登记（假支持） |
 * | 声明有、运行时在、**不生效** | `PolygonLayer#setOpacity`（本条） | 不登记 |
 * | 声明**无**、运行时在、**生效** | `PolylineLayer#setOpacity` | 登记（`RUNTIME_ONLY_REGISTERED` 豁免） |
 *
 * 另有 `Marker#setAnchor`（声明有、settle **之后**实测在位且生效——未 settle 的取样会误判
 * 为「不在原型上」）与 `strokeLineCap`（运行时在、**不生效**）。判据永远是
 * 「**可观测地生效**」，而「生效」只能看画布，成员表与 `getX` 读回都给不出。
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
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "PolygonLayer" });
</script>

<template>
  <slot />
</template>
