<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-wheel-zoom>
    <!--
      官方把初始数据写作构造选项 `dataSource`，本库只走 `data` → `setData()` 这一条路径：
      「数据从哪来」只有一个入口，初始那一帧与后续变化走的是同一套时机。
    -->
    <GeoJSONLayer
      layer-name="demo-geojson"
      reference="BD09LL"
      :data="geojson"
      :polyline-style="{ strokeColor: '#0055ff', strokeWeight: 3 }"
      :level="-50"
      @click="handleClick"
    />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { GeoJSONLayer } from "bmap-vue";

/**
 * 一份最小的 GeoJSON 数据；`data` 变化时只调 `setData()`，不会重建图层。
 *
 * `polylineStyle` 也可以写成「按要素属性算样式」的函数 `(properties) => ({ … })`；那是**换引用
 * 就会重建图层**的那一类，请传 `computed` / 模块常量而不是内联箭头。
 */
const geojson = ref({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [116.35, 39.9],
          [116.45, 39.93],
        ],
      },
      properties: { name: "demo-line" },
    },
  ],
});

function handleClick(e: unknown) {
  // 归一化事件上的要素集合在 `raw.features`（官方事件对象）
  console.log("clicked", (e as { raw?: { features?: unknown } }).raw?.features);
}
</script>
