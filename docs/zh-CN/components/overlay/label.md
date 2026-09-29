# Label 文本标注

在地图上显示文本标注

```ts
import { Label } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上添加动态更新的，试试改变文本输入框内容 class="p-top"
overlay/label
:::

## 动态组件 Props

|  | 属性 | 说明 | 类型 | 默认值 |  || --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- || content         | 设置文本标注的内容                        | `string `                                                                                     | `required` | -                                  || offset          | 文本标注的像素偏移                        | `{x: number, y: number } `                                                                    | -          | -                                  || enableMassClear | 是否在调用 map.clearOverlays 清除此覆盖物 | `boolean `                                                                                    | `true `    | -                                  || style           | 设置文本标注的样式                        | [`CSSStyleDeclaration`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration) | -          | -                                  || position        | 文本标注的坐标                            | `{ lng: number, lat: number} `                                                                | `required` | -                                  || zIndex          | 显示层级                                  | `number`                                                                                      | -          | <Badge type="tip" text="^2.2.0" /> || visible         | 是否显示                                  | `boolean`                                                                                     | `true`     | <Badge type="tip" text="^2.2.0" /> || anchor          | 文本标注的锚点（官方常量名，九选一）。**就地更新**，改它不换实例 | `OverlayAnchor`                                                                              | -（沿用 SDK 自身的默认锚点） | - || width           | 文本标注的宽度（像素，`0` 表示按内容自适应）。**构造期属性**，变化时重建 | `number`                                                                                      | -（沿用 SDK 默认的自适应）  | - |::: warning `anchor` 取**官方常量名**，不是 `0`–`8` 的裸数字合法值是 `BMAP_ANCHOR_TOP_LEFT` / `TOP_RIGHT` / `BOTTOM_LEFT` / `BOTTOM_RIGHT` /`TOP_CENTER` / `MIDDLE_LEFT` / `CENTER` / `MIDDLE_RIGHT` / `BOTTOM_CENTER`（与 `<ZoomControl>` 等控件的 `anchor` 同一张官方常量表，换算在 Driver 边界内完成）。用裸数字 `8` 编译不过 —— 九个值在业务上完全不同，猜错的代价是标注被画到别处而**不报错**。:::::: warning `width` 变化会**重建**标注官方 `Label` 上**没有** `setWidth`（4.0.5 的成员表里没有，真实 4.0 的运行时原型链上也没有，调用会直接抛 `setWidth is not a function`）⇒ 本库按**构造期**属性处理。若需要频繁改宽度，本库**没有**可用的就地更新路径。:::
::: tip 提示
style 可以是任何符合规范的 css 样式，样式属性需使用驼峰命名法
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`label` 共 8 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
