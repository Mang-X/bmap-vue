# 官方 React 文档站对照：组件面与 prop 面

数据来源：<https://lbs.baidu.com/jsapi/react/docs/>（hash 路由 `#/component/<slug>`，
共 47 个组件/入口页）。抓取方式见 `scripts/capture-official-docs.mts`（系统 Chrome + CDP；
**直接 HTTP 抓会得到 404**——那是 hash 路由的正常表现，不代表页面不存在）。
比对方式见 `scripts/compare-official-docs.mts`。

## 判据：三方求交，不只看官方文档

官方 React 文档的 API 表**不等于**上游 SDK 声明。实测 `Marker` 一页列了 34 个键，
其中 10 个（`opacity` / `color` / `rank` / `rotationOrigin` / `shadow` / `baseZIndex` /
`enableCollisionDetection` / `enableDraggingMap` / `visible` / `position`）在
`overlay/MarkerOptions.d.ts` 里**查无此成员**。照抄会引入「传了也不生效」的 prop。

所以缺口 = 官方文档 ∩ 上游 4.0.5 声明 ∩ 本库 `*Props` 的差集。全站这样的
「文档有、上游没有」共 **364 项**——一律不补。

## 一、组件面

官方 47 · 本库覆盖 38。未覆盖 9 个：

| 官方组件 | 分类 | 依据 |
| --- | --- | --- |
| `GroundPoint` | **真实缺口** | 上游 `overlay/GroundPoint.d.ts` 有完整声明（27 个 prop），本库未实现 |
| `Symbol` | **真实缺口** | 上游 `overlay/Symbol.d.ts` 有声明（9 个 prop） |
| `IconSequence` | **真实缺口** | 上游 `overlay/IconSequence.d.ts` 有声明（4 个 prop） |
| `PlaceDetail` | **真实缺口** | 本库的 `PlaceDetail` 在**官方 UI Kit**（`bmap-vue/ui-kit`），不在组件面 |
| `Icon` | 形态差异 | 官方列为独立组件；本库走 `<Marker :icon>`，功能等价 |
| `SimpleInfoWindow` | 官方 React 自有 | 上游 SDK 无此类 |
| `RawOverlay` / `RawControl` | 官方 React 自有 | 上游无；本库用 `./advanced` 的 `unwrapRaw()` + `createHandle` 覆盖同类需求 |
| `ThreeLayer` | 官方 React 自有 | 上游无；three.js 宿主集成，且本库已有原生 `TextLayer` / `PolygonLayer` / `PolylineLayer` |

**真缺口 4 个**（`GroundPoint` / `Symbol` / `IconSequence` / 组件面的 `PlaceDetail`），
前三个建议排期。

## 二、prop 面

三方求交后剩 **67 项**，逐类归因：

### 2.1 React 渲染面（19 项，本库用插槽，不用 prop）

`children`（`BMapProvider` / `Map` / `Marker` / `CustomOverlay` / `CustomControl` /
`ContextMenu`）、`node` / `nodeT`（`Polyline` / `Polygon` / `Circle` / `Rectangle` /
`BezierCurve`）、`points`（`PointCollection` / `MapMask`）、`content`（`InfoWindow`）。

官方 React 用 `children` 挂 React 元素；本库对应**默认插槽**或等价 prop
（如 `<InfoWindow>` 的内容走插槽 + `content` prop）。**不是缺口**。

### 2.2 官方页讲的是**图层**形态，本库对应组件是另一形态（28 项）

| 官方页 | 本库对应 | 说明 |
| --- | --- | --- |
| `point-collection` | `PointLayer` / `PointCollection` | 官方页讲 `PointShapeLayer` 的图层 API；本库 `PointCollection` 是 **overlay 形态**（`properties` / `shape` / `size` …），图层形态由 `PointLayer` 提供 |
| `point-icon-layer` | `PointIconLayer`（overlay）/ 图层走 `PointLayer` | 同上：官方页的 `style` / `data` / `idKey` / `crs` / `selectedIndex` / `selectedColor` / `visible` / `autoSelect` / `popEvent` 是**图层**成员，本库 `PointIconLayer` 是 overlay |
| `dom-layer` | `DOMLayer` | 本库 DOMLayer 的 `createDom` / `data` 走插槽面，官方列的 `offsetX` / `anchors` / `coordinate` 等在本库不是同名 prop |
| `geojson-layer` | `GeoJSONLayer` | 本库 props 走插槽；官方列的 `dataSource` / `markerStyle` / `polylineStyle` / `level` 等需要逐项核对是否已在插槽参数里 |
| `district-layer` | `DistrictLayer` | 同上：`name` / `adcode` / `kind` / `autoViewport` / 描边填充色组 |

**这 28 项需要逐条核对**——部分是形态差异，部分可能是真缺口。见下方分工。

### 2.3 样式类（2 项）

`Map.style` / `Panorama.style`：本库用 `mapStyleId` / `mapStyleJson` 两个 prop
（`MapProps` 里有），官方合成一个 `style`。**命名差异，功能已覆盖**。

## 三、复现

```bash
node --experimental-strip-types scripts/capture-official-docs.mts   # 联网，起浏览器
node --experimental-strip-types scripts/compare-official-docs.mts   # 离线，读上一步的产物
```

## 四、比对器自身踩过的坑（都已在脚本里修掉，记下来免得再犯）

1. **上游类型包在 pnpm store 里有两份**（残留的 `4.0.4_patch_…` 与 git 依赖的 `4.0.5`）。
   `find` 取第一个会**稳定拿到 4.0.4**，把 4.0.5 才有的成员全报成「上游没有」——
   对照结论直接反过来（292 条假缺口）。现在按 `package.json` 的 `version` 取最大。
2. **`extends` 基础接口不都以 `Props` 结尾**（`NativeLayerCommonProps` /
   `NativeLayerPickOptions`）。只查 `XxxProps` 会把 `LineLayer` 的 `crs` / `idKey` 等
   几十个真实 prop 全报成缺口。不跟继承：第一版 292 条，修完 91 条，再修完 67 条。
3. **官方 API 表里的 `onXxx` 是 React 事件回调**，在本库对应 `defineEmits` 的事件名
   （无 `on` 前缀），不是 prop。算进 prop 缺口会凭空报出几百条。
