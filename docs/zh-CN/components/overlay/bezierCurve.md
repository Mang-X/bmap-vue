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

## 构造期 Props（`recreate`）

官方 4.0.5 的 `overlay/BezierCurve.d.ts` 实例成员表上**没有**这两项的 setter ⇒
**改动其中任何一项都会重建实例**。

| 属性           | 说明                                             | 类型      | 官方默认                |
| -------------- | ------------------------------------------------ | --------- | ----------------------- |
| enableClicking | 是否响应点击事件                                 | `boolean` | `true`                  |
| dashArray      | 虚线样式，如 `[8, 4]`（实线 8px、间隙 4px）      | `number[]`| 实线与间隙均为线宽的 2 倍 |

::: warning `<BezierCurve>` **没有** `coordType` / `linkRight` / `strokeLineCap` / `enableEditing`

官方 `BezierCurveOptions` 一共 **8** 个键，上面两项之外**没有**那几项——
`coordType` 与 `linkRight` 只有 `Polyline` / `Polygon` / `Rectangle` / `Circle` 有，
`strokeLineCap` / `strokeLineJoin` 只有 `Polyline` / `Polygon` 有。
`enableEditing` 官方**根本不支持**（`BezierCurve` 没有编辑能力，事件矩阵也把编辑六件套 Omit 掉了）。

:::

## 就地更新 Props（`options`）

|  | 属性 | 说明 | 类型 | 可选值 | 默认值 |  || --------------- | ------------------------------------------- | --------------------------------- | ------------------------- | ---------- | ---------------------------------- || points          | 贝塞尔曲线的坐标数组                        | `{ lng: number, lat: number}[]`   | -                         | `required` | -                                  || controlPoints   | 贝塞尔曲线控制点的坐标数组                  | `{ lng: number, lat: number}[][]` | -                         | `required` | -                                  || strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                          | -                         | `#000000`  | -                                  || strokeWeight    | 描边的宽度，单位为像素                      | `number`                          | -                         | `2`        | -                                  || strokeOpacity   | 描边的透明度，范围 `0-1`                    | `number`                          | -                         | `1`        | -                                  || strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `'solid' \| 'dashed' \| 'dotted'` | -                       | `solid`    | -                                  || enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                         | -                         | `true`     | -                                  || zIndex          | 层叠顺序（**就地更新**，官方 `setZIndex`）  | `number`                          | -                         | -          | `1.0.0`（#165）                   || visible         | 是否显示（走 `show` / `hide`）              | `boolean`                         | -                         | `true`     | `1.0.0`                            |
> `points` / `controlPoints` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion` / `controlPointsVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`bezier-curve` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
