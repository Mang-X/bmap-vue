# MapMask 掩膜

控制地图元素的局部显示与隐藏

- 局部显示：只展示指定区域的地图及地图元素 (poi 标注、底图、楼块等)，隐藏掉区域外的地图元素以突出重点。
- 局部隐藏：隐藏掉局部区域地图元素，比如隐藏掉指定园区范围的地图元素，然后自定义叠加园区模型。

```ts
import { MapMask } from 'bmap-vue'
```

:::tip 注意

1. 局部隐藏适用于地图大级别情况，建议在 zoom>=18 级时使用
2. 初始地图的中心点需要设置到掩膜区域内
:::

## 组件示例

:::demo 局部隐藏
overlay/mapMask
:::

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| -------------- | ------------------------- | ----------------------------------------- | ------ | ---------- |
| path | 掩膜区域路径点串 | `{ lng: number, lat: number}[]` | - | `required` |
| showRegion | 展示区域内部还是外部 | [`MapMaskShowRegion`](#mapmaskshowregion) | - | `inside` |
| isBuildingMask | 楼块是否参与掩膜 | `boolean` | - | `false` |
| isMapMask | 底图是否参与掩膜 | `boolean` | - | `false` |
| isPoiMask | 底图上的 Poi 是否参与掩膜 | `boolean` | - | `false` |
| visible | 是否显示 | `boolean` | - | `true` |

### MapMaskShowRegion

| 值      | 描述                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------ |
| outside | 局部隐藏：隐藏掉局部区域地图元素，比如隐藏掉指定园区范围的地图元素，然后自定义叠加园区模型。           |
| inside  | 局部显示：只展示指定区域的地图及地图元素（poi 标注、底图、楼块等），隐藏掉区域外的地图元素以突出重点。 |

## 组件事件

组件没有 `unload` 事件；以下为实际发出的 typed emits（载荷为 SDK 原生事件）：

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击事件的回调函数 | `(e: unknown) => void` |
| dblclick | 鼠标左键双击事件的回调函数 | `(e: unknown) => void` |
| mousedown | 鼠标在该覆盖物上按下的回调函数 | `(e: unknown) => void` |
| mouseup | 鼠标在该覆盖物上抬起的回调函数 | `(e: unknown) => void` |
| mouseout | 鼠标指针移出该覆盖物事件的回调函数 | `(e: unknown) => void` |
| mouseover | 鼠标指针移入该覆盖物事件的回调函数 | `(e: unknown) => void` |
| rightclick | 鼠标右键单击事件的回调函数 | `(e: unknown) => void` |

