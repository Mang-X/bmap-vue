# Marker3D 带高度的点

在地图上绘制带高度的点覆盖物

```ts
import { Marker3D } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制带高度的点覆盖物
overlay/marker3d/index
:::

## 纹理贴图

:::demo 给点贴上纹理
overlay/marker3d/withImg
:::

## 组件 Props

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| position | 点的坐标 | `{ lng: number, lat: number }` | `required` |
| height | 点高度 | `number` | `required` |
| size | 点大小（宽 / 高） | `number` | `50` |
| shape | 点的[形状](#点形状) | `'BMAP_SHAPE_CIRCLE' \| 'BMAP_SHAPE_RECT'` | `BMAP_SHAPE_CIRCLE` |
| fillColor | 点填充颜色，同 CSS 颜色 | `string` | `#f00` |
| fillOpacity | 点填充的透明度，范围 0 - 1 | `number` | `0.8` |
| icon | 点的[自定义纹理贴图](#自定义纹理贴图) | 自定义纹理贴图描述对象 | - |
| enableMassClear | 是否在调用 `map.clearOverlays()` 时清除此覆盖物 | `boolean` | `true` |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

## 点形状

`shape` 取**官方常量名**，不是裸数字：

| 值 | 说明 |
| --- | --- |
| `BMAP_SHAPE_CIRCLE` | 圆形 |
| `BMAP_SHAPE_RECT` | 正方形 |

## 自定义纹理贴图

`icon` 传一个**自定义纹理贴图描述对象**：

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| imageUrl | 贴图所用图像资源的位置 | `string` | `required` |
| imageSize | 贴图所用的图片的大小，等同于 CSS `background-size`；可用于实现高清屏的高清效果 | `{ width: number, height: number }` | `required` |
| anchor | 贴图的定位点相对于贴图左上角的偏移值 | `{ x: number, y: number }` | - |
| imageOffset | 贴图所用的图片相对于可视区域的偏移值，等同于 CSS `background-position` | `{ x: number, y: number }` | - |

::: warning 贴图**没有** `printImageUrl`
`<Marker>` 的自定义图标里有一个 `printImageUrl` 字段，但它在 JSAPI 4.0 **没有对应项**——
`IconOptions` 只声明了 `anchor` / `imageOffset` / `imageSize` 三个键。传了会被**丢弃**并告警一次，
不会生效。`<Marker3D>` 的贴图因此不提供这个字段。
:::

::: tip 官方文档站还列了 `enableClicking`，但官方 4.0.5 声明里**没有**
`Marker3D` 的构造器不在官方 4.0.5 的类型声明里（只在 `const/Marker3DShapeType.d.ts` 的文档注释
中出现过），因此没有可比对的 `Marker3DOptions`。官方 React 文档表里多出来的
`enableClicking` / `visible` 属于运行时扩展，本库不作为「官方承诺的选项」宣传
（`visible` 仍作为组件 prop 提供，因为它走通用的显隐路径）。
:::

::: tip 本组件带高度，需要配合地图的 `tilt` / `heading`
`<Marker3D>` 绘制的是带高度的点，**必须**在有倾斜与旋转的地图上才有可见效果——
示例里给 `<Map>` 传了 `:tilt="73"` 与 `:heading="64.5"`。
:::

## 组件事件

以下为实际发出的 typed emits（载荷为 SDK 原生事件）：

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| `click` | 鼠标左键单击事件的回调函数 | `(e: unknown) => void` |
| `dblclick` | 鼠标左键双击事件的回调函数 | `(e: unknown) => void` |
| `mousedown` | 鼠标在该覆盖物上按下的回调函数 | `(e: unknown) => void` |
| `mouseup` | 鼠标在该覆盖物上抬起的回调函数 | `(e: unknown) => void` |
| `mouseout` | 鼠标指针移出该覆盖物事件的回调函数 | `(e: unknown) => void` |
| `mouseover` | 鼠标指针移入该覆盖物事件的回调函数 | `(e: unknown) => void` |
| `remove` | 该覆盖物被移除的回调函数 | `(e: unknown) => void` |
| `rightclick` | 鼠标右键单击事件的回调函数 | `(e: unknown) => void` |


## 官方有、本库未暴露

**没有真正的缺口。** `Marker3D` 的构造器**不在**官方 4.0.5 的类型声明里（只在
`const/Marker3DShapeType.d.ts` 的文档注释中出现过），因此没有可比对的 `Marker3DOptions`。
上表列出的九个 prop 就是本库的全部面；其中 `shape` 的两个取值来自官方声明的常量表
（`BMAP_SHAPE_CIRCLE` / `BMAP_SHAPE_RECT`）。

::: tip 本组件的 props 分类与事件面都标着「未取证」
`Marker3D` 走**运行时实测**而非类型声明：更新策略来自对 `Marker3D.prototype` 的成员核对
（例如位置入口实测是 `setPoint` 而不是 `setPosition`），事件面在上游**没有**事件表，因此
它不在[覆盖物事件矩阵](./events)里——本页的事件表是组件 `defineEmits` 的实际形状，
两者不等同。等官方补上声明前，这一点会一直成立。
:::
