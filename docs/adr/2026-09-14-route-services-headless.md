# ADR 2026-09-14：路线服务（Driving / Walking / Riding / Transit）的 headless 契约

- 状态：已接受（Accepted）
- 关联：issue #39（M7-ROUTES）、总追踪 #12
- 依赖：[ADR 2026-09-14：服务生命周期与本地检索归属](./2026-09-14-service-lifecycle-and-local-search.md)
  （本 ADR **沿用**它的归属模型与释放口径，不取代它）
- 参考：[ADR 2026-09-13：Official-first 与 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)、
  [ADR 2026-09-13：详情与路线封装](./2026-09-13-ui-kit-detail-route-wrappers.md)

## 背景

M7 要把 JSAPI 4.0 的四个路线规划服务（`BMap.DrivingRoute` / `WalkingRoute` / `RidingRoute` /
`TransitRoute`）做成 **headless** composable：结果为数据、默认不绘制、可选把结果交给服务画到地图上；
标准路线面板则由 `./ui-kit` 的 `BRoutePlan` 提供（#75）。两者不互相替代、也不能都接上。

本 ADR 冻结这一层的公共契约。事实来源是**发布产物**：`@baidumap/jsapi-v4-types@4.0.4` 的
`service/{DrivingRoute,WalkingRoute,RidingRoute,TransitRoute,...}.d.ts` 与 `const/*.d.ts`，
以及官方 React 参考实现 `huiyan-fe/react-bmap@2.0.1` 的 `src/hooks/services/use*Route.ts`
（同源：它也依赖 `@baidumap/jsapi-loader`）。

逐条核对四个服务的公开签名后，得到**四处必须分开处理**的差异（issue 实施步骤 1 的「不能用最宽模型
假定全部模式相同」）：

| 服务 | `search` 签名 | 途经点 | 构造选项 | 结果形状 |
| --- | --- | --- | --- | --- |
| `DrivingRoute` | `(Point \| LocalResultPoi, …)` —— **没有 `string`** | `{ waypoints }` | `policy` / `enableTraffic` / `alternatives` | `DrivingRouteResult#getPlan → RoutePlan` |
| `WalkingRoute` | `string \| Point \| LocalResultPoi` | 无（两参数） | 只有 `renderOptions` | 同上 |
| `RidingRoute` | 同步行 | 无 | 只有 `renderOptions` | 同上 |
| `TransitRoute` | 同步行 | 无 | `policy` / `intercityPolicy` / `transitTypePolicy` / `pageCapacity` / `enableTraffic` | `TransitRouteResult#getPlan → TransitRoutePlan`（乘车段 + 步行段序列） |

## 决策

### 1. 端点模型：三种形态用类型区分，驾车单独收窄

```ts
type RouteEndpoint            = string | Point | RouteEndpointPoi;  // 步行 / 骑行 / 公交
type DrivingRouteEndpoint     =          Point | RouteEndpointPoi;  // 驾车（无 string）
interface RouteEndpointPoi { uid: string; point: Point; name?: string }
```

- **`string` 的缺席是类型层的事实**，不是运行时校验：给驾车传地名会在编译期被拒，
  运行时（JS 调用方）以 `failed(BMAP_INVALID_ARGUMENT)` 结算并提示「先用 Geocoder / LocalSearch
  取坐标或 POI」；
- **POI 引用**用 `{ uid, point, name? }` 而不是官方的 `LocalResultPoi`：本库的公共 DTO 是**投影**、
  不携带 raw 对象（与 `LocalSearchNearbyRequest.center` 拒绝 `LocalResultPoi` 同源）。
  Driver 把它构造成 SDK 认得的对象（`uid` / `title` / `point`）——**这是未经真实运行时证明的假设**，
  见「已知限制」。

### 2. 结果 DTO：信封共用，方案不强求同构

- 信封 `RouteResult<TPlan>`：`start` / `end` / `plans` / `policy` / `transitType`；
- 驾车 / 步行 / 骑行共用 `RoutePlan`（`getNumRoutes` / `getRoute` / `getDistance` / `getDuration`
  / `getTaxiFare` / `getDragPois`，加 `toll` / `tollDistance` 的**可选读取**）；
