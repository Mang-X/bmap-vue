# ContextMenu 上下文菜单

在地图或标注上添加自定义内容的右键菜单。

```ts
import { ContextMenu, MenuItem, MenuSeparator } from 'bmap-vue'
```

## 组件示例

:::demo 地图与 `Marker` 各一个右键菜单：右击地图或那个 `Marker` 试试
context-menu/index
:::

## 两种写法，一份菜单

菜单项既可以**用数据给**，也可以**用子组件声明**。两种写法最终归一化成同一份条目，
因此顺序、`disabled`、`select` 载荷都不因写法而异；两者可以同时出现，
最终顺序是「`items` 在前、声明式 children 在后」。

```vue
<!-- 数据 API：`-` 表示一条分隔线 -->
<ContextMenu :items="[{ text: '放大', callback: onZoom }, '-', { text: '删除', disabled: true }]" />

<!-- 声明式 API -->
<ContextMenu>
  <MenuItem text="放大" @select="onZoom" />
  <MenuSeparator />
  <MenuItem text="删除" disabled />
</ContextMenu>
```

## 组件 Props

| 属性 | 说明 | 类型 | 默认值 |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- | ------ |
| items       | 菜单项（数据 API），`-` 表示分隔线                          | ([`ContextMenuItem`](#contextmenuitem) \| `-`) `[]` | -      | |
| width       | 菜单宽度（单位 px）                                        | `number`                                            | `100`  | -                                  |
| visible     | 菜单是否**挂到当前目标上**（不是「弹层是否展开」，见下节）  | `boolean`                                           | `true` | |

## ContextMenuItem

| 属性     | 说明                        | 类型                                                                 | 默认值     |
| -------- | --------------------------- | -------------------------------------------------------------------- | ---------- |
| text     | 菜单项文字                  | `string`                                                             | `required` |
| callback | 点击该项时触发              | `(payload: ContextMenuSelectPayload) => void`                         | -          |
| disabled | 是否禁用该菜单项            | `boolean`                                                            | `false`    |
| width    | 该项自己的宽度（覆盖菜单级 `width`） | `number`                                                      | -          |
| id       | 该项 DOM 的 id（官方 `MenuItemOptions.id`） | `string`                                              | -          |

> `width` / `id` 都是**构造期选项**（官方 `MenuItemOptions` 只有这两个键，`MenuItem` 实例上没有对应
> setter）：改动它们会**重建菜单**。`disabled` / `text` 同理（官方 `disable()` 之后无法再 `enable()`，
> 也没有读回），因此「改一个字段就换一个菜单实例」是这条路径的固有代价；回调**不进指纹**，
> 只换 `callback` 不会重建（新函数在下一次点击时生效）。

## MenuItem 组件 Props

`<MenuItem>` 不渲染 DOM，它只把「这里有一条菜单项」注册给父级 `<ContextMenu>`，
位置由**模板里的书写顺序**决定（`v-if` 切换回来时也回到原来的位置）。

| 属性     | 说明                        | 类型      | 默认值     |
| -------- | --------------------------- | --------- | ---------- |
| text     | 菜单项文字                  | `string`  | `required` |
| disabled | 是否禁用该菜单项            | `boolean` | `false`    |
| width    | 该项自己的宽度              | `number`  | -          |
| id       | 该项 DOM 的 id              | `string`  | -          |

`<MenuSeparator>` 没有 props。两者都必须放在 `<ContextMenu>` 的子节点里；放错位置会在控制台得到一条明确提示。

## 组件事件

| 事件名  | 来源        | 说明                                                            | 载荷                          |
| ------- | ----------- | --------------------------------------------------------------- | ----------------------------- |
| `open`  | SDK 事件    | 菜单真正展开时触发（用户右键；程序化 `show()` 也会触发）         | `OverlayPartialPointerEvent`  |
| `close` | SDK 事件    | 菜单关闭时触发（选中某项、`hide()`、点击别处）                   | `OverlayPartialPointerEvent`  |
| `select` | 本库事件   | 某一项被选中；同时也会调用该项自己的回调（数据 API 的 `callback` / `<MenuItem @select>`） | [`ContextMenuSelectPayload`](#contextmenuselectpayload) |

`open` / `close` 的载荷来自上游 `ContextMenuEvent`，其中 `point` / `pixel` 是 `Point | null`，
因此本库的载荷里它们是**可选**的（`null` 与「缺失」都归一化成 `undefined`）。

### ContextMenuSelectPayload

| 字段    | 说明                                              | 类型                              |
| ------- | ------------------------------------------------- | --------------------------------- |
| item    | 被选中的那一项（归一化后的结构）                  | [`ContextMenuItem`](#contextmenuitem) |
| index   | 该项在最终菜单里的序号（含分隔线）                | `number`                          |
| point   | 菜单弹出位置的地理坐标；SDK 没给时为 `undefined`  | `Point \| undefined`              |
| pixel   | 菜单弹出位置的画面像素坐标；没给时为 `undefined`  | `Pixel \| undefined`              |
| map     | 当前地图句柄                                      | `MapHandle`                       |
| target  | 菜单挂载的目标句柄（地图或标注）；未挂载时为 `null` | `SdkHandle<string> \| null`      |

## 菜单挂到哪儿（target）

菜单挂在**最近的挂载目标**上：

| 写法位置            | 目标     | SDK 入口                                             |
| ------------------- | -------- | ---------------------------------------------------- |
| 直接写在 `<Map>` 下 | 地图     | `Map#addContextMenu(menu)`（官方 4.0 有声明）         |
| 写在 `<Marker>` 里  | 那个标注 | `Marker#addContextMenu(menu)`（**运行时扩展成员**）   |

> `Marker#addContextMenu` / `#removeContextMenu` 在官方 4.0.4 的**类型包里没有声明**（只声明在 `Map` 上），
> 但真实 4.0 运行时存在且可用：挂上之后右键该标注会派发菜单的 `open`，`removeContextMenu` 之后同样的
> 右键不再 `open`。本库据此支持 marker 目标。

**没有入口证据的目标会显式报错**（`BMAP_CAPABILITY_UNSUPPORTED`），而**不会**回退挂到地图上——
例如写在 `<Polyline>` 这类覆盖物里时，最近的挂载目标 `kind` 是 `overlay`，菜单没有可挂的地方。

不提供挂载目标契约的组件（`MapMask` / `Marker3D` 这类）**不会成为目标**：它们不 provide
`TargetContext`，因此其下的菜单会落到 `<Map>` 自己的**地图**目标上，与「直接写在 `<Map>` 下」同义。

## 行为细则

- `visible` 的语义是**资源所有权**（挂 / 不挂），**不是**弹层显隐：菜单的展开由用户右键驱动。
  本库**不**把 SDK 的 `open` / `close` 升级成 `v-model:open`——官方没有可靠的打开状态读回，
  也没有「在指定位置打开」的公开入口（`ContextMenu#show()` 只在上一次右键的位置弹出来）。
- target 变化只做**资源所有权迁移**：先从旧目标摘除，再挂到新目标，不会同时残留在两处，
  也不会重复下发同一条挂载命令。
- `items` / `width` 变化时**原子重建**菜单（旧实例连同它的监听一起释放）。
- 组件卸载时会从当前目标摘除菜单。
