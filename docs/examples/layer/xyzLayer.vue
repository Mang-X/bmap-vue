<template>
  <BMap :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <BXYZLayer
      tile-url-template="https://tile.openstreetmap.org/[z]/[x]/[y].png"
      :min-zoom="1"
      :max-zoom="19"
    />
  </BMap>
</template>

<script lang="ts" setup></script>
