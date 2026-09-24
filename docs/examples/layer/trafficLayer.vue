<template>
  <Map :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <TrafficLayer :colors="['#00ff00', '#ffff00', '#ff8800', '#ff0000']" edge />
  </Map>
</template>

<script lang="ts" setup></script>
