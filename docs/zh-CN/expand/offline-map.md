# 离线地图 / 企业自托管

默认在线加载走官方 `@baidumap/jsapi-loader`（见[官方包与加载路径](../contributing/official-packages)），
入口 URL 恒为 `api.map.baidu.com`，**本库不拼入口、不自管回调**。因此离线或企业自托管资源不属于默认路径。

::: warning `apiUrl` 在默认路径上会显式报错
`<Map api-url="...">` / `createBMapPlugin({ apiUrl })` 传入的 `apiUrl` 会被官方 Provider
**在加载前拒绝**（`BMAP_INVALID_ARGUMENT`）。这不是「接收后忽略」的假支持：官方 Loader 1.0.0
没有自定义入口的能力。自托管请走下面两条显式路径之一。
:::

## 路径一：自建入口脚本

用 `customScriptV4Provider(scriptSrc)` 表达——它服务自研 `ScriptLoader`，**只**在这条显式高级路径上启用。

```vue
<script setup lang="ts">
  import { Map, Marker } from 'bmap-vue'
  // 自建入口经显式 v4 Provider 表达
  import { customScriptV4Provider } from 'bmap-vue/core'

  const offlineProvider = customScriptV4Provider('自建地址/getApiScripts.js')
</script>

<template>
  <Map
    :center="{ lng: 106.53637853629937, lat: 29.464275891815767 }"
    enableScrollWheelZoom
    :provider="offlineProvider"
  >
    <Marker :position="{ lng: 121.56847909, lat: 29.8100979777 }"></Marker>
  </Map>
</template>
```

Provider 可以经 `createBMapPlugin({ provider })` 装成全局默认，也可以逐个 `<Map :provider>` 传入。

自建入口脚本需要自己完成两件事（这是**你的入口**的职责，不是本库的）：

1. 加载 JSAPI 4.0 的资源；
2. 在资源就绪时把 `window.BMap` 挂上（官方入口会挂 `BMap`，并把 `BMapGL` 挂成同一对象的别名）。

如果你的入口无法满足第 2 条（例如还需要额外初始化），改用路径二。

## 路径二：宿主已加载

宿主页面（或自己的引导脚本）已经把 SDK 装好时，用 `existingGlobalV4Provider()`——
本库**只消费全局，不另插 script**：

```ts
import { existingGlobalV4Provider } from 'bmap-vue/core'

const app = createApp(App).use(createBMapPlugin({ provider: existingGlobalV4Provider() }))
```

见[配置](../guide/config)。

::: tip 组件取消等待 ≠ 终止加载
没有官方取消接口：全部消费者取消后底层在飞任务**保留**，且不会为后续请求另插重复 script。
:::
