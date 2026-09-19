# 服务生命周期、统一状态口径与 headless LocalSearch

- 状态：Accepted
- 日期：2026-09-14
- 相关：`packages/baidu-map-gl-vue/src/core/services/**`、`src/composables/useBMapServiceTask.ts`、
  `src/composables/useBMap{Geocoder,GeocodeDetail,Convertor,Geolocation,AreaBoundary,IpLocation,LocalSearch}.ts`、
  `src/driver/types/services.ts`、`src/driver/jsapi-v4/services.ts`、`packages/test-utils/fake-bmap-v4/**`、
  `tests/behavior/v3-useBMapLocalSearch.test.ts`
- 取代：`2026-09-12-jsapi-v4-service-panorama-native-layers.md` 的「非目标」第 1 条与「已知限制」中
  「composable 层 raw 访问 + 统一服务生命周期留待 #38」这两条保留项（**不是**整份取代：该 ADR 的
  两层结构、`ServiceResult` 终态集合、私有面不嗅探等决策继续有效）。
- 反向指针见 `2026-09-13-private-sdk-surface-removal.md` 的「已知限制 2」——那一处已经改用与本 ADR
  一致的表述（原文写的是「要等 #26 删除 webgl-v1 之后，与 #38 的服务生命周期一起做」）。

## 背景

`#23` 把 v4 的服务收成了两层（创建面 `ServiceDriver` + 归一化调用面 `ServiceInvocationDriver`），
但刻意留下了三处欠账（PR #63 的「迁移影响」与「已知限制」都登记过）：

1. **7 处 service composable 仍直读 `handle.raw`**（`geocoder.raw.getPoint` / `boundary.raw.get` …），
   各自用 Promise 手工拼「超时 / 空结果 / 迟到回调」；`useBMapAreaBoundary` 甚至连 `whenReady`
   之后都不释放边界实例的引用。
2. **只有 `Autocomplete` 有 Driver 侧释放入口**，因为只有它在 Driver 侧持有资源（输入活动监听 +
   待回包队列）。`LocalSearch` 根本没实现（`service.local-search` 在 Catalog 里是 `native`，
   但代码里没有创建入口）。
3. **`ServiceResult` 的 DTO 在几处漏抄上游声明的字段**：`GeocoderResult.addressComponents` 与
   `surroundingPois` 被压成一个 `poiCount`；`LocalCityResult.level` 没投影，而 `code` 这个
   **上游没声明**的字段却被 `?? 0` 伪造成了 0。`Boundary#get` 回包的点串形态（`isBoundary` 覆盖物
   直接吃它）也在归一化时丢失。

同时 `#72` 的 ADR 把「逐请求归属」这件事记在了本票名下：`Autocomplete` 的回包不带请求身份
（`keyword` 只是**可选**），因此只能靠「通道独占 + 同关键词互斥」。`LocalSearch` 那边本可以更简单
（**不绑输入框**，没有用户输入污染同一条回调通道），但它的回包**同样没有请求身份**——
`LocalResult.keyword` 是官方必填字段，却**不是请求标识**（同关键词重查时新旧两次完全等价），
官方也没有承诺多次请求之间的回调顺序。归属因此只能靠**实例身份**（决策 4）。

参考实现：`huiyan-fe/react-bmap`（官方 React 组件库，`src/hooks/services/*`）。它给出了本库要
对齐的三件事：**统一状态面**（`data` / `loading` / `error` / `supported` + 动作 + `cancel`）、
**LocalSearch 的动作集**（`search` / `searchNearby` / `searchInBounds` / `gotoPage` /
`clearResults` / `cancel`）、以及**「最新者胜」**（`requestId` 守卫）——但它的「最新者胜」建立在一个
不成立的假设上（见决策 4）。

## 决策

### 1. 统一的服务状态口径：八个值，`empty` 是合并结论，`unsupported` 与 `failed` 必须分开

`core/services/serviceStatus.ts` 定义 `BMapServiceStatus`：

```
idle | loading | success | empty | failed | timeout | canceled | unsupported
```

- 前两个是非终态；`success / empty / failed / timeout / canceled` 与 Driver 的 `ServiceCallStatus`
  **一一对应**（类型层用 `Exclude` 双向取差集钉住，任一侧增删成员即编译失败）；
