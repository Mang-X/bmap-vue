<template>
  <BMap :center="point || defaultCenter">
    <BAutoComplete style="width: 100%" @confirm="handleConfirm" />
    <BMarker v-if="point" :position="point"></BMarker>
  </BMap>
</template>

<script setup lang="ts">
import { BMap, BAutoComplete, BMarker, type PointLike, useBMapGeocoder } from "bmap-vue";
// 字符串地点需要后端解析，抖动时地图会停在默认视角；用显式坐标兜底
const defaultCenter: PointLike = { lng: 116.404, lat: 39.915 };
const { get, point } = useBMapGeocoder();

function handleConfirm(e: any) {
  const value = e.item.value as Record<string, string>;
  get(
    value.province + value.city + value.district + value.street + value.business,
    value.city || value.business,
  );
}
</script>

<style scoped></style>
