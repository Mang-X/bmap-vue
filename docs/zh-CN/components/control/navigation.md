# NavigationControl 平移缩放控件

地图的平移缩放控件（官方 `NavigationControl`），默认位于地图左上角。

```ts
import { NavigationControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/navigation
:::

## 静态组件 Props

| 属性              | 说明                                            | 类型                      | 可选值                          | 默认值                    |
| ----------------- | ----------------------------------------------- | ------------------------- | ------------------------------- | ------------------------- |
| anchor            | 控件的停靠位置                                  | `string`                  | [anchor](#anchor)               | `BMAP_ANCHOR_TOP_LEFT`    |
| offset            | 控件的偏移值                                    | `{x: number, y: number }` | -                               | `{ x: 30, y: 10 }`        |
| type              | 控件类型（可就地更新，走官方 `setType()`）      | `string`                  | [type](#type)                   | 官方默认 `LARGE`          |
| showZoomInfo      | 是否显示级别提示信息（只有构造期生效）          | `boolean`                 | -                               | `true`                    |
| enableGeolocation | 是否集成定位功能（只有构造期生效）              | `boolean`                 | -                               | `false`                   |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以动态更新（控制组件会即时下发 `setAnchor()` / `setOffset()`）。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## type

| 值                          | 说明                       |
| --------------------------- | -------------------------- |
| BMAP_NAVIGATION_CONTROL_LARGE | 平移按钮 + 缩放按钮 + 滑块 |
| BMAP_NAVIGATION_CONTROL_SMALL | 平移按钮 + 缩放按钮        |
| BMAP_NAVIGATION_CONTROL_PAN   | 仅平移按钮                 |
| BMAP_NAVIGATION_CONTROL_ZOOM  | 仅缩放按钮                 |

## 选项的更新方式

`type` 走官方 `setType()` **就地更新**（控件不会重建、交互状态不丢）；`showZoomInfo` / `enableGeolocation` 在官方
4.0 的 `NavigationControl` 上没有 setter，改变时会**重建控件**并把新值交给构造期。

::: tip 提示
真实 4.0 上 `setType()` 要求控件已经挂载（内部滑块 DOM 在 `addControl` 时才创建）。本组件保证写入顺序是
`create → add → setOptions`，使用方不需要关心。
:::


::: tip 把选项改回「不传」
把某个选项从有值改回 `undefined`（模板里就是不再传这个 prop）等价于「回到 SDK 默认值」。默认值只存在于
构造期，因此这类变化会**重建控件**（而不是就地写一个 `undefined`——那会被 SDK 边界按「没有值」跳过，
既不下发也不会重试）。
原地修改父级传入的那个对象（例如 `offset.x = 21`、`size.x = 200`）**同样会下发**——变化检测按**值**比较，不要求你换一个新对象。
:::

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。
