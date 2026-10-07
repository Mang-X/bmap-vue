---
"@mangax/bmap-vue": minor
---

`<Map>` 补上四个旋转 / 倾斜交互开关：`enableRotate` / `enableRotateGestures` / `enableTilt` / `enableTiltGestures`

## 缺的是什么

官方 `@baidumap/jsapi-v4-types@4.0.5` 的 `core/MapOptions.d.ts` 声明了这四个键
（**全部**标 `@default true`），本库的 Driver 也**早就**在
`driver/jsapi-v4/map.ts` 的 `INTERACTION_METHODS` 里登记了对应的语义交互名
（`rotate` / `rotate-gestures` / `tilt` / `tilt-gestures`）——**缺的只是组件面的 prop**。

于是此前 `<Map :enable-rotate="false">` 的结果是：类型层不认（`MapProps` 上没有这个键），
Vue 把它收进 `$attrs` 落到根元素上变成两个 DOM attribute，而 SDK **从未收到任何值**。
「写了不生效、也不报错」是这类缺口最糟的形态，所以类型与行为两侧都补了用例。

## 落地口径：交给官方默认，不替使用者表态

四个键官方**全部** `@default true`，因此在 `withDefaults` 里**显式钉 `undefined`**
（与 #179 修的那六项同因）：Vue 会把缺省 `Boolean` prop 的「没传」强转成 `false`，
不钉住的话每一项都会在**每次建图**时被逐个 `disable*()`，官方默认开的旋转 / 倾斜被静默关掉。
钉住之后「没传」真的等于「没传」——组件不下发任何调用，生效的是官方声明的默认值。

这是 `scripts/check-interaction-props.mts` 覆盖的范围，该门禁现在管 **12** 个 prop。

## `enableTiltGestures` 与另外三个**不同**

`enableRotate` / `enableRotateGestures` / `enableTilt` 三对是官方声明的**实例方法**，
建图后调用即可生效，且**构造期键与实例方法同名**（不像 `enableDblclickZoom` →
`enableDoubleClickZoom()` 那一族）。

`enableTiltGestures` 是唯一的例外：官方 `MapOptions` 声明了它，但 4.0 API 参考与
`core/Map.d.ts` 的**实例方法**表里都**没有** `enableTiltGestures()` /
`disableTiltGestures()`（对比 `enableRotateGestures()` 是有的），且没有配对的 `disable*`。

本库因此**只承诺构造期语义**，不臆造实例方法：`setInteraction` 先做结构性存在判断，
运行时真有这对方法就调用，没有就**告警一次**并忽略。既不假装成功，也不靠异常控制流。

## 与 #167 的关系

本条是 #167（「补齐 `<Map>` 缺失的官方能力」）里的**第一批**——也是成本最低、收益最直接的一批
（官方字段、Driver 已支持、只差 prop）。#167 余下的 ~40 个 expose 方法、事件载荷
（`overlay` / `icon` / `poi`）、`enableMapClick` 等构造选项另外分批实施。
