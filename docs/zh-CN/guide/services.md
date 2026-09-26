---
title: Headless 服务
lang: zh-CN
---

# Headless 服务

百度的地址解析、路线规划、本地检索这类服务，官方给的是「自己发请求 + 自己收结果 + 自己管生命周期」。
本库把它们封装成**结果即数据**的 composable：默认不画任何东西，结果由你决定怎么呈现。

这一页是所有服务 composable 的**共用契约**。每个 hook 的独有参数与结果形状见它自己的页面。

## 先选对：要不要地图

服务 composable 只需要 **Client**（`ak` / provider 那层），**不需要地图实例**。所以它可以在
`<BMapProvider>` 子树里直接用，页面上没有 `<Map>` 也能跑：

```vue
<script setup lang="ts">
import { BMapProvider } from 'bmap-vue'
import { useGeocoder } from 'bmap-vue'

const { search, status, data } = useGeocoder()
</script>

<template>
  <!-- 没有 <Map>：服务照样工作 -->
  <BMapProvider :ak="ak">
    <button :disabled="status === 'loading'" @click="search('天安门')">查询</button>
  </BMapProvider>
</template>
```

要**把服务结果画到地图上**时（路线 composable 的 `render` 选项），才需要 `<Map>`。

## 统一状态口径

所有服务 composable 的 `status` 共用同一份定义，这是判断「该不该重试」的依据：

| 值 | 含义 |
| --- | --- |
| `idle` | 尚未发起（或 `reset()` 之后） |
| `loading` | 请求在飞 |
| `success` | 拿到结果。**结果为空仍是 `success`**（用 `pois.length` / `total` 判断） |
| `empty` | 没有结果**或**服务当前不可用（官方没有公开原因时的合并结论） |
| `failed` | 有公开原因：SDK 公开状态码 / 参数非法 / 前置条件不满足 |
| `timeout` | 适配器超时（SDK 可能永不回调） |
| `canceled` | 逻辑取消 |
| `unsupported` | 当前引擎没有这个能力：**一次请求都没有发出**（此时 `supported` 为 `false`） |

`empty` 与 `failed` 不要合并。前者是「问了但没结果」，重试通常没有意义；后者是「问错了或出错了」，
重试可能有用。`unsupported` 又是另一回事——**根本没发请求**，重试同样没有意义。

## 返回值

每个服务 composable 返回同一组骨架，业务结果在 `data` 里：

| 字段 | 说明 |
| --- | --- |
| `data` | 业务结果（各 hook 不同） |
| `status` | 上表的状态 |
| `error` | 有公开原因时的错误信息 `{ code, message }` |
| `sdkStatus` | SDK 公开的状态码（`BMAP_STATUS_*`；成功为 `0`，拿不到时为 `null`） |
| `isLoading` | 是否在飞 |
| `supported` | 当前引擎是否支持（Client 就绪后立即判定，不需要先发一次请求） |
| `isError` | `status === 'failed'` 的别名 |
| `isEmpty` | `data === null` 的别名（失败、取消、`empty` 都是 `true`） |
| `search*` | 发起请求，返回 `Promise<ServiceResult<T>>` |
| `cancel` | **逻辑取消**在飞请求 |
| `reset` | 取消 + 清空结果与状态 |

## 两档：谁有 `invalidateService`

判据是**该服务的 SDK 实例有没有公开的释放入口**，不是「哪个服务看起来复杂」：

| 档 | composable | `invalidateService` |
| --- | --- | --- |
| **简单档** | `useGeocoder` / `useGeocodeDetail` / `useConvertor` / `useAreaBoundary` / `useGeolocation` / `useIpLocation` / `usePanoramaService` | **不暴露**（官方没有实例销毁入口，走无状态通道） |
| **独占档** | `useLocalSearch` + `useDrivingRoute` / `useWalkingRoute` / `useRidingRoute` / `useTransitRoute` | **有**（官方有 `disposeLocalSearch` / `disposeRoute`） |

简单档的 composable 拿不到也**不需要** `invalidateService`；独占档有实例要释放，所以要给你这个入口。
想知道某个具体 hook 属于哪档，看它页面顶部的说明。

## 请求归属：不按到达顺序猜

官方对 JSONP 风格的服务只承诺「**单次调用内部**的顺序」，**没有**承诺多次请求之间的回调顺序。
所以本库不按「谁先回来就是谁的」猜归属：

- **简单档**没有实例身份可依据，因此不建推断层——每个 composable 在同一时刻只处理一个未结算操作。
- **独占档**用「一个实例一个未结算操作」+ 调用方侧「取代即换新实例」：新 `search*` 落在还有未结算
  检索的实例上时，取消旧检索并**释放旧实例**，为新检索建新实例。旧的迟到回包只会落到旧实例上。
- 代价：取代 / 取消 / 超时之后的重查会**多建一个 SDK 实例**，换来的是归属可判定。

`Autocomplete` 是另一回事：它**没有**归一化调用面，构造时传 `onSearchComplete` 原样转发。
「这条结果属于哪次输入」由持有输入框的一方判断——见 [Autocomplete](/zh-CN/components/autoComplete/)。

## 与官方 UI Kit 的分流

本库的服务 composable 不会因为 UI Kit 的交互而发请求，UI Kit 也不会反过来触发它们——
两者是**独立**的通道，同一次交互只走其中一条。标准的结果列表、分页、详情面板、路线面板请用
[官方 UI Kit](./ui-kit)，它由百度官方维护。

同时接上两者（例如同时用 `<PlaceSearch>` 和 `useLocalSearch`）会产生两条**独立**请求，
它们不会共享结果也不会互相取消。

## composable 一览

### 地址与坐标

- [useGeocoder](/zh-CN/hooks/useGeocoder) 地址 ↔ 坐标
- [useGeocodeDetail](/zh-CN/hooks/useGeocodeDetail) 坐标点的结构化地址描述
- [useConvertor](/zh-CN/hooks/useConvertor) 坐标系转换
- [useAreaBoundary](/zh-CN/hooks/useAreaBoundary) 行政区域边界

### 定位

- [useGeolocation](/zh-CN/hooks/useGeolocation) 浏览器定位
- [useIpLocation](/zh-CN/hooks/useIpLocation) IP 定位

### 检索

- [useLocalSearch](/zh-CN/hooks/useLocalSearch) 地点检索（独占档）
- [usePanoramaService](/zh-CN/hooks/usePanoramaService) 全景检索

### 路线规划

默认**只返回数据不画线**；要画到地图上用 `render` 选项，或交给[官方 UI Kit](./ui-kit) 的标准路线面板。

- [useDrivingRoute](/zh-CN/hooks/useDrivingRoute) 驾车
- [useWalkingRoute](/zh-CN/hooks/useWalkingRoute) 步行
- [useRidingRoute](/zh-CN/hooks/useRidingRoute) 骑行
- [useTransitRoute](/zh-CN/hooks/useTransitRoute) 公交
