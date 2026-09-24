<template>
  <Map :center="point || defaultCenter">
    <Autocomplete style="width: 100%" @confirm="handleConfirm" />
    <Marker v-if="point" :position="point"></Marker>
  </Map>
</template>

<script setup lang="ts">
import { Map, Autocomplete, Marker, type PointLike, useGeocoder } from "bmap-vue";
// 字符串地点需要后端解析，抖动时地图会停在默认视角；用显式坐标兜底
const defaultCenter: PointLike = { lng: 116.404, lat: 39.915 };
const { get, point } = useGeocoder();

function handleConfirm(e: any) {
  const value = e.item.value as Record<string, string>;
  get(
    value.province + value.city + value.district + value.street + value.business,
    value.city || value.business,
  );
}
</script>

<style scoped></style>
