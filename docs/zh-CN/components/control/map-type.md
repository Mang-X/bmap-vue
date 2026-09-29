# MapTypeControl 地图类型控件

地图类型切换控件（官方 `MapTypeControl`），默认位于地图右上角。

```ts
import { MapTypeControl } from 'bmap-vue'
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
| type             | 控件样式（只有构造期生效）                | `string`                  | [type](#type)                   | 不传＝官方默认的图标形式 |
| mapTypes         | 展示的地图类型列表（只有构造期生效）      | `string[]`                | [mapTypes](#maptypes)          | 不传＝官方默认的普通 / 卫星 / 混合 |
| showStreetLayer  | 是否显示路网层（可就地更新）              | `boolean`                 | -                               | `true`                    |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以动态更新。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

`anchor` 传的是**官方常量名**，控件边界有一张名字→数值的换算表（`BMAP_ANCHOR_TOP_LEFT` → `0` …），
因此这里要写名字而不是 `0`。

官方还定义了 `BMAP_ANCHOR_TOP_CENTER` / `BMAP_ANCHOR_CENTER` 等非四角落点。4.0 的控件只接受
**四角**，传非四角会先告警一次再交给 SDK，而 SDK 会**静默回落**到控件自身的默认落点——
控制台里能看见告警，但控件不会落到你以为的位置。

## type

**类型是 `string`**，取值为下列三个常量名：

| 值 | 官方等价常量 | 官方数值 | 说明 |
| --- | --- | --- | --- |
| `BMAP_MAPTYPE_CONTROL_HORIZONTAL` | `BMAP_MAPTYPE_CONTROL_HORIZONTAL` | `0` | 横向排列的按钮 |
| `BMAP_MAPTYPE_CONTROL_DROPDOWN` | `BMAP_MAPTYPE_CONTROL_DROPDOWN` | `1` | 按钮 + 下拉列表 |
| `BMAP_MAPTYPE_CONTROL_MAP` | `BMAP_MAPTYPE_CONTROL_MAP` | `2` | 图标形式的地图预览按钮 |

::: warning `type` 收字符串，不收数值
上游 4.0 的 `MapTypeControlOptions.type` 声明为 `MapTypeControlType`（**数值** `0 | 1 | 2`），
而本组件的 `type` prop 声明为 `string`，取值原样（**不做**名字→数值的换算）下发。

这与 `anchor` 不同：`anchor` 在控件边界有一张名字→数值的换算表；`type` 没有这张表。
因此上面这一列要填**字符串**而不是 `0`。
:::

## mapTypes

上游 4.0 声明 `mapTypes?: MapType[]`，而 `MapType` 是一组**字符串**常量：

| 常量名 | 说明 |
| --- | --- |
| `BMAP_NORMAL_MAP` | 普通街道地图 |
| `BMAP_SATELLITE_MAP` | 卫星地图 |
| `BMAP_HYBRID_MAP` | 卫星与路网混合地图 |
| `BMAP_EARTH_MAP` | 地球卫星视图 |
| `BMAP_NONE_MAP` | 无底图模式 |

不传时由 SDK 决定，官方默认是普通 / 卫星 / 混合三张图。

::: warning `mapTypes` 收的是字符串，不是数值
这些常量在 4.0 里本身就是**字符串**（`BMAP_NORMAL_MAP` 等），因此 `mapTypes` 要传**字符串数组**：

```vue
<MapTypeControl :map-types="['BMAP_NORMAL_MAP', 'BMAP_SATELLITE_MAP']" />
```

传数字不会被换算成任何一张图——4.0 的 `MapType` 本身就是这些字符串。
:::

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

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。
