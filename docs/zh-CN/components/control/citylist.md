# CityListControl 城市选择控件

城市选择控件，提供全国的省份、城市切换列表。

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
| anchor | 控件的停靠位置   | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_TOP_LEFT`    |
| offset | 控件的偏移值     | `{x: number, y: number }` | -                 | `{ x: 18, y: 18 }`        |
| expand | 默认列表是否展开 | `boolean`                 | -                 | `false`                   |

## 动态组件 Props

| 属性 | 说明 | 类型 | 可选值 | 默认值 |
| ------- | -------- | --------- | ------ | ------ |
| visible | 是否显示 | `boolean` | - | `true` |

`anchor` / `offset` 同样可以**动态更新**：属性变化时会即时下发 `setAnchor()` / `setOffset()`，
不需要重建控件。`expand` 走官方 `open()` / `close()`，也是**就地更新**。

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 选项的更新方式

- `anchor` / `offset` → 官方基类的 `setAnchor()` / `setOffset()`，**就地更新**；
- `expand` → 官方 `open()` / `close()`，**就地更新**（不重建控件，展开状态与 DOM 保留）。

::: tip 把选项改回「不传」
把某个选项从有值改回 `undefined`（模板里就是不再传这个 prop）等价于「回到 SDK 默认值」。
原地修改父级传入的那个对象（例如 `offset.x = 21`）**同样会下发**——变化检测按**值**比较，
不要求你换一个新对象。
:::

## 组件事件

组件没有 `unload` 事件。如需地图实例，请在 `<Map>` 子树内用 `useMap()` + `whenReady()`。

五个事件对应官方 `CityListControlOptions` 的五个**构造期回调**（`onChangeBefore` / `onChangeAfter` /
`onChangeSuccess` / `onOpen` / `onClose`），由组件转成 Vue 事件对外派发：

| 事件名 | 说明 | 载荷 |
| --- | --- | --- |
| changeBefore | 切换城市前触发 | 无 |
| changeAfter | 切换城市后触发（无论成功与否） | 无 |
| changeSuccess | 切换城市成功后触发 | [`CityListChangeResult`](#citylistchangeresult) \| `null` |
| open | 城市列表面板展开 | 无 |
| close | 城市列表面板收起 | 无 |

`changeSuccess` 的官方回调（`onChangeSuccess`）在控件初始化完成后**也会触发一次**，可在回调里取当前城市名。

### CityListChangeResult

官方 `CityListControlChangeResult` 的逐字段投影。取不到的字段是 `undefined`——不补默认值。

| 字段 | 说明 | 类型 |
| --- | --- | --- |
| city | 城市名称 | `string` |
| code | 城市编码 | `string \| number` |
| title | 城市名称（仅切换成功时提供） | `string`（可选） |
| uid | 城市数据标识（仅切换成功时提供） | `string`（可选） |
| point | 城市坐标（仅切换成功时提供） | `Point \| ''`（可选） |
| level | 地图级别（仅切换成功时提供） | `number`（可选） |


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
