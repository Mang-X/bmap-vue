<script lang="ts" setup>
import { Map, Marker, PointLike } from "bmap-vue";
import { ref } from "vue";

const center = { lng: 113.5213534078, lat: 27.6907991732 };
const data = ref<PointLike[]>([center]);

const handleUpdate = () => {
  data.value = Array.from({ length: 10 }).map(() => {
    const random = Math.random() * 0.05;
    const posLng = Math.random() > 0.5 ? -1 : 1;
    const posLat = Math.random() > 0.5 ? -1 : 1;
    return { lat: center.lat + random * posLat, lng: center.lng + random * posLng };
  });
};
</script>

<template>
  <Map :center="center">
    <Marker v-for="(item, index) in data" :key="index" :position="item" icon="loc_red" />
  </Map>
  <button class="myButton no-m-b" type="button" @click="handleUpdate">更新</button>
</template>
