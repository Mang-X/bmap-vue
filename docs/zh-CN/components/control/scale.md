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
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 83, y: 18 }`        |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | ------------ | --------- | ------------- | ------------------ |
| unit | 比例尺单位制 | `string` | [unit](#unit) | `BMAP_UNIT_METRIC` |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件（M7-CONTROL-PANORAMA / #41 之前它们只在构造期生效）。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## unit

| 值                 | 说明 |
| ------------------ | ---- |
| BMAP_UNIT_METRIC   | 公尺 |
| BMAP_UNIT_IMPERIAL | 英尺 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。

