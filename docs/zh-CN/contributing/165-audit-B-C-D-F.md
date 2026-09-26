# #165 成员级审计：B / C / D / F（2026-09-26）

> 工作包 E（composables）见 `165-audit-inventory.md`。本文是 B/C/D/F 的成员级走查结论。
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

| 类 | 4.0.5 声明、本库 `supports()` 未登记 |
| --- | --- |
| `PointLayer` | `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |
| `ClusterLayer` | `setOpacity` / `getOpacity` / `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |
| `Heatmap` | 上述 + `setGradient` / `setRadius` |
| `TrackLine` | `setOpacity` / `getOpacity` / `setZIndex` / `getZIndex` / `setRenderStage` / `setRefCenter` |

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

## 需要维护者裁决的三处

1. **补 `zIndex` / 补 ref 命令面 / 补事件**，都属于**扩大公共面**。#165 §3.3 要求补，
   但这些是破坏性新增（会改动已冻结的出口基线）。是否本轮做、还是分票，由维护者定。
2. **`<Panorama>` 的 `links`**：补 `getLinks` + 给 `linksChange` 加载荷，还是维持现状并
   撤掉那个事件？两者都比「发了事件但没数据」好。
3. **H1 的二选一**：`CreateBMapPluginOptions.plugins` 是**实现**还是**删除**？实现会新增行为，
   删除是破坏性变更。#165 §3.6 不允许用兼容层绕过，所以必须明确选一个。
