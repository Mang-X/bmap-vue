# DistrictLayer 行政区图层

在地图上显示行政区划分。

```ts
import { DistrictLayer } from 'bmap-vue'
```

## 组件示例

:::demo 渲染北京市行政区划分，绑定鼠标事件
layer/districtLayer
:::

## 静态组件 Props

|  | 属性 | 说明 | 类型 | 可选值 | 默认值 |  || ------------- | ---------------- | ------------------------------- | ------ | ---------------------- | ---------------------------------- || name          | 行政区名字       | `string`                        | -      | `required`             |                                    || kind          | 行政区类型       | [`DistrictType`](#districttype) | -      | `DistrictType['AREA']` |                                    || adcode        | 行政区代码       | `string`                        | -      | -                      | <Badge type="tip" text="^1.0.0" /> || fillColor     | 填充颜色         | `string`                        | -      | `#fdfd27`              |                                    || fillOpacity   | 填充透明度       | `number`                        | -      | `1`                    |                                    || strokeColor   | 描边线条颜色     | `string`                        | -      | `#231cf8`              |                                    || strokeWeight  | 描边线条粗细     | `number`                        | -      | `1`                    | <Badge type="tip" text="^2.4.0" /> || strokeOpacity | 描边线透明度     | `number`                        | -      | `1`                    | <Badge type="tip" text="^2.4.0" /> || autoViewport   | 是否自动调整视野以适应行政区边界范围（官方 `autoViewport`） | `boolean`                       | -      | `false`                |                                    || onComplete     | 行政区边界数据请求完成并绘制到地图后的回调（官方 `onComplete`） | `() => void`                     | -      | -                      | <Badge type="tip" text="^1.0.0" /> |
> 4.0 的 `DistrictLayer` **没有任何字段级 setter**：上面这些 Props 变化时会**重建图层**
> （旧实例先摘掉、旧监听随它那一代释放）。1.0 只提供这一种行为，不提供「静默不生效」的旧行为。
>
> **`onComplete` 是唯一的例外**：它是回调型 option，经 `forwardCallback` 转发到**当前** prop
> （SDK 手上的函数身份恒定、内部读最新值），因此**换回调不重建图层**。这也是 4.0 的
> `DistrictLayer` 给「边界什么时候画完」的**唯一**官方入口——这批图层的事件面只有
> `click` / `mouseover` / `mouseout`，没有 `dataparsed`。

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`visible` 的语义是「挂上 / 摘掉」（`addLayer` / `removeLayer`），与其余图层组件一致。

## DistrictType

| 值       | 说明    |
| -------- | ------- |
| PROVINCE | 省级    |
| CITY     | 市级    |
| AREA     | 县/区级 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击行政区域时触发 | `(e: unknown) => void` |
| mouseover | 鼠标移入行政区域时触发 | `(e: unknown) => void` |
| mouseout | 鼠标移出行政区域时触发 | `(e: unknown) => void` |
