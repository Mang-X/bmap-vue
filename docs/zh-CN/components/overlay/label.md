# Label 文本标注

在地图上显示文本标注

```ts
import { Label } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上添加动态更新的，试试改变文本输入框内容 class="p-top"
overlay/label
:::

## 构造期 Props（`recreate`）

**这一组的每一项都是构造期属性**——官方 `Label` 的实例成员表上**没有** `setWidth` / `getWidth`，
**改动它会重建实例**。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| width | 文本标注的宽度（像素），`0` 表示按内容自适应 | `number` | `0` |

::: warning `width` 变化会**重建**标注
官方 `Label` 上没有 `setWidth`，真实 4.0 的运行时原型链上也没有（调用会直接抛
`setWidth is not a function`）⇒ 本库按构造期属性处理。若需要频繁改宽度，本库**没有**可用的
就地更新路径。
:::

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| content | 设置文本标注的内容 | `string` | `required` |
| position | 文本标注的坐标 | `{ lng: number, lat: number }` | `required` |
| offset | 文本标注的像素偏移 | `{ x: number, y: number }` | `{ x: 0, y: 0 }` |
| style | 设置文本标注的样式，**样式属性需使用驼峰命名法** | `Record<string, unknown>` | - |
| anchor | 文本标注的锚点，取**官方常量名**（九选一，见下） | `OverlayAnchor` | `BMAP_ANCHOR_TOP_LEFT` |
| zIndex | 标注的层叠顺序值 | `number` | - |
| enableMassClear | 是否在调用 `map.clearOverlays()` 时清除此覆盖物（成对开关） | `boolean` | `true` |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

::: warning `anchor` 取**官方常量名**，不是 `0`–`8` 的裸数字
合法值是 `BMAP_ANCHOR_TOP_LEFT` / `BMAP_ANCHOR_TOP_RIGHT` / `BMAP_ANCHOR_BOTTOM_LEFT` /
`BMAP_ANCHOR_BOTTOM_RIGHT` / `BMAP_ANCHOR_TOP_CENTER` / `BMAP_ANCHOR_MIDDLE_LEFT` /
`BMAP_ANCHOR_CENTER` / `BMAP_ANCHOR_MIDDLE_RIGHT` / `BMAP_ANCHOR_BOTTOM_CENTER`
（与 `<ZoomControl>` 等控件的 `anchor` 是同一张官方常量表）。用裸数字 `8` 编译不过——九个值在
业务上完全不同，猜错的代价是标注被画到别处而**不报错**。
:::

::: tip `style` 是普通对象
官方 `LabelOptions.styles` 的类型是 `object`（键值对形式，如 `{ color: '#f00', fontSize: '14px' }`）。
本库把它收成 `Record<string, unknown>`，**属性名用驼峰**（`backgroundColor` 而不是
`background-color`），因为它被原样交给官方的样式入口。
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`label` 共 8 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