- `unsupported` 是**任务状态**，不进 `ServiceResult`：`ServiceResult` 的终态集合由 Driver 冻结
  （`assertServiceResultShape` 逐项断言），塞第六项会破坏所有既有消费者。因此
  「能力不支持」时任务状态是 `unsupported`，而 `execute()` 返回的载荷是
  `failed` + `BMAP_CAPABILITY_UNSUPPORTED`——「请求根本没发出去」与「请求发了但结果不好」是
  调用方必须能区分的两件事，前者还额外由 `supported: false` 表达；
- **「查无结果」与「服务当前不可用」仍是 `empty`**（R25-C / #72 的结论：官方对 Geocoder /
  Boundary / LocalCity 只给了「回调参数是不是 null」这一条公开信息），但
  **拿到了合法回包而结果为空**（`LocalSearch` 的 `pois: []`）是 `success`——「0 条结果」由
  `pois.length` / `total` 表达比压成 `empty` 更有信息量。

`supported` 在 **Client 一就绪**时就按 `capabilities.supports()` 判定（不是「先失败一次才知道」）：
用 `watch(() => ctx.client.value, …, { immediate: true })`。

### 2. 一个 Vue 绑定原语 + 一层框架无关底座，六个 composable 共用

- `core/services/`（不 import vue、不 import SDK）：`BMapServiceStatus` 与状态映射、
  `createRequestGuard()`（「旧请求不得覆盖新结果」的唯一实现）、`runSequential()`（批量动作的
  「顺序 + 逐项终态」口径，两处 `getBatch` 共用）、`jsapiV4ServicesOf()`（见决策 6）。
- `composables/useBMapServiceTask.ts`：**不复制请求框架**——网络语义（超时 / 空结果 / 迟到回调 /
  先到者胜）仍全部由 Driver 的 `createServiceCall` 负责；这里只做四件事：
  1. **能力门**：`supports()` 为 false 时状态直接 `unsupported`，**不创建实例、不发请求**；
  2. **实例缓存**：同一 Client 上服务实例只创建一次，Client 变化时自动重建（跨 Client 的句柄会被
     Driver 拒绝，缓存必须绑 Client 身份）；
  3. **只读状态**：`data` / `error` / `status` / `sdkStatus` / `isLoading` / `supported` 一律
     `Readonly<ShallowRef<…>>`；
  4. **过期保护**：`execute()` 递增序列号并**逻辑取消**上一轮在飞调用（最新者胜），回包落地前比对
     序列号与 `AbortSignal`；被取代的调用**以 `canceled` 结算**，它的结果既不写状态也不交回调用方。
     `onScopeDispose` 之后一律不回写。

`project` 钩子把 Driver 的 DTO 投影成 composable 对外承诺的形态；投影**只作用于 `data`**——
`status` / `error` / `sdkStatus` 是引擎结论，必须是原样的值。

**旧的通用异步任务框架被删除**：`useBMapAsyncTask` / `withServiceTimeout` / `SERVICE_TIMEOUT_MS`
（`composables/useBMapAsyncTask.ts`）在本次改造后**没有任何生产消费者**——同一件事曾有两套实现
（Driver 的归一化调用面 + composable 自己拼的 Promise/定时器），而 issue 的实施步骤 1 明确要求
「不再复制一套通用请求框架」。删除后超时语义只在 `SERVICE_CALL_TIMEOUT_MS` 一处；
调用方要发**自己的**请求（非百度服务）时用 `fetch` + `AbortController`，本库不提供通用异步任务框架。

**与实施步骤 2 的偏离（有意）**：步骤 2 要求 runner「接收 signal/requestId」。本实现给 `invoke`
传了 `AbortSignal`，但**没有**暴露 requestId——序列号改由 `createRequestGuard()` 在 composable
内部持有，理由是 `execute()` 返回的就是「本次调用的结算」（被取代时是 `canceled`），把 requestId
再交给调用方只会多一个必须自己比对、且与 `ServiceResult` 表达同一件事的状态位。

### 3. 动作恒 resolve 成 `ServiceResult<T>`，批量动作逐项带终态

所有动作（`get` / `convert` / `locate` / `search` / `gotoPage` …）都返回
`Promise<ServiceResult<T>>`，**不 reject**；失败/超时/取消都在返回值里。这是**破坏性变更**
（旧实现返回点本身或 `void`），但换来三件东西：与 Driver 的错误协议一致、调用方不必同时处理
`error` 载荷与 `catch`、以及「本次调用的结论」不再需要回读状态（`getBatch` 这类批量动作因此可以
**逐项**带自己的 `status` / `error`——「部分成功」有了载体）。

