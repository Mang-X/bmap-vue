# #165 成员级审计：B / C / D / F（2026-09-26）

> 工作包 E（composables）见 `165-audit-inventory.md`。本文是 B/C/D/F 的成员级走查结论。
> （B / Provider·Map 部分的结论见文末「工作包 B」一节。）
> 依据：官方 `@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`）声明 + `@baidumap/react-bmap@2.0.6`
> （命名参考）+ `@baidumap/vue-bmap`（Vue 侧先例）。**存在性以 v4 声明为准。**
> 本文只记录结论与**处置判据**；逐条表格在各代理报告中，此处不复制。

## 先说结论

**没有全部对齐。** 三个工作包走查出的缺口集中在同一种形态上——
**「分类层知道有这个能力，组件面没有出口」**。这不是命名问题，是能力被裁掉了（#165 §3.3）。

---

## HARD DEFECT（违反仓库既有规则，必须修）

### H1. `CreateBMapPluginOptions.plugins` 接受后被静默丢弃

`plugins/createBMapPlugin.ts:40` 声明 `plugins?: string[]`，**全库无人读它**：
`BMapPluginConfig`（`core/context/pluginConfig.ts:12-15`）只有 `{ provider, defaults }`；
`Map.vue:601` 读的是**组件 prop** `props.plugins`，与 app 级配置不是一回事。

即 `createBMapPlugin({ plugins: ['GeoUtils'] })` 安静地什么都不做、不报错。
这正是 `catalog.ts:5-15` 当初建目录要防的失败模式（「`plugins: ['TrackAnimatino']` 会安静地
什么都不做，`getStatus()` 还是 `ready`」）——只是上移了一层重新长出来了。

AGENTS.md：「**接收后忽略属于假支持**」。处置：**实现它**或**删掉这个选项**，二者择一，不得留空。

### H2. `<PointLayer>` 转发官方未声明的 `pickWidth` / `pickHeight`

`components/data/PointLayer.vue:102-103` 把这两个键放进构造选项袋，但
`visualization/PointLayer.d.ts` 的 `PointLayerOptions` **没有**它们（该类的等价物是
`pickTolerance`（@default 4）、`pickThrough`、`mouseStyleChange`）。
`grep -rn 'pickWidth|pickHeight' $D/visualization/` → **0 命中**。

同名 prop 在 `PointIconLayer` / `PointShapeLayer`（`layer/` 家族）上是**合法**的，
所以这个缺陷是 kind 专属的，很容易漏。处置：**换成本类真实成员**并记录映射依据。

---

## 能力缺口（#165 §3.3「不得无理由裁剪」）

### C1. 9 个官方覆盖物类有 `setZIndex`，只有 1 个组件暴露了 `zIndex`

| 官方类（有 `setZIndex`） | `Circle` `Polyline` `Polygon` `Rectangle` `BezierCurve` `Prism` `GroundOverlay` `Label` `Marker` |
| --- | --- |
| 本库有 `zIndex` prop 的组件 | **只有 `CustomOverlay`** |

根因在共用的形状基类：`PathStrokeProps` / `PathFillProps` / `PathShapeProps` /
`PathEditableProps`（`types/components.ts:281-309`）**都没有 `zIndex`**，
而 Driver 的 `OVERLAY_DESCRIPTORS` 已把 `zIndex` 分类为 `mutateBy("setZIndex")`
（`driver/types/overlays.ts:306,342`）——**分类层就绪、组件层没出口**。

### C2. 27 个覆盖物 / 控件组件**零** `defineExpose`

`grep -n defineExpose` 在 `components/overlays/*.vue` + `components/controls/*.vue` 上
**0 命中**（只有 `Panorama` / `PanoramaLabel` 有）。因此官方公开的这些方法
**没有任何调用路径**：

