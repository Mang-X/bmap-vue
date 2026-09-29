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

| 属性    | 说明         | 类型      | 可选值        | 默认值             | 版本                               |
| ------- | ------------ | --------- | ------------- | ------------------ | ---------------------------------- |
| unit    | 比例尺单位制 | `string`  | [unit](#unit) | `BMAP_UNIT_METRIC` |                                    |
| visible | 是否显示     | `boolean` | -             | `true`             | <Badge type="tip" text="^2.2.0" /> |

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


## `unit`：比例尺单位（#165）

`unit` 是**可就地更新**的选项（官方 `ScaleControl#setUnit(unit: LengthUnit): void`）。此前 Driver
的分类表里已经登记成 `mutable` + `setUnit`，而组件**没有**这个 prop——分类层准备好了、出口没有。

| 属性 | 说明                                   | 类型                       | 可选值             | 默认值 | 版本          |
| ---- | -------------------------------------- | -------------------------- | ------------------ | ------ | ------------- |
| unit | 比例尺单位（公制 / 英制）              | `"metric" \| "us"`        | `metric` / `us`    | -      | `1.0.0`（#165） |

取值域**逐字**取自 `@baidumap/jsapi-v4-types@4.0.4` 的 `const/LengthUnit.d.ts`
（`type LengthUnit = 'metric' | 'us'`，对应官方常量 `BMAP_UNIT_METRIC` / `BMAP_UNIT_IMPERIAL`）。

不给默认值：`undefined` = 不表态。官方 `ScaleControlOptions` 里**没有** `unit`，默认由 SDK 自己决定，
本库不猜。

改动**不重建**控件——控件内部的交互状态与 DOM 都保留。
