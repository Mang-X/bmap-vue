<template>
  <Map enable-scroll-wheel-zoom :zoom="9">
    <DistrictLayer
      @mouseover="handleMouseover"
      @mouseout="handleMouseout"
      viewport
      :kind="DistrictType['AREA']"
      name="北京市"
    />
  </Map>
</template>

<script lang="ts" setup>
import { DistrictType } from "bmap-vue";

function handleMouseover(e: any) {
  e.currentTarget.setFillColor("#9169db");
}

function handleMouseout(e: any) {
  e.currentTarget.setFillColor(e.currentTarget.style.fillColor);
}
</script>