- `Marker`：`setLabel` / `setRotationOrigin` / `setRank` / `getRank` / `openPlaceDetail` / `closePlaceDetail`
- `Label`：`setAnchor` / `setOpacity` / `setTitle`（descriptor 说是 `mutateBy`，但无 prop）
- `Polyline` / `Polygon`：`setPositionAt(index, point)`
- `InfoWindow`：`getTitle` / `getContent` / `isOpen` / `getOffset` / `maximize` / `restore`
- `ContextMenu`：`getItem` / `removeItem` / `removeSeparator` / `getDom` / `show` / `hide`
- `MenuItem`：`setText` / `enable`（`disabled` 改成 `false` 也**永远**触达不到 `enable()`）
- `ScaleControl`：`setUnit` / `getUnit`（Driver 已分类 `mutable`，组件无 prop）
- `CityListControl`：`toggle` / `getTriggerDom` / `getCityName` + 6 个回调型选项
- `OverviewMapControl`：`changeView`

### C3. 事件缺口

| 组件 | 官方事件 | 本库 |
| --- | --- | --- |
| `Panorama` | 24 | **7**；且 `linksChange` **无载荷**，而官方 `getLinks()` 存在却没暴露 ⇒ 消费者拿不到数据 |
| `CityListControl` | 7 | **0** |
| `OverviewMapControl` | 3 | **0** |
| `LocationControl` | 2 | 2（载荷是 `unknown`，非官方具名类型） |

`Panorama` 的 `links` 缺口**推翻了自己的弃用理由**：Driver 注释写「`tiles`/`links` 属渲染细节，
不透出」且「无消费者」——但 `<Panorama>` 已经发 `linksChange` 事件了，**消费者是存在的**，
只是数据通路没建。

### C4. 选项缺口

- `InfoWindow` 缺 8 / 15：`maxWidth` `maxContent` `margin` `collisions` `onClosing`
  `enableSearchTool` `headerContent` `enableContentScroll`
  （前两个 Driver 已分类 `mutable`，**组件无 prop** ⇒ 又是分类层就绪、面层没出口）
- `GroundOverlay` 缺 7 / 10；`CustomOverlay` 缺 9 / 17；`LocationControl` 缺 8 / 9
- `LineLayer` / `FillLayer` 缺 `selectedIndex`、`popEvent`；`DistrictLayer` 缺 `onComplete`
- `Marker3DProps` / `MapMaskProps` 在 SFC 内**内联声明**且不经任何 barrel 导出 ⇒
  **消费方无法为它们命名**（其余 props 类型都可命名）

### D1. 4.0.5 声明了、但 `supports()` 仍回答不支持的成员

`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 在 4.0.5 有了**类声明**，
于是「以无声明为依据」的那个门禁前提失效：

| 类 | 4.0.5 声明、本库 `supports()` 未登记（**落地时的状态**） |
| --- | --- |
| `PointLayer` | `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |
| `ClusterLayer` | `setOpacity` / `getOpacity` / `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |
| `Heatmap` | 上述 + `setGradient` / `setRadius` |
| `TrackLine` | `setOpacity` / `getOpacity` / `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |

> ⚠️ **本表是「落地前」的缺口快照，已被后续切片改写，不要当现状读。**
> 现状（`driver/jsapi-v4/native-layers.ts` 的 kind 表）：`ClusterLayer` / `Heatmap` /
> `TrackLine` 现在**都**登记了 `setOpacity`（按 4.0.5 声明），`setZIndex` 三者也都已登记；
> 仍不登记的只有 `getX` 读回一族、`setRenderStage` / `setRefCenter`（**无组件消费者**），
> 以及 `PointLayer` 的 `setOpacity`（**声明里确实没有**——三个兄弟都有，它没有）。
> 「登记」也不等于「有组件消费者」：#165 收口时新登记的 `PolylineLayer#setOpacity`
> 就**暂时没有**消费者。逐条依据见
> [`165-runtime-audit-2026-09-27`](./165-runtime-audit-2026-09-27)。

