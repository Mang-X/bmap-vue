<template>
  <!--
    正证（issue #158 工作包 C）：这些组件**没有任何本地 import**，类型只可能来自
    `@mangax/bmap-vue/volar` 的 `GlobalComponents` 增补。

    刻意写成**只有 template 的 SFC**：没有 `<script>` 就没有能写 import 的地方，
    「无本地 import」是结构保证，不需要去扫源码文本。

    合法 props / slots 的可推导性由「这份文件零诊断」证明；「真的拿到了组件类型而不是
    退化成 any」由 `negative.vue` 的预期诊断证明 —— 组件若解析成 any，expected 的
    TS2322 / TS2339 就不会出现，门禁转红。
  -->
  <Map :zoom="12" :center="{ lng: 116.4, lat: 39.9 }">
    <ZoomControl />
    <Marker :position="{ lng: 116.4, lat: 39.9 }" :visible="true" />
    <template #default="{ status, map }">
      <span>{{ status }}</span>
      <span>{{ map === null ? "none" : "has-map" }}</span>
    </template>
  </Map>
</template>
