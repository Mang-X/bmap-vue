---
title: 组件事件
lang: zh-CN
---

# 组件事件

v3 组件使用类型化 `emits` 直接对外广播，不经过内部事件总线。

## BMap：map 事件

`<BMap>` 把 SDK 的 map 事件归一化后转发。下表是**完整清单**，它由
`packages/baidu-map-gl-vue/src/core/events/eventCatalog.ts` 生成并被门禁逐行校验
（名字、SDK 名与说明三者必须一致）——所以在模板里 `@` 能补全出全部 43 个名字。

| 事件名                   | SDK 事件名               | 说明                                                         |
| ------------------------ | ------------------------ | ------------------------------------------------------------ |
| `@load`                  | `load`                   | 地图初始化完成（首次视野确定后派发一次；载荷另有 point / zoom） |
| `@click`                 | `click`                  | 左键单击地图                                                 |
| `@dblclick`              | `dblclick`               | 鼠标双击地图                                                 |
| `@rightclick`            | `rightclick`             | 右键单击地图                                                 |
| `@rightdblclick`         | `rightdblclick`          | 右键双击地图                                                 |
| `@mousemove`             | `mousemove`              | 鼠标在地图区域内移动（高频，按帧合帧）                       |
| `@mousedown`             | `mousedown`              | 鼠标按下                                                     |
| `@mouseup`               | `mouseup`                | 鼠标松开                                                     |
| `@mouseover`             | `mouseover`              | 鼠标移入地图区域                                             |
| `@mouseout`              | `mouseout`               | 鼠标移出地图区域                                             |
| `@touchstart`            | `touchstart`             | 触摸开始                                                     |
| `@touchmove`             | `touchmove`              | 触摸移动（高频，按帧合帧）                                   |
| `@touchend`              | `touchend`               | 触摸结束                                                     |
| `@mousewheel`            | `mousewheel`             | 滚轮缩放（载荷另有 trend：true = 放大）                      |
| `@zoomexceeded`          | `zoomexceeded`           | 缩放试图超出允许范围（载荷另有 targetZoom）                  |
| `@dragstart`             | `dragstart`              | 开始拖拽地图                                                 |
| `@dragging`              | `dragging`               | 拖拽中（高频，按帧合帧）                                     |
| `@dragend`               | `dragend`                | 结束拖拽                                                     |
| `@movestart`             | `movestart`              | 地图移动开始                                                 |
| `@moving`                | `moving`                 | 地图移动中（高频，按帧合帧）                                 |
| `@moveend`               | `moveend`                | 地图移动结束                                                 |
| `@zoomstart`             | `zoomstart`              | 开始改变缩放级别                                             |
| `@zooming`               | `zooming`                | 缩放中（高频，按帧合帧）                                     |
| `@zoomend`               | `zoomend`                | 缩放结束                                                     |
| `@beforeaddoverlay`      | `beforeaddoverlay`       | 覆盖物添加前                                                 |
| `@addoverlay`            | `addoverlay`             | addOverlay() 之后                                            |
| `@removeoverlay`         | `removeoverlay`          | removeOverlay() 之后                                         |
| `@clearoverlays`         | `clearoverlays`          | clearOverlays() 之后                                         |
| `@addcontrol`            | `addcontrol`             | addControl() 之后                                            |
| `@removecontrol`         | `removecontrol`          | removeControl() 之后                                         |
| `@addcontextmenu`        | `addcontextmenu`         | addContextMenu() 之后                                        |
| `@removecontextmenu`     | `removecontextmenu`      | removeContextMenu() 之后                                     |
| `@maptypechange`         | `maptypechange`          | 地图类型变化（载荷另有 mapType / exMapType）                 |
| `@style-willchange`      | `style_willchange`       | 个性化样式即将切换                                           |
| `@style-loaded`          | `style_loaded`           | 个性化样式加载完成                                           |
| `@style-loaded-error`    | `style_loaded_error`     | 个性化样式加载失败                                           |
| `@style-loaded-timeout`  | `style_loaded_timeout`   | 个性化样式加载超时                                           |
| `@language-change`       | `language_change`        | 地图显示语言变化                                             |
| `@destroy`               | `destroy`                | 地图实例销毁                                                 |
| `@tilesloaded`           | `tilesloaded`            | 瓦片加载完成                                                 |
| `@resize`                | `resize`                 | 容器可视区域大小变化（载荷另有 size）                        |
| `@headingchange`         | `headingchange`          | 旋转角变化（上游类型未声明，运行时可观察）                   |
| `@tiltchange`            | `tiltchange`             | 倾斜角变化（上游类型未声明，运行时可观察）                   |

