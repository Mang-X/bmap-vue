# CustomControl 自定义控件

根据地图 `Map` 组件提供的 Props，或者地图实例，自定义控件

```ts
import { CustomControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/custom
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                    |
| ------ | -------------- | ------------------------- | ----------------- | ------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_TOP_LEFT`    |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`        |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件。

## 默认插槽

控件的内容写在默认插槽里，它会被渲染进挂到地图容器上的那个 DOM 节点：

```vue
<CustomControl>
  <button @click="zoomIn">放大</button>
</CustomControl>
```

不需要 prop。落在根节点上的属性（`class` / `style` / `id` …）绑在**插槽内容那层**的容器上，
也就是控件自身渲染出来的那块 DOM——想改它的样式直接在 `<CustomControl>` 上写就行：

```vue
<CustomControl style="background: #fff; padding: 10px">
  <button>放大</button>
</CustomControl>
```

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

`anchor` 传的是**官方常量名**，控件边界有一张名字→数值的换算表（`BMAP_ANCHOR_TOP_LEFT` → `0` …），
因此这里要写名字而不是 `0`。

官方还定义了 `BMAP_ANCHOR_TOP_CENTER` / `BMAP_ANCHOR_CENTER` 等非四角落点。4.0 的控件只接受
**四角**，传非四角会先告警一次再交给 SDK，而 SDK 会**静默回落**到控件自身的默认落点——
控制台里能看见告警，但控件不会落到你以为的位置。

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。