- 公交用 `TransitRoutePlan`：`getTotalType(i)` 是**官方自己的判别入口**（0 步行 / 1 乘车），
  据此把 `getTotal(i)` 分流成 `{ kind: "walk", leg }` 或 `{ kind: "line", ... }`。
  硬套 `RoutePlan` 会逼调用方从 `description` 文本里还原换乘信息；
- 刻意不投影 `Route#getPolyline()`（SDK 自己画的覆盖物，所有权属服务，见决策 3）与
  `Line.type` 之外的枚举对象；需要时走 `./advanced` 的 `unwrapRaw()`。
- 刻意不投影**入参的回声字段** `TransitRouteResult.intercityPolicy` / `transitTypePolicy`：它们是调用方
  自己传进来的两个跨城策略（官方注明「仅跨城时有值」），不是回包新增的信息；调用方本来就持有它们。
  相比之下 `policy`（驾车 / 公交）**进** DTO —— 未显式指定时它给出服务端实际采用的那个策略，是调用方
  拿不到的信息。这条差别是刻意的（`TransitRouteResult.policy` 同样按此投影）。

### 3. 归属：沿用「一个实例一个未结算操作」，**不**采纳按请求换回调

四个服务的回包只有一条 `onSearchComplete`，回包里没有请求身份，官方也没有承诺多次请求之间的回调
顺序（`DrivingRoute#setSearchCompleteCallback` 只是**声明了**可设置，4.0 文档没有说明「重设之后
旧请求的回包走哪条通道」）。因此：

- Driver 侧与 `LocalSearch` **共用同一份记账**（`activeOperations` / `supersededOperations` /
  `invokeSlotOperation` / `operationAdmissionFailure`）：一个实例同一时刻只有一个未结算操作，
  并发**显式拒绝**，取消 / 超时之后该实例不再接受新检索；
- composable 侧 `supersede: "recreate"`（**#139 后**：该策略只存在于**独占档**的实例通道
  `core/services/instanceChannel.ts` 里，因为四个路线服务**有** `disposeRoute`；见 ADR
  `2026-09-24-service-task-and-resource-scope-split.md`）：新检索取代在飞检索时**换新实例**，因此「快速重复检索」
  的最新者胜是由实例身份保证的，不依赖回调到达顺序；
- **不采纳**参考实现 `react-bmap` 的「每次请求 `setSearchCompleteCallback(cb)` + `requestId` 守卫」：
  它的归属来源是一个**可变的「最近一次回调」**（即到达顺序），而官方没有承诺那条通道的语义。
  按 #38 评审确立的口径（「归属只能靠可验证的身份」），那条路会得到「看起来能用、乱序时静默错配」
  的失败模式。

### 4. 绘制所有权：默认不画，画了就由公开入口收回

- 不传 `renderOptions` ⇒ 纯 headless（不碰 DOM、不碰地图）；传 `renderOptions.map` 必须是本库
  `MapHandle`（Driver 运行时校验句柄品牌），绘制目标因此**可验证**；
- 路线与标注由**服务自己画**：本库不去枚举它画出来的覆盖物，收回统一走官方公开的
  `clearResults()`（官方文档：「清除最近一次检索的结果，**同时清除地图上的路线和标注**」）；
- `clearRouteResults()`（清结果，实例仍可用）与 `disposeRoute()`（置终态 + 清结果，幂等、
  **成功才记账**）是两个入口，与 `disposeLocalSearch()` 共用同一实现
  （`disposeResultHolderInstance`）。`panel` 写进 DOM 的结果列表同样由 `clearResults()` 清掉。

### 5. 状态码：按**声明的方法签名**判定，并用真实读数钉住

官方对四个服务的 `getStatus()` 声明的是 `ServiceStatus`（`BMAP_STATUS_*`），里面唯一表示成功的是
`0`，`2..8` 依次是位置未知 / 导航未知 / 非法密钥 / 非法请求 / 没有权限 / 服务不可用 / 超时。

同一个类型包里还有一套 `RouteStatus`（`BMAP_ROUTE_STATUS_NORMAL`=0 / `_EMPTY`=1 / `_ADDRESS`=2），
与 `ServiceStatus` 在 0..2 上重叠、语义不同。**第一版据此按「两套一致的那一段」判定（`≥3` 才失败），
真实读数证明这个推理是错的**：

