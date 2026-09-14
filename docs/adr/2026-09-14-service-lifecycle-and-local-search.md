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
（`keyword` 只是**可选**），因此只能靠「通道独占 + 同关键词互斥」；而 `LocalSearch`
**官方把 `LocalResult.keyword` 声明为必填**、也**不绑定输入框**，是真正能落地逐请求归属的地方。

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

### 4. LocalSearch 的请求归属：FIFO + 关键字校验 + 墓碑 + 同关键词互斥

`LocalSearch` 的四个操作**共用实例上的一条 `onSearchComplete`**（构造期权一次），而 SDK 没有取消
入口。归属模型因此是：

1. **FIFO**：官方口径是每个操作恰好触发一次 `onSearchComplete`、按发出顺序到达；未结算的请求排队，
   回包结算队首；
2. **关键字校验**：回包带回的 `keyword`（官方**必填**字段）与队首期望值不一致时**不消费任何槽位**
   （它不属于在册请求）；
3. **墓碑**：`cancel()` / 超时不从队列里删掉槽位，而是把它**降级为墓碑**（`settle = null`），
   由它自己的迟到回包消费掉——删掉槽位就会让迟到回包去结算**下一个**操作；
4. **同关键词互斥**：两个**未结算**且关键字相同的操作无法区分（多关键字用
   `a:<k1>\u0000<k2>` 的规范键），命中时以 `failed(BMAP_SERVICE_FAILED)` 显式拒绝，而不是猜；
5. **队列上界** `MAX_PENDING_SEARCHES = 16`：达到上限时**拒绝新调用**而不是淘汰旧记录
   （淘汰不会取消 SDK 请求，被淘汰那条的回包迟早会把队列错位）。

**与 `Autocomplete` 的关键差异**：LocalSearch 不绑输入框，回调通道不会被用户输入污染，因此不需要
「通道独占」那套前置校验；`keyword` 是必填而不是可选，因此关键字校验是**契约级**而不是**假设级**。

**墓碑为什么要参与「解除互斥」**：`Autocomplete` 的契约是「取消同关键词后立刻重查 ⇒ 显式失败」，
代价是「最新者胜」这个最常见的用法（用户重新点了同一个词的搜索）被挡住。LocalSearch 用
`onCancel: () => retireSearch(...)` 把已结束的槽位降级为墓碑，于是**同一关键词可以重查**——FIFO 保证
墓碑先被消费。这与参考实现的「最新者胜」在可观察行为上一致。**代价（显式接受）**：如果某次请求的
回包**永远不到**（网络断开这类），它的墓碑会吃掉随后那次**同关键词**请求的回包，后者于是走到
`timeout`。放弃这个 trade-off 的唯一办法是退回「一律拒绝」，而那会挡住正当用法。

### 5. 释放路径：`clearLocalSearch` + `disposeLocalSearch`，仍然不引入通用 `dispose`

- `clearLocalSearch(handle)`：清 SDK 侧已产生的可见结果（标注 / 面板）与内部结果状态。**没有回包**，
  因此不是 `ServiceCall`——它清的是「已经画出来的结果」，与 `ServiceCall.cancel()` 的「放弃在飞请求」
  是两件事，两者互不代替。
- `disposeLocalSearch(handle)`：幂等；Driver 侧清理（解绑 EventDriver 订阅 + 把在飞调用显式失败）+
  SDK 自身 `dispose()`；**只有成功才记账**，抛错时句柄保持不可用、再次调用会重试。
- **为什么还是没有通用 `dispose(ServiceHandle<string>)`**：其余服务（Geocoder / Convertor /
  Boundary / Geolocation / LocalCity）在 Driver 侧不持有任何资源，通用入口会承诺「在飞调用会失败、
  释放后拒绝新调用」而实现做不到。契约必须与实现一致。
- Fake v4 的泄漏门禁因此新增 `localSearches` 这一类（生命周期类，按实例销账）：**没有释放入口的
  资源不进泄漏门禁**这条口径不变。

### 6. 不建立在 `setSearchCompleteCallback` 上

`LocalSearch` 的官方声明里**有** `setSearchCompleteCallback`，参考实现也用它（每次 `search()` 前换一个
闭包 + `requestId` 守卫）。本库不用它，理由是 `#72` 的真实 AK 探测**没有得出可发布结论**
（那批检索全部无回包，对照组同样无回包，最可能是同页配额/QPS），因此「换回调能否按请求归属」
（回调是请求时捕获还是响应时读取）在真实运行时上仍未被证实。内部分发器只在构造期挂一次，
归属靠 FIFO + `keyword`——这两个判据都能在官方声明里核对到。

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
  与 Fake 的 `FakeV4LocalSearch` / `localSearches` 诊断项即可；`dist` 不含 `driver/jsapi-v4/**`，
  回滚不影响已发布的其它消费者。

