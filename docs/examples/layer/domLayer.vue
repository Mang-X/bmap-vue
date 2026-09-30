<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-wheel-zoom>
    <!--
      官方构造首参叫 `createDOM`，本库改名 `createDom`：`create-dom` 在 kebab-case 下
      才会归一到 `createDom`，而 `create-dom` ≠ `createDOM`，所以官方那个名字模板里不可达。
    -->
    <DOMLayer
      :create-dom="createDom"
      :data="geojson"
      :min-zoom="5"
      :anchors="[0.5, 1]"
      coordinate="BD09"
      enable-dragging-map
    />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { DOMLayer } from "bmap-vue";

/**
 * 每个要素一个自定义 DOM。
 *
 * `createDom` 换实现**不重建图层**：交给 SDK 的是一个「身份恒定、内部读最新 prop」的包装函数，
 * **下一次** `setData` 触发的解析就会用到新实现；已经画在图上的元素保持旧实现——要让它们换实现，
 * 重新赋值 `data` 即可。
 */
function createDom(properties: object, point: { lng: number; lat: number }) {
  const div = document.createElement("div");
  div.style.cssText =
    "background:#ff5722;color:#fff;padding:4px 8px;border-radius:4px;font-size:12px;white-space:nowrap;";
  // 需要交互就在这里给元素自己挂监听：元素随数据 / 图层一起销毁，不用额外解绑。
  div.textContent = `${(properties as { name?: string }).name ?? ""} (${point.lng.toFixed(3)}, ${point.lat.toFixed(3)})`;
  return div;
}

// `data` 变化只调 `setData()`，不重建图层（重建会让所有 DOM 覆盖物重做，肉眼可见地闪）。
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
