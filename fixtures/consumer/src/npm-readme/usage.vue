<!--
  npm README「Usage」第一段（`packages/bmap-vue/README.md`）的**独立**消费方对照（#190）。

  ⚠️ 每个 README 代码块一个文件，**刻意不合并**：合并进同一个 `<script setup>` 会让
  后一段继承前一段的 import，从而掩盖「这一段自己的**脚本符号**不完整」
  （评审 P1：原先三段合成一个 SFC，第三段即使漏导入也照样编译）。

  分工要说清（实测，别再指望错的那一层）：
  - **脚本符号**（`baiduJsapiV4Provider` 之类）由本目录的独立 SFC + `vue-tsc` 兜住
    ——删掉它自己的 import 会得到 `TS2304`；
  - **模板里的组件标签**（`<Map>` 漏 import）**`vue-tsc` 兜不住**（未解析标签退出码 0），
    由 `scripts/check-snippet-consistency.mts` 的 `selfContainedBlocks()` 在文本层兜住。

  一个 README `vue` 块 = 一个 SFC，各自拥有独立 import 作用域。
  改 README 时请一并改这里，否则「文档说的」与「真的能跑」会重新分叉。
  `verify-package.mts` 对真实 tarball 跑 `vue-tsc`，本目录由消费方 tsconfig 的
  `src/**/*.vue` 覆盖。
-->
<script setup lang="ts">
import { ref } from 'vue'
import { Map, Marker, NavigationControl } from 'bmap-vue'
import type { Point } from 'bmap-vue'

const ak = 'your Baidu Maps ak'
const center = ref<Point>({ lng: 116.404, lat: 39.915 })
</script>

<template>
  <Map :ak="ak" v-model:center="center" :zoom="12">
    <Marker :position="center" />
    <NavigationControl anchor="BMAP_ANCHOR_TOP_RIGHT" />
  </Map>
</template>
