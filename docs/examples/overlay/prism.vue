<template>
  <BMap
    v-bind="$attrs"
    :zoom="10"
    :tilt="50"
    enableScrollWheelZoom
    mapStyleId="980161f3645989feac25a0da15da4178"
    ref="map"
    @ready="handleInitd"
  >
    <BPrism
      isBoundary
      :path="pathPoints"
      :autoCenter="false"
      :topFillOpacity="topFillOpacity"
      :sideFillOpacity="0.9"
      :altitude="5000"
      sideFillColor="#5679ea"
      topFillColor="#5679ea"
      @mouseover="handleMouseover"
      @mouseout="handleMouseout"
    />
  </BMap>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useBMapAreaBoundary } from "bmap-vue";
const topFillOpacity = ref<number>(0.5);
const area = ref<string>("北京市");
const map = ref();
const { boundaries: pathPoints, get } = useBMapAreaBoundary(map);

function handleInitd() {
  get(area.value);
}

function handleMouseover() {
  topFillOpacity.value = 1;
}

function handleMouseout() {
  topFillOpacity.value = 0.5;
}
</script>
