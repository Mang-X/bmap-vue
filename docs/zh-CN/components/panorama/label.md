# PanoramaLabel 全景标注

全景场景内的文本标注（官方 `BMap.PanoramaLabel`）。

```ts
import { Panorama, PanoramaLabel } from 'bmap-vue'
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
