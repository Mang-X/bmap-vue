<template>
  <BMap :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <BTileLayer
      tile-url-template="https://maponline0.bdimg.com/tile/?qt=tile&x={X}&y={Y}&z={Z}&styles=pl"
      :opacity="0.9"
      :z-index="3"
    />
  </BMap>
</template>

<script lang="ts" setup></script>
