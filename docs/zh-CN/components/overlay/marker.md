# BMarker 标注点

在地图上绘制点

```ts
import { BMarker } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 在地图上添加标记点，通过 icon 指定显示图标, 尝试拖动图片
overlay/marker
:::

## 动态渲染

有时候需要根据动态数据，渲染 marker，点击更新按钮查看效果。
:::demo class="p-bottom"
overlay/dyynmicMaker
:::

## 静态组件 Props

| 属性           | 说明                         | 类型      | 默认值 |
| -------------- | ---------------------------- | --------- | ------ |
| title          | 鼠标移到 marker 上的显示内容 | `string`  | -      |
| enableClicking | 是否响应点击事件（构造期属性，变化时重建） | `boolean` | `true` |

## 动态组件 Props

| 属性            | 说明                                                        | 类型                          | 可选值                        | 默认值     | 版本                                |
| --------------- | ----------------------------------------------------------- | ----------------------------- | ----------------------------- | ---------- | ----------------------------------- |
| zIndex          | 显示层级                                                    | `number`                      | -                             | -          | <Badge type="tip" text="^0.0.35" /> |
| position        | 标注点的坐标                                                | `{ lng: number, lat: number}` | -                             | `required` | -                                   |
| offset          | 标注点的像素偏移                                            | ` {x: number, y: number }`    | -                             |            | -                                   |
| icon            | 标注点的图标。可使用默认图标，也可[自定义图标](#自定义图标) | `string `                     | `simple_red / simple_blue...` | -          | -                                   |
| rotation        | 旋转角度                                                    | `number `                     | -                             |            | -                                   |
| enableDragging  | 是否启用拖拽                                                | `boolean `                    | -                             | ` false`   | -                                   |
| visible         | 是否显示                                                    | `boolean`                     | -                             | `true`     | <Badge type="tip" text="^2.2.0" />  |

## 默认图标可选值

simple_red , simple_blue , loc_red , loc_blue , start , end , location

红色图标：red1，red2，red3，red4，red5，red6，red7，red8，red9，red10

蓝色图标：blue1，blue2，blue3，blue4，blue5，blue6，blue7，blue8，blue9，blue10

以上 27 个名字都解析到雪碧图上各自的格子（`start` / `end` 使用内联 SVG，与
`useBMapMarkerIcons()` 返回的雪碧图版本刻意不同）。未知名字按 `simple_red` 渲染并告警一次。

其余图标可根据下图自行定位裁切：

![https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png](https://mapopen.bj.bcebos.com/cms/react-bmap/markers_new2x_fbb9e99.png)

## 自定义图标

| 属性          | 说明                                                                                                                                                                        | 类型                                | 默认值     | 版本                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------- | ---------------------------------- |
| anchor        | 图标的定位点相对于图标左上角的偏移值                                                                                                                                        | `{ x: number, y: number }`          | -          | -                                  |
| imageOffset   | 图标所用的图片相对于可视区域的偏移值，此功能的作用等同于 CSS 中的 background-position 属性                                                                                  | `{ x: number, y: number }`          | -          | -                                  |
| size          | 图标可视区域的大小                                                                                                                                                          | `{ width: number, height: number }` | `required` | <Badge type="tip" text="^2.3.3" /> |
| imageSize     | 图标所用的图片的大小，此功能的作用等同于 CSS 中的 background-size 属性。可用于实现高清屏的高清效果                                                                          | `{ width: number, height: number }` | -          | -                                  |
| imageUrl      | 图标所用图像资源的位置                                                                                                                                                      | `string`                            | `required` | -                                  |
| printImageUrl | 设置 icon 打印图片的 url，该打印图片只针对 IE6 有效，解决 IE6 使用 PNG 滤镜导致的错位问题。如果您的 icon 没有使用 PNG 格式图片或者没有使用 CSS Sprites 技术，则可忽略此配置 | `string `                           | -          | -                                  |

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`marker` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。

## v3 生命周期与更新行为

`BMarker` 的创建 / 挂载 / 就地更新 / 重建 / 卸载由声明式 `OverlaySpec` 驱动（M5-SPEC-MARKER /
issue #30），组件里没有生命周期代码，也不再各自手写 watcher。每个公开属性的更新策略是**声明**的，
并由用例与 Driver 的属性描述符逐条交叉核对：

| 属性 | 更新策略 | 落地 |
| --- | --- | --- |
| `position` | 位置字段 | `setPosition`，并支持 `v-model:position` |
| `offset` / `title` / `icon` / `zIndex` / `rotation` / `enableDragging` | 就地更新 | `setOptions` → 对应 setter（`enableDragging` 是成对开关） |
| `enableClicking` | 构造期属性 | 变化时重建 Marker |
| `visible` | 显隐 | `show()` / `hide()`；SDK 没有这两个成员时退回 `addOverlay` / `removeOverlay` |

- `visible=false` 时，Marker 创建后**不会**先添加到地图再等待 watcher，而是从创建开始就不挂载；
  之后切到 `true` 时才真正 `addOverlay`（此前实现会在未挂载的实例上调用 `show()`，等于永远不显示）。
- `icon` 走「descriptor → 有界 LRU 缓存 → `setIcon`」：**相同图标配置只构造一次 `BMap.Icon`**
  （缓存上限 200 条；作用域是同一个 Client / `<BMapProvider>`，因此它下面的多张地图共用），
  更新时始终重新 `setIcon` ——官方指南明确「直接改 Icon 的属性之后 Marker 不会同步刷新」。
  这份缓存**只服务组件内部**：`useBMapMarkerIcons()` 拿到的始终是每次新建的独立实例，
  你可以安全地持有或修改它，不会影响别处。
- 组件的每次重建都会释放旧实例的 child scope（SDK 监听、Registry 记录一并归零），因此反复重建
  不会累积资源。
- 组件挂到地图上时会登记进该地图的覆盖物注册表（`MapContext.overlays`），可按类型清点当前存活的
  覆盖物。

### `v-model:position`

拖拽结束时，组件除了触发 `dragend`（与别名 `drag-end`），还会在位置**真的变化**时触发
`update:position`：

```vue
<BMarker v-model:position="position" :enable-dragging="true" />
```

两条方向都有回环抑制：父级把刚上报的位置写回时不会重复下发 `setPosition`，SDK 重复派发同一位置
也不会产生第二条 `update:position`。取舍（为什么这里用「最后一次同步值」而不是像 `<BMap>` 那样
读回 SDK 现值）见 ADR [2026-09-17 声明式 OverlaySpec、Marker 状态模型与图标缓存](/adr/2026-09-17-overlay-spec-and-marker)
的决策 4 与已知限制 1。

v3 支持的主要事件包括：`click`、`dblclick`、`rightclick`、`mousedown`、`mouseup`、`mouseover`、`mouseout`、`dragstart`、`dragging`、`dragend`、`drag-end` 和 `remove`。
