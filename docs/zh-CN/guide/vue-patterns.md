---
title: Vue 模式
lang: zh-CN
---

# Vue 模式

本库不是把 SDK 方法包一层，而是把**状态放在 Vue 这一侧**：数据的唯一来源是 props 与 `ref`，
SDK 对象由组件持有并在卸载时释放，组件之间靠 props / 事件 / 插槽通信。你不需要在 `onMounted`
里 `new` 什么、也不需要在 `onUnmounted` 里 `removeOverlay()`。

## 双向绑定：`v-model` 用的就是 `update:*` 约定

视野与位置字段都走 Vue 的 `v-model` 展开形态——`v-model:xxx` 就是 `:xxx` + `@update:xxx`，
没有第二个状态机：

| 组件 | `v-model` | 载荷 | SDK 交互的来源 |
| --- | --- | --- | --- |
| `<Map>` | `v-model:center` | `{ lng, lat }` | `moveend` |
| `<Map>` | `v-model:zoom` | `number` | `zoomend` |
| `<Map>` | `v-model:heading` | `number` | `headingchange` |
| `<Map>` | `v-model:tilt` | `number` | `tiltchange` |
| `<Marker>` | `v-model:position` | `{ lng, lat }` | `dragend` |
| `<InfoWindow>` | `v-model:open` | `boolean` | 点关闭按钮 / 被同图另一个气泡顶掉 |

```vue
<template>
  <Map
    ak="百度地图ak"
    v-model:center="center"
    v-model:zoom="zoom"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

const center = ref({ lng: 116.404, lat: 39.915 })
const zoom = ref(14)
</script>
```

::: tip 只有 `Marker` 的位置是真正双向的
`Marker` 的 `position` 走「位置字段」这一套实现，SDK 拖拽结束后会回写 `update:position`
（**真的变了才回写**）。`Label` / `Circle` / `CustomOverlay` 的位置字段只走「props → SDK」
这一个方向——它们没有可观测的 SDK 侧位置变化来源，因此不提供 `update:position`，不要给它们
绑 `v-model`。

`InfoWindow` 的 `position` 同理是单向的：`position` 变化时的动作是**按新坐标重新打开**
（官方没有 `setPosition`），不是回写。气泡的主状态只有 `open` 一个。
:::

### 受控与非受控

`center` / `zoom` / `heading` / `tilt` 各有两组 prop，来源优先级固定为
**受控值 > `default*` 初值 > 库默认视野**：

| 你传的 prop | 模式 | 外部值变化 | 用户交互（拖拽 / 缩放 / 旋转 / 倾斜） |
| --- | --- | --- | --- |
| `center` | **受控** | 写 SDK（与地图当前值不一致才下发） | 回写内部状态 + emit `update:center` |
| `defaultCenter` | 非受控 | 不生效（**告警一次**） | 回写内部状态 + emit `update:center` |
| 都不传 | 缺省 | 不适用 | 回写内部状态 + emit `update:center` |

`zoom` / `heading` / `tilt` 的规则逐字相同。**传了该 prop 就进入受控档**——组件不再自己决定
这个字段的最终值，它只负责把外部值写进 SDK、并把 SDK 侧观测到的变化回给你：

```vue
<!-- 受控：值由外部持有，组件写 SDK + 回写 -->
<Map v-model:center="center" :zoom="12" />
```

只想给初值、不想自己维护状态时用非受控写法，交互后的回执仍然有（`default*` 档同样会 emit）：

```vue
<Map :default-zoom="12" @update:zoom="(z) => console.log(z)" />
```

三条要知道的行为：

- **回环抑制靠值、不靠来源标记**：SDK 回读现值与受控值按容差判等，父级把我们刚上报的值写回来
  时**一条命令都不发**。这让「用户拖拽 → 父级回写 → 收敛」这条闭环自然停下来，不依赖
  「事件是否恰好在这一帧内到达」；
- **`center` 不做深比较**：`center` 传对象，父级写内联字面量时引用每次都变，深比较会让受控写入
  空跑。传对象时库会做**防御性拷贝**（`{ lng, lat }` 拷一份），因此你原地改 `spot.lng = 5`
  不会顺手改到组件的初值快照上——但它也不会触发更新（引用没变），要改就换一个新对象；
- **回写载荷永远是 SDK 读回的具体坐标点**：`center` 初始可以是城市名（如 `'北京市'`），
  用户交互后 `update:center` 给的是 `{ lng, lat }`。

完整的字段表、`resetView()` 与相等判定口径见
[Map 地图](../components/map) 的「受控 / 非受控视野」一节；
这套原语本身对业务侧开放，见 [`useControllableState`](../hooks/useControllableState)。

## 状态插槽：不必去监听内部运行时

`<Map>` 的加载与错误是**插槽**，不是「注册一个 watcher 再猜状态」：

