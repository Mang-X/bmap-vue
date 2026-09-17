<template>
  <BMap :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <BWMTSLayer
      url="https://t0.tianditu.gov.cn/img_w/wmts"
      :params="{
        Layer: 'img',
        Style: 'default',
        TileMatrixSet: 'w',
        Format: 'tiles',
        tk: '你的天地图key',
      }"
      :min-zoom="1"
      :max-zoom="18"
    />
  </BMap>
</template>

<script lang="ts" setup></script>
