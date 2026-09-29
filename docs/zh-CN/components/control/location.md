# LocationControl 定位控件

定位控件，默认位于地图右下角

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

| 属性    | 说明     | 类型      | 可选值 | 默认值 | 版本                               |
| ------- | -------- | --------- | ------ | ------ | ---------------------------------- |
| visible | 是否显示 | `boolean` | -      | `true` | <Badge type="tip" text="^2.2.0" /> |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件（M7-CONTROL-PANORAMA / #41 之前它们只在构造期生效）。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| locationSuccess | 定位成功时触发 | `(e: unknown) => void` |
| locationError | 定位失败时触发 | `(e: unknown) => void` |


## 命令面（`ref`）

组件通过 `defineExpose` 暴露官方 `GeolocationControl` 的**动作**与**读回**成员。
「改 prop」**不算**这些方法——`location()` 是动作（没有对应 prop），
`getAddressComponent()` 是读回（组件永远不会替你读一次）。

| 命令 | 官方声明 | 说明 |
| --- | --- | --- |
| `location()` | `location(): void` | 开始进行定位 |
| `startLocation()` | `startLocation(): void` | 开始执行定位 |
| `stopLocationTrace()` | `stopLocationTrace(): void` | 停止跟踪用户位置 |
| `getAddressComponent()` | `getAddressComponent(): AddressComponent \| null` | 当前定位地址信息 |
| `status` | — | 实例状态（见下） |

```vue
<script setup lang="ts">
import { ref } from "vue";
import LocationControl from "bmap-vue";

const loc = ref<InstanceType<typeof LocationControl>>();

function start() {
  if (loc.value?.status !== "ready") return; // 未就绪 / 已释放时不调
  loc.value.location();
  const address = loc.value.getAddressComponent();
  // address 为 null 表示**尚未定位**（官方声明即可空）
}
</script>
```

### ⚠️ 没有 `startLocationTrace()`

官方只声明了 `startLocation()`（开始定位）与 `stopLocationTrace()`（停止跟踪）——
两者**不对称**，但这就是上游的形状。社区文档与 issue 描述里常见的 `startLocationTrace()`
**在官方类型声明与真实运行时里都不存在**（live 读数：`startLocation` `callable: true`、
`startLocationTrace` `callable: false`）。

### 释放后显式失败

未就绪、重建窗口内或已释放时，命令抛 `BMAP_RESOURCE_DISPOSED`——
**不**静默返回 `undefined`。因此调用前应先看 `status`。

### 载荷投影

`getAddressComponent()` 返回的是**领域类型** `LocationAddressComponents`，
官方 `AddressComponent` 的五个成员（`streetNumber` / `street` / `district` / `city` /
`province`）**全部可选**，取不到就留在 `undefined`——**不补默认值**
（`city ?? ""` 会把「上游没给」与「空」混起来）。
