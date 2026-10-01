# Label 文本标注

在地图上显示文本标注

```ts
import { Label } from '@mangax/bmap-vue'
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

## 官方有、本库未暴露

| 官方键 | 官方默认 | 为什么不提供 prop |
| --- | --- | --- |
| `enableClicking` | `true` | 官方 `LabelOptions` 有这个构造选项，但本库**没有**把它接成 prop。**结果**：`<Label>` 一律响应点击，你无法关掉 |

这一项与 `<Marker>` 的 `enableMassClear` 是同一类问题：**官方声明有、实例上的分类也在，本库只是
没接线**。同一个 `Label` 实例上没有 `enableClicking` / `disableClicking` 成对开关，因此真要按官方
默认值关掉它只能重建实例——本库目前不提供那条路。

::: tip `styles` 的 prop 名为什么是 `style`（单数）
官方构造选项叫 `styles`（复数），本库 prop 叫 `style`。这是**故意**的：官方 `Label` 实例上的
setter 也叫复数的 `setStyles()`，而 `<Label>` 的 prop 面一律用单数的 `style`（与本库其它组件的
样式 prop 同名同形）。传 `style` 即可，**不要**写 `styles`——那会落进 `$attrs` 且不生效。
:::

::: tip 官方文档站还列了 `title` / `opacity`，但官方 4.0.5 声明里**没有**
`LabelOptions` 一共 7 个键（上表之外没有别的）。官方 React 文档表里多出来的 `title` / `opacity`
在上游 `LabelOptions` 的声明中查无此成员——本库不提供它们，因为照抄会变成「传了也不生效」的
假支持。（`Label` 实例上倒是有 `setTitle` / `setOpacity`，但它们不在构造选项里。）
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`label` 共 8 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
