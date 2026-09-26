# BezierCurve 折线

在地图上绘制二阶贝塞尔曲线

```ts
import { BezierCurve } from 'bmap-vue'
```

::: tip 提示
不了解贝塞尔曲线的小伙伴可以先学习一下：https://zh-CN.javascript.info/bezier-curve
:::

## 组件示例

:::demo 在地图中添加贝塞尔曲线
overlay/bezierCurve
:::

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| --------------- | ------------------------------------------- | --------------------------------- | ------------------------- | ---------- |
| path | 贝塞尔曲线的坐标数组 | `{ lng: number, lat: number}[]` | - | `required` |
| controlPoints | 贝塞尔曲线控制点的坐标数组 | `{ lng: number, lat: number}[][]` | - | `required` |
| strokeColor | 描边的颜色，同 CSS 颜色 | `string` | - | `#000000` |
| strokeWeight | 描边的宽度，单位为像素 | `string` | - | `2` |
| strokeOpacity | 描边的透明度，范围 `0-1` | ` number` | - | ` 1` |
| strokeStyle | 描边的样式，为实线、虚线、或者点状线 | `string` | `solid / dashed / dotted` | - |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean` | - | `true ` |
| visible | 是否显示 | `boolean` | - | `true` |

> `path` / `controlPoints` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion` / `controlPointsVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`bezier-curve` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