> 真实 4.0 运行时（`driving` 天安门 → 太平洋中部，即无法规划）`getStatus()` 回 **`5`**
> （`BMAP_STATUS_INVALID_REQUEST`），而不是 `RouteStatus.EMPTY(1)` 或 `3`；正常路线回 `0`。
> ⇒ 运行时用的就是 `ServiceStatus`，明确的方法签名优先于「另一张码表存在」。

因此口径是（PR #91 评审 P1 之后的定稿）：

- **`status ≥ 2` ⇒ `failed`** 并带上官方那个码，且**优先于载荷**（官方失败时仍会触发
  `onSearchComplete`，先看载荷会把失败读成成功）；
- `status` 为 `0`（声明里唯一的成功值）、`1`（`ServiceStatus` 的「城市列表」/ `RouteStatus` 的
  「结果为空」，两种读法都不否认「没有可用路线」）或读不到（`null`）⇒ 由载荷决定
  `success` / `empty`。

**为什么不是「非 0 全判失败」**：把「有方案但状态码是 1」判成失败会丢掉可用结果；而 `empty`
（没有可用结果、可以重试）在那一刻是更安全的合并结论。**残余未知**：本轮只观测到 `0` 与 `5`，
是否存在回 `1` 的路径未验证——要继续收窄就得再补真实读数，不按猜测放宽。

### 6. 与 UI Kit 的分流

- `./ui-kit` 的 `BRoutePlan` 是标准面板（锁定版本只开放驾车）：它自己发请求、自己画、自己管 DOM；
- 本 ADR 的四个 hooks 是「完全自定义 UI」那条路；
- **同一次界面操作只走其中一条**。两条都接上会让一次点击发出两次检索。
  该口径由 `tests/behavior/v3-useBMapRoutes.test.ts` 的静态门禁守（headless 源码不得引用
  UI Kit / `BRoutePlan`；UI Kit 路线封装不得引用这几个 hook），并在文档里给出两条示例。

### 7. 刻意**不**暴露的官方选项

| 选项 | 处置 | 依据 |
| --- | --- | --- |
| `alternatives` | 不暴露 | 官方声明明说「仅在非 GL 模式下生效」，而 4.0 恒为 GL 模式 ⇒ 收下也不会生效 |
| `selectFirstResult` | 不暴露 | 官方 `RenderOptions` 明说「此属性仅对 `LocalSearch` 有效」 |
| `polylineStyle` | 本轮不暴露（欠账） | 上游声明的 `PolylineOptions`（平铺成员）与官方类文档里的具名分桶（`highlight` / `transit` / `walking` / `decorate`）互相矛盾，无法在不猜的前提下给出可信的公共形状 |
| `panel` | 暴露、**原样转发、不告警** | 4.0.4 自相矛盾：`RenderOptions.panel` 的注释写「驾车路线规划无效」，而 `DrivingRoute.d.ts` 的官方示例传了 `panel` 并说「结果面板已展示」。真实 AK 实测**驾车有效**（容器 DOM 0 → 2417 字符、`clearResults()` 后回 0）⇒ 按上游契约冲突处理，不替 SDK 下结论 |
| `waypoints`（非驾车） | 显式失败 | 官方两参数签名里没有它 ⇒ 收下再丢掉是假支持 |

## 后果

- **落点与 issue「预计变更区域」的偏差**：issue 写的是 `core/services/routes/**`，实现落在
  `driver/jsapi-v4/**`（raw SDK 访问 + 结果投影）与 `composables/**`（Vue 绑定与状态）。
  理由：`core/services/**` 自述「**框架无关**、不 import vue、不 import SDK」，而 raw SDK 的
  **全树白名单**只放行 `driver/**` / `client/**` / `core/loader/**` / `plugins/**`
  （`scripts/raw-sdk-boundary.mts`），把路线代码塞进 `core/services` 会让 `pnpm check:raw-sdk:tree`
  直接红。分工因此是：`core/services` 继续留「状态口径 / 请求序列守卫 / 顺序批处理」这些与引擎无关的
  底座，路线服务与其它服务一样走 `driver` + `composables` 两层。
- **公共 API**：新增（无破坏性变更）。根入口新增四个 hooks、`RouteEndpoint*` / `RoutePlan` /
  `TransitRoutePlan` / `RouteResult` / 渲染与状态类型，以及四张策略常量表
  （`DrivingPolicy` / `TransitPolicy` / `IntercityPolicy` / `TransitVehiclePolicy`，值 + 类型同名）；
  Driver 侧新增 `create*Route` / `search*Route` / `clearRouteResults` / `disposeRoute`；
