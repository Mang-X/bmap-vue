<script setup lang="ts">
/**
 * BGeoJSONLayer —— GeoJSON 覆盖物组合图层（官方 `BMap.GeoJSONLayer`，4.0）
 *
 * 官方构造签名是 `new BMap.GeoJSONLayer(layerName, options)`——**首参是图层名**；本组件把它
 * 暴露成 `layerName`（默认 `bmap-vue-geojson`），并保证 `data` 走归一化的 `setData`。
 *
 * 行为依据（`GeoJSONLayer` / `GeoJSONLayerOptions` / `GeoJSONLayerEventMap`）：
 * - `data` 是一等公民：变化时调 `setData()` **不重建图层**（重建会把所有要素覆盖物拆掉重做）；
 *   `data: null` 走 `clearData()`；
 * - `minZoom` / `maxZoom` / `level` 只有构造期生效（官方没有对应 setter）⇒ 变化时重建；
 * - 事件按官方声明绑定（`click` / `mousemove` / `mouseout`），回调参数就是 SDK 的事件对象
 *   （`click` 的载荷带 `features`）；
 * - **不支持** `opacity` / `zIndex`：官方 `GeoJSONLayer` 没有它们（层级是语义不同的 `level`），
 *   本组件因此不声明这两个 props——而不是声明了再静默忽略。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface BGeoJSONLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
  /** GeoJSON 数据源（`FeatureCollection`）；`null` = 清空。 */
  data?: object | null;
  /** 图层名，写入每个要素的属性；改变它会重建图层。 */
  layerName?: string;
  /** 最小显示层级。 */
  minZoom?: number;
  /** 最大显示层级。 */
  maxZoom?: number;
  /** 来源数据坐标系：`BD09LL` / `BD09MC` / `EPSG3857` / `GCJ02` / `WGS84`。 */
  reference?: string;
  /** 点要素样式（或按属性计算的函数）。 */
  markerStyle?: unknown;
  /** 线要素样式（或按属性计算的函数）。 */
  polylineStyle?: unknown;
  /** 面要素样式（或按属性计算的函数）。 */
  polygonStyle?: unknown;
  /** 显示层级（负数越大层级越高，官方默认 -99）。 */
  level?: number;
}

const props = withDefaults(defineProps<BGeoJSONLayerProps>(), {
  visible: true,
  layerName: "bmap-vue-geojson",
});

const emit = defineEmits<{
  click: [e: unknown];
  mousemove: [e: unknown];
  mouseout: [e: unknown];
}>();

useLayerResource<BGeoJSONLayerProps>(props, {
  component: "BGeoJSONLayer",
  toSpec: (p) => ({
    kind: "geojson",
    visible: p.visible,
    minZoom: p.minZoom,
    maxZoom: p.maxZoom,
    data: p.data,
    options: {
      // 官方构造首参就叫 `layerName`（不是选项）；与 `createDOM` 同样走具名键，
      // 由 Driver 的 `buildCtorArgs` 取出并从选项袋里剔除。
      layerName: p.layerName,
      // 这三类是**身份敏感**的回调（只在解析数据时求一次样式）：换实现必须重建实例，
      // 否则已经在图上的要素不会换样式。因此它们**不**走 `forwardCallback`（那是「每次工作
      // 单元都会再调用」的回调用的），由内核按**引用**比较指纹 ⇒ 引用变化即重建。
      // 代价：请传稳定引用（`computed` / 模块常量），内联箭头会因引用每次变化而重建。
      markerStyle: p.markerStyle,
      polylineStyle: p.polylineStyle,
      polygonStyle: p.polygonStyle,
      ...pickLayerOptions(p, ["reference", "level"]),
    },
  }),
  bind: ({ handle, context, scope }) => {
    const events = context.client.driver.events;
    scope.add(events.on(handle, "click", (e) => emit("click", e)));
    scope.add(events.on(handle, "mousemove", (e) => emit("mousemove", e)));
    scope.add(events.on(handle, "mouseout", (e) => emit("mouseout", e)));
  },
});

defineOptions({ name: "BGeoJSONLayer" });
</script>

<template>
  <slot />
</template>
