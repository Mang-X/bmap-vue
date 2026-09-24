<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <GeoJSONLayer layer-name="demo-geojson" :data="geojson" @click="handleClick" />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { GeoJSONLayer } from "bmap-vue";

/** 一份最小的 GeoJSON 数据；`data` 变化时只调 setData()，不会重建图层。 */
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
