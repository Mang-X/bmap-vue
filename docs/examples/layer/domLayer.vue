<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <DOMLayer :create-dom="createDom" :data="geojson" :min-zoom="5" enable-dragging-map />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { DOMLayer } from "bmap-vue";

/** 每个要素一个自定义 DOM；改成内联箭头函数也不会触发重建。 */
function createDom(properties: object, point: { lng: number; lat: number }) {
  const div = document.createElement("div");
  div.style.cssText =
    "background:#ff5722;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;white-space:nowrap;";
  div.textContent = `${(properties as { name?: string }).name ?? ""} (${point.lng.toFixed(3)}, ${point.lat.toFixed(3)})`;
  return div;
}

const geojson = ref({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [116.404, 39.915] },
      properties: { name: "天安门" },
    },
  ],
});
</script>