### 4. LocalSearch 的请求归属：**一个实例一个未结算操作**（实例身份隔离）

> **本节在 PR #89 的评审（P1-1）后改写。** 初版用的是「FIFO + `keyword` 校验 + 墓碑」——评审给出两个
> 确定性反例证明它在乱序回包下会错，因此整段作废，改为下面这条**不变式**。改写的依据与反例见
> 「外部评审记录」一节。

`LocalSearch` 的四个操作**共用实例上的一条 `onSearchComplete`**（构造期权一次），而 SDK 没有取消
入口。归属模型因此只有一条规则：

> **一个实例，同一时刻最多一个未结算操作。**

回调到达时，在册的那一个就是它——归属与到达顺序、与 `keyword` 都无关。由此派生三条对调用方可见的
契约：

1. **并发被显式拒绝**：实例上已有未结算操作时，新调用以 `failed(BMAP_SERVICE_FAILED)` 结算并说明
   「请 `disposeLocalSearch()` 后重建实例」，而**不是**排队等后来猜；
2. **取消/超时 = 该实例不再可用**：`cancel()` 只把本次 `ServiceCall` 结算成 `canceled`；SDK 侧请求
   收不回，迟到回包无法与后续请求区分，因此该实例此后拒绝新检索（要重建）。超时同理——超时不代表
   SDK 侧请求消失；
3. **`gotoPage` 必须落在同一条结果集上**：它是对上一条结果的延续，因此在「上一次还没结算」或
   「实例已过期」时**被拒绝**，而不是让 SDK 空转等超时（composable 侧用 `supersede: "refuse"` 表达）。

**为什么不用「FIFO + keyword 校验」**（初版的做法，已被评审推翻）：

- 官方只承诺**单次多关键字检索内部**结果数组与关键字数组顺序一致，**没有**承诺多次请求之间的回调
  顺序——初版把「每个操作恰好触发一次回调、按发出顺序到达」当成了官方口径，这是**未经验证**的推断；
- `LocalResult.keyword` 也不是请求身份：同关键词重查时新旧两次完全等价，无法据此区分；
- 两个反例（评审给出，已在 `services.test.ts` 里固化为回归用例）：
  - `cancel A → search B`（不同关键词）：B 的回包先到时，队首是 A 的墓碑 ⇒ B 被判成「不属于在册请求」
    而**丢弃**，随后 A 的回包消费墓碑 ⇒ B 只能等 `timeout`；
  - `cancel K → search K`（同关键词）：新 K 的回包被旧 K 的墓碑吃掉，旧 K 的迟到回包反而结算给新请求
    ⇒ **stale data**。

两种情况下「哪一次请求产生了这个回包」这个事实都不存在，所以本库不再猜：把歧义**变成不可能**，
代价是取消/超时之后要重建实例。

**调用方（composable）如何实现「最新者胜」**：`useBMapServiceTask` 的 `supersede` 策略。
LocalSearch 声明 `supersede: (op) => op.kind === "page" ? "refuse" : "recreate"`：
新检索取代在飞检索时，先取消旧的、再**释放旧实例**（→ 公开的 `clearResults()`，顺带清掉它画出的标注），
并为新检索建一个新实例；`cancel()` / 超时之后的实例被标记为过期，下一次检索同样重建。
**取消不立刻释放实例**——已经画出的结果保留可见（`data` 也保留），旧实例在下一次调用时才交还清理。

**代价（显式接受）**：取代会多建一个 SDK 实例（`LocalSearch` 构造的代价，换来归属可判定）；
`supersede: "recreate"` 只对声明了该策略的服务生效，其余六个服务的行为完全不变。

### 5. 释放路径：`clearLocalSearch` + `disposeLocalSearch`，仍然不引入通用 `dispose`

- `clearLocalSearch(handle)`：清 SDK 侧已产生的可见结果（标注 / 面板）与内部结果状态。**没有回包**，
  因此不是 `ServiceCall`——它清的是「已经画出来的结果」，与 `ServiceCall.cancel()` 的「放弃在飞请求」
  是两件事，两者互不代替。
