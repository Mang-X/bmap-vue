<template>
  <div>
    <!--
      天地图需要你自己的 `tk`（在[天地图开放平台](https://console.tianditu.gov.cn/)申请）。
      未填 key 时不加载图层——放一个必然 401 的 URL 只会让示例在页面上永远空白，
      读者会以为组件坏了。
    -->
    <div class="bmap-example-toolbar">
      <label for="wmts-tk">天地图 key</label>
      <input id="wmts-tk" class="bmap-example-input" v-model="tk" placeholder="你的天地图 tk" />
    </div>
    <p class="bmap-example-status">
      未填写 key 时不加载图层。填入后按 <code>{{ params.TileMatrixSet }}</code> 瓦片矩阵集 （<code
        >{{ params.Layer }}</code
      >
      图层）发请求。
    </p>
    <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
      <WMTSLayer
        v-if="tk"
        url="https://t0.tianditu.gov.cn/img_w/wmts"
        :params="{ ...params, tk }"
        :min-zoom="1"
        :max-zoom="18"
      />
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { WMTSLayer } from "bmap-vue";

/**
 * WMTS 的参数键名遵循 **WMTS 标准**（`Layer` / `Style` / `TileMatrixSet` / `Format`，
 * 首字母大写），与 WMS 的全大写**不同**。写错通常表现为服务端 400 或空白瓦片。
 */
const params = {
  Layer: "img",
  Style: "default",
  TileMatrixSet: "w",
  Format: "tiles",
};

const tk = ref("");
</script>
