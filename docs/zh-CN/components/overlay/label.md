# BLabel 文本标注

在地图上显示文本标注

```ts
import { BLabel } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上添加动态更新的，试试改变文本输入框内容 class="p-top"
overlay/label
:::

## 动态组件 Props

| 属性            | 说明                                      | 类型                                                                                          | 默认值     | 版本                               |
| --------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- | ---------- | ---------------------------------- |
| content         | 设置文本标注的内容                        | `string `                                                                                     | `required` | -                                  |
| offset          | 文本标注的像素偏移                        | `{x: number, y: number } `                                                                    | -          | -                                  |
| enableMassClear | 是否在调用 map.clearOverlays 清除此覆盖物 | `boolean `                                                                                    | `true `    | -                                  |
| style           | 设置文本标注的样式                        | [`CSSStyleDeclaration`](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleDeclaration) | -          | -                                  |
| position        | 文本标注的坐标                            | `{ lng: number, lat: number} `                                                                | `required` | -                                  |
| zIndex          | 显示层级                                  | `number`                                                                                      | -          | <Badge type="tip" text="^2.2.0" /> |
| visible         | 是否显示                                  | `boolean`                                                                                     | `true`     | <Badge type="tip" text="^2.2.0" /> |

::: tip 提示
style 可以是任何符合规范的 css 样式，样式属性需使用驼峰命名法
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`label` 共 8 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
