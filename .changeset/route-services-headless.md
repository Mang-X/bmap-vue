---
"baidu-map-gl-vue": minor
---

路线服务（M7-ROUTES / #39）：新增四个 headless 路线规划 hooks，标准路线面板仍由 `./ui-kit` 的 `BRoutePlan` 提供。

**新增**

- `useBMapDrivingRoute()` / `useBMapWalkingRoute()` / `useBMapRidingRoute()` / `useBMapTransitRoute()`：
  官方 `DrivingRoute` / `WalkingRoute` / `RidingRoute` / `TransitRoute` 的归一化封装，结果是**强类型的
  方案 / 路线 / 关键点**（`RouteResult` → `RoutePlan` / `TransitRoutePlan` → `RouteLeg` → `RouteStep`）。
  选项接受 `MaybeRefOrGetter`，**只有构造期字段（`location` / 各服务自己的策略选项 / `renderOptions`）
  变化才重建 SDK 实例**；四个 hooks 共用同一份状态口径与请求归属（见下）。
- 策略常量（值 + 类型同名，免写魔法数字）：`DrivingPolicy` / `TransitPolicy` / `IntercityPolicy` /
  `TransitVehiclePolicy`，与官方 `BMAP_*_POLICY_*` 逐值对齐。
- Driver 新增路线面：`createDrivingRoute` / `createWalkingRoute` / `createRidingRoute` /
  `createTransitRoute`、`searchDrivingRoute` / `searchWalkingRoute` / `searchRidingRoute` /
  `searchTransitRoute`、`clearRouteResults` / `disposeRoute`。
- Fake v4 新增四个路线服务替身与诊断计数 `routeResults`（未清理的路线结果集，泄漏门禁口径）。

**按服务区分（不是「一个最宽模型套四个服务」）**

| 服务 | 起终点 | 途经点 | 构造选项 |
| --- | --- | --- | --- |
| 驾车 | `Point` / POI 引用 —— **不接受地名**（官方签名里没有 `string`） | 支持 `waypoints` | `policy` / `enableTraffic` |
| 步行 / 骑行 | 地名 / `Point` / POI 引用 | 无（官方两参数签名） | 只有 `renderOptions` |
| 公交 | 地名 / `Point` / POI 引用 | 无 | `policy` / `intercityPolicy` / `transitTypePolicy` / `pageCapacity` / `enableTraffic` |

给不支持的服务传 `waypoints` 会以 `failed(BMAP_INVALID_ARGUMENT)` 结算，而不是静默忽略。

**语义细节（值得知道）**

- **默认不绘制**。要画就显式给 `renderOptions.map`（`MapHandle`，服务只需要 Client 上下文，
  `<BMap>` / `<BMapProvider>` 子树都可用）；那时路线与标注由**服务自己**画，收回统一走官方公开的
  `clearResults()`（`clear()` / `clearRouteResults()` / `disposeRoute()`），本库不接管 SDK 画的覆盖物。
- **归属靠实例身份**：四个服务的回包没有请求身份、官方也没承诺跨请求回调顺序，因此同一实例同一时刻
  只允许一个未结算检索（并发被显式拒绝）；`supersede` 策略是「取代即换新实例」，所以快速重复检索是
  「最新者胜」，旧的迟到回包不会污染新结果。
- **状态码口径**：官方 `getStatus()` 声明的是 `ServiceStatus`，但同一个类型包里还有一套 `RouteStatus`，
  **两套在 0..2 区间重叠、语义不同**。本库只解释两套一致的那一段：`≥ 3` ⇒ `failed` 并带上官方那个码；
  `0..2` 或读不到 ⇒ 由载荷决定（无方案 ⇒ `empty`，可重试）。
- 官方声明了但**不生效**的选项不暴露：`alternatives`（仅非 GL 模式）、`selectFirstResult`（仅
  `LocalSearch`）、`polylineStyle`（上游声明与类文档给的形状互相矛盾，列为欠账）；
  `panel` 对驾车无效（官方文档明确写着），本库**告警一次**而不是静默忽略。
- 与官方 UI Kit 的分流不变：`BRoutePlan` 是标准面板（自己发请求、自己画），本 hooks 是完全自定义 UI
  那条路；**同一次界面操作只走其中一条**，两条都接上会双发检索。该口径有静态门禁守。
