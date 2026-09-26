# 覆盖物事件矩阵

> 这份表是**覆盖物事件面的单一事实源**（`packages/bmap-vue/src/core/overlays/overlayEventCatalog.ts`）
> 的镜像：组件的 `defineEmits`、内核的 SDK 订阅、载荷类型三处都从它出发。
> `tests/behavior/overlay-event-matrix.test.ts` 直接解析上游
> `@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/OverlayEvent.d.ts` 做**双向比对**，因此这份表与上游
> 不可能悄悄漂移（多一个、少一个都红）。

## 名字规范

- **SDK 名**是订阅名：`driver.events.on(handle, sdk名, …)`；
- **Vue 名**是 `emit` 的名字，规则只有一条：SDK 名里的 `_` 换成 `-`（与 map 事件**共用同一条规则**，
  实现见 `core/events/eventCatalog.ts` 的 `toVueEventName`）。覆盖物的上游事件名本来就没有下划线，
  因此当前两者逐字相同——但**仍然派生**：规范只有一处，将来上游加了带下划线的事件名也不会出现第二个口径。

绑定 `@click` / `@lineupdate` 这类名字时用的就是 Vue 名；两者都可以用 `overlayEventOf(kind, 名字)` 查到同一条。

## 载荷三档

| 档位 | 判据（上游声明） | 本库的归一化 | 调用方要做什么 |
| --- | --- | --- | --- |
| `point` 必填 | `OverlayMouseEvent.point` 必填（Marker / Label / 图形族 / `CustomOverlayEventMap`） | raw 缺坐标时补 `{lng:0,lat:0}`（与 map 事件同一兜底） | 直接读 `event.point` |
| 坐标可缺 | 图形族 `mouseout` 的 `GraphMouseOutEvent`（base + Partial）、GroundOverlay 家族、`ContextMenuEvent.point`（`Point \| null`） | **不补**：没有坐标就保持缺失（上游给的 `null` 同样收成「缺失」） | 自己判空（`event.point?.lng`） |
| 仅底座字段 | `OverlayBaseEvent` / `GraphLineUpdateEvent` / 编辑类事件 | 只给底座字段（`type` / `raw` / `preventDefault` …） | 需要未归一化字段时走 `raw` 逃生口 |

第三档里上游声明过但本库**没有归一化**的字段（`lineupdate.action`、编辑事件的 `overlay` / `from`）统一经
`raw` 读取——与 map 事件对 `mousewheel.trend` 这类字段的口径一致，不做猜测式补齐。

## `remove` 的到达时机（两条口径）

`remove` 由 SDK 在**覆盖物被摘除**时派发。本库把「组件的显隐」统一成 `show()` / `hide()`（实例留在图上），
因此这条事件只在**外部**摘除（`map.removeOverlay()` / `map.clearOverlays()`）时到达组件：

| 动作 | `remove` 是否到达组件 |
| --- | --- |
| `map.removeOverlay(overlay)` / `map.clearOverlays()` | ✅ 到达 |
| 组件自身的 `visible` 切到 `false` | ❌ 不到达（`hide()` 不派发它；「隐藏」不等于「被移除」） |
| 组件自身的卸载 / 重建 | ❌ 不到达（摘除发生在监听解绑之后，且内核刻意不回放这条路径上的事件） |

需要「自己被卸载了」的信号请用组件生命周期（`onUnmounted` / 父级的 `v-if`），不要依赖 `remove`。

## 编辑事件按能力注册

`editstart` / `editend` / `linevertexdrag*` / `linevertexdel` 只在开启编辑（`enableEditing`）后才会派发。
**Prism 与 BezierCurve 的上游事件表把编辑六件套 `Omit` 掉了**（SDK 没有 `enableEditing`），因此它们的组件
既不暴露 `enableEditing`，也不声明这些事件——「谁有编辑能力」由矩阵与描述符共同表达。

## 各覆盖物的事件表

### `marker`（上游 `MarkerEventMap`，11 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击标注时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击标注时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击标注时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在标注上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在标注上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入标注时触发 |
| `mouseout` | `mouseout` | `point` 必填 | 鼠标移出标注时触发 |
| `dragstart` | `dragstart` | `point` 必填 | 开始拖拽标注时触发（需先 enableDragging） |
| `dragging` | `dragging` | `point` 必填 | 拖拽标注过程中持续触发（需先 enableDragging） |
| `dragend` | `dragend` | `point` 必填 | 拖拽标注结束时触发（需先 enableDragging） |
| `remove` | `remove` | 仅底座字段 | 标注被移除（如 map.removeOverlay()）时触发 |