**可观察的行为后果**（不只是文档错）：`HeatmapLayer` 的 `visible` 因为走挂上/摘掉，
重新显示会**销毁并重建实例**；`TrackLineLayer` 重建后**播放从头开始、`observed` 进度丢失**。
4.0.5 已声明的 `setVisible` 本可保住实例。

门禁本身也漏了：`native-layers.test.ts` 的 `DECLARED_CTORS` 只列了 `layer/` 那四类，
注释写「扩展 API 没有声明」——该前提在 4.0.5 已不成立。

---

## 已核对且判定为「对齐」（不修，避免无谓改动）

- **`./ui-kit` 子路径隔离**：三条路径独立验证（源码 import 图、构建产物 `dist/*.mjs`、
  `vite.config.build.ts:347` 的 external）——根入口**零**静态路径可达；唯一的可执行引用是
  `loadUiKit.ts:65` 的**动态** `import()`；公共 `.d.ts` 对上游包的 import 数 = 0。
- **四个 UI Kit wrapper**：逐字段核对，**零个杜撰选项、零个杜撰事件**；两处刻意不暴露的能力
  （`PlaceDetailOptions.layout`、`RoutePlan.switchType`）经**直接读官方 1.1.2 产物**确认
  在该版本里是 no-op（`layout` / `compact` 在产物中出现 **0 次**；`switchType` 对非
  `driving` 只 `console.warn`）——不暴露是对的。
- **`RoutePlanDrivingPolicy` 11 个成员与官方枚举逐个同名同值**（含顺序）。
- **`layer/` 家族的选项面**：机器比对 0 丢字段、0 杜撰字段。
  （`extentCRSIsWGS84` / `boundsInWGS84` 疑似杜撰，实际在上游有声明——是**假警报**。）
- **Feature State 五件套**、**`clear` vs `destroy` 语义**、**`idKey` 往返**、**资源归属**、
  **`dataVersion` / 事件矩阵 / 优先级（prop vs 命令无互相覆盖）** 均对齐且有取证支撑。
- **`visualization/` 的范围划出**：Catalog 没有任何 `rawMembers` 声称那 9 个未实现的类
  ⇒ #166 的边界干净。

## Class 2 逐条裁决（2026-09-27，第一段 A–I）

「名字相同、行为不同」的一族。**存在性一律以 v4 声明为准**，行为差异以
`scripts/probe-runtime-members.mts` 的 live 读数（2026-09-27，真实 AK）为准。

