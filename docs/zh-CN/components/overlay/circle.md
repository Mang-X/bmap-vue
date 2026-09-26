# Circle 圆形

在地图上绘制简单的圆形

```ts
import { Circle } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上添加圆形
overlay/circle
:::

## 静态组件 Props

| 属性           | 说明                                                     | 类型      | 默认值  |
| -------------- | -------------------------------------------------------- | --------- | ------- |
| enableClicking | 是否响应点击事件                                         | `boolean` | `true ` |
| geodesic       | 是否开启大地线模式，true 时，两点连线将以大地线的形式    | `boolean` | `false` |
| clip           | 是否进行跨经度 180 度裁剪，绘制跨精度 180 时为了优化效果 | `boolean` | `true ` |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| --------------- | ------------------------------------------- | ----------------------------- | ------------------------- | ---------- |
| center | 圆形中心点经纬度 | `{ lng: number, lat: number}` | - | `required` |
| radius | 圆形的半径，单位为米 | `number` | - | `required` |
| strokeColor | 描边的颜色，同 CSS 颜色 | `string` | - | `#000` |
| strokeOpacity | 描边的透明度，范围 0-1 | `number` | `0-1 ` | 1 |
| fillColor | 面填充颜色，同 CSS 颜色 | `string` | - | `#fff` |
| fillOpacity | 面填充的透明度，范围 0-1 | `number` | `0-1 ` | `0.3 ` |
| strokeWeight | 描边的宽度，单位为像素 | `number` | - | `2 ` |
| strokeStyle | 描边的样式，为实线、虚线、或者点状线 | `string` | `solid / dashed / dotted` | `solid ` |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean` | - | `true ` |
| enableEditing | 是否启用线编辑 | `boolean` | - | `false ` |
| visible | 是否显示 | `boolean` | - | `true` |

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`circle` 共 17 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
