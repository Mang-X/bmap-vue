<template>
  <Map enable-wheel-zoom :zoom="9">
    <DistrictLayer
      name="北京市"
      :kind="DistrictType.AREA"
      auto-viewport
      :fill-color="hovered ? '#9169db' : '#fdfd27'"
      @mouseover="hovered = true"
      @mouseout="hovered = false"
    />
  </Map>
</template>

<script lang="ts" setup>
import { ref } from "vue";
import { DistrictLayer, DistrictType } from "bmap-vue";

/**
 * `kind` 是官方 `DistrictLayer` 的**下钻层级**（`0` 本级 / `1` 下一级 / `2` 再下一级），
 * `DistrictType` 是本库给这三个数字起的领域别名：传「北京市」+ `AREA` 会下钻到区县。
 *
 * `fill-color` 这类样式在官方 `DistrictLayer` 上是**构造期**的（没有字段级 setter），
 * 变化时图层会重建——所以这里用一个布尔量表达高亮，而不是在事件里调 `setFillColor`。
 */
const hovered = ref(false);
</script>
