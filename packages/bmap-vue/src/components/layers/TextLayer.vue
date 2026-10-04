<script setup lang="ts">
/**
 * TextLayer —— 批量文字标注图层（官方 `BMap.TextLayer`，4.0.5 `visualization/` 新增）
 *
 * ## 它是什么
 *
 * 官方为「地图上文字量较大」的场景提供的批量图层：一条 GeoJSON 要素渲染一段文字，
 * 文案 / 字号 / 颜色等**全部是数据驱动**（官方 `StyleValue<T>`，可按要素逐个求值），
 * 并内置碰撞剔除（`collides` / `padding` / `margin`）。几何支持 `Point` / `MultiPoint`。
 *
 * ## 与 `<PolygonLayer>` / `<PolylineLayer>` 的**三处**关键差异（与前两刀相反）
 *
 * 1. **拾取面是完整的**：官方声明了 `setEnablePicked` / `getEnablePicked` / `hitTest`
 *    （`:280` / `:282` / `:289`）与**六个**事件（`TextLayerEventMap`，`:331-338`）。
 *    live 探针（case 3e / 3f，2026-09-27）读到 `prototype.hitTest` 为 `function`、
 *    实际调用返回 `null`（当时容器上没有文字）⇒ **声明与运行时一致**。
 *    而 `PolygonLayer` / `PolylineLayer` 恰好相反（声明有 `hitTest`、运行时**没有**）
 *    ——因此那两族不开面、这一族**开面**。
 * 2. **官方声明了 `setOpacity`**（`:296`，live 实测运行时也有）⇒ 本组件有 `opacity` prop
 *    且走 setter。`PolygonLayer` / `PolylineLayer` **没有**这个 prop（运行时有但未声明，
 *    按 #165 裁决不当契约）。这是两族唯一一处「声明有 vs 声明无」方向相反的地方。
 * 3. **静态枚举 `TextLayer.Anchor`**（`:232-242`）在运行时**确实在位**（探针读到九项
 *    `[-1,1]` 向量全在）。本组件**不**投影它：它是给「自己算锚点向量」的场景用的，
 *    而 `style.anchor` 直接给官方接受的**字符串**（`TextAnchor`）更贴近 `setOptions`
 *    的实际用法——多投影一份只会让两个入口对同一语义给出不同的值。
 *
 * ## 缩放范围仍是构造选项
 *
 * `minZoom` / `maxZoom`（`:190` / `:195`）是**构造选项**，官方**没有** `setMinZoom` /
 * `setMaxZoom`（探针 `protoHas` 均为 `false`）⇒ 变化**换实例**，与前两族同一条口径。
 *
 * ## 刻意不开的面（逐条依据见 `docs/zh-CN/contributing/166-visualization-alignment-audit.md`）
 *
 * - **`setRenderStage` / `setRefCenter`**：声明有（`:304` / `:308`）、运行时也有，但
 *   **无组件消费者**（与前两族同一裁决，#104「没有消费者的扩展面一律不加」）。需要时经
 *   `style` 袋的 `renderStage` 走 `setOptions` 下发（官方注释明说 `setOptions` 会把它
 *   转发到对应 setter）。
 * - **七条 `getX` 读回**（`getData` / `getOptions` / `getEnablePicked` / `getVisible` /
 *   `getOpacity` / `getZIndex` / `getRenderStage` / `getRefCenter`）：无消费者。
 * - **`mouseover` / `mouseout`**：官方声明了（`:336-337`），但它们是**成对**的进入 / 离开
 *   语义，与本库现有组件的领域事件面不同构，且无消费者（沿用前两刀对
 *   `PolygonLayerEventMap` 的同一裁决）。
 * - **`clearData()`**：Driver 侧**登记**了它（官方逐条声明，`:262`），但**本组件不调用**
 *   ——与前两族同一条口径：`data: null` 统一走「换一个没有数据的实例」。
 *   同一个 `data: null` 在不同 kind 上换语义是使用者最难预期的一类差异。
 *
 * ## 为什么**有** `defineExpose`（与前两刀相反）
 *
 * 本票的规则（`docs/zh-CN/contributing/166-visualization-alignment-audit.md` §六）：
 * **官方有同名公开方法、且该语义不是某个已暴露 prop 的受控写入 ⇒ 必须可从 ref 到达。**
 *
 * 逐条套在本组件上：数据（`data`）、样式（`style`）、显隐（`visible`）、层级（`zIndex`）、
 * 透明度（`opacity`）**全都是受控 prop**；`clearData` / `setRenderStage` / `setRefCenter`
 * / 七条 `getX` / `mouseover` / `mouseout` 都不开面。
 *
 * **剩下 `hitTest`**：它既不是任何受控 prop 的写入面（它是**读**——把像素坐标换成命中的
 * 文字），声明与运行时又都在（与前两族相反）⇒ 落进「必须 expose」。`PolygonLayer` /
 * `PolylineLayer` 不 expose 是因为它们**每一条**候选都已被 prop 表达或已关闭；这一族
 * 有一条真的漏出来了。留一个空壳比留一条真命令更糟，但反过来，一条真命令不 expose
 * 就是把官方能力藏起来。
 */
import { NATIVE_LAYER_PICK_EVENTS, pickEmitterFor, useVisualLayer } from "./useVisualLayer";
import type { FeaturePick, TextLayerPick, TextLayerProps } from "../../types/components";

const props = withDefaults(defineProps<TextLayerProps>(), {
  visible: true,
  // 与官方默认值（false，`:150`）**不同**，刻意如此：不给事件就别怪用户拿不到 `pick`。
  enablePicked: true,
  // ⚠️ 官方 `mouseStyleChange` 默认 `true`（`:155`），而 Vue 对可选 `Boolean` prop 会转成
  // `false` ⇒ 显式写 `undefined` 关闭那个转换，让「没传」真的等于「没传」。
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

const { resource } = useVisualLayer<TextLayerProps>(props, {
  kind: "text",
  component: "TextLayer",
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
 * 主动命中测试（官方 `TextLayer.hitTest(x, y)`，`:289`）。
 *
 * 每次调用**重新取会话**（`resource.session()`），与 `featureState` 那条命令面同一口径：
 * 图层会因构造期选项变化（缩放范围）而换实例，闭包里存一个旧句柄会把命令打进一个已经
 * 不在地图上的图层。未就绪时返回 `null`（= 未命中）并**不排队**——排队会让快速切换
 * data / 缩放范围时的迟到命令落到**已经换掉的实例**上，那比直接说「没命中」更糟。
 */
function hitTest(x: number, y: number): TextLayerPick | null {
  const session = resource.session();
  if (!session) return null;
  return session.driver.hitTestText(session.handle, { x, y });
}

defineExpose({
  /**
   * 主动命中：容器像素坐标 → 命中的那段文字（官方 `TextLayerItem`），未命中返回 `null`。
   *
   * 逐字段如实投影官方声明的六项（`point` / `text` / `width` / `height` / `id` /
   * `properties`）。⚠️ **没有** `dataIndex`：官方回包里没有它，而本库不从 `id` 反推下标
   * ——那是 SDK 内部口径，不是有依据的公开身份（见 `NativeLayerTextPick` 的注释）。
   *
   * 读不到值的字段给 `null` 而不是 `0` / `""`：`0` 宽度与「没给宽度」在业务上不是一回事。
   */
  hitTest,
});

defineOptions({ name: "TextLayer" });
</script>

<template>
  <slot />
</template>
