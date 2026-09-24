<template>
  <Map v-bind="$attrs" @ready="handleInitd" :zoom="zoom">
    <CustomControl style="display: flex; background-color: #fff; padding: 10px" :offset="{ x: 0, y: 0 }">
      <button @click="handleZoomOut">缩小</button>
      <button @click="handleZoomIn">放大</button>
    </CustomControl>
  </Map>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { BMapClient, MapHandle } from "bmap-vue";
const zoom = ref(10);
let _client: BMapClient | null = null;
let _map: MapHandle | null = null;
function handleInitd({ client, map }: { client: BMapClient; map: MapHandle }) {
  _client = client;
  _map = map;
}
function handleZoomOut() {
  if (_client && _map) zoom.value = _client.driver.map.getZoom(_map) - 1;
}
function handleZoomIn() {
  if (_client && _map) zoom.value = _client.driver.map.getZoom(_map) + 1;
}
</script>

<style scoped>
button {
  outline: none;
  border: none;
  background: #41b883;
  margin: 0 5px;
  padding: 5px 15px;
  border-radius: 4px !important;
}
</style>