| # | 条目 | 本库行为 | 官方 / 参考行为 | 裁决 | 决定性依据 |
| --- | --- | --- | --- | --- | --- |
| A | `useMap` / `useMapReady` / `useMapStatus` | 返回对象 / `ComputedRef<boolean>` / 8 个独立 ref | MapHandle 本身 / 收回调的哨兵 / 一个原子快照 | **不改（形状）+ 改（文档）** | 形态差异是**有意的 Vue 适配**（Class 4），不是缺陷：8 个独立 ref 能分别 watch，原子快照反而做不到。但「名称对齐 ✓」的对照表**只比名字**、因此会误导移植者，已在生成器里加「同名但不同形」一节 + 双向门禁 |
| B | `get*` 的可空性 | 六个读命令返回 `\| null` | 官方全部非空 | **不改** | 官方非空是**声明**、不是「什么情况下都给得出值」的承诺；本库 `readLiveView` 的口径是「资源已销毁 / 该能力不可用 ⇒ 读不到」。收窄成非空会把「读不到」变成一个编出来的值。参考实现自己也全转 `\| null`（`useMapStatus.ts` 的 `safePoint` / `safeNum`） |
| C | `panBy(pixel)` | 收一个 `Pixel` 对象 | 官方 `panBy(x: number, y: number, options?)` | **不改（Class 4 有意适配）** | Driver 已经把它拆成 `x, y` 两个数字下发（`driver/jsapi-v4/map.ts:859-864`），官方能力**没有缺口**；对象形态是本库全域统一的 `Point` / `Pixel` / `Size` 记法。已写进 `docs/zh-CN/components/map.md` 命令表注记 |
| D | `resetView()` | 回到首次快照，**连 heading / tilt 一起** | 官方 `reset()` 声明只说「恢复地图初始化时的中心点和级别」 | **不改** | live 实测（`resetScope`）：官方 `reset()` 之后 center / zoom 回到初值，**heading 60 / tilt 30 原样不动**。即两者的**实测**行为一致（都不动 heading/tilt）；本库多动的那两个字段是**「归位到首次快照」**语义的一部分，与受控状态机（`centerState.reset()` 等）成套。改它会与 #29 冻结的 `resetView` 语义打架 |
| E | `center` 的 string | prop 收 `\| string`，**命令不收** | 官方 `setCenter(center: Point \| string, options?)` | **改（命令面放宽）** | 三处证据同向：① 声明是 `Point \| string`；② `MapDriver.setCenter(map, Point \| string)` 与 `toRawCenter` **本来就**处理字符串；③ live 实测 `setCenter('北京')` 从上海真的移到北京。收窄只发生在命令面最上面一层。**注意 live 反直觉读数**：官方对无法识别的地名**不抛错**，也真的移动（`'NotACityName-zzz'` 同样移动）⇒「没报错」不能推断「生效了」 |
| F | 命令丢 options | 五条命令全是 `(value)` | 官方五条都是 `(value, options?)` | **不改（本轮），已开票** | 缺口真实：`noAnimation` / `callback` / `setZoom` 的 `zoomCenter` 三者都不可达，没有回调就没有「命令完成」这个可观察事实。live 实测（`optionsCallback` / `optionsCallbackAnimated`）证明五条在 `noAnimation: true` 下 callback **恰好交付一次**（0–1ms）、动画档也交付（setZoom 526ms / panTo 32ms），即「传下去就真的会来」有取证。**但落地要改 `driver/types/map.ts` 的五条签名 + `driver/jsapi-v4/map.ts` 的实现 —— 超出本段工作范围**，见文末「需要 Driver 改动」 |
| G | `panTo` 动画默认 | 不传 options，Driver 直接下发 | 官方 `noAnimation` 默认 `false`（=有动画） | **不改** | live 实测（`panToAnimationDefault`，`requestAnimationFrame` 逐帧 1.5s）：`distinctSampleCount = 1`、`midFlightSamples = 0` —— 无头 SwiftShader 下**直接跳变到位，没有中间态**。即实测行为与官方「默认无动画」**一致**，而官方声明写默认 `false`；本库不传 options 即沿用上游默认，**没有**额外的 prop/命令不一致可修 |
| H | `mapStyleJson` 形状 + 静默优先 | `Record`（单数）；两个 prop 同时给走 `else if` **静默丢一个** | `styleJson?: object[]`；`styleId` / `styleJson` / `merge` 三成员 | **改** | ① 声明是 `object[]`；② 旧代码把整份 `Record` 当作**整个 config** 下发（`setMapStyle(config)`），于是 `styleId` 那一支**永远走不到** —— 不只是「丢一个」，是**结构性地走不到**；③ live 实测（`setMapStyleShapes`）两种先后顺序的胜者都不可控，因此不能在组件层猜赢家，只能**显式失败** |
| I | `<Panorama>` 的 `capture` / `clearOverlays` | Driver 按「无消费者」不加 | 官方声明有；React 参考的 `PanoramaRef` 两个都暴露 | **不改（本轮），已开票** | live 实测（`panoramaInstance`，**实例读法**）坐实了上一轮「无法证伪」的结论：`capture` 与 `clearOverlays` `own: false` / `onProto: false`，但**`callable: true`**，且 `capture()` 真的返回了 1,639 字节的字符串、`clearOverlays()` 不抛。⇒ 成员**确实可达**，「上一轮探针全 false」是**原型读法失效**而不是成员不存在。补它们要动 `driver/types/panorama.ts` + `driver/jsapi-v4/panorama.ts` + `<Panorama>`，**超出本段范围** |

