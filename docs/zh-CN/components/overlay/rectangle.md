# Rectangle 矩形

在地图上绘制矩形（v4 的 `Rectangle` 覆盖物，由对角两点定义的 `bounds` 描述）。

```ts
import { Rectangle } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的矩形
overlay/rectangle
:::

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| --------------- | ------------------------------------------- | ---------------------------------------- | ------------------------- | --------------------- |
| bounds | 显示区域（西南 / 东北两个角点） | `{ southwest: Point, northeast: Point }` | - | `required` |
| strokeColor | 描边的颜色，同 CSS 颜色 | `string` | - | `#000000` |
| strokeWeight | 描边的宽度，单位为像素 | `number` | - | `2` |
| strokeOpacity | 描边的透明度，范围 0-1 | `number` | - | `0.9` |
| strokeStyle | 描边的样式，为实线、虚线、或者点状线 | `string` | `solid / dashed / dotted` | `solid` |
| fillColor | 面填充颜色，同 CSS 颜色 | `string` | - | `#000000` |
| fillOpacity | 面填充的透明度，范围 0-1 | `number` | - | `0.5` |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean` | - | `true` |
| enableEditing | 是否启用线编辑 | `boolean` | - | `false` |
| enableClicking | 是否响应点击事件 | `boolean` | - | `true` |
| visible | 是否显示 | `boolean` | - | `true` |

> `bounds` 按**内容**判等：父级每次渲染传内联字面量不会产生多余的 SDK 命令。
> 这与 `Polyline` / `Polygon` 的 `path`（根引用 + 版本 prop）不同——矩形只有四个数字。

## 更新方式

与其它图形类覆盖物一致（同一套 `OverlaySpec` 生命周期内核）：

| 属性                       | 变化时发生什么                                       |
| -------------------------- | ---------------------------------------------------- |
| `bounds` / 描边 / 填充     | 就地更新（各自的 SDK setter，**不重建实例**）        |
| `enableEditing` / `enableMassClear` | 成对开关（`enableEditing()` / `disableEditing()`） |
| `enableClicking`           | 官方 4.0 只有构造选项 ⇒ **重建实例**（内部状态重置） |
| `visible`                  | `show()` / `hide()`：实例留在图上，只是不可见        |

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`rectangle` 共 17 个事件（与 `Polygon` / `Circle` / `Polyline`
相同，含开启编辑后才派发的 6 个编辑事件）。

详见 [覆盖物事件矩阵](./events)。
