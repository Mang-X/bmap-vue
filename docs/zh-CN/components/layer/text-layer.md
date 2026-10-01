# TextLayer <Badge type="tip" text="^1.0.0" />

官方 JSAPI 4.0.5 `visualization/` 命名空间的**批量文字标注图层**（`BMap.TextLayer`）。文字量较大时
用它而不是逐个 `<Label>` 覆盖物：一条 GeoJSON 要素渲染一段文字，文案 / 字号 / 颜色等**全部是数据
驱动**（官方 `StyleValue<T>`，可按要素逐个求值），并内置碰撞剔除（密集时自动隐藏互相压盖的文字）。

```ts
import { TextLayer } from '@mangax/bmap-vue'
```

与 [`LineLayer` / `FillLayer` / `HeatmapLayer` / `TrackLineLayer`](./native-visual-layers)、
[`PolygonLayer` / `PolylineLayer`](./visualization-layers) 共用**同一份生命周期内核**（数据 / 样式 /
显隐 / 层级 / 拾取 / 释放），差异全在官方**声明了什么**上。

## 基本用法

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { Map, TextLayer } from '@mangax/bmap-vue'

const points = ref({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [116.404, 39.915] },
      properties: { id: 'bj', name: '北京' },
    },
  ],
})
</script>

<template>
  <Map>
    <TextLayer
      :data="points"
      id-key="id"
      :style="{ text: (p) => p.name, fontSize: 14, color: '#333' }"
      @click="onPick"
    />
  </Map>
</template>
```

几何支持 `Point` / `MultiPoint`。`data` 的三态（`null` = 没有数据 / `undefined` = 不表态）与其它
原生图层**完全一致**。

## 能力面

| 组件 | 官方类 | 几何 | 能力 |
| --- | --- | --- | --- |
| `TextLayer` | `TextLayer` | `Point` / `MultiPoint` | 数据 / 强类型样式 / 显隐 / 透明度 / 层级 / 缩放范围 / 拾取事件 / **主动命中** |

## 组件 Props

| 属性 | 说明 | 类型 | 默认值 | 更新口径 |
| --- | --- | --- | --- | --- |
| data | GeoJSON 数据；`null` = 没有数据，`undefined` = 不表态 | `object \| null` | - | 有值 → `setData()`；→ `null` → **换实例** |
| style | 文字样式（见下） | [`TextLayerStyle`](#textlayerstyle) | - | **就地** `setOptions()`（merge） |
| visible | 是否显示 | `boolean` | `true` | **就地** `setVisible()` |
| opacity | 图层级透明度 `[0,1]`，与逐条 `fillOpacity` **相乘** | `number` | 官方默认 `1` | **就地** `setOpacity()` |
| zIndex | 图层层级 | `number` | 官方默认 `1` | **就地** `setZIndex()` |
| minZoom | 最小显示缩放等级 | `number` | 官方默认 `3` | **构造期** → 换实例 |
| maxZoom | 最大显示缩放等级 | `number` | 官方默认 `21` | **构造期** → 换实例 |
| idKey | 数据项属性 key（= 业务身份字段） | `string` | - | **构造期** → 换实例 |
| enablePicked | 是否开启鼠标交互（命中光标 + 事件派发） | `boolean` | **`true`**（官方 `false`） | **构造期** → 换实例 |
| mouseStyleChange | 命中后是否更换鼠标光标 | `boolean` | 官方默认 `true` | **构造期** → 换实例 |
| pickTolerance | 命中容差（css px） | `number` | 官方默认 `4` | **构造期** → 换实例 |
| pickThrough | 命中后是否继续向下层派发 | `boolean` | 官方默认 `false` | **构造期** → 换实例 |

除 `visible` / `zIndex` 外，本组件比前两族**多一个** `opacity` prop——官方为文字图层**声明**了
`setOpacity`，因此它有字段级 setter 可走（单独改它**不换实例**）。这是文字图层与面 / 线两族的
唯一结构差别。

### TextLayerStyle

| 字段 | 说明 | 官方默认 |
| --- | --- | --- |
| text | 文案；不设则读要素的 `properties.text` | - |
| fontSize | 字号（px） | `14` |
| fontFamily | 字体 | `'微软雅黑'` |
| fontWeight | 字重 | `'normal'` |
| color | 文字颜色，css 字符串 | `#333` |
| strokeColor | 描边色，css 字符串 | `rgba(255, 255, 255, 1)` |
| strokeWeight | 描边宽度（px），`0` 表示不描边 | `0` |
| textMaxWidth | 超过该宽度（px）换行；`0` 表示不换行 | `0` |
| lineHeight | 行高（px） | `20` |
| textAlign | 多行时的对齐方式：`center` / `left` / `right` | `'center'` |
| offset | 像素偏移 `[x, y]` | `[0, 0]` |
| anchor | 锚点，决定坐标点落在文字的哪个位置（见下） | `'center'` |
| rotation | 旋转角度（度） | `0` |
| scale | 缩放比例 | `1` |
| fillOpacity | **逐条**透明度 `[0,1]`，与图层级 `opacity` **相乘** | `1` |
| isFlat | `true` 贴地（大小随缩放变化）；`false` 屏幕固定像素大小 | `false` |
| collides | 是否开启碰撞剔除（密集时自动隐藏互相压盖的文字） | `true` |
| waitTime | 碰撞剔除的节流间隔（ms） | `200` |
| padding | 图集槽位内边距 `[x, y]` | `[2, 2]` |
| margin | 碰撞盒外扩 `[x, y]`，控制文字之间的最小间距 | `[0, 0]` |
| renderStage | 绘制阶段：`building` / `poi` / `null` | 官方默认落点 |

