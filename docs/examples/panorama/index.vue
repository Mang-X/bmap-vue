<template>
  <BPanorama
    v-bind="$attrs"
    style="width: 100%; height: 480px"
    :id="panoId"
    :pov="{ heading: 0, pitch: -10 }"
    :zoom="1"
  />
</template>

<script setup lang="ts">
/**
 * 全景查看器示例。
 *
 * 全景容器**没有默认尺寸**，尺寸必须由使用方给出（这里用内联 style）。`id` 是百度全景库里
 * 的一条真实记录，打开后可以通过鼠标拖动改变视角。
 */
const panoId = "09002200122109011551464100z";
</script>
