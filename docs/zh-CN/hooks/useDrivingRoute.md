# useDrivingRoute 驾车路线规划

基于百度 `DrivingRoute` 的 **headless** 驾车路线规划：给出起终点（可选途经点），拿到**强类型**的方案 /
路线 / 关键点，画与不画由你决定。

它**不提供任何 UI**（标准路线面板属于官方 UI Kit，见
[官方 UI Kit](../guide/ui-kit.md) 与下面的「与标准面板互斥」）。

```ts
import { useDrivingRoute } from "bmap-vue";
```

## 示例

:::demo 驾车路线规划 + 自己渲染方案列表
hooks/useDrivingRoute
:::

## 用法

```ts
const { data, status, sdkStatus, isLoading, supported, search, clear, cancel } =
  useDrivingRoute(options);
```

:::tip

- 本 hooks 只需要 **Client 上下文**：`<Map>` 或 `<BMapProvider>` 子树内都可用；
- **默认不绘制**。要绘制官方路线（路线折线 / 起点终点标注 / 自动视野）必须在
  `renderOptions.map` 里显式传 `MapHandle`（`<Map>` 的 `@ready` 或把 hooks 放进 `<Map>` 子树里用
  `useMap().map`），不传就是纯 headless；
- 卸载时 hooks 会自动**取消在飞请求并释放 SDK 实例**（`disposeRoute` → 官方公开的 `clearResults()`）。

:::

### 参数

| 参数    | 描述             | 类型                             | 默认值 |
| ------- | ---------------- | -------------------------------- | ------ |
| options | 构造期选项（见下） | `MaybeRefOrGetter<BMapDrivingRouteOptions>` | `{}`   |

`options` 的每个字段都可以是 ref / getter。**只有下列字段变化才会重建 SDK 实例**（反复调用
`search()` 不会重建——实例本身持有配置与**已画出的结果**，配置变了就必须换实例）：

| 字段          | 描述                                                                                     | 类型                                                    | 默认值 |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| location      | 检索区域：城市名字符串 / `{ lng, lat }` / `MapHandle`。不传时取当前 `<Map>` 的地图实例     | `MaybeRefOrGetter<string \| GeoPoint \| MapHandle \| undefined>` | -      |
| policy        | 驾车策略（`DrivingPolicy.*`）                                                              | `MaybeRefOrGetter<DrivingPolicy \| undefined>`            | `0`    |
| enableTraffic | 是否显示实时路况（官方 4.0 默认 `false`）。开启后按路况分段着色的折线不受折线样式配置影响    | `MaybeRefOrGetter<boolean \| undefined>`                  | `false`|
| renderOptions | 绘制选项（见下）。不传 = 纯 headless                                                       | `MaybeRefOrGetter<BMapRouteRenderOptions \| undefined>`   | -      |

#### BMapRouteRenderOptions

只透传官方声明里**存在且有语义**的成员（其余字段会被忽略：接收后忽略属于假支持）。

| 字段            | 描述                                                | 类型                                        | 默认值  |
| --------------- | --------------------------------------------------- | ------------------------------------------- | ------- |
| map             | 绘制目标：本库的 `MapHandle`（或它的 ref / getter；`null` = 现在没有绘制目标） | `MaybeRefOrGetter<MapHandle \| null \| undefined>` | -       |
| panel           | 结果列表容器（元素或 id）。官方 4.0.4 自述矛盾（`RenderOptions.panel` 的注释说驾车无效，`DrivingRoute.d.ts` 的官方示例却传了它），**真实 AK 实测驾车有效**，本库原样转发、不告警 | `string \| HTMLElement`                      | -       |
| autoViewport    | 检索结束后是否自动调整地图视野                       | `boolean`                                   | `false` |
| viewportOptions | 视野计算选项（`noAnimation` / `margins` / `zoomFactor`） | `object`                                     | -       |

### 返回值

