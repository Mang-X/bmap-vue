# Resolver

`@mangax/bmap-vue/resolver` 提供 `BMapResolver`，给 [unplugin-vue-components](https://github.com/unplugin/unplugin-vue-components)
用：**在模板里直接写 `<Map>` / `<Marker>`，不用手写 `import`**。

## 配置

```ts
// vite.config.ts
import Components from 'unplugin-vue-components/vite'
import { defineConfig } from 'vite'
import { BMapResolver } from '@mangax/bmap-vue/resolver'

export default defineConfig({
  plugins: [
    Components({
      resolvers: [BMapResolver()],
    }),
  ],
})
```

模板与 `<script setup>` 里直接用：

```vue
<template>
  <Map :ak="ak" :zoom="12" v-model:center="center">
    <Marker :position="center" />
    <NavigationControl />
  </Map>
</template>

<script setup lang="ts">
// 不用 import { Map, Marker, NavigationControl } from '@mangax/bmap-vue'
const center = ref({ lng: 116.404, lat: 39.915 })
</script>
```

Nuxt 用 `unplugin-vue-components` 的 [`@nuxtjs/components`](https://github.com/unplugin/unplugin-vue-components#nuxt)，Vite 用上面的写法。

> **用 `unplugin-auto-import` 的话要额外开 `vueTemplate`。** 它默认 `vueTemplate: false`，不会处理
> `<template>` 里的标签 —— 只配 `AutoImport({ resolvers: [BMapResolver()] })` 并**不会**让
> `<Map>` 自动导入。要做模板里的组件自动导入，用上面的 `unplugin-vue-components`；`unplugin-auto-import`
> 更适合自动导入 composable（见下）。

## 它做什么、不做什么

`BMapResolver` 只做一件事：把模板里用到的**组件名**映射到 `@mangax/bmap-vue` 的导出。

- 它只认本库**真实导出**的组件名。写错的或别库的组件名不会被自动导入，
  会照常报「组件未注册」——这是有意的：静默导入一个不存在的名字比报错更难查。
- 它不处理 composable。`useGeocoder()` 这类要自动导入的话，
  用 `unplugin-auto-import` 的 `imports` 配置显式声明，或正常 `import`。
- 它不引入任何运行时依赖，纯粹是构建期的名字映射。

## 什么时候**不要**用

代码要给别人看、或者团队里有人不用这套构建配置时，**手写 import 更清楚**。
自动导入省的是几行样板，代价是「这个名字从哪来」要看构建配置才知道。
本库自己的文档与示例都手写 import。
