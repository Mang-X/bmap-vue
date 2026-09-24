<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <WMSLayer
      url="https://yourhost/geoserver/wms"
      :params="{
        LAYERS: 'workspace:layername',
        VERSION: '1.1.1',
        FORMAT: 'image/png',
        TRANSPARENT: 'true',
      }"
      :min-zoom="3"
      :max-zoom="18"
    />
  </Map>
</template>

<script lang="ts" setup></script>
