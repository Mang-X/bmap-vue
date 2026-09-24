---
title: 数据组件
---

# 数据组件

数据组件用**一个组件**管理一批数据：它们内部做 keyed diff、合帧与资源释放，不会为每个数据项
创建 Vue 组件，也不会为每个数据项挂 watcher。

## 先选对组件（边界就是「落地成几个 SDK 资源」）

| 场景 | 组件 | SDK 资源 |
| --- | --- | --- |
| 中小规模、需要逐点交互 | `MarkerList` | **每项一个 Marker** |
| 空间上邻近的点需要聚合 | `MarkerCluster`（默认） | **整批一个原生聚合图层**（`BMap.ClusterLayer`） |
| 同上，但**事件里要有簇内业务项** | `MarkerCluster engine="markers"` | 每个簇 / 未聚合的单点一个 Marker |
| 大规模散点，画几何图形 | `BPointShapeLayer` | **整批一个原生图层**（`BMap.PointShapeLayer`） |
| 大规模散点，画图标 | `PointIconLayer` | **整批一个原生图层**（`BMap.PointIconLayer`） |
| 同一层里「有图标就用图标、没有就画图形」 | `PointLayer` | **整批一个原生图层**（`BMap.PointLayer`，扩展 API） |

> 三个点图层组件落在**官方原生批量点图层**上：前两个（`PointShapeLayer` / `PointIconLayer`）在
> `@baidumap/jsapi-v4-types@4.0.4` 里有完整类声明；`PointLayer` 用的 `BMap.PointLayer` 属官方
> **扩展 API**（运行时存在、类型包没有类声明、可视化实现按需异步注入），因此它被标为
> `experimental`：能力就绪之前创建会**显式失败**（`BMAP_CAPABILITY_UNSUPPORTED`，经 `resource:error`
> 交出），**不会**自动改用另外两个类 —— 它们是不同的 SDK 能力，偷偷换等于改掉你的意图。
> v3 时代那个 `BMap.PointCollection` 类在 4.0 的**类型包里没有声明**（运行时仍然存在，本库探针实测
> `typeof BMap.PointCollection === "function"`），本库按 official-first 只使用**两处都声明**的等价 API。

所有数据组件的**取数面完全一致**，业务数据可以在它们之间平移：

| 属性 | 说明 | 类型 |
| --- | --- | --- |
| `data` | 数据数组（只按**引用**比较；**大数组建议 `shallowRef` / `markRaw`**，见下文「大数据量」） | `readonly Item[]` |
| `itemKey` | 唯一键：属性名或取值函数 | `keyof Item \| ((item: Item) => PropertyKey)` |
| `getPosition` | 取坐标；返回 `null` / `undefined` = 这一项没有位置 | `(item: Item) => { lng: number; lat: number } \| null \| undefined` |
| `dataVersion` | **引用不变、内容变了**时递增它 | `PropertyKey` |
| `visible` | 是否显示（`false` = 隐藏，不是删掉） | `boolean`，默认 `true` |

> `PointCollection` 在 3.0 发布前更名为 `BPointShapeLayer`（它是**未发布** changeset 里的新增，
> 因此**没有**留弃用别名）。改名的理由是三个组件的名字要能一眼看出各自落在哪个 SDK 类上。

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
  <MarkerList
    :data="stations"
    item-key="id"
    :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
    @item-click="onItemClick"
  />
