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
// 但 `ref` 这类 Vue API 仍要自己 import —— unplugin-vue-components 只自动导入**组件**。
import { ref } from 'vue'
const center = ref({ lng: 116.404, lat: 39.915 })
</script>
```

> 想让 `ref()` 这类 Vue API 也免 import，可以**同时**加 `unplugin-auto-import` 的
> `AutoImport({ imports: ['vue'] })` —— 它负责 Vue API，`unplugin-vue-components` 负责组件，
> 两者互补。注意 `unplugin-auto-import` 默认不处理 `<template>`（`vueTemplate: false`），
> 所以模板里的组件自动导入仍然靠 `unplugin-vue-components`，不要指望前者。

Nuxt 不在本页范围：Nuxt 3/4 自带的组件自动导入只扫 `components/` 目录，**不会**自动识别本
resolver；在 Nuxt 里接入需要自己写一层 Nuxt 模块（`@nuxt/kit` 的 `addComponent`）。

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