- **能力清单**：`service.{driving,walking,riding,transit}-route` 在 Catalog 里本就是 `native`，
  本轮不改（能力矩阵因此无漂移）；
- **资源释放**：新增泄漏门禁计数 `leaks.routeResults`（未清理的路线结果集，含服务画在地图上的路线与
  标注），销账点唯一 = 公开的 `clearResults()`；实例本身没有 `dispose()`，与 `LocalSearch` 同档只进
  活动口径；
- **回滚**：删除四个 composable、Driver 的四个 `create*Route` / `search*Route` 与
  `clearRouteResults` / `disposeRoute` 即可回到本轮之前；`routeResults` 计数与 Fake 替身一并删除。
  没有任何既有服务的行为依赖它们。

## 非目标

- 不重做标准路线面板（属 #75 的 `BRoutePlan`）；
- 不做 `TruckRoute`（官方 4.0.4 未声明 `TruckRoute` 类，Catalog 标 `experimental`，迁移结论属 M8 #43）；
- 不做路线的**增量更新**（改终点而不换实例）：四个服务都没有「改起终点」的公开入口，
  重新检索就是新建一次规划，缓存与去重留给调用方；
- 不接管 UI Kit 内部的地图资源（面板自己画的覆盖物由它自己收回）。

## 真实 AK 读数（2026-09-14，PR #91 评审 P2-3 要求的证据）

驱动的是**源码 Facet Driver**（`.smoke/` 临时 harness，`@pkg` 别名，跑完移出仓库；AK 只经 URL
参数传入，不落盘），因此这一轮同时校验了本库实现与真实 SDK 的配合。8 个探测全部完成、0 个异常：

| 探测 | 读数 |
| --- | --- |
| driving：对照组（纯 `Point` 端点） | `success`，`getStatus()=0`，1 条方案（8284 米） |
| **driving：POI 形态端点（uid 是合成的）** | **`success`**，`getStatus()=0`，1 条方案；结果回显 `start.uid/title` = 我们传的合成值 |
| driving：无法规划（→ 太平洋中部） | `failed(code 5)`，**原始 `getStatus()=5`**（`BMAP_STATUS_INVALID_REQUEST`） |
| render + `clearResults()` | `map.getOverlays()`：`20 → 42`（画了 22 个）→ **`20`**（清干净） |
| **driving + `panel`** | 容器 `innerHTML`：`0 → 2417` 字符（`navtrans-container-v4`）→ **`0`**（清干净） |
| walking：地名端点 | `failed(code 3)`（`getStatus()=3`，这个「地标名 → 地标名」用例拿不到路线） |
| **walking：POI 形态端点** | **`success`**，`getStatus()=0`，1 条方案 |
| **transit：POI 形态端点** | **`success`**，5 条方案，`transitType=0`，分段 `["walk","line","walk"]` |

三条结论直接改了实现或文档：

1. **POI 引用端点可用**（driving / walking / transit），不再是「未经证明的假设」；
2. **`getStatus()` 用 `ServiceStatus`**（无法规划 ⇒ `5`，不是 `RouteStatus.EMPTY(1)`）⇒ 决策 5 的口径；
3. **驾车 `panel` 实测有效**（`0 → 2417 → 0`）⇒ `RenderOptions.panel` 那句「驾车路线规划无效」在
   4.0.4 上是过时描述，本库因此不告警、也不声称无效（决策 7）。

顺带一条使用提示：本轮的 walking **关键字端点**用例（`'天安门' → '国贸'`）返回 `3`，而同一服务的
POI / 坐标端点正常 ⇒ 实际使用时坐标或 POI 比裸地标名更稳（这不改变公开签名，属服务端解析行为）。

## 已知限制

1. **POI 端点已在真实 AK 上验证**（见上一节）：`{ uid, point, name? }` 被构造成
   `{ uid, title, point }` 后，真实运行时接受并成功规划，结果里回显我们给的 `uid` / `title`。
   **残余未知**：合成 uid 必然不存在，因此无法从这轮读数区分「SDK 按 uid 定位」与「uid 未命中后
   回落到 `point`」——只传 `point` 的纯坐标路径没有这个歧义，仍是最稳的形态。
