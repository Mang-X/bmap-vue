<template>
  <BMap :zoom="12" :center="{ lng: 116.404, lat: 39.915 }" enable-scroll-wheel-zoom>
    <BTrafficLayer :colors="['#00ff00', '#ffff00', '#ff8800', '#ff0000']" edge />
  </BMap>
</template>

<script lang="ts" setup></script>