</template>
```

生效范围要说准：**模板里**推断是完整的（消费方 fixture `fixtures/consumer/src/data-components.vue`
用 `vue-tsc` 钉住）；用 `h()` 编程式构造时 `Item` 推不出来（vue-tsc 为泛型组件生成的 props 形状
无法反推类型参数，带不带 `withDefaults` 都一样），那时请用公开的 props 类型显式标注：
`MarkerListProps<Station>` / `MarkerClusterProps<Station>` / `BPointShapeLayerProps<Station>` /
`PointIconLayerProps<Station>` / `PointLayerProps<Station>`。

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

## 大数据量：`shallowRef` / `markRaw`

数据组件的 `data` 只按**引用**比较，但组件处理这批数据时会**逐项读取**它。走 `adaptPoints`
（`Item[]` → `FeatureCollection`）的路径包括 `PointCollection` / `PointIconLayer` / `PointLayer`
与 `MarkerCluster` 的 `native` 引擎；`MarkerList` 与 `MarkerCluster` 的 `markers` 引擎走
`DataLayerManager` 的 keyed diff / 网格聚合。只要 `data` 是 Vue 的**深响应**数组——`ref([...])` /
`reactive([...])` 是最常见的写法——逐项读取时每个字段都要穿过 Proxy 并做**依赖收集**，代价随规模
上升。**「深响应读取显著更贵」这条结论适用于所有复用 `adaptPoints` 的路径**（函数级成本分解见 ADR）。

**组件整链路的具体读数只在 `PointCollection` 上测过**（50k 换一次引用）：深响应输入在组件路径里要
**0.1 ~ 0.2s**（越过浏览器 50ms 长任务线），同一份数据换 `shallowRef` / `markRaw` 只要 **10 ~ 26ms**。
这组数字含 watch / render effect / 资源同步 / `setData` 的整链路，**不要外推到其它组件**；
`MarkerCluster` 的 `native` 引擎虽然复用同一个 `adaptPoints`，但其 `ClusterLayer` 整链路
**未单独取证**。

大数据量建议把**原始（未被深响应化）的**数据源换成 `shallowRef` / `markRaw`（Vue 只跟踪引用本身，
不再代理每一项）：

```vue
<script setup lang="ts">
import { markRaw, ref, shallowRef } from 'vue'

interface Station { id: string; lng: number; lat: number; name: string }

const stations = shallowRef<Station[]>([])
const version = ref(0)

function replace(next: Station[]) {
  // markRaw 让这份数据整体退出响应式系统；换引用本身仍被 shallowRef 感知
  stations.value = markRaw(next)
}

function moveFirst() {
  stations.value[0]!.lng += 0.001
  // 原地改内容不会换引用 ⇒ 必须递增 dataVersion 让组件重新读取（既有契约）
  version.value += 1
}
</script>

<template>
  <PointCollection
    :data="stations"
    :data-version="version"
    item-key="id"
    :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  />
</template>
```

> 示例用**当前 head 实际导出的** `PointCollection`；它在未发布的 3.0 命名里叫 `BPointShapeLayer`
> （见上文「先选对组件」的说明）。1.0 的公共 API 命名对齐（[#135](https://github.com/Mang-X/bmap-vue/issues/135)）
> 完成后，文档会统一改成新名。

边界与代价：

- `shallowRef` / `markRaw` 之后，**原地改内容**（`stations.value[0].lng = …`）不会自动被感知——这与
  现有契约一致（`data` 只按引用比较）：原地改请递增 `dataVersion`。用深响应数组时本来也得靠它
  （组件不 watch 大数组的深层变化），所以这**不是**新增的约束。
- **要拿到这里的收益，传给地图组件的数组与其 item 必须在进入 Vue 深响应系统之前就是 raw / 不可变的。**
  `markRaw` / `shallowRef` 只阻止**后续**的深代理转换，**不会把已经存在的 Proxy 还原成 raw**：
  `markRaw(list.value)` 返回的仍是那个 reactive Proxy，`markRaw([...list.value])` 展开出的每个 item
  也仍是 Proxy——两种情况 `adaptPoints` 逐项读 `item.lng` 时照旧走 Proxy get（以及 effect 内的
  tracking），收益不成立。若同一份数据还要给模板做深响应，应**从原始数据源分别构造**一份 reactive
  状态与一份 raw / plain snapshot，而不是把现有 Proxy 容器再 `markRaw` 一次。

依据与实测口径见 ADR [深响应大数组的更新路径](/adr/2026-09-24-deep-reactive-array-update-path)；同一份
对照在 `tests/performance/component-path.perf.test.ts` §5 是常驻用例。

## `MarkerList`

```vue
<MarkerList
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

## `MarkerCluster`

```vue
<MarkerCluster
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  :cluster-radius="60"
  @cluster-click="onClusterClick"
  @item-click="onItemClick"
/>
```

两个引擎，**默认原生**：

| `engine` | 落地成什么 | `cluster-click.items` |
| --- | --- | --- |
| `"native"`（默认） | 一个原生 `ClusterLayer`（WebGL 渲染） | **`null`**（官方拿不到） |
| `"markers"` | 网格聚合 + 每簇 / 每单点一个 Marker | 业务项数组 |

为什么默认原生：本库在真实 4.0 上取过证（`scripts/probe-native-point-cluster.mts`）——原生
`ClusterLayer` 的构造 / 挂载 / `setData` / 聚簇产出（`change` 事件）/ 簇命中 / 单点命中全部可用，
选项也真的被采纳。所以「原生缺了、要用自研兜底」这条缺口**不成立**。

