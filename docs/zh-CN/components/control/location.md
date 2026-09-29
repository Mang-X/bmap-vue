# LocationControl 定位控件

浏览器定位控件（官方 `GeolocationControl`），默认位于地图右下角。控件包含一个定位按钮与
按钮右侧的定位结果地址区。

```ts
import { LocationControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/location
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                     |
| ------ | -------------- | ------------------------- | ----------------- | -------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_RIGHT` |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`         |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件。

## 定位选项

官方 `GeolocationControlOptions` 除 `anchor` / `offset` 外的全部七个选项。它们**全部是构造期**：
官方对这一族只给了一个整袋入口 `setOptions(options)`，没有逐字段 setter，因此任何一个变化都会
**重建控件**并把新值交给构造期。

| 属性 | 说明 | 类型 | 官方默认值 |
| --- | --- | --- | --- |
| showAddressBar | 是否显示定位信息面板 | `boolean` | `true` |
| enableAutoLocation | 添加控件时是否自动定位一次 | `boolean` | `false` |
| locationIcon | 自定义定位中心点的图标 | [`MarkerIcon`](#markericon) | SDK 默认 |
| watchPosition | 是否持续跟踪用户位置 | `boolean` | `false` |
| useCompass | 是否使用设备指南针定向（仅 iOS 生效） | `boolean` | `false` |
| autoZoom | 定位成功后是否自动调整级别 | `boolean` | `true` |
| autoViewport | 定位成功后是否自动调整视野 | `boolean` | `true` |
| onLocationStart | 接管定位流程的回调 | `(onSuccess, onFail) => boolean \| void` | - |

`locationIcon` 收的是**图标描述**（与 `<Marker icon>` 同构：内置图标名或 `{ imageUrl, size, anchor, … }`）
而不是官方类型声明里的 `BMap.Icon` 实例——组件面不接触 SDK 对象。

`onLocationStart` 返回 `false` 时**不再执行定位**。本库**不**替你把它的 `onSuccess` / `onFail`
转调成 `locationSuccess` / `locationError` 事件：官方没有给「这次定位属于哪次命令」任何身份，
转调只能靠猜。

::: warning `watchPosition` 与「卸载」不是同一件事
`watchPosition: true` 是**持续跟踪**（官方 `stopLocationTrace()` 可以停），
它和组件的卸载流程无关：组件卸载照常走标准的控件释放路径。
:::

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

| 事件名 | 说明 | 载荷 |
| --- | --- | --- |
| locationSuccess | 定位成功时触发 | [`LocationSuccessEvent`](#locationsuccessevent) \| `null` |
| locationError | 定位失败时触发 | [`LocationErrorEvent`](#locationerrorevent) \| `null` |

载荷取不到时为 `null`——不编一个 `{ lng: 0, lat: 0 }` 冒充定位成功。

### LocationSuccessEvent

| 字段 | 说明 | 类型 |
| --- | --- | --- |
| point | 定位到的坐标 | `Point` |
| addressComponent | 地址组成部分；官方声明即可空 | [`LocationAddressComponents`](#locationaddresscomponents) \| `null` |

### LocationErrorEvent

| 字段 | 说明 | 类型 |
| --- | --- | --- |
| code | 官方错误码 | `number` |

官方只声明了 `code: number`，**没有**任何可对照的取值清单，因此本库不替你编一张错误码枚举表。

### LocationAddressComponents

官方 `AddressComponent` 的五个成员，**全部可选**——取不到就留在 `undefined`，不补默认值
（补成 `""` 会把「上游没给」与「真的是空」混起来）。

| 字段 | 说明 | 类型 |
| --- | --- | --- |
| streetNumber | 门牌号 | `string`（可选） |
| street | 街道名 | `string`（可选） |
| district | 区县 | `string`（可选） |
| city | 城市 | `string`（可选） |
| province | 省份 | `string`（可选） |

### MarkerIcon

`<LocationControl location-icon>` 收的是 `<Marker icon>` 的同一套图标描述，二选一：

- **内置图标名**（字符串），例如 `"simple_red"` / `"start"` / `"red1"` … `"red10"` /
  `"blue1"` … `"blue10"` / `"loc_red"` / `"loc_blue"` / `"location"` / `"end"`；
- **自定义图标描述** `{ imageUrl, size, anchor?, imageOffset?, imageSize?, printImageUrl? }`，
  其中 `size` 是 `{ width, height }`。

完整取值与字段说明见 [Marker 的「自定义图标」](../overlay/marker.md#自定义图标)。


## 命令面（`ref`）

组件通过 `defineExpose` 暴露官方 `GeolocationControl` 的**动作**与**读回**成员。
「改 prop」**不算**这些方法——`location()` 是动作（没有对应 prop），
`getAddressComponent()` 是读回（组件永远不会替你读一次）。

| 命令 | 官方声明 | 说明 |
| --- | --- | --- |
| `location()` | `location(): void` | 开始进行定位 |
| `startLocation()` | `startLocation(): void` | 开始执行定位 |
| `stopLocationTrace()` | `stopLocationTrace(): void` | 停止跟踪用户位置 |
| `getAddressComponent()` | `getAddressComponent(): AddressComponent \| null` | 当前定位地址信息（[见上](#locationaddresscomponents)） |
| `status` | — | 实例状态：`idle` / `creating` / `ready` / `error` / `disposing` / `disposed` |

```vue
<script setup lang="ts">
import { ref } from "vue";
import { LocationControl } from "bmap-vue";
import type { ControlCommandTypes } from "bmap-vue";

const loc = ref<ControlCommandTypes["LocationControl"]>();

function start() {
  try {
    // 未就绪 / 已释放时这里会抛 BMAP_RESOURCE_DISPOSED，不会静默 no-op
    loc.value?.location();
  } catch {
    return; // 控件还没就绪，忽略这一次点击
  }
  const address = loc.value?.getAddressComponent();
  // address 为 null 表示**尚未定位**（官方声明即可空）
}
</script>
```

::: tip 想先看状态再调
组件还 expose 了一个 `status`（`idle` / `creating` / `ready` / `error` / `disposing` / `disposed`），
可以先判 `status === "ready"` 再调，避免依赖 catch。
:::

### ⚠️ 没有 `startLocationTrace()`

官方只声明了 `startLocation()`（开始定位）与 `stopLocationTrace()`（停止跟踪）——
两者**不对称**，但这就是上游的形状。社区文档里常见的 `startLocationTrace()`
**在官方类型声明与真实运行时里都不存在**。

### 释放后显式失败

未就绪、重建窗口内或已释放时，命令抛 `BMAP_RESOURCE_DISPOSED`——
**不**静默返回 `undefined`。因此调用前应先看 `status`（`ready` 之外的状态都调不了命令）。

### 载荷投影

`getAddressComponent()` 返回的是**领域类型** `LocationAddressComponents`（见上文
[LocationAddressComponents](#locationaddresscomponents)），官方 `AddressComponent` 的五个成员
**全部可选**，取不到就留在 `undefined`。
