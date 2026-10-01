# CustomOverlay 自定义 DOM 覆盖物

把任意 Vue 内容渲染成地图上的 DOM 覆盖物（v4 的 `CustomOverlay`）。

```ts
import { CustomOverlay } from '@mangax/bmap-vue'
```

## 组件示例

:::demo 用 Vue 内容做覆盖物：换位置、旋转、显隐、点击计数
overlay/customOverlay
:::

## 构造期 Props（`recreate`）

**这一组的每一项都是构造期属性**——官方 `CustomOverlay` 的实例成员表上**没有**对应的 setter
（只有 `setPoint` / `setRotation` / `setRotationOrigin` / `setProperties` 四个写入口）。
**改动其中任何一项都会重建实例**（旧实例连同它的监听一起释放）。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| offset | 相对锚点的像素偏移 | `{ x: number, y: number }` | `{ x: 0, y: 0 }` |
| anchor | 锚点，左上角为 `(0, 0)`、右下角为 `(1, 1)`，取值范围 `[0, 1]` | `{ x: number, y: number }` | `{ x: 0.5, y: 1 }` |
| zIndex | 层叠顺序 | `number` | `0` |
| minZoom | 显示的最小缩放级别 | `number` | - |
| maxZoom | 显示的最大缩放级别 | `number` | - |
| enableMassClear | 是否在 `map.clearOverlays()` 时被清除。⚠️ 官方说明该开关**当前不生效**，因此本库不做就地开关 | `boolean` | `true` |

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| position | 覆盖物的地理坐标点 | `{ lng: number, lat: number }` | `required` |
| rotation | 旋转角度，单位度 | `number` | `0` |
| properties | 自定义业务属性，随实例携带 | `Record<string, unknown>` | - |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

> 「构造期」= 官方只有构造选项、实例上没有对应 setter ⇒ 变化时**重建实例**。
> 其余属性走字段级 setter，就地更新、不重建。

## 官方有、本库暂未暴露的选项

官方 `CustomOverlayOptions` 一共 18 个键。上表的 Props 已给出 10 个（`offset` / `anchor` 由官方
的 `offsetX` / `offsetY` / `anchors` 合并而来，`position` 由 `point` 改名，`rotation` 由
`rotationInit` 改名——**这四个是改名或合并，不是缺口**），下面 8 个是真正的缺口：

| 官方键 | 说明 | 官方默认 | 为什么不提供 prop |
| --- | --- | --- | --- |
| `rotationFlip` | 旋转角度超过 90 度且小于 270 度时是否翻转，避免内容倒置 | `false` | 本库没接线 |
| `fixBottom` | 是否将 DOM 固定在底部 | `false` | 本库没接线；DOM 的定位由 SDK 负责 |
| `useTranslate` | 是否使用 `translate3d` 进行性能优化 | `false` | 本库没接线。⚠️ 这一项**开错方向的代价高**——它改变的是 SDK 搬运宿主时的定位实现，官方没给读回，无法验证是否真的生效 |
| `autoFollowHeadingChanged` | 是否随地图旋转 | `false` | 本库没接线；宿主是 Vue 渲染的子树，跟随旋转要连内容一起变换，超出本库的 DOM 托管边界 |
| `enableDraggingMap` | 覆盖物上是否允许拖拽地图 | `false` | 本库没接线。⚠️ 这一项会改变**地图**的交互（而不是覆盖物的），而本库的覆盖物事件面不承担地图手势仲裁 |
| `nextTick` | 是否延迟一帧再显示，用于解决 DOM 自适应宽度问题 | `false` | 与本库的挂载时序冲突：组件在创建后立即按 `visible` 挂图，延迟一帧会与重建收敛抢同一个时机 |
| `synUpdate` | 是否与地图同步更新（跟随地图每次重绘同步刷新位置）；开启后覆盖物位置更新不再走默认的坐标转换逻辑 | `false` | 见下 |

其中 `synUpdate` 值得单独一提：开启后本组件的 `position` 更新策略会与官方默认**不同**，
而官方没有为它声明读回，本库目前没有稳定的事件口径，因此没有提供入口。

::: tip 官方 API 表里的 `children` 不是一个构造选项
官方 React 文档表里出现的 `children` 是 React 的**渲染插槽**（等价于本组件的默认 slot 内容），
不是一个 SDK 构造选项——传 prop 无意义。本组件的内容一律写在默认 slot 里。
:::

## 宿主与 slot 的所有权

组件创建一个**detached `<div>`** 交给 SDK，再用 `<Teleport>` 把 slot 渲染进它内部：

| 谁 | 拥有什么 |
| --- | --- |
| 本组件 | 宿主元素本身（创建 / 释放），以及「它交给 SDK 搬运」这件事 |
| Vue | 宿主**内部**的渲染子树（slot 内容） |
| SDK | 宿主**被放哪儿**、以及覆盖物的位置 / 旋转 |

因此 SDK 搬运的始终是宿主元素，不会去移动你写的节点；`$attrs`（`class` / `style` 等）落在宿主内部的一层包装节点上，
而不是宿主本身（宿主由 SDK 定位）。

## 更新方式

与其它覆盖物共用同一套声明式生命周期内核：

| 属性                        | 变化时发生什么                                                        |
| --------------------------- | --------------------------------------------------------------------- |
| `position`                  | `setPoint(point, true)`——**只位移**，不重新调用业务 DOM 工厂          |
| `rotation` / `properties`   | 就地更新（`setRotation` / `setProperties`）                            |
| `offset` / `anchor` / `zIndex` / `minZoom` / `maxZoom` / `enableMassClear` | **重建实例**（构造期选项）            |
| `visible`                   | `show()` / `hide()`：实例留在图上，只是不可见                          |

## 组件事件

本组件的三个事件来自上游 `CustomOverlayEventMap`（声明在 `CustomOverlay.d.ts`，不是在 `OverlayEvent.d.ts` 里），
由业务 DOM 冒泡到 SDK 后原样转发——**你不需要在 slot 内容上再绑一遍 DOM 监听**。

| 事件        | 载荷                          | 说明                         |
| ----------- | ----------------------------- | ---------------------------- |
| `click`     | `OverlayPointerEvent`（`point` 必填） | 点击覆盖物时触发      |
| `mouseover` | 同上                          | 鼠标移入覆盖物时触发         |
| `mouseout`  | 同上                          | 鼠标移出覆盖物时触发         |

详见 [覆盖物事件矩阵](./events)。

## 与 `<InfoWindow>` 的两处不同

- **没有尺寸重绘**：`InfoWindow` 有官方的 `redraw()` 入口，因此内容尺寸变化后会重绘气泡；
  `CustomOverlay` **没有**重绘入口（位置刷新由 SDK 自己的渲染循环负责，官方为此提供构造选项 `synUpdate`），
  所以本组件不做自己的重绘循环。
- **没有打开 / 关闭状态**：`CustomOverlay` 只有 `visible`，没有 `open` 这类语义。