### 需要 Driver 改动（超出本段范围，已停手并上报）

三条裁决都指向 `src/driver/**`（AGENTS.md 的 raw SDK 白名单，另一个代理在改）：

1. **F** —— `MapDriver` 的 `setCenter` / `setZoom` / `setHeading` / `setTilt` / `panTo`
   五条要各加一个 `options?` 形参（`noAnimation` / `callback`，`setZoom` 再加 `zoomCenter`），
   实现侧按 `toRawFlyToOptions` 的既有范式投影（全空时返回 `undefined`，不下发该参数），
   然后 `MapCommands` 侧原样透传。**注意 `setZoom` 的 `zoomCenter` 是 `Point`**，
   要经 `geometry.toRawPoint` 投影。
2. **I** —— `PanoramaViewerDriver` 加 `capture` / `clearOverlays`，`<Panorama>` 给出口。
3. **A（可选）** —— 若决定让 `useMap` 的返回形态向官方靠，需要一个**新**的
   `useMapSnapshot()`，**不能**改现有 `useMapStatus` 的返回类型（那是破坏性变更）。

---

## 需要维护者裁决的三处
1. **补 `zIndex` / 补 ref 命令面 / 补事件**，都属于**扩大公共面**。#165 §3.3 要求补，
   但这些是破坏性新增（会改动已冻结的出口基线）。是否本轮做、还是分票，由维护者定。
2. **`<Panorama>` 的 `links`**：补 `getLinks` + 给 `linksChange` 加载荷，还是维持现状并
   撤掉那个事件？两者都比「发了事件但没数据」好。
3. **H1 的二选一**：`CreateBMapPluginOptions.plugins` 是**实现**还是**删除**？实现会新增行为，
   删除是破坏性变更。#165 §3.6 不允许用兼容层绕过，所以必须明确选一个。

---

## 工作包 B：Provider / Map

### B-H1. 四个 `<Map>` / `<BMapProvider>` prop 接受后被静默丢弃

| prop | 事实 | 依据 |
| --- | --- | --- |
| `noAnimation` | **全库无人读**（`grep "props.noAnimation"` = 0 命中），`withDefaults` 设了默认值却无消费者。官方的 `noAnimation` 只作为 `setCenter` / `setZoom` 等**逐调用**选项存在，**没有** `MapOptions.noAnimation` | `Map.vue:66`；`Map.d.ts:660,698,129,163` |
| `restrictCenter` | 被读入 `mapOptions` 后由 Driver **显式丢弃**并告警。官方对应能力是 `restrictBounds(bounds: Bounds)`——收的是 `Bounds` 不是布尔 | `Map.vue:574`；`driver/jsapi-v4/map.ts:125`；`Map.d.ts:361` |
| `backgroundColor` | 同上，4.0 的 `MapOptions` 无此键 | `Map.vue:576`；`driver/jsapi-v4/map.ts:125` |
| `suspense`（Provider） | 声明并设默认 `false`，**全库无人读**（`grep "props.suspense"` 只命中声明与默认两处） | `BMapProvider.vue:34,44` |

四个都被 `docs/zh-CN/components/map.md:145-146` 记成「可用」。这与 H1/H2 同型：
**「接收后忽略属于假支持」**。

### B-H2. 默认值落在官方有效范围之外

| prop | 本库默认 | 官方声明 | 依据 |
| --- | --- | --- | --- |
| `minZoom` | **`0`** | 「取值范围 **[3, 21]**」 | `Map.vue:64`；`MapOptions.d.ts:2-5` |
| `tilt` | （无默认） | 「取值范围 **[0, 73]**」——但本库两处注释写成 `0..90` | `MapOptions.d.ts`；`Map.vue:304`、`useMapStatus.ts:41` |

