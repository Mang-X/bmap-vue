<script setup lang="ts">
/**
 * TrafficLayer —— 实时路况图层（官方 `BMap.TrafficLayer`，4.0）
 *
 * 官方把它定义为「预配置的 `TileLayer`」，因此构造选项与 `TileLayer` 一致（`opacity` /
 * `zIndex`），另外多两个**可就地更新**的开关：`colors`（`setColors`）与 `edge`（`setEdge`）。
 * 后两者变化时不会重建图层，也不会丢掉已加载的瓦片。
 *
 * `autoRefresh` / `refreshInterval` 只有构造期生效（官方没有对应 setter）：改变它们会重建
 * 图层——这是有意的，因为「刷新间隔」是图层内部的定时器，就地改不了。
 *
 * ⚠️ **不承诺多实例隔离**：官方 `TrafficLayer` 是**页面级单实例**（原型本身就是已构造实例，
 * `map` / 瓦片缓存 / 刷新 timer 在所有 `new TrafficLayer()` 之间共享，见 ADR
 * `2026-09-11-jsapi-v4-control-layer-facets` §12 的技术结论）。挂两个路况图层时，
 * `autoRefresh` 一类共享状态以最后一次写入为准；需要严格隔离就一个 `<Map>` 一个实例。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface TrafficLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
  /** 图层透明度，0 - 1。 */
  opacity?: number;
  /** 图层层叠顺序（官方有 `setZIndex`，可就地更新）。 */
  zIndex?: number;
  /** 是否自动刷新路况数据。 */
  autoRefresh?: boolean;
  /** 路况自动刷新间隔（毫秒）。 */
  refreshInterval?: number;
  /** 路况颜色，顺序为 `[畅通, 缓行, 拥堵, 严重拥堵]`（可就地更新）。 */
  colors?: string[];
  /** 是否展示白色描边（可就地更新）。 */
  edge?: boolean;
}

const props = withDefaults(defineProps<TrafficLayerProps>(), {
  // 布尔 option 显式写 `undefined`：绕开 Vue「缺省即 false」的 props 转换，
  // 让「没传」= 「不表态」（理由与代价见 ADR 2026-09-17 决策 5）。
  visible: true,
  autoRefresh: undefined,
  edge: undefined,
});

useLayerResource<TrafficLayerProps>(props, {
  component: "TrafficLayer",
  toSpec: (p) => ({
    kind: "traffic",
    visible: p.visible,
    opacity: p.opacity,
    zIndex: p.zIndex,
    // `colors` / `edge` 会被 Driver 分类为「可就地更新」，因此它们的变化不会重建图层；
    // `autoRefresh` / `refreshInterval` 是构造期选项，变化 ⇒ 重建。
    options: pickLayerOptions(p, ["autoRefresh", "refreshInterval", "colors", "edge"]),
  }),
});

defineOptions({ name: "TrafficLayer" });
</script>

<template>
  <slot />
</template>
