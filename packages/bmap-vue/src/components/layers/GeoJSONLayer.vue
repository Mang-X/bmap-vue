<script setup lang="ts">
/**
 * GeoJSONLayer —— GeoJSON 覆盖物组合图层（官方 `BMap.GeoJSONLayer`，4.0）
 *
 * 官方构造签名是 `new BMap.GeoJSONLayer(layerName, options)`——**首参是图层名**；本组件把它
 * 暴露成 `layerName`（默认 `bmap-vue-geojson`），并保证 `data` 走归一化的 `setData`。
 *
 * 行为依据（`GeoJSONLayer` / `GeoJSONLayerOptions` / `GeoJSONLayerEventMap`）：
 * - `data` 是一等公民：变化时调 `setData()` **不重建图层**（重建会把所有要素覆盖物拆掉重做）；
 *   `data: null` 走 `clearData()`；
 * - `minZoom` / `maxZoom` 只有构造期生效（运行时**没有** `setMinZoom` / `setMaxZoom`）
 *   ⇒ 变化时重建；
 * - `level` **就地更新**（#165 收口）：变化时调 `setLevel()`，**不重建**。依据是 live 读数
 *   （`scripts/probe-165-level-effect.mts`，4.0.5）——`setLevel(-50)` 之后 `getLevel()` 读回
 *   `-50`，且 `getData()` 里**每一个**要素的 `zIndex` 都从 `-99` 变成 `-50`：它逐个透传给解析
 *   出的覆盖物，不是只改图层自己的内部字段。官方注释的「负数越大层级越高」是**语义**描述
 *   而非取值约束（实测 `0` / `2000` / `1.5` 都照收），因此本组件不做任何范围校验。
 * - 事件按官方声明绑定（`click` / `mousemove` / `mouseout`），回调参数就是 SDK 的事件对象
 *   （`click` 的载荷带 `features`）；
 * - **不支持** `opacity` / `zIndex`：官方 `GeoJSONLayer` 没有它们（层级是语义不同的 `level`），
 *   本组件因此不声明这两个 props——而不是声明了再静默忽略。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";

export interface GeoJSONLayerProps {
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
  /**
   * 显示层级（官方默认 -99）。
   *
   * 变化时**就地更新**（官方 `setLevel`，逐个透传给解析出的每个要素的 `zIndex`），**不重建**。
   * 取值不做校验：官方的「负数越大层级越高」是语义描述，实测正数与小数同样被接受。
   */
  level?: number;
}

const props = withDefaults(defineProps<GeoJSONLayerProps>(), {
  visible: true,
  layerName: "bmap-vue-geojson",
});

const emit = defineEmits<{
  click: [e: unknown];
  mousemove: [e: unknown];
  mouseout: [e: unknown];
}>();

useLayerResource<GeoJSONLayerProps>(props, {
  component: "GeoJSONLayer",
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

defineOptions({ name: "GeoJSONLayer" });
</script>

<template>
  <slot />
</template>