`minZoom` 经 `PASSTHROUGH_OPTION_KEYS` **原样透传给 SDK 构造器**，即我们交给 SDK 一个
它自己声明为非法的值，且无校验、无报错。`tilt` 的两处注释则是会误导后来者的错误范围。

### B-H3. `<Map @click>` 载荷丢 `overlay` / `icon` / `poi`

官方 `MapMouseEvent`：`{ point; pixel; overlay: Overlay | null; icon?; poi? }`。
本库 `DriverEvent`（`driver/types/events.ts:19-31`）只有 `type / point / pixel / size /
zoom / targetZoom / trend / …`——**没有 `overlay` / `icon` / `poi`**。

后果：**「用户点到了哪个 marker」这一最常见的地图事件用例，只能经未类型的 `.raw` 逃生口**。
`pixel` 也从官方的**必填**降级为可选。事件**名字**是 41/41 精确匹配（集合运算可证），
缺口全在载荷保真度上。

### B-H4. 能力目录承诺了 Driver 没实现的成员

| catalog 条目 | 声明 | 实际 |
| --- | --- | --- |
| `map.screenshot` | `status: "native"`，`rawMembers: ["getScreenshot"]` | `MapDriver` **无** `getScreenshot` |
| `map.viewport` | `rawMembers` 含 `getViewport` | `MapDriver` **只实现** `setViewport` |
| `map.fly-to` | `status: "extended"`，`rawMembers: ["panTo"]` | 探测的是**另一个成员**（`panTo`），无 `flyTo` 命令 |

`supports("map.screenshot")` 返回 `true` 是一个**兑现不了的承诺**——这比「不提供」更糟。

### B-M. 11 个官方 `MapOptions` 字段无 prop（4 个 Driver 已支持）

`enableRotate` / `enableRotateGestures` / `enableTilt` / `enableTiltGestures`（这四个已在
`MapInteraction` 与 `INTERACTION_METHODS` 里，**只差一个 prop**）、`fixCenterWhenPinch` /
`fixCenterWhenResize` / `zoomCenter` / `enableIconInfoWindow` / `enableIconHighlight` /
`enableMapClick`（4.0 默认改成了 `false`，是所有底图 POI 交互的总闸）/ `overlayTop` /
`enableAdaptiveMinZoom`。

另：`toMapType()` 只映射 `MapTypeId` 声明的 5 个常量中的 3 个，`BMAP_HYBRID_MAP` 与
`BMAP_NONE_MAP` **静默回落成 normal**；叠加没有 `getMapType()` ⇒ **当前地图类型完全读不到**。

### B-R. 同名不同形（会被 `official-api-alignment.md` 的「名称对齐 ✓」误导）

| 名称 | 本库 | 官方 React 参考（`huiyan-fe/react-bmap`） |
| --- | --- | --- |
| `useMap` | 返回**对象** `{status,map,client,error,whenReady}` | 返回 **MapHandle 本身**（未就绪为 `null`） |
| `useMapReady` | 返回 `ComputedRef<boolean>` | 接收**回调**的哨兵 hook `useMapReady(onReady)`；其 docstring 自述为 `<Map onReady>` 的**等价物**（效果等价，二者任选其一） |
| `useMapStatus` | 8 个**独立** readonly ref | 一个**原子快照**对象（`useSyncExternalStore`，无撕裂读） |

三者名字与该参考完全一致，**返回形态都不同**。那份对照表只比名字，
把三个都记成「名称对齐 ✓」，会误导从参考实现移植的人。