- `disposeLocalSearch(handle)`：幂等；Driver 侧清理（置终态 + 解绑 EventDriver 订阅 + 把在飞调用显式失败）
  + **公开的 `clearResults()`**（官方 `LocalSearch` **没有** `dispose()`；`clearResults()` 同时清掉它
  画在地图上的标注与结果面板）；**只有成功才记账**，抛错时句柄保持不可用、再次调用会重试。
  `clearLocalSearch()` 保留为「只清结果、实例仍可用」的 Driver 级原语。
- **为什么还是没有通用 `dispose(ServiceHandle<string>)`**：其余服务（Geocoder / Convertor /
  Boundary / Geolocation / LocalCity）在 Driver 侧不持有任何资源，通用入口会承诺「在飞调用会失败、
  释放后拒绝新调用」而实现做不到。契约必须与实现一致。
- Fake v4 的泄漏门禁因此新增 `localSearchResults` 这一类：记的是**交付出去、还没被 `clearResults()`
  清掉的结果集**（含绘制物），按实例销账。`LocalSearch` 实例本身**不进**泄漏门禁（官方没有 destroy，
  随 GC 回收，与 Geocoder / Boundary 等同档）——**没有释放入口的资源不进泄漏门禁**这条口径不变，
  变更的是「这个服务的资源是什么」。

### 6. 不建立在 `setSearchCompleteCallback` 上

`LocalSearch` 的官方声明里**有** `setSearchCompleteCallback`，参考实现也用它（每次 `search()` 前换一个
闭包 + `requestId` 守卫）。本库不用它，理由是 `#72` 的真实 AK 探测**没有得出可发布结论**
（那批检索全部无回包，对照组同样无回包，最可能是同页配额/QPS），因此「换回调能否按请求归属」
（回调是请求时捕获还是响应时读取）在真实运行时上仍未被证实。内部分发器只在构造期挂一次，
归属靠**实例身份**这条可在声明里核对到的不变式（决策 4），与回调的注册时机无关。

### 7. DTO 收口：上游声明的字段必须真的被读进投影

| 变更 | 理由 |
| --- | --- |
| `GeocodedAddress` 增加 `addressComponents` 与 `surroundingPois`（复用 `LocalSearchPoi`） | 官方 `GeocoderResult` 声明了它们；旧 DTO 只留一个 `poiCount`，结构化地址被静默丢弃 |
| `queryBoundary` 的载荷 `Point[][]` → `BoundaryRings { raw, rings }` | 官方回包的**点串形态本身就是公开契约**（`B*` 覆盖物的 `isBoundary` 直接吃它）。只留解析后的环会丢掉调用方需要的东西 |
| `LocalSearchResult` 投影官方 `LocalResult` 的 `keyword` / `city` / `province` / `center` / `radius` / `bounds` / `pois` / `pageSize` / `total` / `pageCount` / `pageIndex` / `cities` / `moreResultsUrl` / `suggestions` | 逐项对应官方声明；`getCurrentNumPois`（本页）与 `getNumPois`（总数）分开，避免两个读数互相矛盾 |
| **刻意不投影**：`LocalResultPoi.marker`（SDK 覆盖物对象）、`LocalResultPoi.type`（官方数字枚举，本库不自持其值域） | 前者会把 raw 对象带进公共 DTO；后者投影成裸数字只会让调用方写魔法数字。需要时走 `./advanced` 的 `unwrapRaw()` |
| `BMapIpLocationResult`：**去掉 `code`**，新增 `level` | `code` 不在官方 `LocalCityResult` 声明里，旧实现用 `?? 0` 把「没有」伪造成 0（既违反「只依据公开面」，又让消费者以为拿到了状态码）；`level` 是官方声明里被丢掉的那个字段 |
| LocalSearch 构造选项**不接受** `onSearchComplete` / `onMarkersSet` 等回调 | 结果经 `data` / `status` 表达；`onMarkersSet` 会把官方 `LocalResultPoi`（含 raw `marker`）交出去，那属于逃生口 |

### 8. 与官方 UI Kit 的分流

本票不新增任何 UI：headless composable 是**显式 opt-in**，不订阅 UI Kit 组件的事件、也不接管它们的
生命周期；UI Kit 那条链路的「单次交互不重复发出 UI / headless 两套请求」由 `#73` 的三条用例
（`v3-ui-kit-events.test.ts` / `v3-ui-kit-place-detail.test.ts` / `v3-ui-kit-route-plan.test.ts` 的
`propertyAccesses` 记账 + 正证守卫）承担，本票**不重复实现**同一判据。
`LocalSearchOptions.renderOptions` 只透传官方声明的五个成员（`map` / `panel` / `selectFirstResult` /
`autoViewport` / `viewportOptions`）：接收后忽略属于假支持。

