# 原生批量可视化图层 <Badge type="tip" text="^1.0.0" />

四个 JSAPI 4.0 **原生批量图层**：`LineLayer`（线）/ `FillLayer`（面）/ `HeatmapLayer`（热力）/
`TrackLineLayer`（轨迹线）。它们与[图层组件](./index)的区别是：**数据是一等公民**（`setData` /
要素状态 / 拾取），因此一个组件承载成千上万个要素，渲染在 SDK 内部完成。

```ts
import { LineLayer, FillLayer, HeatmapLayer, TrackLineLayer } from 'bmap-vue'
```

## 先选对组件（差别来自**官方声明了什么**、**弃用了什么**）

::: warning `LineLayer` / `FillLayer`：官方已在 4.0.5 弃用底层的类
`@baidumap/jsapi-v4-types@4.0.5` 给 `BMap.LineLayer` 与 `BMap.FillLayer` 各加了一条
`@deprecated`，官方建议改用 4.0.5 新增的 `visualization` 命名空间里的 `PolylineLayer` /
`PolygonLayer`。

**两个组件继续可用，行为不变**（开发期会告警一次，props 类型上带 `@deprecated`）。官方建议的
替代品 **`<PolylineLayer>` / `<PolygonLayer>` 本库现已提供**（#166）——但
**弃用替代不是改名**：两者的 `style` 字段族不同、样式更新入口不同（见
[PolygonLayer / PolylineLayer](./visualization-layers)）。需要这层语义的可以继续用
`LineLayer` / `FillLayer`；`HeatmapLayer` / `TrackLineLayer` 不在官方弃用名单内。

逐字段迁移表、七个无对应的旧选项、以及「什么时候该留下」的判断，见
[弃用图层的迁移指引](./deprecated-layers-migration)。