`anchor` 的取值（官方 `TextAnchor`）：`center` / `topLeft` / `topCenter` / `topRight` /
`rightCenter` / `bottomRight` / `bottomCenter` / `bottomLeft` / `leftCenter`。

`text` / `fontSize` / `fontFamily` / `fontWeight` / `color` / `strokeColor` / `strokeWeight` /
`offset` / `anchor` / `rotation` / `scale` / `fillOpacity` 都可以收**数据驱动表达式**
（按要素逐个求值，参数是要素的 `properties` / 要素本身 / 序号）。

::: tip `minZoom` / `maxZoom` 是**构造选项**
官方**没有** `setMinZoom` / `setMaxZoom` 字段级 setter（4.0.5 声明里没有，live 实测运行时也没有），
因此改这两个 prop 会**换实例**。默认 `3` / `21`。
:::

::: warning `opacity` 只有一个入口
官方 `setOptions` 的注释明写：袋里的 `opacity` / `visible` / `zIndex` / `renderStage` /
`referCenter` / `enablePicked` 会「**转发到对应 setter**」。而顶层 `opacity` prop 走的正是那个
`setOpacity` ⇒ `style.opacity` 与 `opacity` prop 写的是**同一份 SDK 状态**，两个入口并存的
后果是**最终值取决于谁最后被改**。

因此顶层 `opacity` prop 是**唯一入口**。把 `opacity` 放进 `style` 会被忽略并**告警一次**
（不静默接收后丢弃）。逐要素的透明度请用 `fillOpacity`——官方明写两者**相乘**，不是一回事。
:::

::: tip `setOptions` 是 **merge**，不是「整袋替换」
「仅更新已声明的样式键」这句话的意思是「**只写你给的那几个键，没给的保持原值**」，与 `layer/`
家族的 `setStyleOptions`（「合并到现有样式」）是**同一种**语义。真实运行时上逐 kind 验证过两个
家族都是 merge。
:::

## 拾取与 `hitTest`

四个拾取事件（`click` / `dblclick` / `rightclick` / `mousemove`）无条件订阅，载荷与
[`PolygonLayer` / `PolylineLayer`](./visualization-layers) 同形（`{ hit, dataIndex, id, item,
latLng, pixel }`）。

`enablePicked` 默认 **`true`**——与官方默认 `false` **不同**，刻意如此：不给事件就别怪用户拿不到
`pick`。

除事件外，本组件还 `defineExpose` 了一个**主动命中**命令（[`PolygonLayer` / `PolylineLayer` 没有）：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TextLayer } from '@mangax/bmap-vue'
import type { TextLayerPick } from '@mangax/bmap-vue'

const layer = ref<InstanceType<typeof TextLayer>>()
const hit = ref<TextLayerPick | null>(null)

function probe() {
  hit.value = layer.value?.hitTest(120, 80) ?? null
}
</script>

<template>
  <TextLayer ref="layer" :data="points" id-key="id" />
</template>
```

回包**逐字段**对应官方 `TextLayerItem`（`point` / `text` / `width` / `height` / `id` /
`properties`），⚠️ **没有** `dataIndex`——官方回包里没有这一项，本库也不从 `id` 反推下标（那是 SDK
内部口径，不是有依据的公开身份）。未命中返回 `null`；回包里读不到的字段给 `null` 而不是 `0` / `""`
（`0` 宽度与「没给宽度」在业务上不是一回事）。

::: tip 为什么前两个组件没有 `hitTest`
`PolygonLayer` / `PolylineLayer` 官方**声明**了 `hitTest`，但**真实运行时没有** ⇒ 放开门面就是
「调用方按文档写、运行时报错」，因此不 expose。`TextLayer` 是声明与运行时**都对齐**的那一族，
所以 expose。
:::

## 刻意不开的面

这些是**官方声明里有、但本库不投影**的成员——理由与证据都在那份审计里：

- **`setRenderStage` / `setRefCenter` 与七条 `getX` 读回**：官方有、运行时也有，但**没有组件
  消费者**——本库不给「没有消费者」的扩展开口子。需要绘制阶段时经 `style` 袋的 `renderStage`
  走 `setOptions` 下发（官方注释明说 `setOptions` 会把它转发到对应 setter）。
- **`mouseover` / `mouseout` 事件**：官方声明了（`TextLayer.d.ts:336-337`），但它们是**成对**的
  进入 / 离开语义，与本库现有组件的领域事件面不同构且无消费者，因此不派发（与前两族同一裁决）。
- **要素状态（Feature State）**：官方声明里**没有** `updateState` 一族，因此组件**不** expose
  `featureState`。
- **`static TextLayer.Anchor`**：运行时确实在位（九个 `[-1, 1]` 向量全在），但它是给
  「自己算锚点向量」的场景用的；`style.anchor` 直接给官方 `setOptions` 接受的**字符串**
  （`TextAnchor`）更贴近实际用法，因此不投影这一份。

## 未封装的同族类

官方 4.0.5 `visualization/` 一共 13 个类。除本组件外本库**还没有**落地
[`BarLayer` / `FlyLineLayer` / `GeoJSONSource`](./visualization-layers#未封装的-visualization-类)——
**真实运行时它们在这份产物里完全不存在**（见该页的说明），与「本库尚未封装」的其它类不同：
那三个是**上游声明了、运行时没发**。