## 非目标

- 不做路线服务（Driving / Walking / Riding / Transit，属 `#39`），不实现任何标准 UI
  （建议列表 / 搜索面板 / 详情，属 `#73` / `#75` 的官方 UI Kit），不读取 SDK 私有面。
- 不改 `Autocomplete` 的归属契约（通道独占 + 同关键词互斥）。它的依据（`keyword` 可选）与本票不同，
  一起改会把两套判据混起来；「Autocomplete 也能用墓碑解除互斥」属于后续可评估项。
- 不给其余服务补释放入口（官方没有 `destroy` / `dispose`）。
- 不做 `LocalSearch` 的 `enableAutoViewport` / `enableFirstResultSelection` /
  `setPageCapacity` / `setPageNum` 的运行时开关（它们**只影响绘制与分页**，而首页容量已在构造选项里；
  需要时走 `./advanced`）。这一条是显式欠账。

## 已知限制

1. **墓碑吃回包的窗口**（决策 4）：某次请求的回包永不到达时，其墓碑会吃掉随后同关键词请求的回包，
   后者以 `timeout` 结算。判定与规避写在 `search()` 的契约注释里。
2. **墓碑占用队列槽位**：`MAX_PENDING_SEARCHES = 16` 统计的是**全部**槽位（含墓碑）。一个长期
   不回包的 SDK 上反复取消 + 重查，最终会让新调用以 `failed(BMAP_SERVICE_FAILED)` 被拒
   ——这是刻意的 fail-explicit（淘汰墓碑会导致回包错位），而不是可以靠调大常量解决的问题。
3. **`sdkStatus` 只在公开带状态码的服务上恒有值**：`Geolocation` / `LocalSearch`
   （`BMAP_STATUS_*`）与 `Convertor`（回包 `status`）；其余服务没有公开错误码入口，`sdkStatus`
   恒为 `null`——不伪装成 0。
4. **`renderOptions.map` 的绘制效果未在真实 AK 上验证**：Fake 不实现标注绘制，真实 smoke 只验证
   「构造成功 + `search` 结算」。绘制（标注 / 面板 / 自动视野）的视觉正确性属 `#74` 的真实环境验收。
5. **`LocalSearch` 的 `keyword` 回填仍未被真实 AK 证实**（同 `#72` 对 `Autocomplete` 的标注）：
   官方声明是必填，但「运行时是否一定回填」未在真实环境验证过。回填缺失时退化为纯 FIFO
   （顺序到达仍然正确），不会错归。
6. `useBMapServiceTask` 的实例缓存绑定在 **Client 身份**上：`<BMapProvider>` 的 definition 变化
   （换 AK / 换 Provider）会产生新 Client，实例随之重建——这是正确行为，但会多一次构造。
7. **`supported` 在 Client 就绪前是乐观初值 `true`**（= 尚未判定）：`capabilities` 来自 Driver，
   没有 Client 就无从探测。判定在 Client 落地的那一刻完成（`watch(..., { immediate: true })`），
   因此「读到 `false`」一定来自真实探测；但「Client 还没就绪时读到 `true`」不代表能力可用。

## 参考

- 官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`：`LocalSearch` / `LocalResult` /
  `LocalResultPoi` / `LocalSearchOptions` / `GeocoderResult` / `AddressComponent` /
  `LocalCityResult` / `StatusCodes`（`BMAP_STATUS_*`）。
- 参考实现 `huiyan-fe/react-bmap`（`src/hooks/services/*`、`src/types/results.ts`）：状态面与动作集
  对齐；归属模型**不采纳**它的 `requestId` 守卫（那是「最新者胜」，对下拉列表够用，对数据契约不够），
  改用 FIFO + `keyword` 校验 + 墓碑。
- 本仓库：`2026-09-12-jsapi-v4-service-panorama-native-layers.md`（两层结构）、
  `2026-09-13-private-sdk-surface-removal.md`（`empty` 是合并结论、不嗅探私有面）、
  ADR `2026-09-14-remove-legacy-engine.md`（删除旧引擎后统一服务生命周期的前提已成立）。