### `label`（上游 `LabelEventMap`，8 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击文本标注时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击文本标注时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击文本标注时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在文本标注上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在文本标注上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入文本标注时触发 |
| `mouseout` | `mouseout` | `point` 必填 | 鼠标移出文本标注时触发 |
| `remove` | `remove` | 仅底座字段 | 文本标注被移除（如 map.removeOverlay()）时触发 |

### `polyline`（上游 `GraphEventMap`，17 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |
| `editstart` | `editstart` | 仅底座字段 | 开始编辑（拖拽图形节点）时触发（需 `enableEditing`） |
| `editend` | `editend` | 仅底座字段 | 一次节点编辑结束时触发（需 `enableEditing`） |
| `linevertexdragstart` | `linevertexdragstart` | 仅底座字段 | 开始拖拽图形编辑节点时触发（需 `enableEditing`） |
| `linevertexdragging` | `linevertexdragging` | 仅底座字段 | 拖拽图形编辑节点过程中持续触发（需 `enableEditing`） |
| `linevertexdragend` | `linevertexdragend` | 仅底座字段 | 拖拽图形编辑节点结束时触发（需 `enableEditing`） |
| `linevertexdel` | `linevertexdel` | 仅底座字段 | 删除图形编辑节点时触发（需 `enableEditing`） |

### `polygon`（上游 `GraphEventMap`，17 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |
| `editstart` | `editstart` | 仅底座字段 | 开始编辑（拖拽图形节点）时触发（需 `enableEditing`） |
| `editend` | `editend` | 仅底座字段 | 一次节点编辑结束时触发（需 `enableEditing`） |
| `linevertexdragstart` | `linevertexdragstart` | 仅底座字段 | 开始拖拽图形编辑节点时触发（需 `enableEditing`） |
| `linevertexdragging` | `linevertexdragging` | 仅底座字段 | 拖拽图形编辑节点过程中持续触发（需 `enableEditing`） |
| `linevertexdragend` | `linevertexdragend` | 仅底座字段 | 拖拽图形编辑节点结束时触发（需 `enableEditing`） |
| `linevertexdel` | `linevertexdel` | 仅底座字段 | 删除图形编辑节点时触发（需 `enableEditing`） |

### `rectangle`（上游 `GraphEventMap`，17 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |
| `editstart` | `editstart` | 仅底座字段 | 开始编辑（拖拽图形节点）时触发（需 `enableEditing`） |
| `editend` | `editend` | 仅底座字段 | 一次节点编辑结束时触发（需 `enableEditing`） |
| `linevertexdragstart` | `linevertexdragstart` | 仅底座字段 | 开始拖拽图形编辑节点时触发（需 `enableEditing`） |
| `linevertexdragging` | `linevertexdragging` | 仅底座字段 | 拖拽图形编辑节点过程中持续触发（需 `enableEditing`） |
| `linevertexdragend` | `linevertexdragend` | 仅底座字段 | 拖拽图形编辑节点结束时触发（需 `enableEditing`） |
| `linevertexdel` | `linevertexdel` | 仅底座字段 | 删除图形编辑节点时触发（需 `enableEditing`） |

### `circle`（上游 `GraphEventMap`，17 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |
| `editstart` | `editstart` | 仅底座字段 | 开始编辑（拖拽图形节点）时触发（需 `enableEditing`） |
| `editend` | `editend` | 仅底座字段 | 一次节点编辑结束时触发（需 `enableEditing`） |
| `linevertexdragstart` | `linevertexdragstart` | 仅底座字段 | 开始拖拽图形编辑节点时触发（需 `enableEditing`） |
| `linevertexdragging` | `linevertexdragging` | 仅底座字段 | 拖拽图形编辑节点过程中持续触发（需 `enableEditing`） |
| `linevertexdragend` | `linevertexdragend` | 仅底座字段 | 拖拽图形编辑节点结束时触发（需 `enableEditing`） |
| `linevertexdel` | `linevertexdel` | 仅底座字段 | 删除图形编辑节点时触发（需 `enableEditing`） |

### `prism`（上游 `GraphEventMap (Omit 编辑事件)`，11 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |

