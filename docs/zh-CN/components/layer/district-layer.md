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

| 属性         | 说明                                                     | 类型                          | 可选值                        | 默认值              |
| ------------ | -------------------------------------------------------- | ----------------------------- | ----------------------------- | ------------------- |
| name         | 行政区名字（**必填**）                                     | `string`                      | -                             | `required`          |
| kind         | 行政区划展示层级（相对 `name` 下钻几级）                   | [`DistrictType`](#districttype) | -                             | `0`（当前层级）     |
| adcode       | 行政区代码；多个用逗号分隔表示合并为一个大区。**优先级高于 `name`** | `string`           | -                             | -                   |
| fillColor    | 填充颜色                                                   | `string`                      | -                             | `#fdfd27`           |
| fillOpacity  | 填充透明度                                                 | `number`                      | -                             | `1`                 |
| strokeColor  | 描边线条颜色                                               | `string`                      | -                             | `#231cf8`           |
| strokeWeight | 描边线条粗细                                               | `number`                      | -                             | `1`                 |
| strokeOpacity | 描边线透明度                                              | `number`                      | -                             | `1`                 |
| autoViewport | 是否自动调整视野以适应行政区边界范围                       | `boolean`                     | -                             | `false`             |
| onComplete   | 行政区边界数据请求完成并绘制到地图后的回调                 | `() => void`                  | -                             | -                   |

`name` 会被包成官方要求的边界表达式（`(名称)` 形式）；如果你的数据源用的是**行政区代码**而不是
名称，用 `adcode`（官方明确它**优先级高于** `name`）。注意多区合并**仅在 `kind: 0` 时有效**——
下钻模式只能传一个名称。

## 动态组件 Props

| 属性   | 说明     | 类型      | 可选值 | 默认值 |
| ------ | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | -      | `true` |

`visible` 的语义是「挂上 / 摘掉」（`addLayer` / `removeLayer`），与其余图层组件一致。

## 更新口径

4.0 的 `DistrictLayer` **没有任何字段级 setter**：`fillColor` / `fillOpacity` / `strokeColor` /
`strokeWeight` / `strokeOpacity` / `kind` / `autoViewport` 全是**构造选项**，变化时会**重建图层**
（旧实例先摘掉、旧监听随它那一代释放）。本库不提供「静默不生效」的旧行为。

**`onComplete` 是唯一的例外**：它是回调型 option，经转发包装交给 SDK 的函数**身份恒定、内部读
最新值**，因此**换回调不重建图层**。这也是 4.0 的 `DistrictLayer` 给「边界什么时候画完」的**唯一**
官方入口——这批图层的事件面只有 `click` / `mouseover` / `mouseout`，没有 `dataparsed`。

本组件也**不**提供 `opacity` / `zIndex` / `minZoom` / `maxZoom`：官方 `DistrictLayer` 没有这几个语义
（透明度只有 `fillOpacity` / `strokeOpacity` 两项，层级是语义完全不同的 `level` 概念），
声明了再静默忽略属于假支持。

## DistrictType

官方 `DistrictLayer` 的 `kind` 是**下钻层级**（`0` = 展示传入行政区本身的轮廓，`1` = 下钻一级，
`2` = 下钻两级），官方在类型包里的原名是数字。本库另按「展示结果落在哪一级行政区」给它起了三个
名字并导出为 `DistrictType` 常量，模板里写 `:kind="DistrictType['AREA']"` 即可：

| 值                | 官方数字 | 展示结果 |
| ----------------- | -------- | -------- |
| `PROVINCE`        | `0`      | 传入行政区本身的轮廓 |
| `CITY`            | `1`      | 下一级行政区（如省 → 市） |
| `AREA`            | `2`      | 再下一级（如市 → 区县） |

这三个名字是**本库的领域别名**，官方类型包里没有——但它对应官方 `kind` 的通常用法（传一个省名时
想要区县轮廓就要下钻两级），比裸数字可读。

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 鼠标左键单击行政区域时触发 | `(e: unknown) => void` |
| mouseover | 鼠标移入行政区域时触发 | `(e: unknown) => void` |
| mouseout | 鼠标移出行政区域时触发 | `(e: unknown) => void` |
