<!--
  npm README「`<BMapProvider>` 复用应用级默认」第二段的**独立**消费方对照（#190）。

  一个 README `vue` 块 = 一个 SFC，理由见同目录 `usage.vue` 的文件头。
-->
<script setup lang="ts">
import { BMapProvider, Map, ZoomControl } from 'bmap-vue'
</script>

<template>
  <BMapProvider>
    <Map :zoom="12">
      <ZoomControl />
    </Map>
  </BMapProvider>
</template>
