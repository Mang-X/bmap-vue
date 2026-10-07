<script setup>
import { Map } from "bmap-vue";
</script>

<!--
  真实 SFC（issue #158 工作包 B）：SSR 验证的对象是**经 @vue/compiler-sfc 编译后**的组件，
  不是 `h(Map)` 手搓的渲染函数。默认插槽把两个可观察事实写进 DOM：

  - `status`：SSR 下应为 `idle`（没有挂载，也就没有建图）；
  - `map`：SSR 下应为 `null` → 渲染成 `no-map`，证明服务端**没有**创建地图实例。

  刻意不加 `lang="ts"`：这份 fixture 参加的是**运行时**渲染，不参加消费方的 `vue-tsc`
  类型检查（它不在 `fixtures/consumer/tsconfig.json` 的 include 里），保持纯 JS 可以让
  runner 直接执行 `compileScript` 的产物，不必再引入 TS → JS 的转译层。
-->
<template>
  <Map :zoom="12" :center="{ lng: 116.4, lat: 39.9 }">
    <template #default="{ status, map }">
      <span class="ssr-status">{{ status }}</span>
      <span class="ssr-has-map">{{ map === null ? "no-map" : "map" }}</span>
    </template>
  </Map>
</template>
