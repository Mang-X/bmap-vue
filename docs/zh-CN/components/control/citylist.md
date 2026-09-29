# CityListControl 城市选择控件

缩放控件，默认位于地图右下角

```ts
import { CityListControl } from 'bmap-vue'
```

## 组件示例

:::demo
control/cityList
:::

::: tip 提示
组件示例样式被 vitepress 样式影响，实际使用不受影响，请参考官方示例为准
https://lbs.baidu.com/jsdemo.htm#cCityList
:::

## 静态组件 Props

| 属性   | 说明             | 类型                      | 可选值            | 默认值                    |
| ------ | ---------------- | ------------------------- | ----------------- | ------------------------- |
| anchor | 控件的停靠位置   | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_LEFT` |
| offset | 控件的偏移值     | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`        |
| expand | 默认列表是否展开 | `boolean`                 | -                 | `false`                   |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件（M7-CONTROL-PANORAMA / #41 之前它们只在构造期生效）。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

该组件没有对外事件。


## 命令面（`ref`）

组件通过 `defineExpose` 暴露官方 `CityListControl` 的**动作**与**读回**成员。

| 命令 | 官方声明 | 说明 |
| --- | --- | --- |
| `toggle()` | `toggle(): void` | 切换城市列表面板的展开状态 |
| `getCityName()` | `getCityName(): string` | 当前城市名称 |
| `status` | — | 实例状态 |

`toggle()` 与 `expand` prop 是**两条路径**：`expand` 是**受控**入口（变化即下发 `open` /
`close`），`toggle()` 是**动作**（切一次，不镜像回 prop）。官方没有可观察的「面板被别人
打开过」的值可供同步，因此**刻意不做**命令 ⇄ prop 双向绑定。

### ⚠️ 没有 `getTriggerDom()`

官方**确实**声明了 `CityListControl#getTriggerDom(): HTMLElement | undefined`，但本库
**不暴露**它：返回值是**原生 DOM 元素**，交出去会把 SDK 内部渲染结构（按钮 class、
子节点、事件绑定）变成公共契约——调用方一 `appendChild` / `addEventListener` 就会与 SDK 的
事件系统打架。

「收窄成领域投影」在这里**不成立**：其它地方能投影是因为官方返回的是**数据**
（`Point` / `Size` / `AddressComponent`……），而一个 `HTMLElement` 没有任何可投影的领域值。

需要该节点的用户走 `./advanced` 的 `unwrapRaw()`（明确的 raw 逃生口，不是组件面）。

### 释放后显式失败

未就绪、重建窗口内或已释放时，命令抛 `BMAP_RESOURCE_DISPOSED`，不静默返回 `undefined`。