2. **`getStatus()` 的码表**：见决策 5——真实读数（无法规划 ⇒ `5`）证明运行时用 `ServiceStatus`，
   本库按 `≥ 2` 判失败。**残余未知**：是否存在回 `1` 的路径未观测到（本轮只见到 `0` 与 `5`）。
3. **`clearResults()` 在宿主地图已销毁时可能抛**：官方清理会碰渲染器里的 map。本库的处置是
   「释放失败不记账、报出来、下次释放重试」（`useBMapServiceTask` 的 `pendingReleases`），
   与 `disposeLocalSearch()` 完全一致。组件卸载时若地图已被销毁，会看到一条 `BMAP_SDK_CALL_FAILED`
   告警；这不是泄漏（诊断计数不会因此非 0）。
4. **`polylineStyle` 未暴露**（见决策 7 的欠账）。
5. **真实服务 smoke 未进 required**：本轮用**一次性真实 AK smoke**（`.smoke/` 临时 harness，跑完移出、
   不入库）取到了四类服务 + render / panel 的读数（见「真实 AK 读数」一节），但没有把它做成仓库里的
   required 探针——在线路线服务按次计费 / 限流，进 required 会让 CI 变脆。做常驻 route 探针属后续票。
6. **`panel` 按上游契约冲突处理**：不告警、也不承诺有效或无效（真实读数表明驾车有效，见决策 7）。
7. **泄漏门禁的 `routeResults` 仍是代理指标**：Fake 只记「未清理的结果集」，它**不真的**往地图上加
   折线 / 标注、也不写 `panel` 的 DOM。不过本轮真实读数给了它一条外部对照：`map.getOverlays()` 在
   `search` 后 `20 → 42`、`clearResults()` 后回到 `20`；panel 容器 `0 → 2417` 字符 → `0`。
   因此「本库释放路径走通了」由 `assertIdle()` 证明，「SDK 侧确实清干净了」由这条真实读数证明——
   两者合起来才是完整结论。
8. **测试文件不进任何 typecheck 门禁**（既存欠账，不是本票引入）：`tsconfig.build.json` 排除
   `src/**/*.test.ts`，`tests/**` 与 `packages/test-utils/**` 无覆盖的 tsconfig。本票用一次性
   tsconfig（`tests/**` + `test-utils/**` + `src/**`，跑完即删）核对过：**本次改动的文件 0 错误，
   全仓既存 43 个错误分布在 15 个未触碰的文件**（交集为空）。因此：
   - 「驾车端点不接受字符串」这条**类型层收窄**的常驻断言放在了 `fixtures/v3-consumer`（那里真有
     `vue-tsc` 门禁，由 `verify-package` 跑），`routes.test.ts` 里的 `@ts-expect-error` 是同口径的
     第二道；把 `tests/**` 纳入门禁需要先清掉那 43 个既存错误，属后续票。

## 参考

- 官方声明：`@baidumap/jsapi-v4-types@4.0.4` 的 `service/DrivingRoute.d.ts` /
  `WalkingRoute.d.ts` / `RidingRoute.d.ts` / `TransitRoute.d.ts` / `*Options.d.ts` /
  `RoutePlan.d.ts` / `TransitRoutePlan.d.ts` / `Route.d.ts` / `Step.d.ts` / `Line.d.ts` /
  `RouteRenderOptions.d.ts`，以及 `const/{DrivingPolicy,TransitPolicy,IntercityPolicy,TransitType,
  TransitPlanType,RouteStatus,StatusCodes,RouteType,LineType}.d.ts`；
- 官方 React 参考实现：`huiyan-fe/react-bmap@2.0.1` 的 `src/hooks/services/use{Driving,Walking,
  Riding,Transit}Route.ts`（同源 `@baidumap/jsapi-loader`；本 ADR 决策 3 明确不采纳它的归属做法）；
- 本仓库：`src/driver/jsapi-v4/services.ts`（创建面 + 归一化调用面 + 投影）、
  `src/driver/types/services.ts`（公共 DTO 与策略常量）、
  `src/composables/routeServices.ts`（四个 hooks 的共用底座）、
  `src/composables/useBMap{Driving,Walking,Riding,Transit}Route.ts`；
- 测试：`src/driver/jsapi-v4/routes.test.ts`（含「策略表 vs 上游 `.d.ts`」的反射断言）、
  `tests/behavior/v3-useBMapRoutes.test.ts`（含 UI / headless 分流门禁）。
