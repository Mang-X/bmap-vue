<script setup lang="ts">
import type { Component } from "vue";

withDefaults(
  defineProps<{
    file: string;
    demo?: Component;
    height?: number;
  }>(),
  { demo: undefined, height: undefined },
);
</script>

<template>
  <ClientOnly>
    <div
      class="example-showcase"
      :class="{ 'has-demo-height': height !== undefined }"
      :style="height !== undefined ? { '--demo-height': `${height}px` } : undefined"
    >
      <component :is="demo" v-if="demo" />
      <div v-else class="example-empty" role="status">示例加载失败：{{ file }}</div>
    </div>
  </ClientOnly>
</template>

<style lang="less" scoped>
/*
 * 示例容器四周**统一**留白。
 *
 * 此前是 `padding: 0 1rem`——只有左右，上下为 0。后果是同一张卡里出现两种风格：
 * 顶部的工具条（按钮、输入框）紧贴卡片上缘，地图贴着左右缘，而地图**下方**被
 * 4.0 自绘的版权条压住（`© Baidu - GS…`），那条本身不可通过 `displayOptions` 关闭，
 * 官方 `setCopyrightOffset` 在 4.0.4 上实测**任何值都会把条挪到 0,0**（更糟），所以唯一
 * 稳的办法是给容器留出下边距。
 *
 * `.p-top` / `.p-bottom` 是按需追加的额外边距（多个示例相邻时拉开距离），
 * 与这里的基准留白叠加。
 */
.example-showcase {
  padding: 12px 16px;
  margin: 0.5px;

  /* 卡片本身 `overflow: hidden` + 12px 圆角；内边距会从四角漏出背景色，
     所以把圆角补给地图本身，两边才严丝合缝。 */
  :deep(.bmap-container) {
    border-radius: 6px;
    overflow: hidden;
  }
}
.example-showcase.has-demo-height > :deep(.bmap-container) {
  height: var(--demo-height) !important;
}
</style>
