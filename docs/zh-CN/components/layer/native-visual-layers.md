# 原生批量可视化图层 <Badge type="tip" text="^3.0.0" />

四个 JSAPI 4.0 **原生批量图层**：`BLineLayer`（线）/ `BFillLayer`（面）/ `BHeatmapLayer`（热力）/
`BTrackLineLayer`（轨迹线）。它们与[图层组件](./index)的区别是：**数据是一等公民**（`setData` /
要素状态 / 拾取），因此一个组件承载成千上万个要素，渲染在 SDK 内部完成。

```ts
import { BLineLayer, BFillLayer, BHeatmapLayer, BTrackLineLayer } from 'baidu-map-gl-vue'
```

## 先选对组件（差别来自**官方有没有声明**）

| 组件 | 官方类 | 能力面 | 适合 |
| --- | --- | --- | --- |
| `BLineLayer` | `LineLayer`（4.0.4 有声明） | 数据 / 强类型样式 / 显隐 / 透明度 / 层级 / 缩放范围 / 拾取 / 要素状态 | 轨迹、路网、连线 |
| `BFillLayer` | `FillLayer`（有声明） | 同上（样式是 `BFillLayerStyle`） | 面状统计、区域着色 |
| `BHeatmapLayer` | `Heatmap`（**无声明**，扩展 API） | 数据 / 样式袋 / 显隐 | 点密度热力 |
| `BTrackLineLayer` | `TrackLine`（**无声明**，扩展 API） | 数据 / 显隐（**基线**） | 轨迹线（播放控制见文末） |

「官方有没有声明」不是细节：**没有声明**的类只能按「运行时按需注入」处理，本库因此只暴露驱动已
登记、且逐条核对过的入口。所以后两个组件**没有** `opacity` / `zIndex` / `minZoom` / `maxZoom`——
官方不公开对应 setter，声明了也只是静默忽略（假支持）。

## 统一语义：同名的 prop，四条写入路径

四个组件共用同一份生命周期内核。**能就地更新的一律不重建**：

| 变化 | 路径 | 是否重建 |
| --- | --- | --- |
| `data` | `setData()`（`null` = `clearData()`） | 否 |
| `style` | `setStyleOptions()` + `doOnceDraw()`（官方样式是 merge，且明确「改完要重绘」） | 否 |
| `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter（该 kind 有 setter 时） | 否 |
| `idKey` / `crs` / `enablePicked` / `pickWidth` / `pickHeight` / `autoSelect` / `selectedColor` | 构造选项 ⇒ **换实例**（官方只有整袋 `setBaseOptions`，且不自动重绘） | 是 |

两条容易踩的语义：

- **字段由「有值」变回「不表态」时会重建并告警一次**。官方这批图层没有 unset 入口，静默保留旧值
  会让你的声明与画面分叉；本库选择「回到 SDK 自己的默认状态」并告诉你。
- **原地修改同一份 `data` 不会被感知**（数据按引用比较，与图层组件同一条口径）。请换引用，或换
  一份新的 `FeatureCollection`。

## `visible` 有两种落地

| kind | 隐藏的语义 |
| --- | --- |
| `BLineLayer` / `BFillLayer`（有 `setVisible`） | `setVisible(false)`：**数据与实例都留着**，显示时不再下发数据 |
| `BHeatmapLayer` / `BTrackLineLayer`（没有 `setVisible`） | **摘掉图层**；重新显示时**换一个新实例**并重新下发数据 |

后者的行为来自实测：`removeLayer` 之后的实例再也渲染不了（重挂不会让内容回来），所以本库不去猜
「复用可行」。文档只承诺能做到的事。

## 拾取事件

```vue
<script setup lang="ts">
import { BLineLayer } from 'baidu-map-gl-vue'
import type { BMapFeaturePick } from 'baidu-map-gl-vue'

function onClick(pick: BMapFeaturePick) {
  if (!pick.hit) return          // 官方未命中也派发事件
  if (pick.id === null) return   // 身份认不出（没设置 idKey / 该字段不是数字或字符串）
  console.log(pick.id, pick.item?.name)
}
</script>

<template>
  <BLineLayer
    :data="geojson"
    id-key="id"
    :style="{ strokeColor: '#0055ff', strokeWeight: 4 }"
    @click="onClick"
  />
