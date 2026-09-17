<script setup lang="ts">
/**
 * BDOMLayer —— 自定义 DOM 覆盖物图层（官方 `BMap.DOMLayer`，4.0）
 *
 * 官方构造签名是 `new BMap.DOMLayer(createDOM, options)`——**首参是 DOM 工厂**；本组件把它
 * 暴露成必填 prop `createDom`（prop 名与官方首参名的映射见下）。
 *
 * 行为依据（`DOMLayer` / `DOMLayerOptions` / `DOMLayerEventMap`）：
 * - `data` 变化调 `setData()`，**不重建图层**（重建会让所有 DOM 覆盖物重新创建 —— 肉眼可见的
 *   闪烁）。因此 `createDom` 即使写成内联箭头函数也不会触发重建：内核的指纹把函数折叠成 `fn`；
 * - `createDom` 变化**不重建、也不会被丢弃**：传给 SDK 的是一个引用稳定的包装函数，它每次都
 *   转发到当前 prop，因此后续渲染出的 DOM 用的是最新实现（与官方参考实现
 *   `huiyan-fe/react-bmap` 的 `useLatest` 语义一致）；
 * - 官方用整袋 `setStyleOptions(partial)` 更新构造项（`minZoom` / `maxZoom` / `zIndex` /
 *   `offsetX` / `offsetY` / `anchors` / `coordinate` / `enableDraggingMap`），因此这些 prop
 *   变化时**就地更新**，不重建；
 * - 事件按官方声明绑定（`click` / `mouseover` / `mouseout`，由图层内部的 DOM 覆盖物派发）；
 *   回调参数是**归一化事件**，官方事件的原始对象在 `e.raw`；
 * - 清空走官方 `clearData` 归一化入口（`DOMLayer` 的实现是 `removeAllOverlays()`）：
 *   把 `data` 置为 `null` 即可。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BDOMLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
  /** GeoJSON `FeatureCollection`；`null` = 清空全部 DOM 覆盖物。 */
  data?: object | null;
  /**
   * 创建 DOM 元素的回调，接收要素 `properties` 与该点坐标，返回 `HTMLElement`。
   *
   * prop 名刻意用 `createDom`（而不是官方构造首参的 `createDOM`）：Vue 把模板里的
   * `create-dom` 归一成 `createDom`，而 `createDOM` 在 kebab-case 下**不可达**
   * （`create-dom` ≠ `createDOM`），只能写 `:createDOM="..."`。这里选模板友好的一侧，
   * 与 SDK 的那份名字的映射在组件内部完成。
   *
   * 它的变化**不会重建图层**；传给 SDK 的是引用稳定的转发函数，因此后续 `setData` 触发的
   * DOM 创建用的仍是最新的实现。
   */
  createDom: (properties: object, point: { lng: number; lat: number }) => HTMLElement;
  /** 最小显示缩放等级。 */
  minZoom?: number;
  /** 最大显示缩放等级。 */
  maxZoom?: number;
  /** 图层层叠顺序。 */
  zIndex?: number;
  /** 水平偏移（像素）。 */
  offsetX?: number;
  /** 垂直偏移（像素）。 */
  offsetY?: number;
  /** 锚点，取值 `[0,1]` 的 `[水平, 垂直]`。 */
  anchors?: [number, number];
  /** 坐标系类型，默认 `BD09`。 */
  coordinate?: string;
  /** 是否允许拖动地图。 */
  enableDraggingMap?: boolean;
}

const props = withDefaults(defineProps<BDOMLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  enableDraggingMap: undefined,
});

const emit = defineEmits<{
  click: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
}>();

useLayerResource<BDOMLayerProps>(props, {
  component: "BDOMLayer",
  toSpec: (p) => ({
    kind: "dom",
    visible: p.visible,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    zIndex: p.zIndex,
    data: p.data,
    options: {
      // 官方构造首参就叫 `createDOM`；prop 名与其不同（见 props 的说明），这里做映射。
      // 与其余回调型 option 走同一个 `forwardCallback`：SDK 手上的函数**转发到当前 prop**，
      // 因此后续 `setData` 触发的新一轮 DOM 创建用的是最新实现，且内联箭头不会触发重建。
      createDOM: forwardCallback(() => p.createDom),
      ...pickLayerOptions(p, [
        "offsetX",
        "offsetY",
        "anchors",
        "coordinate",
        "enableDraggingMap",
      ]),
    },
  }),
  bind: ({ handle, context, scope }) => {
    const events = context.client.driver.events;
    scope.add(events.on(handle, "click", (e) => emit("click", e)));
    scope.add(events.on(handle, "mouseover", (e) => emit("mouseover", e)));
    scope.add(events.on(handle, "mouseout", (e) => emit("mouseout", e)));
  },
});

defineOptions({ name: "BDOMLayer" });
</script>

<template>
  <slot />
</template>
