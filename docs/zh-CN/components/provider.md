---
title: BMapProvider Client 上下文
---

# BMapProvider Client 上下文

`<BMapProvider>` 为子树提供 SDK Client 上下文（加载状态 + `BMapClient`），无需地图实例即可使用服务类 hooks（如 `useGeocoder`）。`<Map>` 会优先复用最近的 Provider 上下文。

```ts
import { BMapProvider } from 'bmap-vue'
```

## 基础用法

```vue
<template>
  <BMapProvider @ready="onReady" @error="onError">
    <template #loading>SDK 加载中…</template>
    <template #error="{ error, retry }">
      <button @click="retry">加载失败：{{ error.message }}，点击重试</button>
    </template>
    <RouterView />
  </BMapProvider>
</template>

<script setup lang="ts">
import { BMapProvider } from 'bmap-vue'

function onReady() {}
function onError() {}
</script>
```

不传 `definition` / `provider` 时复用 `app.use(createBMapPlugin(...))` 的默认定义
（`baiduJsapiV4Provider()`，官方 Loader）。需要子树换入口时才显式传 `provider`：
`customScriptV4Provider(src)`（自托管）或 `existingGlobalV4Provider()`（宿主已加载）。

## 静态组件 props

| 属性        | 说明                                              | 类型                        | 默认值 |
| ----------- | ------------------------------------------------- | --------------------------- | ------ |
| client      | 已创建好的 `BMapClient`（最高优先级）             | `BMapClient`                | -      |
| definition  | 完整 Client 定义（覆盖默认定义）                  | `CreateBMapClientOptions`   | -      |
| provider    | 便捷 Provider（与 `<Map>` 的 `provider` 对称）    | `BMapProviderLike`          | -      |
| loadOptions | 配合 `provider` 使用的加载选项                    | `BMapLoadOptions`           | `{}`   |
| autoLoad    | 挂载后自动加载 SDK（`false` 时需手动 `load()`）   | `boolean`                   | `true` |
| suspense    | 保留字段                                          | `boolean`                   | `false` |

无 `definition` 时，Provider 复用 `app.use(createBMapPlugin(...))` 的默认定义或最近父 Provider 的上下文。

`definition` / `provider` 都直接交给 `createBMapClient`（缺省注入 jsapi-v4 的 Driver 工厂）：
`provider` 必须是**结构化**形状（`load()` 返回 `LoadedSdk`，engine = `jsapi-v4`）。需要固定某个
Driver 实现时直接传带 `driver` 的 `definition`。迁移期的 `withMigrationDriver` 归一与宽松
Provider 形状已随旧引擎删除（`#26`），见[从 WebGL v1 迁移到 4.0](../guide/migration-v1-to-v4)。

## 插槽

| 插槽名  | 说明                     | 参数                          |
| ------- | ------------------------ | ----------------------------- |
| default | 常驻内容（加载中也渲染） | `{ status }`                  |
| loading | Client 加载中展示        | `{ status }`                  |
| error   | Client 加载失败展示      | `{ error: BMapError, retry }` |

服务端渲染时不执行 SDK 加载，只输出容器内容；客户端挂载后开始加载。

## 组件事件

| 事件名 | 说明             | 载荷         |
| ------ | ---------------- | ------------ |
| ready  | Client 加载完成  | `BMapClient` |
| error  | Client 加载失败  | `BMapError`  |

## 组件方法

| 方法   | 说明             | 类型                                            |
| ------ | ---------------- | ----------------------------------------------- |
| load   | 手动加载 Client  | `(signal?: AbortSignal) => Promise<BMapClient>` |
| retry  | 失败后重试       | `() => Promise<BMapClient>`                     |

## 与 `app.use()` 的关系

`app.use(createBMapPlugin({ ak }))` 只提供**默认** Client 定义；`<BMapProvider>` 可覆盖其子树的默认值。
`<Map>` 的查找顺序见[配置](../guide/config#client-查找顺序)。
