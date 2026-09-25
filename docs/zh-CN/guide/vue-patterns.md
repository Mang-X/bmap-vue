---
title: Vue 模式
lang: zh-CN
---

# Vue 模式

本库不是把命令式 API 套一层壳。组件按 Vue 的约定设计——
受控状态、插槽、双向绑定、响应式边界，都用 Vue 自己的语言表达。

## `v-model`：视野是双向的

`<Map>` 的四个视野字段都是受控的，直接用 `v-model`：

```vue
<template>
  <Map v-model:center="center" v-model:zoom="zoom" :ak="ak" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Point } from 'bmap-vue'

const center = ref<Point>({ lng: 116.404, lat: 39.915 })
const zoom = ref(12)
</script>
```

用户拖动或滚轮缩放时，SDK 读回的值会**写回**你的 ref——不需要自己监听
`moveend` / `zoomend` 再同步。

::: warning 载荷永远是坐标点
`v-model:center` 回写的永远是 SDK 读回的**具体坐标点**。
即使你传进去的是城市名字符串，用户交互之后这个值也会变成点。
:::

覆盖物统一用 `update:position`：

```vue
<Marker v-model:position="pos" />
```

## 受控与非受控

**传了**某个字段 = 受控：外部值变化会写进 SDK，SDK 的用户交互会回写并 emit
`update:*`。**没传** = 非受控：由组件自己管，你只监听 `update:*` 拿值。

```vue
<!-- 受控：zoom 始终是 12，用户缩放会被"弹"回去 -->
<Map :zoom="12" />

<!-- 非受控：初始 12，之后跟随用户 -->
<Map :zoom="12" @update:zoom="onZoom" />
```

底层是同一个状态机，没有第二套逻辑要收口。

## 插槽

`<Map>` 的 `loading` / `error` 插槽载荷**完全相同**，都是
`{ status, error, containerReady, retry }`：

```vue
<Map :ak="ak">
  <template #loading="{ status, containerReady }">
    <p v-if="!containerReady">等容器有尺寸…</p>
    <p v-else>SDK 加载中…</p>
  </template>
  <template #error="{ error, retry }">
    <button @click="retry">加载失败：{{ error.message }}，点击重试</button>
  </template>
</Map>
```

`containerReady` 区分「容器还没尺寸」与「SDK 还在加载」——两者都是 `loading`，
但前者根本不用等 SDK。详见 [Map 地图](/zh-CN/components/map)。

`<BMapProvider>` 的插槽载荷**更少**，因为它没有容器：

```vue
<BMapProvider :ak="ak">
  <template #loading="{ status }">SDK 加载中…</template>
  <template #error="{ error, retry }">
    <button @click="retry">加载失败：{{ error.message }}，点击重试</button>
  </template>
  <RouterView />
</BMapProvider>
```

两者都会在非 `loading` / `error` 状态下渲染默认插槽，所以把 `<RouterView />`
放进默认插槽即可。

## 响应式边界

大数组**不要**放进深响应。Vue 会给每个元素包 Proxy，读一遍就是一遍代理开销：

```ts
import { shallowRef, markRaw } from 'vue'

const stations = shallowRef<Station[]>([])
const layerData = markRaw(fetchGeoJSON())
```

配合本库的数据组件：

| 场景 | 做法 |
| --- | --- |
| 换一份新数据 | `stations.value = next`（组件按**引用**比较） |
| 原地改内容 | 递增 `dataVersion` prop |

```vue
<template>
  <PointCollection
    :data="stations"
    :data-version="version"
    item-key="id"
    :get-position="(s) => s.position"
  />
</template>

<script setup lang="ts">
const stations = shallowRef<Station[]>(initial)
const version = ref(0)
function patch(id: string) {
  stations.value.find((s) => s.id === id)!.lng += 0.01
  version.value += 1 // 引用没变，靠这个告诉组件内容变了
}
</script>
```

`shallowRef` / `markRaw` 之后原地 mutate 不会自动被感知，这与「`data` 只按引用比较」
的契约是一致的，不是新增的约束。完整说明见[数据组件](/zh-CN/components/data)。

## 事件

组件用类型化 `emits` 直接广播，不经过内部事件总线。`<Map>` 的 43 个地图事件
与所有覆盖物的事件都有静态声明，模板里 `@` 能补全出来。

覆盖物的 `defineEmits` 是**生成物**，由事件矩阵加生成器维护——
加一个事件要改事实源，不要在组件里手抄键名。矩阵见
[覆盖物事件矩阵](/zh-CN/components/overlay/events)，地图事件见[组件事件](./com-events)。

## 命令式

需要命令式控制时用组件 `ref` 暴露的**只读**命令面：

```ts
const mapRef = useTemplateRef<InstanceType<typeof Map>>('mapRef')
mapRef.value?.panTo({ lng: 116.4, lat: 39.9 })
```

命令面刻意**不是** SDK 实例的同形镜像——它只包含本库承诺过的操作。
需要 raw 实例见[扩展契约](./advanced)。

## 多实例

多个 `<Map>` 各自独立，互不干扰。

但同一页面里 SDK 全局是**进程级**的一份，所以**不同地图必须共用同一个 `ak`**
（或同一份 Client）。用不同 `ak` 请求同一个 SDK 会触发
`BMAP_SDK_CONFIG_CONFLICT`——见[错误码与排障](./errors)。

```vue
<!-- 两张图，各自独立 -->
<Map :ak="ak" :center="a" />
<Map :ak="ak" :center="b" />
```