```vue
<Map ak="百度地图ak">
  <template #loading="{ status, containerReady }">
    <p>{{ containerReady ? '地图加载中…' : '容器还没展开' }}</p>
  </template>
  <template #error="{ error, retry }">
    <p>加载失败：{{ error }}</p>
    <button @click="retry()">重试</button>
  </template>
</Map>
```

`#loading` 与 `#error` 收到**同一份**载荷，四个字段一次给全：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `MapStatus` | `idle` / `waiting-client` / `creating` / `initializing` / `ready` / `error` / `disposing` / `disposed` |
| `error` | `unknown` | 结构化错误（`status === 'error'` 时非空；通常是 `BMapError`） |
| `containerReady` | `boolean` | 容器门禁是否放行（区分「容器还没展开」与「SDK 在加载」） |
| `retry` | `() => Promise<MapReadyContext>` | 重试加载：并发共享同一次启动；容器不可用时保持 pending |

- `#loading` 在 `status !== 'ready'` **且** `status !== 'error'` 时渲染；
- `#error` 在 `status === 'error'` 时渲染（自带文案带一个「重试」按钮）；
- **默认插槽的载荷不变**：`{ status, map, error, client }`。

插槽的取舍是明确的：业务只判**状态**，不判 SDK 进度条百分比（官方没有公开的加载进度事件，
合出一个「0~100」是假接口）。

`<BMapProvider>` 也有 `loading` / `error` 插槽，但载荷**更少**——它没有容器，因此没有
`containerReady`：

```vue
<BMapProvider :ak="ak">
  <template #loading="{ status }">SDK 加载中…</template>
  <template #error="{ error, retry }">
    <button @click="retry()">加载失败：{{ error }}，点击重试</button>
  </template>
  <RouterView />
</BMapProvider>
```

两者在非 `loading` / `error` 状态下都渲染**默认插槽**（`<Map>` 的载荷是
`{ status, map, error, client }`，`<BMapProvider>` 的载荷是 `{ status }`），所以把
`<RouterView />` 放进默认插槽即可。

## 命令式：组件 `ref` 上的只读命令面

需要命令式控制时，用组件 `ref` 暴露的命令面——它**不是** SDK 实例的同形镜像，只包含本库
承诺过的操作：

```ts
const mapRef = useTemplateRef<InstanceType<typeof Map>>('mapRef')
mapRef.value?.panTo({ lng: 116.4, lat: 39.9 })
mapRef.value?.setZoom(15)
```

**未就绪时的契约**很明确：读命令给 `null`、写命令是**空操作**（不排队、也不会在就绪后
重放）。需要确定性时先 `await whenReady()`。SDK 调用失败照常抛出，不降级成 `null`。
完整命令表见[Map 地图](../components/map)，需要 raw 实例见[扩展契约](./advanced)。

## 事件：订阅固定，不随模板变化重绑

`@click` / `@moveend` / `@zooming` 这类 map 事件在地图就绪时**一次订全部**，不随改绑监听器
变化重新订阅——因为 Vue 不会因为 emit listener 变化而重渲染子组件，「改绑就重订」在
组件树上拿不到等价收益，却会让解绑窗口出现漏事件。`mousemove` / `touchmove` / `dragging` /
`moving` / `zooming` 一帧最多提交一次（取该帧最后一次的载荷），`mousewheel` **刻意不合帧**
（滚轮是离散输入，每次都有自己的方向，压帧会丢掉「先放大再缩小」）。

需要在 `setup` 里按条件订阅、或订阅「别处的地图」时，用
[`useMapEvent`](../hooks/useMapEvent)；要在组件外读中心点 / 缩放 / 边界 / 移动中，用
[`useMapStatus`](../hooks/useMapStatus)。完整事件清单见[组件事件](./com-events)。

::: warning 组件内部不要自己拼 driver
组件 / composable 只依赖项目领域类型与 Facet Driver。需要 raw SDK 地图时走 `./advanced` 的
`unwrapRaw()`，不要在业务代码里读内部句柄——那是逃生口，不是常规路径。
:::

## 大数据量：`shallowRef` / `markRaw` 与 `dataVersion`

数据组件（`MarkerList` / `MarkerCluster` / `PointCollection` / `PointIconLayer` / `PointLayer`）
用**一个组件**管理一批数据：内部做 keyed diff、合帧与资源释放，不会为每个数据项创建 Vue 组件。

两条必须知道的规则：

| 你做了什么 | 会发生什么 |
| --- | --- |
| 换一个新数组 | keyed diff：新增的建资源、消失的摘资源、坐标变了的项更新位置 |
| 原地改内容（`list[0].lng = 1`） | **不产生任何 SDK 调用**——`data` 只按引用比较 |
| 原地改内容 + 递增 `dataVersion` | 逐项重新读取并下发（不依赖引用比较） |
| 什么都不改，父级重新渲染 | **不产生任何 SDK 调用**（同一引用 + 同一版本 = 短路） |