### `bezier-curve`（上游 `GraphEventMap (Omit 编辑事件)`，11 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击图形时触发 |
| `dblclick` | `dblclick` | `point` 必填 | 双击图形时触发 |
| `mousedown` | `mousedown` | `point` 必填 | 在图形上按下鼠标时触发 |
| `mouseup` | `mouseup` | `point` 必填 | 在图形上抬起鼠标时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入图形时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出图形时触发（合成派发时可能不带坐标） |
| `mousemove` | `mousemove` | `point` 必填 | 鼠标在图形上移动时触发 |
| `rightclick` | `rightclick` | `point` 必填 | 右键点击图形时触发 |
| `rightdblclick` | `rightdblclick` | `point` 必填 | 右键双击图形时触发 |
| `remove` | `remove` | 仅底座字段 | 图形被移除（如 map.removeOverlay()）时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 图形的节点数据发生变化时触发（变化来源见 raw.action） |

### `ground-overlay`（上游 `GroundOverlayEventMap`，11 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | 坐标可缺 | 点击覆盖物时触发（JSAPI 4.0 的载荷附带坐标；旧引擎只保证基础字段） |
| `dblclick` | `dblclick` | 坐标可缺 | 双击覆盖物时触发（同上） |
| `rightclick` | `rightclick` | 坐标可缺 | 右键点击覆盖物时触发 |
| `rightdblclick` | `rightdblclick` | 坐标可缺 | 右键双击覆盖物时触发 |
| `mousedown` | `mousedown` | 坐标可缺 | 在覆盖物上按下鼠标时触发 |
| `mouseup` | `mouseup` | 坐标可缺 | 在覆盖物上抬起鼠标时触发 |
| `mouseover` | `mouseover` | 坐标可缺 | 鼠标移入覆盖物时触发 |
| `mouseout` | `mouseout` | 坐标可缺 | 鼠标移出覆盖物时触发 |
| `mousemove` | `mousemove` | 坐标可缺 | 鼠标在覆盖物上移动时触发 |
| `remove` | `remove` | 仅底座字段 | 覆盖物被移除时触发 |
| `lineupdate` | `lineupdate` | 仅底座字段 | 覆盖物渲染数据发生变化时触发（变化来源见 raw.action） |

### `info-window`（上游 `InfoWindowEventMap`，6 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `open` | `open` | 仅底座字段 | 信息窗口打开时触发 |
| `close` | `close` | 仅底座字段 | 信息窗口关闭时触发 |
| `clickclose` | `clickclose` | 仅底座字段 | 点击信息窗口的关闭按钮时触发 |
| `maximize` | `maximize` | 仅底座字段 | 信息窗口最大化时触发（需开启 enableMaximize） |
| `restore` | `restore` | 仅底座字段 | 信息窗口从最大化恢复时触发 |
| `resize` | `resize` | 仅底座字段 | 信息窗口尺寸发生变化时触发 |

### `custom-overlay`（上游 `CustomOverlayEventMap`，3 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `click` | `click` | `point` 必填 | 点击自定义覆盖物时触发 |
| `mouseover` | `mouseover` | `point` 必填 | 鼠标移入自定义覆盖物时触发 |
| `mouseout` | `mouseout` | `point` 必填 | 鼠标移出自定义覆盖物时触发 |

上游把这三个事件声明在 `overlay/CustomOverlay.d.ts`（不是 `OverlayEvent.d.ts`），载荷是
`OverlayMouseEvent<CustomOverlay>`。事件由业务 DOM 冒泡到 SDK，本库原样转发——业务**不需要**
自己在 slot 内容上再绑一遍 DOM 监听。

### `context-menu`（上游 `ContextMenuEventMap`，2 个）

| Vue 名 | SDK 名 | 载荷 | 说明 |
| --- | --- | --- | --- |
| `open` | `open` | 坐标可缺 | 菜单打开时触发（`sdk.show()` 与真实右键都会触发） |
| `close` | `close` | 坐标可缺 | 菜单关闭时触发（选中菜单项、`sdk.hide()` 都会触发） |

上游把这两条声明在 `context-menu/ContextMenu.d.ts`，载荷 `ContextMenuEvent` 的
`point` / `pixel` 都是 `Point | null`——因此它们属于「坐标可缺」那一档，**不补** `(0,0)`。
菜单项的**选中**不是 SDK 事件（由 `MenuItem` 的构造回调给出），因此不在这张表里：
`<ContextMenu @select>` 与 `<MenuItem @select>` 是本库在自己的回调里派发的。

## 上游没有事件表的种类

- `map-mask`：掩膜：4.0.4 没有 MapMaskEventMap（MapMask 本身不在类型包的类声明里）
- `marker3d`：3D 标注：构造器 Marker3D 不在 4.0.4 的类声明里，因此也没有事件表；事件面要等运行时取证（与 TrafficLayer / 图层事件同一路径）

