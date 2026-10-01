# PanoramaLabel 全景标注

全景场景内的文本标注（官方 `BMap.PanoramaLabel`）。

```ts
import { Panorama, PanoramaLabel } from '@mangax/bmap-vue'
```

## 组件示例

:::demo
panorama/label
:::

## 使用方式

必须作为 `<Panorama>` 的**子组件**：标注只存在于某个查看器内部（官方经 `Panorama#addOverlay` /
`removeOverlay` 挂载），脱离 `<Panorama>` 会明确报错（`BMAP_PARENT_CONTEXT_MISSING`），而不是被静默忽略。

```vue
<Panorama :point="point" style="width: 100%; height: 480px">
  <PanoramaLabel content="天安门" :position="{ lng: 116.404, lat: 39.915 }" />
</Panorama>
```

## Props

| 属性            | 说明                                        | 类型      | 默认值  |
| --------------- | ------------------------------------------- | --------- | ------- |
| content         | 标签文本                                    | `string`  | `''`    |
| position        | 标签在全景场景中的地理位置                  | `Point`   | -       |
| altitude        | 距地面高度（米）                            | `number`  | 官方 `2` |
| displayDistance | 是否显示标签到当前场景点的距离              | `boolean` | `true`  |

## 选项的更新方式

- `content` → `setContent()`、`position` → `setPosition()`、`altitude` → `setAltitude()`：**就地更新**；
- `displayDistance` → 官方**只有构造期**（没有 `setDisplayDistance`），改变时**重建标注**。

## 组件事件

| 事件    | 说明                                  | 载荷         |
| ------- | ------------------------------------- | ------------ |
| `click` | 单击标签（官方 `PanoramaLabelEventMap.click`） | 官方事件对象 |

## 生命周期

标注的所有权是「谁创建谁摘除」：子组件的卸载早于父组件（Vue 的顺序），因此标注会先从查看器上摘掉，
再由 `<Panorama>` 销毁查看器。整个过程中标注资源计数归零（Fake 诊断的 `panoramaLabels` 门禁）。

`<PanoramaLabel>` 不渲染可见 DOM —— 内容由 SDK 在全景画面里绘制。

## 命令面（`defineExpose`）

此前一个全景标注只能靠**卸载组件**消失，而卸载会连实例一起摘掉（`Panorama#removeOverlay`）——
「临时藏起一个标签」这条最常见的诉求无处落地。

| 方法     | 官方声明                      | 说明 |
| -------- | ----------------------------- | ---- |
| `show()` | `PanoramaLabel#show(): void`  | 显示 |
| `hide()` | `PanoramaLabel#hide(): void`  | 隐藏 |

**与「组件卸载」是两种语义**：命令只改 SDK 当前态，标注仍在查看器里、仍占一个实例；卸载则走
`removeLabel` 摘除。刻意不把它们合成一个 `setVisible`。

**没有 `isVisible()` 可暴露**：官方 `PanoramaLabel` 声明的是 `setPosition` / `getPosition` /
`getPov` / `setContent` / `getContent` / `show` / `hide` / `setAltitude` / `getAltitude`
——**没有** `isVisible()`。造一个恒 `false` 的「读回」等于给调用方一个编出来的答案。

命令**不**回写任何 prop（`visible` 不是 `PanoramaLabelProps` 的字段，官方
`PanoramaLabelOptions` 也没有）。下一次 `displayDistance` 触发重建时按 props 重新建，因而恢复可见。

未就绪 / 已释放时**显式抛错**，不静默 no-op。
