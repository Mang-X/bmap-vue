# NavigationControl 平移缩放控件

地图的平移缩放控件（官方 `NavigationControl`），默认位于地图左上角。

```ts
import { NavigationControl } from '@mangax/bmap-vue'
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
| type              | 控件类型（可就地更新，走官方 `setType()`）      | `string`                  | [type](#type)                   | 不传＝官方默认的「大型」控件 |
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

`anchor` 传的是**官方常量名**，控件边界有一张名字→数值的换算表（`BMAP_ANCHOR_TOP_LEFT` → `0` …），
因此这里要写名字而不是 `0`。

官方还定义了 `BMAP_ANCHOR_TOP_CENTER` / `BMAP_ANCHOR_CENTER` 等非四角落点。4.0 的控件只接受
**四角**，传非四角会先告警一次再交给 SDK，而 SDK 会**静默回落**到控件自身的默认落点——
控制台里能看见告警，但控件不会落到你以为的位置。

## type

**类型是 `string`**，取值为下列四个常量名：

| 值 | 官方等价常量 | 官方数值 | 说明 |
| --- | --- | --- | --- |
| `BMAP_NAVIGATION_CONTROL_LARGE` | `BMAP_NAVIGATION_CONTROL_LARGE` | `0` | 平移按钮 + 缩放按钮 + 滑块 |
| `BMAP_NAVIGATION_CONTROL_SMALL` | `BMAP_NAVIGATION_CONTROL_SMALL` | `1` | 平移按钮 + 缩放按钮 |
| `BMAP_NAVIGATION_CONTROL_PAN` | `BMAP_NAVIGATION_CONTROL_PAN` | `2` | 仅平移按钮 |
| `BMAP_NAVIGATION_CONTROL_ZOOM` | `BMAP_NAVIGATION_CONTROL_ZOOM` | `3` | 仅缩放按钮 |

::: tip 填**常量名**，控件边界替你换成数字
上游 4.0 的 `NavigationControlOptions.type` 收的是**数值** `0 | 1 | 2 | 3`
（`setType(type: NavigationControlType)` 同型），而本组件的 `type` prop 声明为 `string`。
控件边界有一张名字→数值的换算表（与 `anchor` 同一套做法），上表里的常量名会被换成对应的
官方数值再交给 SDK。

因此这一列要填**字符串**（常量名）而不是数字。⚠️ 直接填数字（`type="2"`）**不告警也不被
换算**——控件边界对非字符串原样放行。而 `2` 恰好就是 `BMAP_NAVIGATION_CONTROL_PAN` 的值，
所以它**可能看起来是对的**：数字与官方数值**巧合相同**时没有任何异常信号，一旦官方调整取值
就静默错位。一律填常量名。
填不存在的名字会**先告警一次再忽略**，控件沿用自身默认样式（不会静默换成某个未知样式）。
:::

::: warning 换算表**按控件族分开**
`<NavigationControl>` 只接受上表的四个 `BMAP_NAVIGATION_CONTROL_*`。传 `<MapTypeControl>`
的 `BMAP_MAPTYPE_CONTROL_*` 会**告警并忽略**，不会静默生效——两族的数值还撞
（`BMAP_NAVIGATION_CONTROL_PAN` 与 `BMAP_MAPTYPE_CONTROL_MAP` 都是 `2`），误接受会让控件
渲染出**另一种样式**且控制台里什么都没有。
:::

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
