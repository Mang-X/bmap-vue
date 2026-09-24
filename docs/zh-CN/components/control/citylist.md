# CityListControl 城市选择控件

缩放控件，默认位于地图右下角

```ts
import { CityListControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/cityList
:::

::: tip 提示
组件示例样式被 vitepress 样式影响，实际使用不受影响，请参考官方示例为准
https://lbs.baidu.com/jsdemo.htm#cCityList
:::

## 静态组件 Props

| 属性   | 说明             | 类型                      | 可选值            | 默认值                    |
| ------ | ---------------- | ------------------------- | ----------------- | ------------------------- |
| anchor | 控件的停靠位置   | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_LEFT` |
| offset | 控件的偏移值     | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`        |
| expand | 默认列表是否展开 | `boolean`                 | -                 | `false`                   |

## 动态组件 Props

| 属性    | 说明     | 类型      | 可选值 | 默认值 | 版本                               |
| ------- | -------- | --------- | ------ | ------ | ---------------------------------- |
| visible | 是否显示 | `boolean` | -      | `true` | <Badge type="tip" text="^2.2.0" /> |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件（M7-CONTROL-PANORAMA / #41 之前它们只在构造期生效）。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。