[`PointIconLayer`](../data#pointiconlayer) 同属这一批，但它的官方替代品 `<PointLayer>` 本库
**已经提供**，那条见[数据组件](../data)。
:::

| 组件 | 官方类 | 能力面 | 适合 |
| --- | --- | --- | --- |
| `LineLayer` | `LineLayer`（有声明；4.0.5 起官方标 `@deprecated`，建议 `PolylineLayer`） | 数据 / 强类型样式 / 显隐 / 透明度 / 层级 / 缩放范围 / 拾取 / **要素状态** | 轨迹、路网、连线（**需要要素状态**时用它——新的 `PolylineLayer` 没有） |
| `FillLayer` | `FillLayer`（同上；官方建议 `PolygonLayer`） | 同上（样式是 `FillLayerStyle`） | 面状统计、区域着色（同上） |
| `HeatmapLayer` | `Heatmap`（4.0.5 补上类声明，扩展 API） | 数据 / 样式袋 / 显隐 | 点密度热力 |
| `TrackLineLayer` | `TrackLine`（4.0.5 补上类声明，扩展 API） | 数据 / 显隐 / **播放命令面** / **进度观察** | 轨迹线（播放控制见文末） |

**「类型包里有没有类声明」不是能力面的依据**。这四个类在 4.0.5 之后**全部有**类声明
（`Heatmap` / `TrackLine` 是 4.0.5 才补上的，`LineLayer` / `FillLayer` 更早就有），
但后两个（`HeatmapLayer` / `TrackLineLayer`）在浏览器里仍要等**可视化扩展异步注入**才能用——
「有声明」说的是形状，「已注入」说的是可用性，两件事各判各的。live 探针实测
`Heatmap` / `TrackLine` 属这一族，而 `LineLayer` / `FillLayer` / `PointIconLayer` /
`PointShapeLayer` 的构造器与全套成员在 `BMap.Map` 就绪时**已经齐备**（settle `0ms`），
即**随主包注入**、不等异步注入。

「官方有没有弃用」也不改变这张表：能力矩阵里 `layer.line` / `layer.fill` 的 `status` 仍是
`experimental`、`layer.point-icon` 仍是 `native`。`status` 的四个取值表达的是**能力从哪来**，
没有一档表示「官方标了弃用」——为它新造一个状态会让 `supports()` / 能力矩阵全线改语义。弃用只记在
[能力矩阵](../../contributing/capability-matrix)的说明列与上面那个提示框里。

## 统一语义：同名的 prop，四条写入路径

四个组件共用同一份生命周期内核。**能就地更新的一律不重建**：

| 变化 | 路径 | 是否重建 |
| --- | --- | --- |
| `data`（有值） | `setData()` | 否 |
| `data` → `null`（明确「没有数据」） | 换一个**没有数据的实例** | **是** |
| `data` → `undefined` | **不表态**：不产生任何 SDK 调用，已画出来的数据保持不变；**换实例时会把上一代的数据补齐到新实例** | 否 |
| `style` | `LineLayer` / `FillLayer`：`setStyleOptions()` + `doOnceDraw()`（官方样式是 merge，且明确「改完要重绘」）；`HeatmapLayer` / `TrackLineLayer`：`setOptions()`（4.0.5 声明的新入口） | 否 |
| `visible` / `opacity` / `zIndex` / `minZoom` / `maxZoom` | 字段级 setter（该 kind 有 setter 时） | 否 |
| `idKey` / `crs` / `enablePicked` / `pickWidth` / `pickHeight` / `autoSelect` / `selectedColor` / `selectedIndex` / `popEvent` | 构造选项 ⇒ **换实例**（官方只有整袋 `setBaseOptions`，且不自动重绘） | 是 |

其中 `selectedIndex` / `popEvent` 是 #165 Class 3 补齐的（官方 `layer/LineLayer.d.ts:25` / `:70`、
`FillLayer.d.ts:30` / `:75`）：此前 `selectedColor` 单独暴露而「哪一条被选中」没有入口，
是一对**半接线**的选项；`popEvent` 控制拾取事件是否向上层冒泡。两者都是构造选项、官方没有
就地改的入口，所以变化时换实例。

> ⚠️ `popEvent` 的官方默认是 `true`，而 Vue 对缺省的 `Boolean` prop 会转成 `false`。
> 组件因此显式写 `popEvent: undefined`，让「没传」真的是「没传」——否则每个不传它的用户
> 都会被静默改成「事件不冒泡」。`FillLayer` 的 `border`、`PointIconLayer` 的 `userSizes` /
> `visibility`、`PointLayer` 的 `mouseStyleChange` / `pickThrough` 是同一条理由。

`data: null` 走「换实例」而不是调 `clearData()`：这是本库自己的取舍
（ADR `2026-09-19-native-data-layer-components` 决策 8 / #106 评审 P1）——这一族的实例本就随摘除
被丢弃，摘除前多打一次可能失败的调用没有收益。

> 该取舍最初的理由是「这一族没有公开的清空入口」。4.0.5 之后这条**只对一半成立**：官方
> `visualization/{PointLayer,ClusterLayer,Heatmap,TrackLine}.d.ts` 都声明了 `clearData()`，
> `layer/{LineLayer,FillLayer}.d.ts` 仍然没有（`layer/` 里只有 `GeoJSONLayer` 声明了它）。
> **行为不变**（四个组件仍然换实例），改变的只是这条说明的准确性。

两条容易踩的语义：

- **字段由「有值」变回「不表态」时会重建并告警一次**。官方这批图层没有 unset 入口，静默保留旧值
  会让你的声明与画面分叉；本库选择「回到 SDK 自己的默认状态」并告诉你。
- **原地修改同一份 `data` 不会被感知**（数据按引用比较，与图层组件同一条口径）。请换引用，或换
  一份新的 `FeatureCollection`。

## `visible` 的落地

| kind | 隐藏的语义 |
| --- | --- |
| 全部八类（含 `HeatmapLayer` / `TrackLineLayer`） | `setVisible(false)`：**数据与实例都留着**，重新显示是同一个实例的 `setVisible(true)` |

⚠️ 4.0.5（git `5ba67f4`）给 `visualization/` 的 `PointLayer` / `ClusterLayer` / `Heatmap` /
`TrackLine` 补上了类声明，**四个类都逐条声明了 `setVisible` / `getVisible`**。在此之前本库按
「4.0.4 没有类声明 ⇒ 不把成员当契约」只凭 live 取证放开了 `PointLayer` / `ClusterLayer` 的
`setVisible`，`HeatmapLayer` / `TrackLineLayer` 因此走**摘挂**：隐藏 = `removeLayer`，
重新显示 = 换一个新实例并重新下发数据。

那个前提已经失效，显隐因此统一走 setter。对 `TrackLineLayer` 这一处的行为差别尤其明显：
摘挂会**换实例**，而换实例会把播放进度与播放状态一起丢掉——「播放到一半切到后台再回来」会从头播。
现在 `visible` 翻转不再换实例，播放位置扛得过隐藏往返。

> 仍然**不**登记的成员（4.0.5 的声明里也确实没有，或没有消费者）：
> 状态 API（`updateState` 一族）、缩放范围（`minZoom` / `maxZoom` 是**构造选项**而非字段级
> setter）、`setRenderStage` / `setRefCenter`。`PointLayer` 另外**没有** `setOpacity`
> （`ClusterLayer` / `Heatmap` / `TrackLine` 都有）。逐条依据见
> `driver/jsapi-v4/native-layers.ts` 的 kind 表注释与
> `native-layers.test.ts` 的「操作面与官方声明一致」。

## 拾取事件

```vue
<script setup lang="ts">
import { LineLayer } from 'bmap-vue'
import type { FeaturePick } from 'bmap-vue'

function onClick(pick: FeaturePick) {
  if (!pick.hit) return          // 官方未命中也派发事件
  if (pick.id === null) return   // 身份认不出（没设置 idKey / 该字段不是数字或字符串）
  console.log(pick.id, pick.item?.name)
}
</script>

<template>
  <LineLayer
    :data="geojson"
    id-key="id"
    :style="{ strokeColor: '#0055ff', strokeWeight: 4 }"
    @click="onClick"
  />
</template>
```

| 事件 | 说明 |
| --- | --- |
| `click` / `dblclick` / `rightclick` / `mousemove` | 载荷为 `FeaturePick`（见下） |

官方**不派发** `mouseover` / `mouseout`，本库也不声明。

载荷的三个字段各自表达一件事：

| 字段 | 语义 |
| --- | --- |
| `hit` | 是否命中（未命中时 `dataIndex === -1`，事件**照常派发**） |
| `id` | **可以公开 / 交给 Feature State 的业务身份** = `feature.properties[idKey]`；取值域 `string \| number`，不在这个域（例如 symbol）或 `idKey` 没声明时为 `null` |
| `item` | 命中的业务项；线 / 面图层就是该要素的 `properties`，未命中为 `null`。**不受 `id` 取值域影响**（业务项按完整业务键恢复） |

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
import { LineLayer } from 'bmap-vue'

const layer = ref<InstanceType<typeof LineLayer> | null>(null)

function highlight(id: string) {
  const state = layer.value?.featureState
  if (!state) return
  state.update([id], { selected: true }, { append: true })
  console.log(state.get(id))     // { "<id>": { selected: true } }
}
</script>

<template>
  <LineLayer ref="layer" :data="geojson" id-key="id" />
</template>
```

五条值得知道的口径：

- **身份只有业务 id**：不用要素下标（`dataIndex`）、不按调用顺序配对、不缓存「我们以为 SDK 现在是
  什么状态」——`get()` 每次都读回 SDK；
- **没有声明 `idKey` 时命令会被拒绝**（告警一次，不做任何事）。「已声明」= **只要给了字符串就算**
  （空字符串也是合法的字段名，与 `itemKey` 的 `PropertyKey` 口径一致）。「按 id 定位」在没有身份字段的
  图层上没有意义，而放它过去就等于悄悄依赖 SDK 的默认 `idKey`——那会让**拾取**（如实给出 `id: null`）
  与**状态命令**（装作知道身份）在同一张图层上形成两套身份语义；
- **非法 id 在调用之前失败**（`BMAP_INVALID_ARGUMENT`），不会产生 SDK 调用；空数组 / 空映射是合法
  输入（什么都不做）；
- **图层未就绪时命令不排队**：告警一次并跳过。需要确定性时等挂载完成后再调用；
- **状态样式要靠样式表达式读取**：官方的 `updateState` 只是把状态写进要素（声明原文：「状态会参与
  样式表达式的求值…在样式表达式中通过 `feature-state` 访问」），真正的视觉效果来自 `style` 里的
  数据驱动表达式（`StyleExpression` 的 `object` 那一支）。

`HeatmapLayer` **没有**要素状态入口，因此不提供该命令面。`TrackLineLayer` 的命令面是**播放控制**（见下节），不是要素状态。

## 播放控制与进度观察（`TrackLineLayer` / #110）

`TrackLine` 的播放命令面与事件观察经 **live 探针取证**（`scripts/probe-track-line.mts`，2026-09-23，exit 0），方法名不是从类型包猜的。

### 命令面（`ref.playback`）

| 命令 | 官方入口 | 语义 |
| --- | --- | --- |
| `start()` | `start()` | 起播（从当前 `process` 继续） |
| `pause()` | `pause()` | 暂停 |
| `resume()` | `resume()` | 从暂停处继续 |
| `stop()` | `stop()` | 停止播放（**不**归零 `process`：live 探针 `cmd.stop.observed` 保持原值） |
| `setSpeed(n)` | `setSpeed(n)` | 播放倍速（正有限数；`BMAP_INVALID_ARGUMENT`） |
| `setProcess(p)` | `setProcess(p)` | 跳到进度 `0–1`（越界同样 `BMAP_INVALID_ARGUMENT`） |

四条口径：

- **命令是发出去的**：是否真的暂停/跳转，由 SDK 的 `progress` / `statuschange` 事件回答（见 `observed`）。本组件**不建**内部播放状态机去镜像 SDK；
- **参数在 SDK 调用之前校验**：`setSpeed` 必须是正有限数、`setProcess` 必须落在 `[0,1]`，非法值抛 `BMAP_INVALID_ARGUMENT`、不产生任何 SDK 调用；
- **图层未就绪时命令不排队**：告警一次并跳过（与要素状态命令同一条口径）；
- **不支持的操作显式失败**：`BMAP_CAPABILITY_UNSUPPORTED` 从 Driver 抛出，不在这一层静默 no-op。

### 进度观察（`ref.observed` + 事件）

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TrackLineLayer } from 'bmap-vue'
import type { TrackLineObserved } from 'bmap-vue'

const layer = ref<InstanceType<typeof TrackLineLayer> | null>(null)

function play() {
  layer.value?.playback.start()
}

function onProgress(o: TrackLineObserved) {
  // o.process / o.elapsed / o.distance / o.point / o.angle 来自 progress 载荷
}
</script>

<template>
  <TrackLineLayer ref="layer" :data="track" @progress="onProgress" />
</template>
```

| 面 | 来源 | 说明 |
| --- | --- | --- |
| `observed`（expose） | 事件派生的只读读数 | 换实例时**不清空**（避免闪 `null`）；新一代的**第一条**事件从空快照重建（不继承上一代字段）；**不是**内部播放状态机 |
| `@progress` | SDK `progress` 事件 | 载荷含 `process` / `elapsed` / `distance` / `point` / `angle` |
| `@statuschange` | SDK `statuschange` 事件 | 载荷含 `status` / `statusName` |

`defineExpose` 会把 ref **解包**：父级通过 `vm.observed` 读到的是**值**。要追踪变化用 `watch(() => vm.observed, …)`。

### 页面可见性策略（`pauseOnHidden`）

live 探针实测：**SDK 不会**在页面 hidden 时自动暂停（`progress` 继续推进）。因此：

| 策略 | 行为 |
| --- | --- |
| **默认**（`pauseOnHidden=false`） | 页面 hidden 时只停掉**本库自己的观察**（`observed` 不再更新），**不**改写业务播放意图（SDK 继续播） |
| **显式 opt-in**（`pauseOnHidden=true`） | 只对「**已送达 start/resume 且 handle 仍是那一代**」的实例：hidden 触发 `pause()`、shown 恢复 `resume()`——**not-ready / 抛错的命令不留意图**（visibility 不补发迟到的 start），**stop/idle/跨代意图不被反向启动**；hidden 中把 prop 改成 `false` 会**立刻 resume 本库造成的 pause**，已 hidden 时改成 `true` 则立即按策略 pause；**已在 hidden 时新送达的 `start` / `resume` 也会立刻按当前 `visibilityState` 再 pause 一次**（不绕过 opt-in） |

自动 pause/resume 必须是 opt-in、不是基础默认，这是 issue #110 的硬约束。

## 释放策略

卸载（组件卸载 / 地图销毁 / 换实例）时的固定顺序是：**先解绑业务监听 → 摘图层（`removeLayer`）**。
先解绑是硬要求（SDK 可能在 `removeLayer` 期间同步派发事件），这也是官方参考给出的清理清单
（「解绑事件 → `map.removeLayer(layer)`」）。

| 场景 | 会发生什么 |
| --- | --- |
| 组件卸载 / 地图销毁 | 解绑监听 → `removeLayer()`；实例随摘除被丢弃（SDK 侧的数据也随之成为垃圾） |
| `visible=false` | 只调 `setVisible(false)`：数据与实例都留着，**不摘图层**（八个 kind 一致，见上文） |

> **这一族没有 `clearData`，所以「清空」不走清空入口。** 官方专页四类
> （`LineLayer` / `FillLayer` / `PointIconLayer` / `PointShapeLayer`）的公开方法里只有
> `setData` / `getData`（上游类型包与官方参考都如此），因此 `data = null` 由**换一个没有数据的
> 实例**表达——这与「字段由有值变回未表态时重建」是同一条口径：SDK 侧无法 unset 的东西，
> 本库不猜、也不假装调了一个不存在的入口。

## 已知限制

- **`data = null` 的代价是一次重建**：官方专页这一族没有公开的清空入口（见「释放策略」的注），
  因此「没有数据」只能用「换一个没有数据的实例」表达。它是离散动作、代价可控，但**不是零成本**；
  需要「临时不显示」的用 `visible`（不要用 `data = null`）。
- **`HeatmapLayer` 的 `style` 是原样透传的键值袋，组件面刻意只暴露 `data` / `style` / `visible`**：
  官方 `HeatmapOptions` 确实声明了 `gradient` / `size` / `unit` / `max` / `min` /
  `weightField` 等一批构造选项（4.0.5 已补上类声明），但它们**没有逐字段的更新入口**：
  官方 `Heatmap` 的成员表只为其中**两个**声明了字段级 setter —— `setGradient(gradient)` 与
  **`setRadius(radius)`**（注意 setter 名是 `setRadius`、构造键名却是 `size`，按名字推导的
  更新通道会直接打空）；`size` / `unit` / `min` / `max` / `weightField` 五个在真实运行时的
  原型链上**任何一层都没有**对应方法（live 读数，2026-09-27，settle 之后）。而 `style` 这个
  整袋口（官方 `setOptions`）**已经能到达全部六个**——再开六个逐项 prop 等于给同一个值开两条
  通道，其中一条还没有独立的存在理由。需要强类型样式请用 `LineLayer` / `FillLayer`。
- **样式里的函数换实现后，只在 SDK 下一次求值时生效**：交给 SDK 的是转发到最新实现的包装，已经画
  出来的要素不会回溯变化。要立刻换样式，请换 `data` 的引用触发重新解析。
- **`TrackLineLayer` 不依赖旧的 `BMapGLLib.TrackAnimation` 插件**：播放命令面（`start` / `pause` / `resume` / `stop` / `setSpeed` / `setProcess`）、事件观察（`observed` / `@progress` / `@statuschange`）与页面可见性联动（`pauseOnHidden`）已由 #110 落地，方法名均经 live 探针取证；本库**不**另建一套「镜像 SDK 播放状态」的内部状态机。
- **`LineLayer` / `FillLayer` 底层的官方类已被弃用**（官方 4.0.5，建议 `PolylineLayer` /
  `PolygonLayer`）。替代组件本库**已提供**（#166，见
  [PolygonLayer / PolylineLayer](./visualization-layers)），但本库**不提供指向新名字的别名垫片**
  ——两个名字的 `style` 字段族与更新语义都不同，别名只会让人更难判断自己拿到的是哪一套语义。
  **一个实质差异**：旧的这两个组件有**要素状态**命令面，新的两个**没有**（官方在
  `PolygonLayer` / `PolylineLayer` 上没有声明状态 API），依赖要素状态的用法**留在旧组件**。
- **`MVTLayer`**（#109）：MVT 矢量瓦片图层，能力面 `layer.mvt`；见「[MVTLayer](./mvt-layer.md)」。