### 9. 绘制所有权：服务默认 headless，绘制必须显式给 MapHandle

`createLocalSearch(location, { renderOptions: { map } })` 的 `map` **只接受本库的 `MapHandle`**，
其余形态抛 `BMAP_INVALID_ARGUMENT`。不传 `map` = 纯 headless（只回数据、不绘制）；传了则绘制出来的
覆盖物由 `clearLocalSearch` / `disposeLocalSearch` 负责收回——所有权可验证。

## 后果

- **正向**：六处 composable 的 raw 访问回收到 Driver 边界内（`#23` 的「seam 已就位但仍在用
  `handle.raw`」这条欠账关闭）；`LocalSearch` 从「Catalog 里 native 但代码里没有」变成可用；
  服务状态口径、错误语义、批量语义在各服务之间一致；`ServiceResult` 的 DTO 与官方声明逐字段对齐。
- **成本 / 破坏性变更**（详见 PR 的「迁移影响」表）：`useBMapAsyncTask` / `withServiceTimeout` /
  `SERVICE_TIMEOUT_MS` 删除；动作返回值改为 `ServiceResult`；
  `queryBoundary` 载荷类型改变；`GeocodedAddress` 增字段；`BMapIpLocationResult` 去 `code` 加 `level`；
  v4 Driver 面新增 `createLocalSearch` / `search` / `searchNearby` / `searchInBounds` / `gotoPage` /
  `clearLocalSearch` / `disposeLocalSearch`。库尚未发布 1.0，且这些面都是 v3 重构中的内部契约。
- **回滚**：删除 `core/services/**`、`useBMapServiceTask.ts`、`useBMapLocalSearch.ts`，恢复
  `useBMapAsyncTask.ts`，把六个 composable 恢复到 `handle.raw` 版本，并移除 Driver 的 LocalSearch 面
  与 Fake 的 `FakeV4LocalSearch` / `localSearchResults` 诊断项即可；`dist` 不含 `driver/jsapi-v4/**`，
  回滚不影响已发布的其它消费者。

## 非目标

- 不做路线服务（Driving / Walking / Riding / Transit，属 `#39`），不实现任何标准 UI
  （建议列表 / 搜索面板 / 详情，属 `#73` / `#75` 的官方 UI Kit），不读取 SDK 私有面。