> **对照物说明**：这一族是 **react-bmap 单边**比对。`@baidumap/vue-bmap` 虽也导出
> `useMap`（`ComputedRef<MapHandle\|null>`）与 `useMapReady`（同款回调哨兵，docstring 亦自述
> 与 `<Map @ready>` 等价），但**没有** `useMapStatus`——`src/index.ts` 与 `src/composables/index.ts`
> 均无该导出（只在 `DESIGN.md` 与 examples 的 `apiData.ts` 里被提及，尚无实现）。
> 因此 `useMapStatus` 一行**只有 react-bmap 一个对照**，`useMap` / `useMapReady` 两行两个参考形态一致。

### B-A. 判定为对齐（不应无谓改动）

- **事件名 41/41 精确匹配**（集合对称差为 ∅；两个额外的 `headingchange` / `tiltchange`
  是有据的 `declared:false` 运行时事件）。
- `heading` 的**环绕比较器**（`setHeading(270) → getHeading() === -90`）与官方文档一致。
- `load` 事件「仅在首次 `centerAndZoom` 后派发一次」的时序问题解决得干净。
- `enableContinuousZoom` / `enableTraffic` / `enableResizeOnCenter` 等 v2 兼容 prop 的处置
  诚实：`enableTraffic` **明确告警并 no-op**（4.0 的路况是 `TrafficLayer`），
  没有假装生效。
- `enableWheelZoom` 默认 `false`（官方 `true`）是**有意为之且有注释论证**的差异。

> **后续（Class 1 已落地，改的是名字不是判断）**：上两条提到的 `enableResizeOnCenter` 与
> `enableWheelZoom` 已在 #165 Class 1 中**改名**为官方 `MapOptions` 的构造期键
> `fixCenterWhenResize` / `enableWheelZoom`（旧名**直接删除**、无兼容别名，见 §3.6）。
> 上面这两条结论本身**不因此失效**：
> - 改的只是 prop 名，**落地机制与默认值都不动**（仍按官方实例方法落一次；`enableWheelZoom`
>   仍默认 `false` 并显式写进构造 options）；
> - `enableTraffic` / `enableContinuousZoom` 两条**未改名**（前者的处置是 Class 5 的「静默丢弃」，
>   另开票；后者官方构造期键同名，无需改）。
>
> 另一个由 Class 1 顺带修掉的**静默错值**（本审计当时未列为 HARD DEFECT）：
> `mapType` 此前只映射 `BMAP_NORMAL_MAP` / `BMAP_SATELLITE_MAP` / `BMAP_EARTH_MAP`，
> `BMAP_HYBRID_MAP` 被**静默降级**成 `normal`——要混合图拿到普通图且无任何提示。
> 现在五个官方常量全部有明确落点，`BMAP_NONE_MAP` **显式失败**。
- 未知/泄露检查：`./composables` 的 `forgotten-exports.json` 为 `[]`；
  `PublicMapContext` / `MapEventSource` 的窄面没有泄漏内部类型。
  > **更正（#160 结清后的回归）**：写下这一条时该断言**并不成立** —— 本工作包新增的
  > `MarkerOptions.label` / `LabelOptions.anchor` 只在**根入口**做了导出（按 props 口径的别名
  > `MarkerLabelSpec` / `OverlayAnchor`），`./composables` 与另外两个子入口的 export 面没跟上，
  > 于是 `MarkerLabelInput` / `OverlayAnchorName` 在这里仍是未导出类型（`advanced` / `plugins`
  > 还多一个 `ViewportOptions`）。欠账被 `pnpm generate:api` 一次性写进了身份集合基线，
  > `check:api` 随后全绿。三个名字已按「升为公共导出」补齐三个出口，本条断言现在才真正成立；
  > 根因与门禁修补见 `.changeset/160-forgotten-exports-regression.md`。
- 4.0.5 对本工作包**零影响**：`core/MapEvent.d.ts` / `MapOptions.d.ts` **逐字节未变**，
  `core/Map.d.ts` 只是给 `addLayer`/`removeLayer` 加了 12 个 visualization 类名。
  本节的 `4.0.4` 注释**结论仍然成立**，只是版本号过时。
