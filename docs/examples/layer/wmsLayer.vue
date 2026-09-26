<template>
  <div>
    <!--
      WMS 没有「拿来就能跑」的公共端点：每个 WMS 服务都是部署方自己的 GeoServer / MapServer，
      需要服务端开 CORS。因此这里**不**放一个必然加载失败的占位 URL——那会让示例在页面上
      永远是一片空白，读者以为组件坏了。

      下面是一个可运行的最小骨架：把它换成你自己的服务地址即可。
    -->
    <div class="bmap-example-toolbar">
      <label for="wms-url">WMS 服务地址</label>
      <input
        id="wms-url"
        class="bmap-example-input"
        v-model="url"
        placeholder="https://your-geoserver.example.com/geoserver/wms"
      />
    </div>
    <p class="bmap-example-status">
      未填写地址时不加载图层；填入后地图会按 <code>{{ params.LAYERS }}</code> 图层发请求。
      服务端需要允许跨域，否则瓦片会被浏览器拦掉（表现为空白而不是报错）。
    </p>
    <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
      <WMSLayer v-if="url" :url="url" :params="params" :min-zoom="3" :max-zoom="18" />
    </Map>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { WMSLayer } from "bmap-vue";

/** WMS 的参数键名是**全大写**（与 WMTS 的首字母大写不同）。写错通常表现为服务端 400。 */
const params = {
  LAYERS: "workspace:layername",
  VERSION: "1.1.1",
  FORMAT: "image/png",
  TRANSPARENT: "true",
};

const url = ref("");
</script>
