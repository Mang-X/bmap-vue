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
| 线的描边 | `LineLayerStyle.borderWeight` / `borderColor` / `borderCovered` / `borderMask` | 并入 `strokeWeight` / `strokeColor`（`borderCovered` / `borderMask` **无对应**） |
| 线的纹理 | `LineLayerStyle.strokeTextureUrl` / `strokeTextureWidth` / `strokeTextureHeight` | 同名，另有 `strokeTextureSpaced` / `strokeTextureGap` / `strokeTextureColor` |
| 面的填充纹理 | `FillLayerStyle.patternUrl` / `patternMapping` / `patternScale` / `patternOffset` | `PolygonLayerStyle.fillTextureUrl` / `fillTextureSize` / `fillTextureAlphaOnly`（雪碧图裁剪与 UV 偏移**无对应**） |
| 面的描边 | `FillLayerStyle.borderWeight` / `borderColor` | `PolygonLayerStyle.strokeWeight` / `strokeColor` / `strokeOpacity` |
| 默认描边 | `border` 默认 `true`（有描边） | `strokeWeight` 默认 `0`（**不描边**） |

> ⚠️ `patternUrl` / `patternScale` 是 **`FillLayerStyle`** 的字段，**不是** `LineLayerStyle` 的
> ——官方 `LineStyle` 里没有这一族。

样式更新入口也不同：旧组件走 `setStyleOptions`（**merge**）并显式 `doOnceDraw()`；新组件走
`setOptions`（**同样是 merge**：官方注释「仅更新已声明的样式键，未知键忽略并告警一次」的意思是
「只写你给的键，没给的保持原值」），但**没有** `doOnceDraw`——这是两族**唯一**的更新语义差别。

::: tip 两族的样式更新都是 merge
「仅更新已声明的样式键」这句的意思是「**只写你给的那几个键，没给的保持原值**」，与旧组件
`setStyleOptions` 的「合并到现有样式」是**同一种**语义。真实运行时上逐 kind 验证过：先
`setOpacity(0.25)`、再做一次**不含** `opacity` 的样式写，`getOpacity()` 在 `text` / `polyline` /
`line` / `point-shape` 四种 kind 上**全部**仍是 `0.25`。⇒ 迁移时**只写你要改的键**即可，
没写的键沿用旧实例当前值。详见[迁移指引](./deprecated-layers-migration)。
:::

逐字段迁移表与「什么时候该留下」的判断，见[弃用图层的迁移指引](./deprecated-layers-migration)。

## 能力面

| 组件 | 官方类 | 几何 | 能力 |
| --- | --- | --- | --- |
| `PolygonLayer` | `PolygonLayer` | `Polygon` / `MultiPolygon`（含洞） | 数据 / 强类型样式 / 显隐 / 层级 / 缩放范围 / 拾取 |
| `PolylineLayer` | `PolylineLayer` | `LineString` / `MultiLineString` | 同上（样式多虚线 / 纹理一族） |

## 组件 Props