状态与错误语义**与其它服务 hooks 完全一致**（见[统一状态口径](/zh-CN/guide/services#统一状态口径)）。

| 返回值     | 描述                                                             | 类型                                                     |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| data       | 路线结果（`start` / `end` / `plans` / `policy`）                  | `Readonly<ShallowRef<DrivingRouteResult \| null>>`         |
| status     | 任务状态（见下）                                                  | `Readonly<ShallowRef<BMapServiceStatus>>`                 |
| error      | 有公开原因时的错误信息（`{ code, message }`）                     | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`          |
| sdkStatus  | SDK 公开的状态码（`BMAP_STATUS_*`；成功为 `0`，拿不到时为 `null`） | `Readonly<ShallowRef<number \| null>>`                    |
| isLoading  | 是否在检索中                                                      | `Readonly<ShallowRef<boolean>>`                           |
| supported  | 当前引擎是否支持驾车路线规划（Client 就绪后立即判定）              | `Readonly<ShallowRef<boolean>>`                           |
| isError    | `status === 'failed'` 的别名                                      | `ComputedRef<boolean>`                                    |
| isEmpty    | `data === null` 的别名（失败、取消、`empty` 都是 `true`）          | `ComputedRef<boolean>`                                    |
| search     | 发起一次检索（见下）                                              | `(start, end, options?) => Promise<ServiceResult<…>>`     |
| clear      | 丢弃当前实例与结果：下一次 `search` 重建，且公开的 `clearResults()` 会收回地图上的路线与标注 | `() => void`                                  |
| cancel     | **逻辑取消**在飞检索（SDK 侧请求收不回），已画出的结果不动          | `() => void`                                              |
| reset      | 取消 + 清空 `data` / `error` / `status`                           | `() => void`                                              |

### search

```ts
const result = await search(start, end, { waypoints });
```

| 参数      | 描述                                                                                       | 类型                        |
| --------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| start/end | 起点 / 终点：`{ lng, lat }` 或 POI 引用 `{ uid, point, name? }`。**驾车不接受地名**（官方 `DrivingRoute#search` 的签名里没有 `string`），要按地址出发请先用 `useGeocoder` / `useLocalSearch` 取坐标或 POI | `DrivingRouteEndpoint`      |
| waypoints | 途经点坐标数组（**只有驾车支持**）                                                           | `readonly Point[]`          |

返回的 `ServiceResult` **恒 resolve**（不 reject）：失败 / 超时 / 取消都在 `status` 里。

## 与标准面板互斥

标准路线面板由官方 UI Kit 的 `RoutePlan` 提供（`bmap-vue/ui-kit`，见
[官方 UI Kit](../guide/ui-kit.md)）。它**自己发请求、自己画**；本 hooks 是「完全自定义 UI」那条路。

**同一次界面操作只走其中一条**——两条都接上会让一次点击发出两次检索（多花一次配额，还可能让面板与
你的列表显示不同的结果）。

::: code-group

```vue [用标准面板（UI Kit）]
<script setup lang="ts">
import { ref } from "vue";
import { RoutePlan } from "bmap-vue/ui-kit";
import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css";

const plan = ref();
async function go() {
  await plan.value.search({ start: "天安门", end: "北京西站" });
}
</script>

<template>
  <RoutePlan ref="plan" />
</template>
```

```vue [完全自定义 UI（本 hooks）]
<script setup lang="ts">
import { useDrivingRoute } from "bmap-vue";
const { data, status, search } = useDrivingRoute({ location: "北京市" });
</script>

<template>
  <button @click="search({ lng: 116.391, lat: 39.91 }, { lng: 116.431, lat: 39.931 })">
    规划驾车路线
  </button>
  <p v-if="status === 'empty'">没有可用路线</p>
  <ul v-else-if="data">
    <li v-for="plan in data.plans" :key="plan.index">
      {{ plan.distanceText }} · {{ plan.durationText }}
    </li>
  </ul>
</template>
```

:::

### 让服务自己画到地图上

`renderOptions.map` 必须是本库的 `MapHandle`，而地图句柄只能从 `<Map>` 的子树里拿到
（`useMap()`）——因此把路线 hooks 放进一个子组件：

```vue
<!-- Parent.vue -->
<template>
  <Map :center="{ lng: 116.404, lat: 39.915 }">
    <RouteOverlay :from="from" :to="to" />
  </Map>
</template>
```

```vue
<!-- RouteOverlay.vue：在 <Map> 子树里，能拿到地图句柄 -->
<script setup lang="ts">
import { useMap, useDrivingRoute } from "bmap-vue";

const props = defineProps<{ from: Point; to: Point }>();
const { map } = useMap();
// 传了 map 就是「让服务自己画」：路线与标注由服务持有，clear() / 卸载时由公开的
// clearResults() 收回（所有权可验证）。
const { search } = useDrivingRoute({ renderOptions: { map, autoViewport: true } });
search(props.from, props.to);
</script>

<template><span /></template>
```

## 语义细节

- **归属靠实例身份**：驾车（以及其余三个路线服务）的回包没有请求身份，官方也没有承诺多次请求之间的
  回调顺序，因此同一个实例同一时刻只允许一个未结算检索——并发会被**显式拒绝**（`failed`）；
  新检索取代在飞检索时会**换新实例**，所以「快速重复检索」是最新者胜，旧的迟到回包不会污染新结果。
- **`cancel()` 与 `clear()` 是两件事**：`cancel()` 只放弃在飞请求的结果（已经画出来的路线不动）；
  `clear()` 释放实例——顺带用公开的 `clearResults()` 把地图上的路线与标注收回来。
- **`empty` 与 `failed` 的区别是「能不能重试」**：没有可用方案 ⇒ `empty`；只有官方给出公开状态码
  （`≥ 3`）才 `failed`。官方的 `getStatus()` 有两套互相重叠的码表（`ServiceStatus` 与 `RouteStatus`
  在 `0..2` 区间语义不同），那一段本库不猜，统一按 `empty` 处理。
