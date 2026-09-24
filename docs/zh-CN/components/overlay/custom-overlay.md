# BCustomOverlay 自定义 DOM 覆盖物

把任意 Vue 内容渲染成地图上的 DOM 覆盖物（v4 的 `CustomOverlay`）。

```ts
import { BCustomOverlay } from 'bmap-vue'
```

## 组件示例

:::demo 用 Vue 内容做覆盖物：换位置、旋转、显隐、点击计数
overlay/customOverlay
:::

## 动态组件 Props

| 属性              | 说明                                            | 类型                      | 默认值     | 版本                               |
| ----------------- | ----------------------------------------------- | ------------------------- | ---------- | ---------------------------------- |
| position          | 覆盖物的地理坐标点                              | `Point`                   | `required` | <Badge type="tip" text="^1.0.0" /> |
| offset            | 相对锚点的像素偏移（**构造期**）                | `{ x: number, y: number }` | `{ x: 0, y: 0 }` | <Badge type="tip" text="^1.0.0" /> |
| anchor            | 锚点，左上角 `(0, 0)`、右下角 `(1, 1)`（**构造期**） | `{ x: number, y: number }` | `{ x: 0.5, y: 1 }` | <Badge type="tip" text="^1.0.0" /> |
| rotation          | 旋转角度（度）                                  | `number`                  | `0`        | <Badge type="tip" text="^1.0.0" /> |
| zIndex            | 层叠顺序（**构造期**）                          | `number`                  | `0`        | <Badge type="tip" text="^1.0.0" /> |
| minZoom / maxZoom | 显示的最小 / 最大缩放级别（**构造期**）         | `number`                  | -          | <Badge type="tip" text="^1.0.0" /> |
| properties        | 自定义业务属性，随实例携带                      | `Record<string, unknown>` | -          | <Badge type="tip" text="^1.0.0" /> |
| visible           | 是否显示                                        | `boolean`                 | `true`     | <Badge type="tip" text="^1.0.0" /> |
| enableMassClear   | 是否在调用 `map.clearOverlays` 清除此覆盖物     | `boolean`                 | `true`     | <Badge type="tip" text="^1.0.0" /> |

> 「构造期」= 官方只有构造选项、实例上没有对应 setter ⇒ 变化时**重建实例**（旧实例连同它的监听一起释放）。
> 其余属性走字段级 setter，就地更新、不重建。

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

## 与 `<BInfoWindow>` 的两处不同

- **没有尺寸重绘**：`InfoWindow` 有官方的 `redraw()` 入口，因此内容尺寸变化后会重绘气泡；
  `CustomOverlay` **没有**重绘入口（位置刷新由 SDK 自己的渲染循环负责，官方为此提供构造选项 `synUpdate`），
  所以本组件不做自己的重绘循环。
- **没有打开 / 关闭状态**：`CustomOverlay` 只有 `visible`，没有 `open` 这类语义。
