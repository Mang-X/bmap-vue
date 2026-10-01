---
"@mangax/bmap-vue": patch
---

#165 Class 1：已有的能力但命名与官方不同 —— 直接改名对齐（**破坏性变更，不留别名**）

按维护者裁决的处置口径（`docs/zh-CN/contributing/165-disposition-rules.md`）：
「已有的参数，但命名不同的，直接修」。#165 §3.6 禁止 deprecated 别名 / 迁移 shim /
第二套兼容入口，因此以下是**直接改名**，没有留任何过渡入口。

## 覆盖物：坐标数组 `path` → `points`

| 组件 | 旧 | 新 | 官方依据 |
| --- | --- | --- | --- |
| `<Polyline>` `PolylineProps.path` | `path` | `points` | `constructor(points: Array<Point>, opts?)` |
| `<Polygon>` `PolygonProps.path` | `path` | `points` | `constructor(points, opts?)` |
| `<BezierCurve>` `BezierCurveProps.path` | `path` | `points` | `constructor(points, controlPoints, opts?)` |
| `<Prism>` `PrismProps.path` | `path` | `points` | `constructor(points, altitude, opts?)` |
| `<MapMask>` `MapMaskProps.path` | `path` | `points` | 无 d.ts（运行时类），为与上述四者一致而改名 |

**`<Rectangle>` 不改**：它本来用的就是 `bounds`，与官方 `constructor(bounds: Bounds, opts?)` 一致。

## `<Map>`：四个交互 prop 对齐官方构造期键名

| 旧 | 新 |
| --- | --- |
| `enableDoubleClickZoom` | **`enableDblclickZoom`** |
| `enableScrollWheelZoom` | **`enableWheelZoom`** |
| `enablePinchToZoom` | **`enablePinchZoom`** |
| `enableResizeOnCenter` | **`fixCenterWhenResize`** |

### 一个容易踩的坑：官方**同一概念有两个名字**

官方 `MapOptions` 的**构造期键**是 `enableDblclickZoom` / `enableWheelZoom` /
`enablePinchZoom` / `fixCenterWhenResize`，而 `BMap.Map` 的**实例方法**却是
`enableDoubleClickZoom()` / `enableScrollWheelZoom()` / `enablePinchToZoom()` /
`enableResizeOnCenter()`。这四个 prop 表达的是**构造期语义**，因此取构造期键名。

**内部机制不动**：它们仍然是创建后经 `setInteraction` 打实例方法（不是构造选项），
Driver 的 `INTERACTION_METHODS` 与方法名一个字没改。

### `enableWheelZoom` 的默认值**故意不改**

官方默认 `true`，本库默认 `false`（避免页面一滚就误缩放）。这是有意的差异
（`LIBRARY_MAP_DEFAULTS` + 注释论证），属「Vue 适配/本库决策」，**本轮只改名**。

## 另两处：此前靠 Driver 层改名「兜」着的命名裂缝

| 旧 | 新 | 官方依据 |
| --- | --- | --- |
| `DistrictLayerProps.viewport` | **`autoViewport`** | `DistrictLayer.d.ts:151` |
| `PointCollectionProps.shape` | **`shapeType`** | `PointShapeLayer.d.ts:102` |

这两处此前是**本库自造名 + Driver 层显式改名**兜住的（`layers.ts` 的
`aliases { viewport: "autoViewport" }`、`PointCollection.vue` 的 `style.shapeType = props.shape`）。
改名后两个 workaround 一并删除，**没有留下第二套入口**。

## 顺带修掉一个静默错值

`mapType` 此前只映射 `MapTypeId` 声明的 5 个常量中的 3 个，
`BMAP_HYBRID_MAP` / `BMAP_NONE_MAP` **静默回落成 `"normal"`**——要混合底图却拿到普通底图，
且不报错。现在：新增 `hybrid`；`BMAP_NONE_MAP` 与未知名字**显式抛
`BMAP_INVALID_ARGUMENT`**（官方声明了它，但真实 4.0 运行时没有对应成员，
不编造表示法）。`MapTypeIdName` 收紧为官方五个名字的**闭合联合**。

## 保留（Class 4：特意设计的 Vue 适配）

`pathVersion` / `controlPointsVersion`（官方无对应概念，是数组原地变更的响应式失效计数器）、
`MarkerProps.position`、`GeoJSONLayer.data`、`DOMLayer.createDom`、
`useViewAnimation.loop`（官方 `interation` 是上游拼写错误，改成它属另一个决策）。

## 验证

`tests/type-contracts/official-naming.type-test.ts`（新增）**双向可判别**：
正向断言新名存在，反向 `@ts-expect-error` 断言旧名已消失。实测把
`enableWheelZoom` 改回旧名会同时报 TS2353（新名不存在）与 TS2578（旧名又可用），
即「旧名复活」和「新名消失」两种回归都会红。