那 `engine="markers"` 为什么还留着：它**多给一样东西** —— 簇内的业务项。原生引擎拿不到：
官方在命中载荷里只给簇的元数据（`clusterId` / `pointCount` / `bbox`），
`getClusterLayer().getItems()` 也只有簇级条目。所以它是**显式选择**（「我要业务项，接受每簇一个
Marker 的代价」），不是自动降级。

| 属性（`engine: "native"`） | 说明 | 默认值 |
| --- | --- | --- |
| `clusterRadius` | 聚合半径（像素，官方 `clusterRadius`） | 未提供时**不写这个选项**，用 SDK 的默认值（本库实测为 `60`，但那是实测、不是跨版本承诺） |
| `clusterMinPoints` | 达到该数量才聚合（官方 `clusterMinPoints`） | 同上（实测 `2`） |
| `clusterMinZoom` / `clusterMaxZoom` | 聚合生效的 zoom 范围（官方同名选项） | 同上（实测 `3` / `16`） |
| `fitViewOnClick` | 点击簇时缩放到该簇 | 同上 —— ⚠️ **官方默认是 `true`**（点簇会缩放地图）；不想缩放就显式传 `false` |
| `singleStyle` | 未参与聚合的单点样式（官方同名选项，**扁平**键名：`shape` / `size` / `fillColor` …） | 同上 |

| 属性（`engine: "markers"`） | 说明 | 默认值 |
| --- | --- | --- |
| `gridSize` | 像素网格边长 | `128` |
| `minClusterSize` | 达到该数量才聚合；不足的点展开为独立 item | `3` |
| `zoom` | 聚合使用的 zoom；未提供时**在每次聚合计算时**读一次地图当前 zoom（读不到时用 `8`，并告警一次）。地图缩放变化**不会**自动重算聚合 | - |

⚠️ 与当前 `engine` 不匹配的选项会**告警一次**（不静默）：`gridSize` / `minClusterSize` / `zoom`
只对 `markers` 生效，`clusterRadius` 等只对 `native` 生效。换 `engine` 等于换资源形态，因此整层重建。

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `cluster-click` | 簇被点击 | `ClusterPick<Item>`：`{ engine, id, size, position, items }` |
| `cluster-change` | 聚合结果读数（两个引擎同名同形） | `ClusterChange`：`{ engine, clusters, singles, zoom }`（`zoom` 拿不到时为 `null`） |
| `item-click` | 未聚合的单点被点击 | 最新的业务 item |

`items` 只在 `engine="markers"` 下是业务项数组，`native` 下是 `null` —— 用 `null` 而不是空数组，
是为了让「这一层拿不到」与「这一簇确实是空的」在类型上就分得开。

聚合参数（`clusterRadius` 等）是**构造期**选项：改变 ⇒ 重建实例（不重建就没法保证生效：
官方同时列了 `setOptions` 与 `redraw`，但本库没有取证「改了再 `redraw()` 会重新聚簇」）。

## `BPointShapeLayer`

```vue
<BPointShapeLayer
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
| `click` | 图层级拾取（**含未命中**） | `PointPick<Item>`：`{ hit, dataIndex, id, item, latLng, pixel }` |

未命中时官方**同样派发事件**（`dataIndex === -1`），因此 `click` 的 `hit` 为 `false`、`item` 为
`null`，而 `item-click` 不会派发。`id` 是命中要素的**业务身份**（`properties[idKey]`）；认不出时为
`null`（本库不按事件顺序 / 下标猜身份）。

## 要素状态（Feature State）

`PointCollection` 通过组件 `ref` 暴露要素状态命令面，按业务 id（即 `itemKey` 指向的字段）定位：

```ts
const state = layer.value?.featureState
state?.update(["a"], { selected: true }, { append: true })
state?.get("a")   // { "a": { selected: true } } —— 读回 SDK 的当前值
```

五个命令 `update` / `remove` / `clear` / `replace` / `get` 与官方入口一一对应；身份口径、参数校验
与「未就绪不排队」的口径见[原生批量可视化图层](./layer/native-visual-layers) 的「要素状态」一节。

`itemKey` 恒能推出身份字段（函数式 key 落保留字段 `__id`），因此本组件不会遇到那条「未声明
`idKey` ⇒ 命令被拒绝」的前置条件。

更新路径与逐点组件不同，但都在这一个实例上完成：

| 变化 | 路径 |
| --- | --- |
| `data` / `dataVersion` / `properties` | `setData()`（**不重建**）；**数据变空时走 `clearData()`**（图层留着、数据清空） |
| `shape` / `size` / `color` / `strokeColor` / `strokeWeight` | 更新样式并**显式重绘**（官方口径：样式更新后不会自动重绘） |
| `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter（**不重建**，隐藏也不摘掉图层） |
| `itemKey` / `enablePicked` / `pickWidth` / `pickHeight` | **重建图层**（它们是构造期选项） |

