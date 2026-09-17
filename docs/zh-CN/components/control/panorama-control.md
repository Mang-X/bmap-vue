# BPanoramaControl 全景控件 <Badge type="tip" text="^0.0.31" />

全景地图服务，360° 全景地图刻画真实世界，将街道场景带入到地图产品中，用户可以拖拽地图从不同的角度浏览真实的街景效果

```ts
import { BPanoramaControl } from 'baidu-map-gl-vue'
```

:::tip
全景地图服务属于百度地图高级服务，需要向[百度地图申请](https://lbs.baidu.com/apiconsole/fankui#?typeOne=%E4%BA%A7%E5%93%81%E9%9C%80%E6%B1%82&typeTwo=%E9%AB%98%E7%BA%A7%E6%9C%8D%E5%8A%A1&typeThree=JS%20API%E5%85%A8%E6%99%AF%E5%9B%BE)才可以使用
:::

## 组件示例

单独使用该组件不会显示全景地图覆盖情况，还需要搭配 `BPanoramaCoverageLayer` 组件使用。

:::demo
control/panoramaControl
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                     |
| ------ | -------------- | ------------------------- | ----------------- | -------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_RIGHT` |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`         |

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

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

该组件没有对外事件。

