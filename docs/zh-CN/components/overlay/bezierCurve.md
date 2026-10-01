# BezierCurve 折线

在地图上绘制二阶贝塞尔曲线

```ts
import { BezierCurve } from '@mangax/bmap-vue'
```

::: tip 提示
不了解贝塞尔曲线的小伙伴可以先学习一下：https://zh-CN.javascript.info/bezier-curve
:::

## 组件示例

:::demo 在地图中添加贝塞尔曲线
overlay/bezierCurve
:::

## 构造期 Props（`recreate`）

官方 `BezierCurve` 的实例成员表上**没有**这两项的 setter ⇒ **改动其中任何一项都会重建实例**。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| enableClicking | 是否响应点击事件。官方**没有**成对开关 | `boolean` | `true` |
| dashArray | 虚线样式配置，如 `[8, 4]` 表示实线部分长 8 像素、间隙部分长 4 像素 | `number[]` | 实线与空隙的长度均为线宽的 2 倍 |

::: warning `<BezierCurve>` **没有** `coordType` / `linkRight` / `strokeLineCap` / `strokeLineJoin` / `enableEditing`

官方 `BezierCurveOptions` 一共 **8** 个键，上面两项之外**没有**那几项——
`coordType` / `linkRight` / `dashArray` 的其余部分只有 `Polyline` / `Polygon` / `Rectangle` /
`Circle` 有，`strokeLineCap` / `strokeLineJoin` 只有 `Polyline` / `Polygon` 有。
`enableEditing` 官方**根本不支持**（`BezierCurve` 没有编辑能力，事件矩阵也把编辑六件套 Omit 掉了）。

:::

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| points | 贝塞尔曲线的坐标数组 | `{ lng: number, lat: number }[]` | `required` |
| controlPoints | 贝塞尔曲线控制点的坐标数组（每个控制点组对应一段曲线） | `{ lng: number, lat: number }[][]` | `required` |
| strokeColor | 描边的颜色，同 CSS 颜色 | `string` | `#000000` |
| strokeWeight | 描边的宽度，单位为像素 | `number` | `2` |
| strokeOpacity | 描边的透明度，范围 0 - 1 | `number` | `1` |
| strokeStyle | 描边的样式，为实线、虚线、或者点状线 | `'solid' \| 'dashed' \| 'dotted'` | `solid` |
| enableMassClear | 是否在调用 `map.clearOverlays()` 时清除此覆盖物（成对开关） | `boolean` | `true` |
| zIndex | 覆盖物的层叠顺序值 | `number` | - |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

> `points` / `controlPoints` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion` / `controlPointsVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`bezier-curve` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。

## 官方有、本库未暴露

**没有缺口。** 官方 `BezierCurveOptions` 的 8 个键全部有出口：两个构造期（`enableClicking` /
`dashArray`）在上表，其余六个在「就地更新 Props」表里。

::: tip 官方文档站的 `path` / `node` / `nodeT` 不在官方 4.0.5 声明里
官方 React 文档的 API 表比 SDK 本身宽：`path`（本库改名 `points`，与图形族对齐）、`node` /
`nodeT` 在上游 `BezierCurveOptions` 的声明中查无此成员。`node` / `nodeT` 是 React 的渲染插槽，
不是构造选项。

`controlPoints` 是本库的**几何必填项**（官方 `BezierCurve` 构造函数的第二个位置参数，
`Array<Array<Point>>`），官方 API 表把它列成了独立的一行——在本库它是 prop 而不是构造选项。
:::
