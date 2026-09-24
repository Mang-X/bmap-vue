# BMapType 地图类型控件

地图类型切换控件（官方 `MapTypeControl`），默认位于地图右上角。

```ts
import { BMapType } from 'bmap-vue'
```

## 组件示例

:::demo
control/mapType
:::

## 静态组件 Props

| 属性             | 说明                                      | 类型                      | 可选值                          | 默认值                    |
| ---------------- | ----------------------------------------- | ------------------------- | ------------------------------- | ------------------------- |
| anchor           | 控件的停靠位置                            | `string`                  | [anchor](#anchor)               | `BMAP_ANCHOR_TOP_RIGHT`   |
| offset           | 控件的偏移值                              | `{x: number, y: number }` | -                               | `{ x: 10, y: 10 }`        |
| type             | 控件样式（只有构造期生效）                | `string`                  | [type](#type)                   | 官方默认 `MAP`            |
| mapTypes         | 展示的地图类型列表（只有构造期生效）      | `number[]`                | -                               | 官方默认三种类型          |
| showStreetLayer  | 是否显示路网层（可就地更新）              | `boolean`                 | -                               | `true`                    |

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

## type

| 值                            | 说明             |
| ----------------------------- | ---------------- |
| BMAP_MAPTYPE_CONTROL_MAP      | 地图预览按钮样式 |
| BMAP_MAPTYPE_CONTROL_DROPDOWN | 按钮 + 下拉列表  |
| BMAP_MAPTYPE_CONTROL_HORIZONTAL | 横向列表样式   |

## 选项的更新方式

- `showStreetLayer` → 官方 `showStreetLayer(isShow)`，**就地更新**（真实 4.0 上这是该控件唯一的字段级 setter）；
- `type` / `mapTypes` → 官方没有 setter，改变时**重建控件**并把新值交给构造期。

::: warning 注意
`showStreetLayer` 的默认值显式写成 `true`。Vue 对布尔 prop 有「缺省即 `false`」的转换，如果不给默认值，
「用户显式传 `false`」与「用户没传」会变成同一个值 —— 前者本该真的关掉路网层，却因为与默认值相同而不会下发。
:::


::: tip 把选项改回「不传」
把某个选项从有值改回 `undefined`（模板里就是不再传这个 prop）等价于「回到 SDK 默认值」。默认值只存在于
构造期，因此这类变化会**重建控件**（而不是就地写一个 `undefined`——那会被 SDK 边界按「没有值」跳过，
既不下发也不会重试）。
原地修改父级传入的那个对象（例如 `offset.x = 21`、`size.x = 200`）**同样会下发**——变化检测按**值**比较，不要求你换一个新对象。
:::

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

该组件没有对外事件。
