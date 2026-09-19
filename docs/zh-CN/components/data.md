---
title: 数据组件
---

# 数据组件

数据组件用**一个组件**管理一批数据：它们内部做 keyed diff、合帧与资源释放，不会为每个数据项
创建 Vue 组件，也不会为每个数据项挂 watcher。

## 先选对组件（边界就是「落地成几个 SDK 资源」）

| 场景 | 组件 | SDK 资源 |
| --- | --- | --- |
| 中小规模、需要逐点交互 | `BMarkerList` | **每项一个 Marker** |
| 空间上邻近的点需要聚合 | `BMarkerCluster` | 每个簇（或未聚合的单点）一个 Marker |
| 大规模散点（千级以上） | `BPointCollection` | **整批只有一个原生图层** |

> `BPointCollection` 用的是 JSAPI 4.0 的**原生批量点图层**（`BMap.PointShapeLayer`）。
> v3 时代那个同名的 `BMap.PointCollection` 类在 4.0 的**类型包里没有声明**，但**运行时仍然存在**
> （本库探针实测 `typeof BMap.PointCollection === "function"`）；本库按 official-first 只使用
> **两处都声明**的等价 API，所以这里的「Collection」表达的是业务语义（一批点），不是那个类的包装。

三个组件的**取数面完全一致**，业务数据可以在它们之间平移：

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `data` | 数据数组（只按**引用**比较） | `readonly Item[]` |
| `itemKey` | 唯一键：属性名或取值函数 | `keyof Item \| ((item: Item) => PropertyKey)` |
| `getPosition` | 取坐标；返回 `null` / `undefined` = 这一项没有位置 | `(item: Item) => { lng: number; lat: number } \| null \| undefined` |
| `dataVersion` | **引用不变、内容变了**时递增它 | `PropertyKey` |
| `visible` | 是否显示（`false` = 隐藏，不是删掉） | `boolean`，默认 `true` |

## `Item` 类型会原样保留

三个组件的 `Item` 都从 `data` 推断，事件载荷就是你的业务类型：

```vue
<script setup lang="ts">
import { ref } from 'vue'

interface Station {
  id: string
  lng: number
  lat: number
  name: string
}
const stations = ref<Station[]>([])

function onItemClick(station: Station) {
  // station.name 是 string —— 不是 any / unknown
  void station.name
}
</script>

<template>
  <BMarkerList
    :data="stations"
    item-key="id"
    :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
    @item-click="onItemClick"
  />
</template>
```

生效范围要说准：**模板里**推断是完整的（消费方 fixture `fixtures/v3-consumer/src/data-components.vue`
用 `vue-tsc` 钉住）；用 `h()` 编程式构造时 `Item` 推不出来（vue-tsc 为泛型组件生成的 props 形状
无法反推类型参数，带不带 `withDefaults` 都一样），那时请用公开的 props 类型显式标注：
`BMarkerListProps<Station>` / `BMarkerClusterProps<Station>` / `BPointCollectionProps<Station>`。

## 数据更新语义

| 你做了什么 | 会发生什么 |
| --- | --- |
| 换一个新数组（`data.value = list.map(...)`） | keyed diff：新增的建资源、消失的摘资源、**坐标变了**的项更新位置 |
| 原地改内容（`list[0].lng = 1`）+ 递增 `dataVersion` | 逐项重新读取并下发（不依赖引用比较） |
| 什么都不改，父级重新渲染 | **不产生任何 SDK 调用**（同一引用 + 同一版本 = 短路） |
| 内联回调（`:get-position="(item) => ..."` 每次渲染都是新函数） | 也不会产生多余调用：函数按**源码**折叠；换的是闭包里的值时请递增 `dataVersion` |
| 某一次 SDK 调用失败（创建 / 移动 / 摘除抛错） | 那一项**不记账**，下一次同步会重试；失败项的所有权保留（不会为同一个 key 再建一份） |

坏数据不会让整层消失，但**一定会被点名**（开发期告警，按原因聚合计数、不刷屏）：

- `itemKey` 取不到可用的 key（`undefined` / `null` / `NaN`）⇒ 跳过该项；
- `getPosition` 不是合法坐标（缺字段 / `NaN` / `±Infinity` / 超出经纬度范围）⇒ 跳过该项；
  **`(0, 0)` 是合法坐标**，不会被当作「缺失」；
- 同一批数据里 key 重复 ⇒ **后者胜**（重复 id 的行为官方没有声明，因此不能交给 SDK）；
- `properties()` 里写了 id 字段 ⇒ 被要素身份覆盖并告警（否则拾取回来的 key 与业务项对不上）。

## `BMarkerList`

```vue
<BMarkerList
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  @item-click="onItemClick"
/>
```

| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `data` / `itemKey` / `getPosition` / `dataVersion` / `visible` | 见上表 | - |

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `item-click` | 某个 Marker 被点击 | **最新的**业务 item（`Item`） |

