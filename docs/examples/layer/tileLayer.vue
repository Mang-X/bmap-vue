<template>
  <div>
    <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-wheel-zoom>
      <TileLayer
        tile-url-template="https://maponline0.bdimg.com/tile/?qt=tile&x={X}&y={Y}&z={Z}&styles=pl"
        :opacity="0.9"
        :z-index="3"
        :tile-load-observer="observer"
      />
    </Map>
    <p class="bmap-example-status">
      请求 <b>{{ requested }}</b> 张 · 失败 <b>{{ failed }}</b> 张
      <template v-if="lastErrorUrl">（最后一张失败：<code>{{ lastErrorUrl }}</code>）</template>
    </p>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { TileLayer } from "bmap-vue";
import type { TileLoadObserver } from "bmap-vue";

/**
 * 官方这批网络图层的类声明里**没有**任何事件成员，运行时也不派发 `tileload` / `tileerror`，
 * 因此本库不发明事件，而是提供 `tileLoadObserver` 这个**观察面**：不接管加载，只在旁边看。
 *
 * ⚠️ 与官方的 `tileLoadFunction` 不同——后者是**接管式**的：设了它 SDK 就不再自己加载，
 * 函数必须自己完成加载（`tile.src = url`），否则瓦片不会出现。
 */
let requested = 0;
let failed = 0;
let lastErrorUrl = "";

const observer = computed<TileLoadObserver>(() => ({
  // SDK **要求加载**一张瓦片（请求，不代表成功）——想数请求次数用它
  onRequest: ({ url }) => {
    requested += 1;
    lastErrorUrl = "";
  },
  // 该图片元素加载**失败**（以元素为单位；浏览器不提供失败原因）
  onError: ({ url }) => {
    failed += 1;
    lastErrorUrl = url;
  },
}));
</script>