所以 `dataVersion` 不是可选优化，而是「原地改」这条路径的**必需一环**：

```vue
<script setup lang="ts">
import { markRaw, shallowRef } from 'vue'

const stations = shallowRef<Station[]>([])
const version = ref(0)

function moveFirst() {
  stations.value[0]!.lng += 0.001
  version.value += 1   // 引用没变 ⇒ 必须显式告诉组件重新读
}
</script>
```

`shallowRef` / `markRaw` 解决的是**另一个**问题：数据组件处理这批数据时会逐项读取它，
`ref([...])` / `reactive([...])` 的深响应数组会让每个字段的读取都穿过 Proxy 并做依赖收集，
代价随规模上升。

::: warning `markRaw` 不会把已经存在的 Proxy 还原成 raw
收益成立的**前提**是：传给地图组件的数组与其 item 在进入 Vue 深响应系统**之前**就是 raw /
不可变的。`markRaw(list.value)` 返回的仍是那个 reactive Proxy，`markRaw([...list.value])`
展开出的每个 item 也仍是 Proxy。若同一份数据还要给模板做深响应，应**从原始数据源分别构造**
一份 reactive 状态与一份 raw snapshot，而不是把现有 Proxy 容器再 `markRaw` 一次。
:::

读数口径与逐组件代价见[数据组件](../components/data) 的「大数据量」一节。

## 多实例、Teleport 与 KeepAlive

### 多张地图

多个 `<Map>` 各自持有独立的运行时与容器，互不干扰（[Map 地图](../components/map) 顶部的
「多实例」示例就是两张并排的地图）。需要按子树切 Client 时用 `<BMapProvider>`——查找顺序是
`client` prop > `definition` prop > `provider/ak/apiUrl` props > 最近的 `<BMapProvider>` >
`app.use()` 默认定义，详见[配置](./config)。

要操作「别处那张地图」时，把句柄显式传给订阅面，别依赖 `inject` 的最近祖先：

```ts
const { map, client } = await whenReady()
useMapEvent('click', handler, { source: { map, client } })
```

::: warning 一个 realm 只能有一份 SDK 全局
同配置可以共享，不同配置（不同 `ak` / 入口）会被显式拒绝为
`BMAP_SDK_CONFIG_CONFLICT`——多个 `<Map>` 指的是多个**地图实例**，不是多份 SDK。
:::

### Teleport

`<InfoWindow>` 的**组件根就是 `<Teleport>`**：内容节点由 SDK 持有，Vue 的渲染子树被 Teleport
到那块宿主上，因此 SDK 搬动宿主时不会动到 Vue 管理的节点树。两个推论：实例的 `$el` **不指向**
内容节点；服务端渲染的 HTML 里**不含**气泡内容（SSR 期不渲染 slot、不创建宿主）。

需要从外部定位气泡内容时用宿主上的 `data-bmap-infowindow-content` 属性。

### KeepAlive

`<Map>` 在 `deactivated` 时**默认不销毁** WebGL 地图（`keepAliveBehavior="suspend"`），
只暂停高频计算；`activated` 时自动恢复并补偿一次 `checkResize()`。

```vue
<Map ak="百度地图ak" keepAliveBehavior="suspend" />
```

设为 `"dispose"` 时，`deactivated` 会销毁地图并释放容器观察器（尺寸 / 视口 / 页面前后台 /
减少动画偏好的监听都挂在地图实例的资源作用域上）——组件还在 `<KeepAlive>` 的 cache 里，
但地图相关资源已经归零，`activated` **不会复活它**（需要重新挂载）。

::: tip 暂停是一个「原因集合」，不是一个开关
`expose.suspend()` / `resume()` 按原因记账：只有原因集合**变空**才真正恢复。页面前后台
（`document`）、容器离开视口（`offscreen`）、`<KeepAlive>` 停用（`keep-alive`）各记一笔，
你的手动暂停（`user`）**独立记账**——别的原因怎么变都不会把它摘掉。这条也意味着「切到后台再
回来」不会让你的手动暂停失效。完整原因表见[Map 地图](../components/map)。
:::

## 一句话对照

| 你想做的事 | 本库的做法 |
| --- | --- |
| 让外部持有视野 | `v-model:center` / `v-model:zoom` / `v-model:heading` / `v-model:tilt` |
| 让标记跟手拖动 | `v-model:position`（仅 `Marker`） |
| 只给一个初始视野 | `:default-center` / `:default-zoom` / `:default-heading` / `:default-tilt` |
| 展示加载 / 错误态 | `#loading` / `#error` 插槽 |
| 渲染气泡内容 | 默认插槽（`<InfoWindow>` 的根是 `<Teleport>`） |
| 一次管理一批点 | `data` + `itemKey` + `getPosition` + `dataVersion` |
| 卸载时释放资源 | 组件自己负责，不需要在 `onUnmounted` 里手写 |