三点约定：

- **名字**：规范名 = SDK 名把分隔符 `_` 换成 `-`（只有 5 个 `style_*` / `language_change`
  需要换）。`@style-loaded`、`@style_loaded`、`@styleLoaded` 都能绑上同一条——`<BMap>` 对
  两者都会发出，兼容拼写集中在 Catalog 一处，组件里没有第二份兼容代码。
- **载荷**：`{ type, point?, pixel?, size?, zoom?, targetZoom?, trend?, mapType?, exMapType?, domEvent?, raw, preventDefault(), stopPropagation() }`。
  指针 / 拖拽类事件恒有 `point`；未归一化的原样细节走 `raw` 逃生口。
- **按需订阅**：只有父级真的绑了监听器的 map 事件才会订阅 SDK（43 个事件不会无条件绑 43 个
  监听器）；高频事件（上表标注「按帧合帧」的 5 个）一帧最多提交一次、取最后一次载荷。

```vue
<BMap ak="xxx" @click="onClick" @maptypechange="onTypeChange" />
```

```ts
import type { MapEventPayloadOf } from 'baidu-map-gl-vue'

function onClick(e: MapEventPayloadOf<'click'>) {
  console.log(e.point, e.pixel) // point 必有
}
function onTypeChange(e: MapEventPayloadOf<'maptypechange'>) {
  console.log(e.mapType, e.exMapType)
}
```

## BMap：组件事件

与地图无关的事件（就绪、插件、生命周期、视野 v-model 回写）：

| 事件名           | 载荷                        | 说明                                             |
| ---------------- | --------------------------- | ------------------------------------------------ |
| `ready`          | `{ client, map, container }` | 地图就绪（`client + map` 可用）                  |
| `initd`          | 同 `ready`                  | `ready` 的历史别名（deprecated，请改用 `ready`） |
| `plugin-ready`   | `name: string`              | 单个插件加载完成（载荷为插件名）                 |
| `plugin-error`   | `{ name, error }`           | 单个插件加载失败                                 |
| `unload`         | -                           | 地图组件卸载                                     |
| `error`          | `BMapError`                 | 地图或 Client 加载失败                           |
| `update:center`  | `{ lng, lat }`              | 用户交互后的中心点回写（`v-model:center`）       |
| `update:zoom`    | `number`                    | 用户交互后的缩放级别回写（`v-model:zoom`）       |
| `update:heading` | `number`                    | 用户交互后的旋转角回写（`v-model:heading`）      |
| `update:tilt`    | `number`                    | 用户交互后的倾斜角回写（`v-model:tilt`）         |

其中 `map` 为 `MapHandle`（不再是 raw SDK 地图；raw 地图经 `baidu-map-gl-vue/advanced` 的 `unwrapRaw()` 获取），
`client` 提供 `driver` 领域接口（`driver.map / driver.overlays / driver.services / driver.geometry`）。

```vue
<BMap ak="xxx" @ready="onReady" @plugin-ready="onPluginReady" />
```

```ts
function onReady({ client, map }: { client: BMapClient; map: MapHandle }) {
  // 命令式能力经 driver 调用，例如：
  client.driver.map.setZoom(map, 15)
}
function onPluginReady(name: string) {
  console.log('plugin ready:', name)
}
```

## 在组件外订阅：useMapEvent / useMapStatus

`<BMap>` 的 `@` 只覆盖模板；需要在 setup 里按条件订阅、或读地图外部状态时用这两个 hook：

- [`useMapEvent`](../hooks/useMapEvent)：按事件名订阅，handler 更新不重绑，高频事件按帧合帧；
- [`useMapStatus`](../hooks/useMapStatus)：`center / zoom / bounds / size / heading / tilt / moving / zooming`
  的只读 refs，值没变就不产生新引用。

## 子组件

覆盖物 / 控件 / 图层组件各自声明自己的 typed emits（如 `BMarker` 的 `click/dblclick/dragend/update:position`、
`BInfoWindow` 的 `open/close`、`BContextMenu` 的 `open/close`），详见各组件文档的事件表。
子组件没有 `initd/unload` 事件；如需地图实例，请用 `useBMap()` + `whenReady()`：

```ts
import { useBMap } from 'baidu-map-gl-vue'

const { whenReady } = useBMap() // 须在 <BMap> 子树内调用
const { client, map } = await whenReady()
```

## 内部诊断事件

`resource:error` / `plugin:ready` 等内部事件走每 Runtime 独立的诊断总线，仅用于日志与调试，
不作为组件间 ready 或注册同步机制，不建议业务代码订阅。
