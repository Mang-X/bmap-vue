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
      <template v-if="lastErrorUrl"
        >（最后一张失败：<code>{{ lastErrorUrl }}</code
        >）</template
      >
    </p>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { TileLayer } from "bmap-vue";

/**
 * 官方这批网络图层的类声明里**没有**任何事件成员，运行时也不派发 `tileload` / `tileerror`，
 * 因此本库不发明事件，而是提供 `tileLoadObserver` 这个**观察面**：不接管加载，只在旁边看。
 *
 * ⚠️ 与官方的 `tileLoadFunction` 不同——后者是**接管式**的：设了它 SDK 就不再自己加载，
 * 函数必须自己完成加载（`tile.src = url`），否则瓦片不会出现。
 *
 * 观察者以**最近一次**向该图片元素发起加载的那次为准（SDK 会复用元素）。回调里的 `url` 是
 * 元素**当前**的 `src`——官方没有暴露单次请求的身份，本库**不做逐请求归因**。
 */
const requested = ref(0);
const failed = ref(0);
const lastErrorUrl = ref("");

const observer = {
  // SDK **要求加载**一张瓦片（请求，不代表成功）——想数请求次数用它
  onRequest: ({ url }: { url: string }) => {
    requested.value += 1;
    lastErrorUrl.value = "";
  },
  // 该图片元素加载**失败**（以元素为单位；浏览器不提供失败原因）
  onError: ({ url }: { url: string }) => {
    failed.value += 1;
    lastErrorUrl.value = url;
  },
};
</script>
