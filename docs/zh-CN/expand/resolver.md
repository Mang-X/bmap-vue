# Resolver

`bmap-vue/resolver` 提供 `BMapResolver`，给 [unplugin-auto-import](https://github.com/unplugin/unplugin-auto-import)
之类的自动导入工具用：**在模板里直接写 `<Map>` / `<Marker>`，不用手写 `import`**。

## 配置

```ts
// vite.config.ts
import AutoImport from 'unplugin-auto-import/vite'
import { defineConfig } from 'vite'
import { BMapResolver } from 'bmap-vue/resolver'

export default defineConfig({
  plugins: [
    AutoImport({
      imports: ['vue'],
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
// 不用 import { Map, Marker, NavigationControl } from 'bmap-vue'
const center = ref({ lng: 116.404, lat: 39.915 })
</script>
```

Nuxt 用 `@nuxtjs/auto-import` 的 `imports.resolvers`，Vite 用上面的写法。

## 它做什么、不做什么

`BMapResolver` 只做一件事：把模板里用到的**组件名**映射到 `bmap-vue` 的导出。

- 它只认本库**真实导出**的组件名。写错的或别库的组件名不会被自动导入，
  会照常报「组件未注册」——这是有意的：静默导入一个不存在的名字比报错更难查。
- 它不处理 composable。`useGeocoder()` 这类要自动导入的话，
  用 unplugin-auto-import 的 `imports` 配置显式声明，或正常 `import`。
- 它不引入任何运行时依赖，纯粹是构建期的名字映射。

## 什么时候**不要**用

代码要给别人看、或者团队里有人不用这套构建配置时，**手写 import 更清楚**。
自动导入省的是几行样板，代价是「这个名字从哪来」要看构建配置才知道。
本库自己的文档与示例都手写 import。
