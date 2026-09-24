# BPolyline 折线

在地图上绘制简单的折线

```ts
import { BPolyline } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的折线
overlay/polyline
:::

## 静态组件 Props

| 属性           | 说明                                                     | 类型      | 可选值 | 默认值  | 版本                               |
| -------------- | -------------------------------------------------------- | --------- | ------ | ------- | ---------------------------------- |
| enableClicking | 是否响应点击事件                                         | `boolean` | -      | `true`  |                                    |
| geodesic       | 是否开启大地线模式，true 时，两点连线将以大地线的形式。  | `boolean` | -      | `false` |                                    |
| clip           | 是否进行跨经度 180 度裁剪，绘制跨精度 180 时为了优化效果 | `boolean` | -      | `true`  |                                    |
| linkRight      | 连接右线，配合`clip`解决跨 ±180 度经线绘制问题           | `boolean` | -      | `true`  | <Badge type="tip" text="^2.1.0" /> |

## 动态组件 Props

| 属性            | 说明                                        | 类型                            | 可选值                    | 默认值     | 版本                               |
| --------------- | ------------------------------------------- | ------------------------------- | ------------------------- | ---------- | ---------------------------------- |
| path            | 多边形的坐标数组                            | `{ lng: number, lat: number}[]` | -                         | `required` | -                                  |
| strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                        | -                         | `#000000`  | -                                  |
| strokeWeight    | 描边的宽度，单位为像素                      | `string`                        | -                         | `2`        | -                                  |
| strokeOpacity   | 描边的透明度，范围 `0-1`                    | ` number`                       | -                         | ` 1`       | -                                  |
| strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `string`                        | `solid / dashed / dotted` | -          | -                                  |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                       | -                         | `true `    | -                                  |
| enableEditing   | 开启可编辑模式                              | `boolean`                       | -                         | `false `   | -                                  |
| visible         | 是否显示                                    | `boolean`                       |                           | `true`     | <Badge type="tip" text="^2.2.0" /> |

> `path` / `controlPoints` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion` / `controlPointsVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`polyline` 共 17 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
