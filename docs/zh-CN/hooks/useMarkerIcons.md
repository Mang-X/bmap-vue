# useMarkerIcons

通过该 hooks 可获取一些内置的地图图标（`BMap.Icon`，JSAPI 4.0 下 `BMapGL` 是同一命名空间的别名）。

```ts
import { useMarkerIcons } from 'bmap-vue'
```

> 参考：[marker 图标可选值](/zh-CN/components/overlay/marker#默认图标可选值)

## 用法

```ts
const icons = useMarkerIcons(client) // client 可在 ready 事件或 useMap().client 获取
```

:::tip
图标经 `client.driver.overlays.buildIcon` 构建，不依赖全局 `BMapGL`；在 `<Map>` 子树内调用时可省略参数
:::

### 参数

| 参数 | 描述 | 类型 |
| --- | --- | --- |
| client | BMapClient（map ready 后可用） | `BMapClient`（可选） |

### 返回值

| 返回值 | 描述                                    | 类型                                      |
| ------ | --------------------------------------- | ----------------------------------------- |
| icons   | 所有内置的 `BMap.Icon` 实例对象键值对 | `Record<DefaultMarkerIcons, unknown>`（SDK 图标句柄，类型由 Driver 决定） |

## 代码示例

composable 必须在 `setup` 内调用（内部使用 `inject`）。在 `<Map>` 子树内可省略参数，
否则请在 `ready` 载荷中拿到 `client` 后显式传入：

```vue
<template>
  <Map @ready="handleReady">
    <IconUser />
  </Map>
</template>

<script setup lang="ts">
import { Map, useMarkerIcons, type BMapClient } from 'bmap-vue'
import { defineComponent, h } from 'vue'

// 子树内调用：省略参数
const IconUser = defineComponent({
  setup() {
    const icons = useMarkerIcons()
    return () => h('div')
  }
})

function handleReady({ client }: { client: BMapClient }) {
  const icons = useMarkerIcons(client)
  // ...
}
</script>
```

## TS 类型定义参考

```ts
export declare type DefaultMarkerIcons =
  | 'simple_red'
  | 'simple_blue'
  | 'loc_red'
  | 'loc_blue'
  | 'start'
  | 'end'
  | 'location'
  | 'red1'
  | 'red2'
  | 'red3'
  | 'red4'
  | 'red5'
  | 'red6'
  | 'red7'
  | 'red8'
  | 'red9'
  | 'red10'
  | 'blue1'
  | 'blue2'
  | 'blue3'
  | 'blue4'
  | 'blue5'
  | 'blue6'
  | 'blue7'
  | 'blue8'
  | 'blue9'
  | 'blue10'
export declare function useMarkerIcons(client?: BMapClient): Record<string, unknown>
```
