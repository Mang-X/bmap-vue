# Prism 3d 棱柱

通过该组件可在地图上绘制 3d 棱柱，可以基于位置经纬度，高度，顶面和侧面的颜色、透明度等属性来绘制不规则的棱柱体。

```ts
import { Prism } from 'bmap-vue'
```

## 示例

:::demo 通过 [`useAreaBoundary`](../hooks/useAreaBoundary) 获取边界字符串，并传给 `Prism` 的 `points`，同时设置 `isBoundary` 为 `true`
overlay/prism
:::

## 构造期 Props（`recreate`）

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| isBoundary | 是否是行政区域的边界多边形。⚠️ 官方 `PrismOptions` 里**没有**这个键，4.0 运行时是否读取它**没有证据**；本库按构造期透传，**不声称支持** | `boolean` | - |
| autoCenter | 是否自动根据多边形居中地图。⚠️ 同上：官方 `PrismOptions` 里没有这个键，本库按构造期透传 | `boolean` | - |

::: warning `isBoundary` / `autoCenter` 的官方口径
上面两项在官方 `PrismOptions` 的声明里**不存在**。本库保留它们是为了不让你已发布的用法静默失效，
但把它们如实标成「未取证」——**不是**一个官方承诺的选项。变化会**重建实例**。
:::

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| points | 普通多边形使用点对象数组，行政边界使用边界字符串数组 | `({ lng: number, lat: number } \| string)[]` | `required` |
| altitude | 3d 棱柱高度 | `number` | `required` |
| topFillColor | 顶面填充颜色，合法的 CSS 颜色值，**传入空字符串时顶面无填充效果** | `string` | `#fff` |
| topFillOpacity | 顶面填充透明度，取值范围 0 - 1 | `number` | `0.5` |
| sideFillColor | 侧面填充颜色，合法的 CSS 颜色值，**传入空字符串时侧面无填充效果** | `string` | `#fff` |
| sideFillOpacity | 侧面填充透明度，取值范围 0 - 1 | `number` | `0.8` |
| zIndex | 覆盖物的层叠顺序值 | `number` | - |
| enableMassClear | 是否在调用 `map.clearOverlays()` 时清除此覆盖物（成对开关） | `boolean` | `true` |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

::: tip 顶面 / 侧面颜色的官方默认是**跟随主题色**
官方 `PrismOptions` 的 `topFillColor` / `sideFillColor` 默认跟随主题色（CSS 变量
`--bmap-color-primary-bg`，缺省 `#eaf1ff`）；本库显式给的是 `#fff`（顶面透明度 `0.5`、
侧面 `0.8`）。想跟随主题色请直接给 `''` 之外的空值或不传后自行接管。
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`prism` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。
`prism` **没有**编辑能力，因此不暴露 `enableEditing`，也不派发那 6 个编辑事件。

详见 [覆盖物事件矩阵](./events)。