- 不改 `Autocomplete` 的归属契约（通道独占 + 同关键词互斥）。它的依据与本票不同（回调通道会被用户
  输入污染，与本票的 LocalSearch 相反），也不允许「一个实例一个在飞操作」——输入提示本来就是
  「边打边发」。它是否也改用实例隔离属后续可评估项。
  **[已兑现于 #104 / 2026-09-19]** 答案是「都不改，直接删」：既没有实例隔离可用（一个输入框一个
  实例，通道却被原生输入共用），也没有可验证身份，于是程序化 `suggest()` 连同归属层整体删除，
  `Autocomplete` 退回「事件式转发、不建归一化调用面」。本票的 LocalSearch 模型不受影响。
- 不给其余服务补释放入口（官方没有 `destroy` / `dispose`）。
- 不做 `LocalSearch` 的 `enableAutoViewport` / `enableFirstResultSelection` /
  `setPageCapacity` / `setPageNum` 的运行时开关（它们**只影响绘制与分页**，而首页容量已在构造选项里；
  需要时走 `./advanced`）。这一条是显式欠账。

## 已知限制

1. **取代要付一次构造代价**（决策 4）：LocalSearch 的归属依赖实例身份，因此「取代 / 取消 / 超时」
   之后的重查会新建一个 SDK 实例。官方 `LocalSearch` 的构造没有公开代价数字，本库也没有实测；
   在「用户反复改关键词」的交互里这是**每次一次构造**，如果实测发现开销不可接受，优化方向是
   「同一实例串行 + 只在上一次未结算时才重建」，而不是回到按到达顺序猜归属。
2. **取消/超时后的实例必须由调用方重建**：Driver 会拒绝继续使用（这是刻意的 fail-explicit），
   直接调 Driver 的调用方若不重建就会一直拿到 `failed`。composable 已经替调用方做了这件事
   （`supersede: "recreate"`），这条限制只在直接用 Driver 时可见。
3. **`sdkStatus` 只在公开带状态码的服务上恒有值**：`Geolocation` / `LocalSearch`
   （`BMAP_STATUS_*`）与 `Convertor`（回包 `status`）；其余服务没有公开错误码入口，`sdkStatus`
   恒为 `null`——不伪装成 0。
4. **`renderOptions.map` 的绘制效果未在真实 AK 上验证**：Fake 不实现标注绘制，真实 smoke 只验证
   「构造成功 + `search` 结算」。绘制（标注 / 面板 / 自动视野）的视觉正确性属 `#74` 的真实环境验收。
5. **`LocalSearch` 的跨请求回包顺序仍未有官方保证**：官方只承诺单次多关键字检索**内部**的顺序，
   本库的实现因此**不依赖**它（决策 4）。真实 AK 上的乱序行为属 `#74` 的 live 观察项——观察只可能
   影响「要不要额外的容错」，不影响现在的正确性。
6. **supersede 之后的迟到回包是否可能「重新画」**（评审的非阻塞提示，留给 `#74` 的 live 验收）：
   `renderOptions.map` / `panel` 场景下，supersede 会先对旧实例调 `clearResults()`，但旧 JSONP 请求
   仍可能随后回包。Fake **无法**证明它不会重新绘制 marker / panel。届时的观察点：清掉之后地图上是否
   又出现旧标注；若是，则需要在「已终态实例」上把回调通道也断开（`setSearchCompleteCallback(() => {})`，
   官方声明里有该成员）——当前没有证据表明需要它，因此**不**预先加上。
7. `useBMapServiceTask` 的实例缓存绑定在 **Client 身份**上：`<BMapProvider>` 的 definition 变化
   （换 AK / 换 Provider）会产生新 Client，实例随之重建——这是正确行为，但会多一次构造。
8. **`supported` 在 Client 就绪前是乐观初值 `true`**（= 尚未判定）：`capabilities` 来自 Driver，
   没有 Client 就无从探测。判定在 Client 落地的那一刻完成（`watch(..., { immediate: true })`），
   因此「读到 `false`」一定来自真实探测；但「Client 还没就绪时读到 `true`」不代表能力可用。

## 参考

- 官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`：`LocalSearch` / `LocalResult` /
  `LocalResultPoi` / `LocalSearchOptions` / `GeocoderResult` / `AddressComponent` /
  `LocalCityResult` / `StatusCodes`（`BMAP_STATUS_*`）。
- 参考实现 `huiyan-fe/react-bmap`（`src/hooks/services/*`、`src/types/results.ts`）：状态面与动作集
  对齐；归属模型**不采纳**它的 `requestId` 守卫（那是「最新者胜」，对下拉列表够用，对数据契约不够），
  改用「一个实例一个未结算操作」这条不变式（初版试过 FIFO + `keyword` 校验 + 墓碑，被 PR #89 的
  评审用两个乱序反例推翻，见决策 4）。
- 本仓库：`2026-09-12-jsapi-v4-service-panorama-native-layers.md`（两层结构）、
  `2026-09-13-private-sdk-surface-removal.md`（`empty` 是合并结论、不嗅探私有面）、
  ADR `2026-09-14-remove-legacy-engine.md`（删除旧引擎后统一服务生命周期的前提已成立）。

## 外部评审记录（PR #89，基线 `51d51bb`）

维护者评审给出 3 条 P1 + 2 条 P2 + 1 处正文笔误，全部**先在仓库里复现成红用例**再改（复现命令与读数
写在 PR 回复里）。逐条处置：

| 发现 | 复现结果（红） | 处置 |
| --- | --- | --- |
| **P1-1** 归属依赖「跨请求按发出顺序回包」这个官方**没有承诺**的前提 | `cancel A → search B` 且 B 的回包先到 ⇒ B `timeout`；`cancel K → search K` 且新的先到 ⇒ 新调用拿到结果（stale） | 整段作废，改为「一个实例一个未结算操作」不变式 + composable 侧 `supersede` 策略（决策 4）；两个反例固化为回归用例（`expected 'timeout' to be 'failed'` / `expected 'success' to be 'failed'`） |
| **P1-2** 把不存在的官方 `LocalSearch#dispose()` 当成官方 API；`disposeLocalSearch` 没有调用公开的 `clearResults()` | `disposeLocalSearch` 后 `callLog` 里**没有** `clearResults` | 释放路径走公开 `clearResults()`（`disposeServiceInstance` 的 SDK 步可注入）；Fake 删掉虚构的 `dispose()`，泄漏口径改为「未清理的**结果集**」（`localSearchResults`） |
| **P1-3** 多关键字检索后 `gotoPage` 继承陈旧的 `lastSearchKeyword` | `search("A")` → `search(["B","C"])` → `gotoPage(0)` ⇒ `timeout` | 新模型里**没有**关键字判据（槽位唯一），该字段与相关工具一并删除 |
| **P2-1** `releaseCached()` 先丢引用再释放、并吞掉异常 ⇒ 「可重试」名存实亡、静默泄漏；`cleanup()` 与 `events.release()` 写在同一个 try 里 | 注入一次释放失败后，没有任何重试与可观察信号 | 失败的实例进**待释放队列**并在下一次释放重试 + 告警；`disposeServiceInstance` 两步分别 try/catch |
| **P2-2** `createLocalSearch(location: unknown, …)` 与 `renderOptions.map?: unknown` 与领域类型不一致 | — | 收紧为 `string \| Point \| MapHandle` / `map?: MapHandle`（运行时品牌校验保留，覆盖 JS 调用方与跨 Client） |
| 正文笔误：PR 描述写 `46 files`，实际 54 | — | 正文按实际读数更新 |

**评审同时确认了的判断**（保留）：`Autocomplete` 的 `dispose()` **是**官方声明里的成员（`service/Autocomplete.d.ts`），
因此它的释放路径不变；只有 `LocalSearch` 没有。

### 第三轮（复审）

| 发现 | 复现结果（红） | 处置 |
| --- | --- | --- |
| **P1** `supersede` 漏掉「已开始但还没拿到 `ServiceCall`」的窗口：`busy` 只看 `activeCall`，在 `await whenReady()` 期间为 `false` | 原始级：`第一条不得被这条调用作废: expected 'canceled' to be 'success'`；行为级（`<BMapProvider>` 延迟加载）：`expected 5 to be 'BMAP_SERVICE_FAILED'` | `busy` 改判 `activeController !== null \|\| instanceStale`；取代时**无条件**收掉上一条 execution（含还没拿到 call 的那条）。两层各留一条回归用例 |
| **P1** timeout 不触发 `onCancel` ⇒ 迟到回包到达后实例「又变回可用」，同一 handle 的行为取决于回包早晚 | `超时之后的同实例重查不得落到 SDK: expected [ 'search:餐厅:', 'search:餐厅:' ] to deeply equal [ 'search:餐厅:' ]` | `ServiceCallOptions` 新增 `onTimeout`（与 `onCancel` 对称），Driver 在超时时同样 `supersedeLocalSearch()` |
| **P1（文档）** ADR 仍残留上一版被推翻的结论（决策 5 的 SDK `dispose()`、`localSearches`、决策 6 的 FIFO 归属、已知限制的 keyword 退化、回滚说明），源码注释仍写「归属可以建立在请求顺序 + 回包 keyword 上」 | `grep` 逐处核对 | 全文按当前实现清理（single-flight + 实例身份 + `clearResults()` + `localSearchResults`）；历史说明保留在「外部评审记录」里，不再出现在决策/限制正文 |
| **P2** Fake 的 `gotoPage()` 在「还没有结果」时不回调 ⇒ 被建模成 timeout，而官方语义是回调 + `INVALID_REQUEST(5)` | `Fake 也必须回调，不能建模成 timeout: expected +0 to be 1` | Fake 改为置 `status = 5` 并回调；补一条 Driver 级用例（首次 `gotoPage` ⇒ `failed(5)`） |

**刻意不采纳的建议**：评审提到「除非能找到百度对跨请求 FIFO 的明确官方保证」——查过 4.0.4 的
`LocalSearch.d.ts` 与 `LocalResult.d.ts`，**没有**任何关于多次请求之间回调顺序的承诺（只承诺单次多关键
字内部顺序），因此没有理由保留 FIFO。另外「让旧实例自己吸收迟到回包」被采纳为「旧实例在取消/处置后
忽略一切回包」（比保留槽位更简单，且同样不会错配）。
