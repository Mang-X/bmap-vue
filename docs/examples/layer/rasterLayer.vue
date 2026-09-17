<template>
  <BMap :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <BRasterLayer
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      :subdomains="['a', 'b', 'c']"
      :max-zoom="19"
    />
  </BMap>
</template>

<script lang="ts" setup></script>