| 属性 | 说明 | 类型 | 默认值 | 更新口径 |
| --- | --- | --- | --- | --- |
| data | GeoJSON 数据；`null` = 没有数据，`undefined` = 不表态 | `object \| null` | - | 有值 → `setData()`；→ `null` → **换实例** |
| style | 样式（见下） | [`PolygonLayerStyle`](#polygonlayerstyle) / [`PolylineLayerStyle`](#polylinelayerstyle) | - | **就地** `setOptions()`（merge） |
| visible | 是否显示 | `boolean` | `true` | **就地** `setVisible()` |
| zIndex | 图层层级 | `number` | 官方默认 `1` | **就地** `setZIndex()` |
| minZoom | 最小显示缩放等级 | `number` | 官方默认 `3` | **构造期** → 换实例 |
| maxZoom | 最大显示缩放等级 | `number` | 官方默认 `21` | **构造期** → 换实例 |
| idKey | 数据项属性 key（= 业务身份字段） | `string` | - | **构造期** → 换实例 |
| enablePicked | 是否开启鼠标交互（命中光标 + 事件派发） | `boolean` | **`true`**（官方 `false`） | **构造期** → 换实例 |
| mouseStyleChange | 命中后是否更换鼠标光标 | `boolean` | 官方默认 `true` | **构造期** → 换实例 |
| pickTolerance | 命中容差（css px） | `number` | 官方默认 `4` | **构造期** → 换实例 |
| pickThrough | 命中后是否继续向下层派发 | `boolean` | 官方默认 `false` | **构造期** → 换实例 |

`data` 的三态（`null` = 没有数据 / `undefined` = 不表态）与
[`native-visual-layers`](./native-visual-layers) 里的口径**完全一致**。

⚠️ 这两个组件**没有** `opacity` prop，尽管 `PolylineLayer` 官方声明了 `setOpacity`——
理由见下面的[刻意不开的面](#刻意不开的面)。

### PolygonLayerStyle

| 字段 | 说明 | 官方默认 |
| --- | --- | --- |
| fillColor | 填充色，css 字符串 | `rgba(25, 25, 250, 0.6)` |
| fillOpacity | 填充透明度 `[0,1]` | `1` |
| strokeColor | 描边色，css 字符串 | `rgba(250, 250, 25, 1)` |
| strokeWeight | 描边宽度（px），`0` 表示**不描边** | `0` |
| strokeOpacity | 描边透明度 `[0,1]` | `1` |
| fillTextureUrl | 纹理图片地址，**非空即启用平铺填充** | `''`（即纯色填充） |
| fillTextureSize | 平铺时单张图在屏幕上的宽度（px） | 不传取图片真实宽度 |
| fillTextureAlphaOnly | `true` 只用纹理 alpha 做镂空、颜色取 `fillColor`；`false` 用纹理自身颜色 | `false` |

⚠️ 官方默认 `strokeWeight: 0` = **不描边**——这是与旧 `FillLayer` 最容易踩的差别。

### PolylineLayerStyle

| 字段 | 说明 | 官方默认 |
| --- | --- | --- |
| strokeColor | 线颜色，css 字符串 | `rgba(25, 25, 250, 1)` |
| strokeWeight | 线宽（屏幕 px，全宽） | `4` |
| strokeOpacity | 线透明度 `[0,1]`，与线色 alpha、图层级 `opacity` **相乘** | `1` |
| strokeLineJoin | 拐角连接样式：`miter` / `bevel` / `round` | `round` |
| strokeLineCap | 线端点样式：`butt` / `round` / `square` | `round` |
| strokeStyle | 线型：`solid` / `dashed` / `dotted` | `solid` |
| dashArray | 实线段 / 间隙的屏幕像素长度（同 SVG `stroke-dasharray`，奇数个自动翻倍） | `[8, 4]` |
| strokeTextureUrl | 纹理图片地址，**必须是竖图**（x 跨线宽、y 沿线方向）。非空时优先级高于 `strokeStyle` | `''` |
| strokeTextureWidth | 原图宽（px），只参与沿线长度换算 | 不传取图片真实尺寸 |
| strokeTextureHeight | 原图高（px），同上 | 不传取图片真实尺寸 |
| strokeTextureSpaced | `true` 按 `strokeTextureGap` 间隔平铺（箭头串）；`false` 沿线连续拉伸 | `false` |
| strokeTextureGap | 相邻纹理间隔（px），仅 `strokeTextureSpaced` 为 `true` 时生效 | `16` |
| strokeTextureColor | 纹理叠加色（rgb 相乘），仅配了 `strokeTextureUrl` 时生效 | `rgba(255, 255, 255, 1)` |

两族的 `strokeColor` / `strokeWeight` / `fillColor` / `fillOpacity` / `strokeLineJoin` /
`strokeLineCap` 还可以收**数据驱动表达式**（按要素逐个求值，参数是要素的 `properties` /
要素本身 / 序号）。官方注明两个限制：`strokeColor` 在**虚线模式**下走 uniform 染色，**回调不生效**；
`strokeWeight` 传回调时**沿线长度换算**（虚线圆间距、纹理图案尺寸）仍按默认值 `4` 计算。

::: tip `minZoom` / `maxZoom` 是**构造选项**
官方**没有** `setMinZoom` / `setMaxZoom` 字段级 setter（4.0.5 声明里没有，live 实测运行时也没有），
因此改这两个 prop 会**换实例**（官方唯一能改的路径就是重建）。它们默认 `3` / `21`。
:::

## 刻意不开的面

这些是**官方声明里有、但本库不投影**的成员：

- **`hitTest`**：官方**声明**了（`PolygonLayer.d.ts:201` / `PolylineLayer.d.ts:233`），
  但 **live 探针实测运行时没有**（`prototype.hitTest` 为 `false`）。放开门面就是假支持。
- **`setOpacity`**：**两族处置相反**——这是本库「在位 / 声明 / 生效三条判据不可互换」的样板：
  - `PolylineLayer` **登记**。`PolylineLayerOptions.opacity`（`:131` @default 1）是官方
    **声明的**选项，且 `setOptions` 的注释（`:209`）明写 `opacity` / `visible` / `zIndex` /
    `renderStage` / `referCenter` / `enablePicked` **转发到对应 setter** ⇒ 官方**承诺**了
    字段级入口；运行时 `setOpacity` 在位；live **像素读数**证明它**可观测地生效**
    （哨兵像素 `1 → 0 → 1 → 0 → 1` = 4229 → 0 → 4229 → 0 → 4229，可逆且重复一致）。
    走「运行时依据」的显式豁免表登记（要求：真在位、真生效、真没声明）。
  - `PolygonLayer` **不登记**。它同样在位、`getOpacity` 也读得回（但**零信息量**：setter 与
    getter 共用同一份状态），可**像素读数证明它不驱动渲染**——`setOpacity` 走 `1 → 0 → 1`、
    `setOptions({opacity})` 走 `1 → 0 → 1`、构造期 `opacity: 0`，**五态全部同值**；而同一次
    运行里 `setVisible(false)` / `setOptions({fillOpacity: 0})` 都能归零 ⇒ 不是「测不出来」，
    是**真·在位但不生效**。登记它等于开一个「调用成功但画面不变」的面。
  ⚠️ 组件行为**未变**：两个组件都**不**暴露 `opacity` prop。`<PolygonLayer>` 是因为选项表里
  根本没有 `opacity` 这一项（只能经 `style` 袋下发 `fillOpacity` / `strokeOpacity`）；
  `<PolylineLayer>` 则是一条**范围决策**（Driver 侧已登记的操作暂时没有组件消费者）。
  判据是**可观测地生效**，不是「成员在不在」：同一个官方声明里的成员可以一边登记一边不登记。
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

官方 4.0.5 的 `visualization/` 一共 13 个类，本库只落地了与本库现有数据组件重合度最高的几个。
**尚未封装**（不在本库的能力面里）：

- **`WebGLCustomLayer` / `ThreejsLayer` / `DeckglLayer`**：自绘容器（要把 WebGL / three.js /
  deck.gl 的渲染循环接进地图生命周期），成本与风险比「包一层官方类」高一个量级；
  （`WebGLCustomLayer` 运行时**确实在位**，`ThreejsLayer` / `DeckglLayer` 尚未随主包发出。）
- **`BarLayer` / `FlyLineLayer` / `GeoJSONSource`**：官方 4.0.5 的**类型包声明**了它们，但
  **真实运行时这份产物里根本没有**（`BMap` 上是 `undefined`，多次复读都一样）。这不是「本库还没包」，
  而是**上游声明了、运行时没发**——因此本库不建它们的能力槽位：登记进去只会让能力判断对
  一个永远不会来的能力说真话。

[`TextLayer`](./text-layer) 是这一族里**唯一声明与运行时完全对齐**的类（`hitTest` 与 `setOpacity`
都在，而前两族恰好各缺一个、方向相反）。

它们在能力清单里**没有**任何条目——「没封装」这件事在能力矩阵上是查得出来的。
