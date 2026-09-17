# BOverview 鹰眼控件

缩略地图控件（官方 `OverviewMapControl`），默认位于地图右下角。

```ts
import { BOverview } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo
control/overview
:::

## 静态组件 Props

| 属性         | 说明                                        | 类型                      | 可选值            | 默认值                    |
| ------------ | ------------------------------------------- | ------------------------- | ----------------- | ------------------------- |
| anchor       | 控件的停靠位置                              | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_RIGHT` |
| offset       | 控件的偏移值                                | `{x: number, y: number }` | -                 | `{ x: 0, y: 0 }`          |
| size         | 缩略地图尺寸（领域口径是 Pixel，可就地更新）| `{x: number, y: number }` | -                 | 官方默认 `150 × 150`      |
| isOpen       | 挂载后的开合状态（只有构造期生效）          | `boolean`                 | -                 | `false`                   |
| zoomInterval | 鹰眼与主图的缩放级别差（只有构造期生效）    | `number`                  | -                 | 官方默认 `4`              |
| padding      | 鹰眼与主图之间的空隙像素（只有构造期生效）  | `number`                  | -                 | 官方默认 `4`              |

## 动态组件 Props

| 属性    | 说明     | 类型      | 可选值 | 默认值 | 版本                               |
| ------- | -------- | --------- | ------ | ------ | ---------------------------------- |
| visible | 是否显示 | `boolean` | -      | `true` | <Badge type="tip" text="^2.2.0" /> |

`anchor` / `offset` 同样可以动态更新。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 选项的更新方式

- `size` → 官方 `setSize()`，**就地更新**（领域口径的 `{x, y}` 会换算成官方的 `Size`）；
- `isOpen` / `zoomInterval` / `padding` → 官方没有 setter，改变时**重建控件**并把新值交给构造期。

::: warning 为什么 `isOpen` 用重建而不是切换
官方只提供 `changeView()` 的**切换**语义（没有幂等 `setOpen`），就地更新会变成「点两次才回到目标状态」。
重建时把 `isOpen` 交给构造期是最确定的表达，代价是控件内部状态重置 —— 所以不要让它频繁抖动。
:::


::: tip 把选项改回「不传」
把某个选项从有值改回 `undefined`（模板里就是不再传这个 prop）等价于「回到 SDK 默认值」。默认值只存在于
构造期，因此这类变化会**重建控件**（而不是就地写一个 `undefined`——那会被 SDK 边界按「没有值」跳过，
既不下发也不会重试）。
:::

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

该组件没有对外事件。
