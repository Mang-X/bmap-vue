<template>
  <Map v-bind="$attrs" :zoom="13">
    <Rectangle
      :bounds="bounds"
      stroke-color="#1677ff"
      :stroke-weight="3"
      fill-color="#1677ff"
      :fill-opacity="0.25"
      enableEditing
    />
  </Map>
</template>

<script lang="ts" setup>
// 矩形由对角两点定义：southwest 是西南角、northeast 是东北角
const bounds = {
  southwest: { lng: 116.36, lat: 39.88 },
  northeast: { lng: 116.45, lat: 39.95 },
};
</script>
