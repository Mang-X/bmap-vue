# ScaleControl 比例尺控件

比例尺控件，默认显示在地图左下角

```ts
import { ScaleControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/scale
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                    |
| ------ | -------------- | ------------------------- | ----------------- | ------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_LEFT` |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 10, y: 10 }`        |

## 动态组件 Props

| 属性   | 说明           | 类型     | 可选值                  | 默认值        |
| ------ | -------------- | -------- | ----------------------- | ------------- |
| unit   | 比例尺单位制   | `string` | [unit](#unit)           | SDK 默认      |
| visible | 是否显示      | `boolean` | -                      | `true`        |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件。

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

## unit

比例尺的长度单位。**直接写字符串字面量**——官方那两个常量本身就是这两个字符串，
常量名 `BMAP_UNIT_METRIC` / `BMAP_UNIT_IMPERIAL` **不是**要传的值：

| 值 | 说明 | 官方等价常量 | 官方实际值 |
| --- | --- | --- | --- |
| `metric` | 公制（米 / 千米） | `BMAP_UNIT_METRIC` | `"metric"` |
| `us` | 英制（英里 / 英尺） | `BMAP_UNIT_IMPERIAL` | `"us"` |

```vue
<ScaleControl unit="us" />
```

::: warning 不要传常量名
官方文档示例里写的是 `setUnit(BMAP_UNIT_IMPERIAL)`，而 `BMAP_UNIT_IMPERIAL` 求值就是字符串 `"us"`。
本组件的 `unit` prop 收的就是 `"us"` / `"metric"` 这两个**字面量**；
传 `"BMAP_UNIT_IMPERIAL"` 不会被换算，SDK 不认这个值。
:::

## 选项的更新方式

- `unit` → 官方 `setUnit(unit)`，**就地更新**：改动**不重建**控件，控件内部的交互状态与 DOM 都保留；
- `anchor` / `offset` → 官方基类的 `setAnchor()` / `setOffset()`，**就地更新**。

::: tip `unit` 不给默认值
官方 `ScaleControlOptions` 里**没有** `unit` 这个构造选项——它只有 `setUnit()` 这一个入口。因此
`unit` 未给时是「不表态」，初始单位制由 SDK 自己决定，本库不猜默认值。
:::

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。
