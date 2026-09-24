<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <XYZLayer
      tile-url-template="https://tile.openstreetmap.org/[z]/[x]/[y].png"
      :min-zoom="1"
      :max-zoom="19"
    />
  </Map>
</template>

<script lang="ts" setup></script>