</template>
```

| 事件 | 说明 |
| --- | --- |
| `click` / `dblclick` / `rightclick` / `mousemove` | 载荷为 `BMapFeaturePick`（见下） |

官方**不派发** `mouseover` / `mouseout`，本库也不声明。

载荷的三个字段各自表达一件事：

| 字段 | 语义 |
| --- | --- |
| `hit` | 是否命中（未命中时 `dataIndex === -1`，事件**照常派发**） |
| `id` | 业务身份 = `feature.properties[idKey]`；**认不出时为 `null`**（不猜官方的默认 `idKey`） |
| `item` | 命中的业务项；线 / 面图层就是该要素的 `properties`，未命中为 `null` |

`id` 与 `item` 解耦是有意的：`properties` 是官方回包直接给出的，即使你没设置 `idKey` 也能拿到；
而**要素状态**必须知道身份，所以 `idKey` 仍然要设置（见下）。

## 要素状态（Feature State）

要素状态是**命令面**（不是 prop）：通过组件 `ref` 使用，按**业务 id**（`idKey` 字段的值）定位要素。

| 命令 | 官方入口 | 语义 |
| --- | --- | --- |
| `update(keys, state, { append })` | `updateState(keys, params, ifAppend)` | `append` 缺省 `false` = **替换**该要素的整个状态对象；`true` = 合并 |
| `remove(keys)` | `removeState(keys)` | 只摘掉列出的 id |
| `clear()` | `clearState()` | 清空全部 |
| `replace(inputs)` | `replaceAllState(inputs)` | **全量替换**（未覆盖到的 id 会消失） |
| `get(keys?)` | `getAllState()` | 读回（**SDK 的当前值**，不给 keys 就是全量） |

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { BLineLayer } from 'baidu-map-gl-vue'

const layer = ref<InstanceType<typeof BLineLayer> | null>(null)

function highlight(id: string) {
  const state = layer.value?.featureState
  if (!state) return
  state.update([id], { selected: true }, { append: true })
  console.log(state.get(id))     // { "<id>": { selected: true } }
}
</script>

<template>
  <BLineLayer ref="layer" :data="geojson" id-key="id" />
</template>
```

四条值得知道的口径：

- **身份只有业务 id**：不用要素下标（`dataIndex`）、不按调用顺序配对、不缓存「我们以为 SDK 现在是
  什么状态」——`get()` 每次都读回 SDK；
- **非法 id 在调用之前失败**（`BMAP_INVALID_ARGUMENT`），不会产生 SDK 调用；空数组 / 空映射是合法
  输入（什么都不做）；
- **图层未就绪时命令不排队**：告警一次并跳过。需要确定性时等挂载完成后再调用；
- **状态样式要靠样式表达式读取**：官方的 `updateState` 只是把状态写进要素（声明原文：「状态会参与
  样式表达式的求值…在样式表达式中通过 `feature-state` 访问」），真正的视觉效果来自 `style` 里的
  数据驱动表达式（`BMapStyleExpression` 的 `object` 那一支）。

`BHeatmapLayer` / `BTrackLineLayer` **没有**要素状态入口，因此不提供该命令面。

## 释放策略

卸载（组件卸载 / 地图销毁 / 换实例）时的固定顺序是：**先解绑业务监听 → 清数据 → 摘图层**。
先解绑是硬要求（SDK 可能在 `removeLayer` 期间同步派发事件），清数据是「先清后摘」这条官方推荐
顺序的落实（实测两种顺序都安全）。

| 场景 | 会发生什么 |
| --- | --- |
| 组件卸载 / 地图销毁 | 解绑监听 → `clearData()` → `removeLayer()` |
| 组件卸载 / 地图销毁（`BTrackLineLayer`） | 解绑监听 → `removeLayer()`：该 kind **没有** `clearData` 入口（官方扩展 API 只公开 `setData`），实例随摘除被丢弃 |
| `visible=false`（有四类专页声明的 kind） | 只调 `setVisible(false)`：数据与实例都留着 |
| `visible=false`（扩展 API 的 kind） | 摘掉图层（重新可见时换新实例） |

## 已知限制

- **`BHeatmapLayer` 的 `style` 是原样透传的键值袋**：官方扩展 API 只公开整袋 `setOptions`，没有可
  核对的声明，本库不复刻一份没有依据的字段表。需要强类型样式请用 `BLineLayer` / `BFillLayer`。
- **样式里的函数换实现后，只在 SDK 下一次求值时生效**：交给 SDK 的是转发到最新实现的包装，已经画
  出来的要素不会回溯变化。要立刻换样式，请换 `data` 的引用触发重新解析。
- **`BTrackLineLayer` 只是基线**：播放控制（`start` / `pause` / `resume` / `stop`）与页面可见性联动
  **未实现**——官方类型包没有 `TrackLine` 的类声明，方法名必须先由真实运行时探针取证；本库也不会
  另建一套「镜像 SDK 播放状态」的内部状态机。该组件不依赖旧的 `BMapGLLib.TrackAnimation` 插件。
- **`BMVTLayer` 尚未提供**（见 ADR 的欠账表）。