「最新」不是装饰：点完一次之后父级重新渲染、把 item 换成新对象是常态，事件回调读的是内部账本
（`key → 最新 item`），不是创建 Marker 那一刻闭包里的旧对象。

`visible=false` 用覆盖物自身的 `show` / `hide`（隐藏 ≠ 摘掉：资源、账本与「最新 item」都留着）。

## `BMarkerCluster`

```vue
<BMarkerCluster
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  :grid-size="64"
  :min-cluster-size="3"
  @cluster-click="onClusterClick"
  @item-click="onItemClick"
/>
```

| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `gridSize` | 像素网格边长 | `128` |
| `minClusterSize` | 达到该数量才聚合；不足的点展开为独立 item | `3` |
| `zoom` | 聚合使用的 zoom；未提供时**在每次聚合计算时**读一次地图当前 zoom（读不到时用 `8`，并告警一次）。地图缩放变化**不会**自动重算汇聚 | - |

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `cluster-click` | 聚合簇被点击（`size >= minClusterSize`） | 最新的簇对象（`points` 是业务项数组） |
| `item-click` | 未聚合的单点被点击 | 最新的业务 item |

坏数据在**聚合之前**就被过滤：非法坐标进了聚合会把整桶的平均值污染成 `NaN`，一个坏点会让同桶的
好点一起消失。展开的单点用**业务 key** 当 id，因此不同桶的单点不会互相顶掉。

## `BPointCollection`

```vue
<BPointCollection
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  :properties="(s) => ({ name: s.name, level: s.level })"
  :shape="0"
  :size="18"
  color="#1677ff"
  @item-click="onItemClick"
  @click="onPick"
/>
```

| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `properties` | 写进每个要素 `properties` 的属性映射 | - |
| `shape` / `size` / `color` / `strokeColor` / `strokeWeight` | 点样式（官方 `PointShapeStyle` 的子集） | SDK 默认 |
| `opacity` / `zIndex` / `minZoom` / `maxZoom` | 透明度 / 层级 / 缩放范围 | SDK 默认 |
| `enablePicked` | 是否开启鼠标拾取 | **`true`**（官方默认 `false`，这里刻意不同） |
| `pickWidth` / `pickHeight` | 点击拾取矩形尺寸（像素） | 官方默认（30） |

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `item-click` | 命中某个要素 | 最新的业务 item |
| `click` | 图层级拾取（**含未命中**） | `BMapPointPick<Item>`：`{ hit, dataIndex, id, item, latLng, pixel }` |

未命中时官方**同样派发事件**（`dataIndex === -1`），因此 `click` 的 `hit` 为 `false`、`item` 为
`null`，而 `item-click` 不会派发。`id` 是命中要素的**业务身份**（`properties[idKey]`）；认不出时为
`null`（本库不按事件顺序 / 下标猜身份）。

## 要素状态（Feature State）

`BPointCollection` 通过组件 `ref` 暴露要素状态命令面，按业务 id（即 `itemKey` 指向的字段）定位：

```ts
const state = layer.value?.featureState
state?.update(["a"], { selected: true }, { append: true })
state?.get("a")   // { "a": { selected: true } } —— 读回 SDK 的当前值
```

五个命令 `update` / `remove` / `clear` / `replace` / `get` 与官方入口一一对应；身份口径、参数校验
与「未就绪不排队」的口径见[原生批量可视化图层](./layer/native-visual-layers) 的「要素状态」一节。

更新路径与逐点组件不同，但都在这一个实例上完成：

| 变化 | 路径 |
| --- | --- |
| `data` / `dataVersion` / `properties` | `setData()`（**不重建**） |
| `shape` / `size` / `color` / `strokeColor` / `strokeWeight` | 更新样式并**显式重绘**（官方口径：样式更新后不会自动重绘） |
| `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter（**不重建**，隐藏也不摘掉图层） |
| `itemKey` / `enablePicked` / `pickWidth` / `pickHeight` | **重建图层**（它们是构造期选项） |

`properties` 里不需要自己写 id：库里会把要素身份写进 `properties`（`itemKey` 是字符串时就是该
字段名，是函数时用保留字段 `__id`），并把它作为图层的 `idKey` —— 少了它，拾取回来的要素认不出
业务项。

## 资源释放

三个组件都随组件卸载释放全部资源（Marker 摘除 + 监听解绑；`BPointCollection` 还会把图层登记进
地图的图层账本，因此**即使地图先被销毁**，图层也会在 `map.destroy()` 之前被摘掉 —— 这条依赖
`<BMap>` 提供的 `MapContext.layers`；自定义 Context 没有它时组件退化为自持账本，只保证
「组件卸载」这条路径）。数据组件不持有跨组件的共享状态。
