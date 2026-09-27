# PolygonLayer / PolylineLayer <Badge type="tip" text="^1.0.0" />

官方 JSAPI 4.0.5 `visualization/` 命名空间新增的两个**批量面 / 线图层**，也是官方在同一版本里
**指名**的弃用替代品：`BMap.FillLayer` → `BMap.PolygonLayer`、`BMap.LineLayer` →
`BMap.PolylineLayer`。

```ts
import { PolygonLayer, PolylineLayer } from 'bmap-vue'
```

与 [`LineLayer` / `FillLayer` / `HeatmapLayer` / `TrackLineLayer`](./native-visual-layers) 共用
**同一份生命周期内核**（数据 / 样式 / 显隐 / 层级 / 拾取 / 释放），差异全在官方**声明了什么**上。

## ⚠️ 弃用替代**不是改名**

从 `<FillLayer>` / `<LineLayer>` 迁过来时，`style` **不是同一套字段**，必须重写：

| | 旧组件 | 新组件 |
| --- | --- | --- |
| 线的颜色 / 宽度 | `LineLayerStyle.strokeColor` / `strokeWeight` | `PolylineLayerStyle.strokeColor` / `strokeWeight`（同名） |
| 线的纹理 | `LineLayerStyle.patternUrl` / `patternScale` / `patternOffset` | `PolylineLayerStyle.strokeTextureUrl` / `strokeTextureSpaced` / `strokeTextureGap` |
| 面的填充纹理 | `FillLayerStyle.patternUrl` / `patternMapping` / `patternScale` | `PolygonLayerStyle.fillTextureUrl` / `fillTextureSize` / `fillTextureAlphaOnly` |
| 面的描边 | `FillLayerStyle.borderWeight` / `borderCovered` / `borderMask` | `PolygonLayerStyle.strokeWeight` / `strokeColor` / `strokeOpacity` |
| 默认描边 | `border` 默认 `true`（有描边） | `strokeWeight` 默认 `0`（**不描边**） |

样式更新语义也不同：旧组件走 `setStyleOptions`（**merge**）并显式 `doOnceDraw()`；新组件走
`setOptions`（**只更新你写到的键**，其余保持原值）。两个组件因此**不**能混用在同一张图上做同一次
样式更新。

## 能力面

| 组件 | 官方类 | 几何 | 能力 |
| --- | --- | --- | --- |
| `PolygonLayer` | `PolygonLayer` | `Polygon` / `MultiPolygon`（含洞） | 数据 / 强类型样式 / 显隐 / 层级 / 缩放范围 / 拾取 |
| `PolylineLayer` | `PolylineLayer` | `LineString` / `MultiLineString` | 同上（样式多虚线 / 纹理一族） |

`data` / `style` / `visible` / `zIndex` / `minZoom` / `maxZoom` / `idKey` / `enablePicked` /
`mouseStyleChange` / `pickTolerance` / `pickThrough` 的语义与
[`native-visual-layers`](./native-visual-layers) 里的 `data` 三态（`null` = 没有数据 /
`undefined` = 不表态）完全一致。

::: tip `minZoom` / `maxZoom` 是**构造选项**
官方**没有** `setMinZoom` / `setMaxZoom` 字段级 setter（4.0.5 声明里没有，live 实测运行时也没有），
因此改这两个 prop 会**换实例**（官方唯一能改的路径就是重建）。它们默认 `3` / `21`。
:::

## 刻意不开的面（逐条依据见[对齐审计](../../contributing/166-visualization-alignment-audit)）

这些是**官方声明里有、但本库不投影**的成员——理由与证据都在那份审计里：

- **`hitTest`**：官方**声明**了（`PolygonLayer.d.ts:201` / `PolylineLayer.d.ts:233`），
  但 **live 探针实测运行时没有**（`prototype.hitTest` 为 `false`）。放开门面就是假支持。
- **`setOpacity`**：反过来——**live 实测运行时**有，官方**声明**里没有。本库的口径是
  「不把官方没承诺的成员当契约」，与 #165 对 `PointLayer` 的裁决一致。
  ⚠️ 因此 `PolylineLayerOptions.opacity`（官方默认 `1`）只能经 `style` 袋经 `setOptions`
  整袋下发，**没有** `opacity` prop。`PolygonLayerOptions` 根本没有 `opacity` 这一项。
- **`setRenderStage` / `setRefCenter` 与七条 `getX` 读回**：官方有、运行时也有，但**没有组件
  消费者**——本库不给「没有消费者」的扩展开口子。
- **要素状态（Feature State）**：这两族**没有**状态 API（官方声明里没有 `updateState` 一族），
  因此组件**不** `defineExpose`（`LineLayer` / `FillLayer` 那个 `featureState` 在这里是空的）。
- **`mouseover` / `mouseout` 事件**：官方声明了，但它们是**成对**的进入 / 离开语义，与本库
  现有四个组件的领域事件面不同构且无消费者，因此不派发。

## 与旧组件共存

`<LineLayer>` / `<FillLayer>` **继续可用、行为不变**：官方只标了 `@deprecated`，没有删除，
而 1.0 是清白面——本库不提供指向新名字的别名垫片（两个名字行为并不相同，别名只会让人更难判断
自己拿到的是哪一套语义）。开发期会对旧组件告警一次，props 类型上带 `@deprecated`。

## 未封装的 visualization 类

官方 4.0.5 的 `visualization/` 一共 13 个类，本票只落地了与本库现有数据组件重合度最高的几个。
**尚未封装**（不在本库的能力面里）：

- **`WebGLCustomLayer` / `ThreejsLayer` / `DeckglLayer`**：自绘容器（要把 WebGL / three.js /
  deck.gl 的渲染循环接进地图生命周期），成本与风险比「包一层官方类」高一个量级；
  （`WebGLCustomLayer` 运行时**确实在位**，`ThreejsLayer` / `DeckglLayer` 实测尚未随主包发出。）
- **`BarLayer` / `FlyLineLayer` / `GeoJSONSource`**：官方 4.0.5 的**类型包声明**了它们，但
  **live 探针实测这份产物里根本没有**（`BMap` 上是 `undefined`，8 秒后与再 25 秒后两次复读都
  一样，扫遍 `BMap` 全部 294 个自有属性也没有任何别名）。这不是「本库还没包」，而是**上游声明了、
  运行时没发**——因此本库不建它们的能力槽位：登记进去只会让 `supports()` 对一个永远不会来的
  能力说真话。逐条读数见[对齐审计](../../contributing/166-visualization-alignment-audit)。

[`TextLayer`](./text-layer) 已在 #166 第二刀落地——它是这一族里**唯一声明与运行时完全对齐**的类
（`hitTest` 与 `setOpacity` 都在，而前两族恰好各缺一个、方向相反）。

它们在能力清单（`driver/capability/catalog.ts`）里**没有**任何 `rawMembers` 声称——
「没封装」这件事在能力矩阵上是查得出来的。