`properties` 里不需要自己写 id：库里会把要素身份写进 `properties`（`itemKey` 是字符串时就是该
字段名，是函数时用保留字段 `__id`），并把它作为图层的 `idKey` —— 少了它，拾取回来的要素认不出
业务项。

## `PointIconLayer`

```vue
<PointIconLayer
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  icon="https://example.com/pin.png"
  :width="32"
  :height="32"
  @item-click="onItemClick"
/>
```

与 `BPointShapeLayer` 的差异只有「每个点画什么」：前者画几何图元，后者画一张图标。

| 属性 | 说明 | 默认值 |
| --- | --- | --- |
| `properties` | 写进每个要素 `properties` 的属性映射 | - |
| `icon` / `width` / `height` / `anchors` / `offset` / `scale` / `rotation` | 图标样式（官方 `PointIconStyle` 的子集） | SDK 默认 |
| `isFlat` / `isFixed` | 是否贴地 / 是否跟随缩放保持尺寸（**构造期**选项） | 官方默认（均为 `true`） |
| `opacity` / `zIndex` / `minZoom` / `maxZoom` | 透明度 / 层级 / 缩放范围 | SDK 默认 |
| `enablePicked` | 是否开启鼠标拾取 | **`true`**（官方默认 `false`，这里刻意不同） |
| `pickWidth` / `pickHeight` | 点击拾取矩形尺寸（像素） | 官方默认（30） |

事件与 `BPointShapeLayer` 完全相同（`item-click` + 含未命中的 `click`），更新路径也相同。
注意图标是按 URL **异步加载**的：本库不接管它的加载状态（SDK 也没有公开「图标就绪」的事件），
`dataparsed` 不代表图标已经可见。

## `PointLayer`（`experimental`，扩展 API）

```vue
<PointLayer
  :data="stations"
  item-key="id"
  :get-position="(s) => ({ lng: s.lng, lat: s.lat })"
  shape="circle"
  :size="18"
  fill-color="#1677ff"
  @item-click="onItemClick"
/>
```

它的选项是**扁平**的（`shape` / `icon` / `size` / `fillColor` / `fillOpacity` / `strokeColor` /
`strokeWeight` / `scale` / `rotation` / `offset` / `anchor`），与 `BPointShapeLayer` 的样式字段名
**不同**（那里是官方的 `PointShapeStyle`）。未配置 `icon` 时按 `shape` 画几何图元，配置了就走图标模式。

三处要提前知道的事：

1. **可视化实现是按需异步注入的**：就绪之前创建会经 `resource:error` 交出
   `BMAP_CAPABILITY_UNSUPPORTED`；注入完成之后重试即可成功（同一个组件，不必换实例）。
2. **不会自动改用别的类**：要最稳就用 `BPointShapeLayer` / `PointIconLayer`（两处都声明）。
3. **命中载荷与另外两个不同**：官方在扩展 API 上**没有** `dataIndex`，业务键在
   `value.properties[idKey]` / `value.id` 上。因此 `click.dataIndex` 恒为 `-1`（载荷里那个
   `index` 字段的语义没有取证，本库不读它），`click.hit` 的判据是「能不能解析出业务身份」。

图层级的 `opacity` / `zIndex` / `minZoom` / `maxZoom` **没有**暴露：它们走 `setOpacity` /
`setZIndex` / …，而官方扩展专页没有把这一族列为 `PointLayer` 的方法面（`setVisible` 是唯一取过证
的一位）。传了会**告警**，不会静默收下。

## 资源释放

所有数据组件都随组件卸载释放全部资源（Marker 摘除 + 监听解绑）；四个落在原生图层上的组件
（`MarkerCluster` 的 `native` 引擎 + 三个点图层）还会把图层登记进地图的图层账本，因此
**即使地图先被销毁**，图层也会在 `map.destroy()` 之前被摘掉 —— 这条依赖 `<Map>` 提供的
`MapContext.layers`；自定义 Context 没有它时组件退化为自持账本，只保证「组件卸载」这一条路径。
数据组件不持有跨组件的共享状态。
