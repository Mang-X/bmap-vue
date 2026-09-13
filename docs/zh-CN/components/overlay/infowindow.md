# BInfoWindow 信息窗口

使用 slot 模式渲染子节点向地图添加信息窗口，以及与地图相关的一些交互。

```ts
import { BInfoWindow } from 'baidu-map-gl-vue'
```

::: tip 提示
地图上只能同时显示一个 `infoWindow`，所以当地图上有多个 `infoWindow` 组件同时绑定 `v-model="true"`，只有最后一个 `infoWindow` 组件会在地图上显示。
:::

## 组件示例

:::demo 通过 slot 插槽渲染不同内容 infoWindow class="p-top"
overlay/infowindow
:::

:::demo 动态位置
overlay/dynmicInfoWindow
:::

<style scoped>
  :deep(img) {
    max-width: none;
  }
  :deep(h2) {
    margin: 0;
    border-top: none;
    padding-top: 0;
    letter-spacing: initial;
    line-height: initial;
  }
</style>
<br>

## 静态组件 Props

| 属性   | 说明                                                                                                                                                                                               | 类型                      | 默认值          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------- |
| offset | 信息窗位置偏移值。默认情况下在地图上打开的信息窗底端的尖角将指向其地理坐标，在标注上打开的信息窗底端尖角的位置取决于标注所用图标的 infoWindowOffset 属性值，您可以为信息窗添加偏移量来改变默认位置 | `{x: number, y: number }` | `{x: 0, y: 0 }` |

## 动态组件 Props

| 属性               | 说明                                                                                                   | 类型                            | 可选值    | 默认值     | 版本                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------- | --------- | ---------- | ---------------------------------- |
| show               | 是否开启信息窗体, 支持 `v-model:show`                                                                  | `boolean `                      | -         | `false`    | <Badge type="tip" text="^2.2.2" /> |
| position           | 信息窗体所在坐标                                                                                       | `{ lng: number, lat: number}` | -         | -          | -                                  |
| title              | 信息窗标题文字                                                                                         | `string`                        | -         | -          | -                                  |
| width              | 信息窗宽度，单位像素。取值范围：0, 220 - 730。如果您指定宽度为 0，则信息窗口的宽度将按照其内容自动调整 | `number`                        | `220-730` | `0`        | -                                  |
| height             | 信息窗高度，单位像素。取值范围：0, 60 - 650。如果您指定高度为 0，则信息窗口的高度将按照其内容自动调整  | `number`                        | `60-650`  | `0`        | -                                  |
| enableAutoPan      | 是否开启信息窗口打开时地图自动移动                                                                     | `boolean`                       | -         | ` true`    | -                                  |
| enableCloseOnClick | 是否开启点击地图关闭信息窗口                                                                           | `boolean`                       | -         | ` false`   | -                                  |

## 组件事件

v3 子组件没有 `initd/unload` 事件；以下为 `BInfoWindow` 实际发出的 typed emits：

| 事件名       | 说明                       | 属性 |
| ------------ | -------------------------- | ---- |
| open         | 信息窗口被打开时触发此事件 | -    |
| close        | 信息窗口被关闭时触发此事件 | -    |
| update:open  | 受控状态回写               | `boolean` |
| update:show  | 兼容状态回写               | `boolean` |

## v3 状态同步与清理

`open` 是 v3 推荐的受控状态，支持 `v-model:open`。旧的 `show` / `v-model:show` 仍作为 deprecated alias 保留。

```vue
<BInfoWindow
  v-model:open="open"
  :position="position"
  title="北京"
  :width="320"
>
  内容
</BInfoWindow>
```

::: warning 打开气泡必须给出 `position`
官方 4.0 的打开入口是 `Map#openInfoWindow(infoWnd, point)`，`point` **没有默认值**，`InfoWindow`
实例也没有公开的 `openInfoWindow()` —— 所以「没有位置就打开」没有可解释的语义。气泡挂到 Marker 上的「目标级打开」属后续里程碑。
:::

**状态同步是一条声明式规则**（没有隐藏状态）：

| `open` | `position` | 结果 |
| --- | --- | --- |
| `true` | 有效坐标 | 打开；已打开时按新坐标移动 |
| `true` | 缺失 | 不打开（已经开着就关掉），并把 `BMAP_INVALID_ARGUMENT` 交给内部诊断总线 |
| `false` | 任意 | 关闭 |

两个推论值得注意：

- **`position` 晚到会自动补开**：`open=true` 先到、`position` 由异步数据后到是常见形态，组件按「期望
  状态」判断，不需要手动把 `open` 切成 `false → true` 来恢复；
- **`position` 变回 `undefined` 会关闭气泡并报错**（而不是悄悄停在旧位置）——`open=true` 但缺位置就是
  「想开却打不开」；
- `position` **不是**实例 option：它由 `openInfoWindow(map, infoWindow, position)` 提供，因此动态移动
  走的是重新打开，不会出现「position 在当前引擎不支持」这类告警。

- `title`、`width`、`height` 和 `position` 更新后会同步到已经创建的 InfoWindow；`offset` 作为创建参数应用。
- SDK 自己打开或关闭窗口时，组件会回写 `update:open` 和 `update:show`，不会重复发出相同状态。
- 组件卸载时会**关闭** InfoWindow 并释放自己的事件订阅与观察器。
- 气泡走**地图级**专用入口（`openInfoWindow` / `closeInfoWindow`），不是 `addOverlay` / `removeOverlay`——这一点在 JSAPI 4.0 上是硬要求（气泡不是普通覆盖物）。slot 内容容器由打开状态驱动可见性，打开时不会被内联样式隐藏。
- slot 内容变化会触发 redraw；内部观察器会在卸载时断开。

<!-- maximize	event{type, target}	信息窗口最大化后触发此事件
restore	event{type, target}	信息窗口还原时触发此事件 -->
