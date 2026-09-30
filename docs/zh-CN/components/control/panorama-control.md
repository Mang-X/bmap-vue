# PanoramaControl 全景控件

全景地图服务，360° 全景地图刻画真实世界，将街道场景带入到地图产品中，用户可以拖拽地图从不同的角度浏览真实的街景效果

```ts
import { PanoramaControl } from 'bmap-vue'
```

:::tip
全景地图服务属于百度地图高级服务，需要向[百度地图申请](https://lbs.baidu.com/apiconsole/fankui#?typeOne=%E4%BA%A7%E5%93%81%E9%9C%80%E6%B1%82&typeTwo=%E9%AB%98%E7%BA%A7%E6%9C%8D%E5%8A%A1&typeThree=JS%20API%E5%85%A8%E6%99%AF%E5%9B%BE)才可以使用
:::

## 组件示例

单独使用该组件不会显示全景地图覆盖情况，还需要搭配 `PanoramaCoverageLayer` 组件使用。

:::demo
control/panoramaControl
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                     |
| ------ | -------------- | ------------------------- | ----------------- | -------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_TOP_RIGHT`    |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 10, y: 10 }`         |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

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

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。

