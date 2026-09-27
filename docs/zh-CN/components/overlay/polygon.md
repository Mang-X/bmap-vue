# Polygon 多边形

在地图上绘制简单的多边形

```ts
import { Polygon } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的多边形
overlay/polygon/index
:::

## 镂空面绘制 / 行政区域边界

:::demo 结合 [`useAreaBoundary`](../hooks/useAreaBoundary) 获取边界字符串，并通过 `isBoundary` 为 `true` 绘制行政区域
overlay/polygon/boundaries
:::

## 构造期 Props（`recreate`）

官方 4.0.5 的 `overlay/Polygon.d.ts` 实例成员表上**没有**这些项的 setter ⇒
**改动其中任何一项都会重建实例**（旧实例连同其事件绑定一起释放）。

::: warning `strokeLineCap` / `strokeLineJoin` 有一条**反直觉**的 live 读数

这两个的官方**类型声明里没有** setter，但**运行时原型链上确实有**（与 `setStrokeColor` /
`setStrokeWeight` / `setStrokeStyle` 同一层），而且**真调一次不抛**。

之所以仍然按**构造期**处理，是因为 live 实测调完之后 `getStrokeStyle()` 读回**没有变化**——
**没有任何可观察的效果**。把它当可就地更新会得到「调用成功但画面不变」的静默假支持，
比重建糟糕得多。（`<Polyline>` 上的同类读数与结论完全一致。）

:::

| 属性            | 说明                                                       | 类型                                            | 官方默认                |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| isBoundary      | 是否是行政区域的边界多边形（路径按 SDK 原生边界名解析）     | `boolean`                                       | `false`                 |
| enableClicking  | 是否响应点击事件                                           | `boolean`                                       | `true`                  |
| strokeLineCap   | 描边线端头类型                                             | `'round' \| 'butt' \| 'square'`                 | `'round'`               |
| strokeLineJoin  | 描边线连接处类型                                           | `'round' \| 'miter' \| 'bevel'`                 | `'round'`               |
| linkRight       | 跨 180 度经线时是否按最短路径绘制                         | `boolean`                                       | `false`                 |
| coordType       | 输入坐标的坐标类型（未设置时用全局 `BMap.coordType`）      | `'BMAP_COORD_BD09' \| 'BMAP_COORD_GCJ02' \| 'BMAP_COORD_WGS84'` | 用全局值 |
| dashArray       | 虚线样式，如 `[8, 4]`（实线 8px、间隙 4px）                | `number[]`                                      | 实线与间隙均为线宽的 2 倍 |

::: warning `<Polygon>` **没有** `clip` / `geodesic` / `autoCenter`

官方 `PolygonOptions` 的 15 个键里**没有** `clip` 与 `geodesic`（只有 `PolylineOptions` 有），
也**没有** `autoCenter`——「创建后按显示区域居中地图」是 `<Prism>` / `<GroundOverlay>` 的
组件侧行为，`<Polygon>` 没有这个 prop。需要居中请用 `map.setViewport(bounds)`。

:::

## 就地更新 Props（`options`）

| 属性            | 说明                                        | 类型                             | 可选值                    | 默认值     | 版本                               |
| --------------- | ------------------------------------------- | -------------------------------- | ------------------------- | ---------- | ---------------------------------- |
| points          | 多边形的坐标数组                            | ` { lng: number, lat: number}[]` | -                         | `required` | -                                  |
| strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                         | -                         | `#000000`  | -                                  |
| strokeWeight    | 描边的宽度，单位为像素                      | `number`                         | -                         | `2 `       | -                                  |
| strokeOpacity   | 描边的透明度，范围 0-1                      | `number`                         | -                         | `0.9`      | -                                  |
| strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `'solid' \| 'dashed' \| 'dotted'` | -                       | `solid`    | -                                  |
| fillColor       | 面填充颜色，同 CSS 颜色                     | `string`                         | -                         | `#000000`  | -                                  |
| fillOpacity     | 面填充的透明度，范围 0-1                    | `number`                         | `0-1`                     | `0.5`      | -                                  |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                        | -                         | `true`     | -                                  |
| enableEditing   | 开启可编辑模式                              | `boolean`                        | -                         | `false`    | -                                  |
| zIndex          | 层叠顺序（**就地更新**，官方 `setZIndex`）  | `number`                         | -                         | -          | `1.0.0`（#165）                   |
| visible         | 是否显示（走 `show` / `hide`）              | `boolean`                        | -                         | `true`     | `1.0.0`                            |

> `points` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`polygon` 共 17 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。

## 读回命令面（`defineExpose`，#165）

官方在这个类上声明的 getter 此前**没有任何调用路径**——组件永远不会替调用方读一次。
现在它们在组件 `ref` 上。

| 方法                                     | 官方声明 | 适用 |
| ---------------------------------------- | -------- | ---- |
| `getBounds()`                            | `getBounds(): Bounds` | 全部 |
| `getStrokeColor()` / `getStrokeOpacity()` / `getStrokeWeight()` / `getStrokeStyle()` | 各自的 `getXxx()` | 全部 |
| `getCenter()` / `getRadius()`            | 各自的 `getXxx()` | 仅 Circle |
| `getFillColor()` / `getFillOpacity()`    | 各自的 `getXxx()` | Polygon / Rectangle / Circle（**Polyline 没有填充**） |
| `setPositionAt(i, pt)`                   | `setPositionAt(index: number, point: Point): void` | Polygon / Polyline |

返回值全部是**领域值**：`getBounds()` 给 `{ southwest, northeast }`、`getOffset()` 一类给
`{ x, y }`——raw `BMap.Bounds` / `BMap.Size` 不会出现在调用方手里。

⚠️ **不镜像成组件状态**：官方这些 getter 返回的是**当前值**而不是 SDK 默认值，`props` 才是主模型。

### `setPositionAt` 的 `deep`

官方 `Polygon` 的签名是 `setPositionAt(index, point, deep?)`——`deep` 指定「改第几层环」
（`Polygon` 的路径可以是多环），而 `Polyline` 只有两个参数。给非 polygon 传 `deep` 会**显式抛
`BMAP_INVALID_ARGUMENT`**，而不是让官方默默吞掉第三个参数。

它**不**回写 `props.path`：官方没有「顶点被改了」的事件，猜不出一次 `setPositionAt` 属于哪次
路径写入。调用方应同时更新 `path`（或递增 `pathVersion`）。

### 刻意不暴露

`<Polyline>` 的 `getFillColor()` / `getFillOpacity()` 抛 `BMAP_CAPABILITY_UNSUPPORTED`
（官方 `Polyline.d.ts` 只声明描边 getter，没有填充）。

未就绪 / 已释放时**显式抛 `BMAP_RESOURCE_DISPOSED`**，不静默 no-op。
