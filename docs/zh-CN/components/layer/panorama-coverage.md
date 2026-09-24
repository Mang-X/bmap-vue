# PanoramaCoverageLayer 全景图层 <Badge type="tip" text="^0.0.31" />

全景地图服务，360° 全景地图刻画真实世界，将街道场景带入到地图产品中，用户可以拖拽地图从不同的角度浏览真实的街景效果

```ts
import { PanoramaCoverageLayer } from 'bmap-vue'
```

:::tip 提示
全景地图服务属于百度地图高级服务，需要向[百度地图申请](https://lbs.baidu.com/apiconsole/fankui#?typeOne=%E4%BA%A7%E5%93%81%E9%9C%80%E6%B1%82&typeTwo=%E9%AB%98%E7%BA%A7%E6%9C%8D%E5%8A%A1&typeThree=JS%20API%E5%85%A8%E6%99%AF%E5%9B%BE)才可以使用
:::

## 组件示例

单独使用该组件无法查看全景地图，还需要搭配 `PanoramaControl` 组件使用。

:::demo 显示全景图层
layer/panoramaCoverage
:::

## 组件 Props

| 属性    | 说明         | 类型      | 默认值 | 版本                               |
| ------- | ------------ | --------- | ------ | ---------------------------------- |
| visible | 是否挂在地图上 | `boolean` | `true` | <Badge type="tip" text="^1.0.0" /> |

`visible` 的语义是「挂上 / 摘掉」（`addLayer` / `removeLayer`）。

## 稳定性

4.0.4 的类型包**没有** `PanoramaCoverageLayer` 的类声明（官方 Skill 明确它是 4.0 公开图层），
因此本库按结构探测构造器：当前运行时没有它时会**显式失败**并告警一次，而不是静默降级。
