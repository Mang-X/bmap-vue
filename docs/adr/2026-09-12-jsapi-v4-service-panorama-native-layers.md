# ADR 2026-09-12：v4 Service / Panorama / Native Layer Facet（归一化服务调用 / 运行时注入探测 / 装配收口）

- 状态：已接受（Accepted）
- 日期：2026-09-12
- 计划键：`M3A2-SERVICES-NATIVE`（issue #23，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-11-jsapi-v4-map-facet`](./2026-09-11-jsapi-v4-map-facet.md)、[`2026-09-11-jsapi-v4-overlay-facet`](./2026-09-11-jsapi-v4-overlay-facet.md)、[`2026-09-11-jsapi-v4-control-layer-facets`](./2026-09-11-jsapi-v4-control-layer-facets.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

`#19`~`#22` 交付了 v4 Driver 底座与 Map / Overlay / Control / Layer 四个 Facet，
`createJsapiV4Driver` 仍是「明确失败」的空壳（装配需要 Service / Panorama）。
最后一批缺口是**服务、全景与原生批量数据图层**，以及「Contract Harness 覆盖所有 Facet 与
unsupported policy」这件事。

动手前必须冻结八件容易写歪的事：

1. **服务是 callback 风格，且失败与「查无结果」不可区分**：`Geocoder#getPoint` /
   `Boundary#get` / `LocalCity#get` 失败时**只回 `null`**，服务端错误码（配额 302、
   Referer 限制）只出现在 JSONP 回调注册表 `_rd` 里；`Geolocation` 又是唯一自带
   `getStatus()`（`BMAP_STATUS_*`）的服务。业务不想要「每个调用各自写一遍超时 + 空判断」。
2. **`Autocomplete` 是事件式服务**：`search()` 只发起请求，结果经**构造选项**
   `onSearchComplete` 回来——没有「一次调用一次回调」的配对关系（用户在输入框里打字也会触发）。
3. **原生数据图层有八个 kind，但方法面并不一致**：官方专页的四类
   （`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）共享
   `setData` / `clearData` / 要素状态 / `setVisible` / `setOpacity` / `setZIndex` /
   `setStyleOptions` / `doOnceDraw`；而扩展 API 的四个
   （`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`）只公开各自那几个方法。
   把它们硬套成一套接口，必然产生「调了但没反应」。
4. **扩展 API 的实现是异步注入的**（官方明确），且 `@baidumap/jsapi-v4-types@4.0.4`
   **没有这四个类的类声明**：能力探测不能在 Driver 构造期冻结结论。
5. **样式不会自动重绘**：官方专页图层 `setStyleOptions()` 后需要显式 `doOnceDraw()`；
   层级方法还会访问「已关联的 Map」，因此顺序是 `create → add → setZIndex`。
6. **共享 `BMapDriver` 不能塞 v4 独有的面**：它要同时被 webgl-v1 满足，而 v1 既没有原生
   数据图层，也没有归一化服务调用面；但 `#22` 的结论又要求「组件不必访问 raw 服务/图层」。
7. **契约要在两个环境跑**：`driver-contract.ts` 顶部 import 了 vitest，浏览器里加载不了，
   而 issue 明确要求「同一 Contract Harness 可运行 Fake v4 和真实 smoke 子集」。
8. **迁移期行为要收口**：四个既有测试断言「v4 默认路径明确失败」（消息含 `M3A.2`），
   装配完成后它们必须转成正向断言，而不是被删掉。

## 决策

### 1. Service Facet 分两层，v4 独有面挂在 `JsapiV4Driver` 上

- **创建面** `ServiceDriver`（共享，两引擎都实现）：6 项基础服务 + `ViewAnimation` 的创建。
- **归一化调用面** `ServiceInvocationDriver`：`geocode` / `reverseGeocode` / `convert` /
  `queryBoundary` / `locate` / `locateCity` / `suggest`，每个返回 `ServiceCall<T>`。
- `JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver`。
- 新增 `JsapiV4Driver extends BMapDriver`，把 v4 独有的三个面收进去：
  `services`（收窄为 `JsapiV4ServiceDriver`）、`panorama`（收窄为 `PanoramaViewerDriver`）、
  `nativeLayers`（新 facet）。

理由：共享契约保持「webgl-v1 也能满足」的形状（v1 随 `#26` 删除，不为此写第二套实现），
同时 `#25` 完成默认 cutover 后，组件拿到 v4 Client 的类型就能用到全部能力。三个收窄成员都是
`BMapDriver` 对应成员的**子类型**，因此 `JsapiV4Driver` 可以原样传给任何期望 `BMapDriver` 的位置
（`createBMapClient` 的注入点、`createDriver` 的分派）。

### 2. 服务调用适配器：恒 resolve、先到者胜、空/失败分离、超时、取消

`src/driver/normalize/serviceCall.ts` 的 `createServiceCall`（engine 无关）：

| 语义 | 做法 | 为什么 |
| --- | --- | --- |
| 不 reject | 失败/超时/取消都表达成 `ServiceResult.status` | 业务不必为「服务失败」再写一层 try/catch；`start` 同步抛错也走结果通道 |
| 空结果 ≠ 失败 | `settle.empty()` / `settle.failed({code,message})` 两个入口 | 真实失败只回 `null`，混为一谈会让业务分不清「没有」与「出错」 |
| 先到者胜 | 首次结算后 `pending = false`，后续结算一律忽略 | 真实服务**在超时之后仍会回包**；不设这道门就会把过期结果写回去（迟到回调） |
| 超时 | 默认 `SERVICE_CALL_TIMEOUT_MS = 15000`（与 composable 层同值），`status: "timeout"` | SDK 失败时可能永不回调，否则 Promise 永久挂起 |
| 取消 | `cancel()` 立刻以 `canceled` 结算并执行 `onCancel` | JSONP 发出去收不回，只承诺「放弃结果 + 解绑」，不假装能中止请求 |

`ServiceResult` 的形状不变式（`status` 与 `data` / `error` 的对应关系）由共享契约的
`assertServiceResultShape` 固定，Fake 与真实环境都跑。

**适配器之外的每一步也必须在受保护范围内**：`convert` 的坐标校验是这条的实例——几何边界会以
`BMAP_INVALID_POINT` 拒绝非有限数 / 缺分量，若在校验之前就调用 `geometry.toRawPoints(points)`，
异常会从 `createServiceCall` **之外**逃逸，连 `ServiceCall` 都返回不了（PR #63 复审 P2-4）。
现行做法：进调用之前先逐项校验（容器 → 成员，缺分量 / 非有限数一律
`failed + BMAP_INVALID_ARGUMENT`），并把几何转换放进受保护的调用流程作为兜底。

### 3. 「空结果 vs 失败」靠 JSONP 嗅探，抽到 `normalize/jsonpProbe.ts` 两引擎共用

`webgl-v1/services.ts` 里原有的 `captureJsonpServiceError` 直接**上移到**
`normalize/jsonpProbe.ts`，v1 保留同名再导出（import 路径与测试不变）。嗅探逻辑只依赖
`rawSdk._rd` 的形状、与 engine 无关，v4 Service Facet 因此不需要第二份实现。

调用顺序是硬约束（v1 composable 的注释已经写过，这次落进 Facet）：**先调 SDK（它同步注册
`_rd` 回调）→ 再 `probe.rescan()` 包装**。JSONP 回包恒为异步，所以 rescan 必定先于回包执行。
Fake 也把这条时序建模出来（回包走微任务），否则「嗅探没用」会成为一个假的测试结论。

**凡是「失败只回 `null`」的服务都必须接探针**：`geocode` / `reverseGeocode` / `queryBoundary`
之外，**`locateCity` 也接了**（PR #63 复审 P2-3 指出它漏了——不接就会把「服务失败」归类成
「查不到城市」，业务既拿不到错误原因也没法判断要不要重试）。`convert` 与 `locate` 自带状态码，
不走探针。

### 4. `Geolocation` 的状态码表：数值字面量 + 类型层钉在官方声明上

`Geolocation#getStatus()` 是唯一自带状态的服务。失败状态码 → 可读原因的映射写在 Driver 内部
（**不读全局 `BMAP_STATUS_*`**：Driver 只认 `rawSdk` 传入的命名空间），与官方
`const/StatusCodes.d.ts` 的一致性由文件末尾的类型断言钉死（同 `#22` 的锚点常量表口径）。
`getStatus` 成员缺失或调用失败时返回 `null`，**不把缺成员伪装成状态 0**。

### 5. `Autocomplete`：**「同关键词最多一个槽位」不变式 + FIFO 归属**（不靠到达时间猜）

`Autocomplete#search()` **不带请求身份**：回包除了可选的 `keyword` 之外没有任何可归因的信息。
三轮复审各给出了一组反例，结论是**任何「按到达时间猜」的规则都会错**：

| 规则 | 反例 |
| --- | --- |
| 取**最早**同名项（`findIndex`） | 旧请求的回包**始终不到达**（请求被中断）时，新请求的回包被旧墓碑吸收 → 新请求饿死 |
| 取**最新**同名项 | 旧回包**先到**（这是按请求顺序返回的正常情形）→ 新请求收到旧结果 |
| 无匹配就落回 FIFO | 用户输入触发的回包、被上界丢掉的旧请求的迟到回包都会结算给下一个调用 |

前两条互为反例、且区别只在「旧回包到底来不来」——**这一点在回包里观察不到**。因此本轮不再调整
匹配顺序，而是消除歧义本身：

```ts
// suggest() 的前置拒绝：同关键词已有未完成槽位（含等自己回包的墓碑）⇒ 直接 failed
if (hasPendingKeyword(raw, keyword)) return serviceFailedCall("Autocomplete.search", "…回包不带请求标识…");

// onSearchComplete 的归属（不变式成立时，取最早同名项 == 就是它自己）
const settle = resolvePending(raw, results.keyword);
if (settle) settle.success(readSuggestions(results)) / settle.empty();
options.onSearchComplete?.(results);            // 原样转发业务自己的监听
```

**不改动匹配顺序，改的是允许出现哪些请求**：拒绝同关键词的重叠之后，同一关键词在任意时刻最多
只有一个槽位 ⇒ 回包归属**与到达顺序无关**（「两种顺序都正确」由构造保证），且永远不会把旧结果
当成新结果。代价是「取消 / 超时后立刻用同一关键词重查」会被**显式拒绝**（`failed` +
`BMAP_SERVICE_FAILED`，消息说明原因），而不是静默给出可能属于旧请求的数据——这正是三轮复审
「无法确定归属时应明确失败，不能猜测后返回 `success`」的主张。等前一次结算（或它的回包到达、
墓碑移除）之后，同关键词重查即可正常进行；**不同关键词的「取消 + 重查」不受任何限制**。

其余要点：

- **不吞掉业务监听**（`BAutoComplete.vue` 一直在用 `onSearchComplete`）；
- **`cancel()` 不动队列**：被取消的 `search()` 的回包仍会到达（SDK 没有取消入口），它的槽位必须
  留在原处吸收那个回包，否则迟到回包会结算**下一个**调用；
- **「带 keyword 但不匹配」不落回 FIFO**：用户输入触发的回包（同一条 `onSearchComplete`）、以及
  被上界丢掉的旧请求的迟到回包都属于这一类，落回 FIFO 会结算给下一个调用；
- **`search()` 同步抛错时回滚槽位**：请求没发出去就不会有回包，留着会永久错位一格。
- **队列到上限时拒绝新调用，而不是淘汰旧记录**（四轮复审 P2-1）：淘汰并不会取消 SDK 请求，
  被淘汰请求的回包仍会到达；一旦它的关键词又出现在队列里（取消旧 K 之后再查 K），那个回包就会
  被错误地结算给新调用。上限（`MAX_PENDING_SUGGESTS = 16`）因此只是「SDK 长期不回包」时的资源
  护栏，触发时**显式失败**，且旧记录保留到自己的回包到达为止。
- **回调通道必须独占**（四轮复审 P2-2，五轮复审 P2 补强）：`Autocomplete` 只有一条
  `onSearchComplete`，用户输入触发的检索与程序化 `search()` 共用它，回包里没有「谁触发的」
  信息——所以**可输入的输入框上，同关键词的原生回包与程序化回包无法区分**。`suggest()` 因此
  要求实例的输入框不可输入（`readOnly` / `disabled` / `type="hidden"`），否则**前置拒绝**
  （`failed` + `BMAP_SERVICE_FAILED`，消息给出替代方案）。
  **判定看的是输入框的当前状态，而不是创建实例时的状态**：HTML 控件的可编辑性取决于当前的
  `disabled` / `readonly` / `type`，构造之后随时可以变回可输入，所以校验发生在**每次
  `suggest()` 与每次回包**（`exclusivityFailure`）；一旦观察到可输入，该实例被**永久**标记为
  失去独占（`lostExclusivity`），不因为随后又变回只读而恢复资格（可编辑期间触发的原生请求可能
  仍在等回包），在飞的程序化请求同时被**显式失败**。调用方需重建实例。
  **只看当前状态还不够**（六轮复审 P2）：`解除只读 → 用户输入发出原生检索 → 恢复只读` 之后两道
  检查看到的都是只读，那段窗口完全没有记录。六轮先用 `MutationObserver` 观察属性变化，**七轮复审
  P2-2 证明这个口径过宽**：真实 Chromium 里 `input.readOnly = true` 重复赋同值也会产生属性记录，
  于是「始终只读、只随 loading 切 `disabled`」这类完全安全的用法会被永久禁用。现行做法是监听
  **输入活动**（`input` 事件）——它才是官方文档里原生检索的触发源（「输入框中的字符输入会触发
  检索」），既不误伤属性写入，又覆盖那个没有检查点的窗口。
  **监听器必须有释放路径**（七轮复审 P2-1）：输入框通常比实例活得久，SDK 的 `dispose()` 也不知道
  Driver 挂过监听器，所以 `JsapiV4ServiceDriver.dispose(handle)` 提供显式释放入口（解绑监听器 +
  把在飞调用显式失败 + 调用 SDK 自身的 `dispose()`，幂等），`loseExclusivity` 复用同一个解绑函数。
  只用联想 UI（不调用 `suggest()`）的实例也**应该**在结束使用时调用它。
  这把「通道是否独占」变成调用方**可判定、可复核**的前置条件，而不是 Driver 事后猜；
  `AutocompleteOptions.input` 的 JSDoc 与 `suggest()` 的类型文档都写明了这条。

**「每次请求一个独立实例 + 回调闭包」为什么不在本 issue 做**（唯一能彻底去掉顺序假设与前置拒绝
的做法，也是三轮复审的首选建议）：真实 AK 实测给了三条结论——**脱离文档**的输入框构造即抛
`TypeError … reading 'top'`；**挂到文档且不可输入**（`readOnly`）时 `suggest = success`；
**挂到文档但可输入**时被新规则拒绝（`failed: BMAP_SERVICE_FAILED`）；而**不带 `input`** 的实例
能构造却 **3s 内 0 回包**（不能当作程序化专用通道）。也就是说独占通道**只能由调用方用不可输入的
输入框表达**；若由 Driver 自己造一个挂到文档的隐藏输入框，就要引入 DOM 所有权（SSR / 无 DOM 环境
不成立）与**释放路径**（当前 `ServiceDriver` 没有 per-service dispose，隐藏输入框会随页面常驻，
违反仓库「所有资源都要有释放路径」的原则）。因此登记为 M7（#38 ServiceSpec / AsyncTaskController）的接口设计项——那里会同时
定义「输入提示」的 UX 语义与实例/输入框的所有权。本 issue 的过渡契约保证**任何允许执行的调用都
不会拿到错误归属的数据**。

**残留限制（显式接受）**：`keyword` 由运行时可选填充，是否填充、是否与请求参数同形都未在文档中
承诺——不填充时归属退化为顺序 FIFO，不同形时该次 `suggest()` 会走到 `timeout`（而不是猜）。二者
连同上面的独立实例设计一起，属 M3A.3（#25）的真机核对项。

**参考实现的评估（`huiyan-fe/react-bmap` 的 `src/hooks/services/useAutocomplete.ts`）**：它的做法是
`raw.setSearchCompleteCallback(cb)`，每次 `search()` 前换一个闭包，闭包里用 `requestIdRef` 守卫
（`if (requestId !== requestIdRef.current) return`）。逐条核对：

- **那个守卫就是「最新者胜」**（旧响应一律丢弃）——与本 issue 二轮试过的「取最新同名项」同源。
  对**下拉列表**够用（用户又打字了，旧结果本就该丢），对**数据契约**不够（`suggest()` 的结果要么
  属于本次、要么明确失败，不能把另一次的结果给它）。因此不采纳，维持「通道独占 + 同关键词互斥」
  的显式契约。
- 它调用的 `setSearchCompleteCallback` **不在官方 `Autocomplete` 的声明与文档里**（官方只对
  `LocalSearch` / `DrivingRouteLine` / `TransitRoute` 声明它）。真实 4.0 的 `Autocomplete` 实例上
  实测**确实有**这个方法（`typeof === "function"`），但按本仓库的 SDK 边界规则（成员必须能在官方
  API 参考的方法表或上游 `.d.ts` 里核对到）**不建立在它上面**——方向与 `#22` 对
  `PanoramaCoverageLayer` 的判断相反（那边是官方文档有、类型包没有，才可以用结构探测）。
- 「换回调能否按请求归属」（回调是**请求时捕获**还是**响应时读取**）本次**未得出可发布结论**：
  该探测跑在 smoke 页面**末尾**，所有 Autocomplete 检索（**含只装构造回调的对照组**）都拿不到
  回包，最可能是同页大量服务检索触发服务端配额 / QPS；对照组同样无回包，因此**不能**据此断言
  方法无效。留给 `#38` 用**独立页面**验证。
- **真正有用的指向**：`LocalSearch`（真实 4.0 上存在，且**官方文档明确**支持
  `setSearchCompleteCallback`）是面向程序化检索的 SDK 类——不绑输入框（没有 UI 共享通道问题）、
  有 `getStatus()`。「精确的逐请求归属」因此应当在 LocalSearch / ServiceSpec 那一层实现，正是 M7
  `#38` 的范围；参考实现也是这个分层（driver 只创建实例，逐请求 API 在 hook 层）。

### 6. `TrackAnimation` 显式失败，指向 `TrackLine`

Catalog 的 `service.track-animation` 是 `unsupported`（该插件属 `BMapGLLib`，迁移结论属 M8 #43）。
v4 的 `createTrackAnimation` 抛出带 `capability: "service.track-animation"` 的
`BMAP_CAPABILITY_UNSUPPORTED`，消息里直接给出 4.0 的替代入口
（`driver.nativeLayers.create("track-line")`）——**不静默给一个不能用的实例**。

### 7. 原生图层：八个 kind，操作面按 kind 声明，不支持的操作显式失败

`NATIVE_LAYER_DESCRIPTORS`（`Record<NativeLayerKind, …>`，漏一个 kind 直接编译失败）里每个 kind
一条记录：`ctor` / `declared` / `operations`。`declared` 同时决定三件事（写在一起才不会漂移）：
能否用 `namespaceCtor`、能否用字段级 setter 族、缺成员时报哪个错误码。

| kind | ctor | declared | operations |
| --- | --- | --- | --- |
| `point-icon` / `point-shape` / `line` / `fill` | 同名类 | ✅ | setData, clearData, setStyle, setVisible, setOpacity, setZIndex, setZoomRange, updateState, removeState, clearState, setEnablePicked |
| `point` | `PointLayer` | ❌ | setData, clearData, setStyle, setEnablePicked, hitTest |
| `cluster` | `ClusterLayer` | ❌ | setData, clearData, setStyle |
| `heatmap` | `Heatmap` | ❌ | setData, clearData, setStyle |
| `track-line` | `TrackLine` | ❌ | setData |

- **不支持的操作抛 `BMAP_CAPABILITY_UNSUPPORTED`**（先 `warnOnce` 一条），不静默 no-op。
  「调了但什么都没发生」是数据图层最难排查的一类问题。
- `supports(kind, operation)` 是**调用前查一次**的唯一入口；它的答案与真实调用的一致性由共享
  契约（`runNativeLayerFacetContract`）与单测（8 kind × 12 操作）双向断言。
- `setStyle`：`declared` 的走 `setStyleOptions` **并显式 `doOnceDraw()`**（官方不自动重绘）；
  扩展 API 走整袋 `setOptions`（官方只给这一个入口）。
- `setZoomRange` 只改**给到的那一端**：补默认值会把调用方先前的设置悄悄改掉。
- `updateState(keys, state, append)` 的第三参数是官方的 `ifAppend`，落在领域签名上叫 `append`
  并默认 `false`（替换语义）。

### 8. runtime-only 图层按「加载后就绪」探测，能力守卫也在调用时刻求值

- 四个扩展 API 的构造器用 `requireRuntimeCtor` 结构探测，**在 `create()` 调用时刻判断**：
  注入前 `create` 失败（`BMAP_CAPABILITY_UNSUPPORTED`），注入后**同一个 Driver** 再 `create`
  就能成功。Driver 不在构造期冻结这个结论。
- 能力守卫 `capabilities.require(...)` 也放在 `create()` 里（`supports()` 每次重算
  `rawMembers`），因此「先建 Driver、后注入实现」这条正常顺序成立；`throw` 策略下失败发生在
  构造之前，不会留下孤儿实例。

### 9. `Panorama`：`supported` 是重新探测的 getter，`destroy` 幂等且**成功后记账**

- `supported` 实现成每次读取都重新探测 `namespace.Panorama` 的 getter（同 §8 的理由）。
- `create` / `createService` 走能力守卫 + `namespaceCtor`，实例经 `registry.adopt` 成句柄。
- `destroy()` 拆成**两个状态**：`disposing`（清理在飞，重入短路）/ `destroyed`（SDK 对象已销毁，
  重试时跳过这一步）。用一个布尔同时表达「不要再做任何事」和「已经清干净了」会同时踩两个坑：
  当重入保护用就得在调 SDK **之前**写，于是失败也被记成「已销毁」、重试入口消失；当完成标记用
  就得在调 SDK **之后**写，于是清理期间的重入会真的销毁两次。
- **销毁时先释放 Driver 侧的订阅，且不记账「曾经释放过」**：`events.release(viewer)`（EventDriver
  的 `groups` 是强引用 `Map<rawTarget, …>`，不主动释放就会长期持有已销毁的 raw 对象与业务回调）。
  顺序与 Map Facet 一致（业务事件先下线、再销毁 SDK 对象）；解绑失败**不阻断** SDK 销毁
  （`release` 的契约是「其余项已尽力释放」），但两者都汇总抛出，由调用方决定是否重试。
  **每次销毁尝试都重新释放**：`release()` 无分组时是 no-op，而「曾经释放过」这个记忆是错的——
  SDK 销毁失败后查看器并没有销毁，业务可以重新订阅（等待就绪 / 恢复），此时跳过释放会让新订阅
  随查看器一起泄漏（PR #63 二轮复审 P2-3）。
- 真实 4.0 在**未加载场景**的实例上 `destroy()` 会抛 `TypeError`（见 smoke 记录）——归一后是
  `BMAP_SDK_CALL_FAILED`，消息里保留原始错误文本，并说明「再次 destroy 只会补做未完成的那一步」。
- 检索归一化用 `retrieve()`：`getPanoramaById` / `getPanoramaByLocation` 都是
  「id/point + callback(`PanoramaData | null`)」，查不到是 `empty`（官方口径），不是 `failed`。
  按坐标检索**不给半径时省略该实参**（官方的两个重载不是「可选参数占位」）。

### 10. 装配：`createJsapiV4Driver` 真正装配，返回 `JsapiV4Driver`

- 装配点**只从 `driver/jsapi-v4/**` 取运行时实现**、返回类型全部来自 `driver/types/**`：
  前者是声明边界目录（`check:public-dts` 断言它不得进入发布产物），从它 import **类型**会让
  公共 `.d.ts` 指向未发布的文件。
- 命名空间形状在装配点先断言一次（`assertJsapiV4Namespace`），让「命名空间不可用」有唯一、
  清晰的失败点，而不是由「第一个碰巧需要 Map 的 Facet」决定报错信息。
- 依赖顺序写在一处：`geometry → events → map(需要 events) → overlays → controls → layers →
  services → panorama → nativeLayers`，每个 Client 一份独立 Handle Registry（跨 Client 混用抛
  `BMAP_HANDLE_FOREIGN`）。
- **迁移影响**：四个断言「v4 默认路径明确失败（消息含 `M3A.2`）」的测试改成**正向**断言
  （`createBMapClient` 默认路径装出可用 v4 Client），而不是删除；默认 Provider / Playground /
  Docs 的切换仍属 `#25`。

### 11. 契约拆两半：纯探针 + vitest 断言

- `packages/test-utils/facet-probes.ts`：`probeServiceFacet` / `probeNativeLayerFacet` /
  `probePanoramaFacet` / `callNativeLayerOperation`，**不 import vitest**，只做调用与结构化记录。
- `packages/test-utils/driver-contract.ts`：新增 `runServiceFacetContract` /
  `runNativeLayerFacetContract` / `runPanoramaFacetContract`，用 vitest 断言探针结果，并把探针
  再导出（调用方不必知道文件怎么切）。
- 契约带 `expectation: "fixture" | "live"` 两档：Fake 环境要求「命中 fixture」；真实环境只要求
  「结算且形状自洽」——配额、网络与 Referer 都不受本库控制，把「真实环境必须成功」写进契约
  只会得到一个不稳定的门禁。
- `callNativeLayerOperation` 是「怎么调」的单一实现，Fake 侧单测与真实 smoke 共用，避免
  「契约里测的那套调用」与「浏览器里跑的那套调用」各自漂移。

### 12. Capability Catalog 与运行时一致

- 新增三个 runtime-only 能力：`layer.point` / `layer.heatmap` / `layer.track-line`
  （`V4_ONLY`、`experimental`、`runtimeOnly: true`）。前两个是原生数据图层的缺口，
  `layer.track-line` 同时登记「播放控制与迁移结论属 M8 #43」。
- 已有的 `layer.cluster`（extended）/ `layer.point-icon` / `layer.point-shape` / `layer.line` /
  `layer.fill` 维持原状；能力矩阵由脚本重生成（64 条）。
- **控件不进 Catalog** 是 `#22` 冻结的 family 划分结果，本 issue 不改。

## 后果

- 正面：v4 有了完整可用的 Service / Panorama / Native Layer 三个面，且**装配完成**——
  用 v4 Provider 的组件路径从「明确失败」变成「可用」；服务调用不再需要业务自己写
  「超时 / 空结果 / 迟到回调」三件套；原生数据图层的「调了没反应」被显式失败取代；
  契约在两个环境（Fake 与真实 AK）跑同一份探针代码。
- 负面 / 成本：新增三个 v4 独有类型面（`JsapiV4Driver` / `NativeLayerDriver` /
  `ServiceInvocationDriver`）；`createJsapiV4Driver` 的返回类型从 `BMapDriver` 收窄为
  `JsapiV4Driver`（子类型，不破坏既有调用方）；`facet-probes.ts` 与
  `driver-contract.ts` 拆成两个文件；v1 的 `captureJsonpServiceError` 变成再导出；
  Catalog +3 条（能力矩阵与 docs JSON 随之更新）。
- 回滚：删除 `jsapi-v4/{services,panorama,native-layers}.ts`、`normalize/serviceCall.ts`、
  `types/native-layers.ts`、`facet-probes.ts`、Fake 增量与 Catalog 三条，并把
  `createJsapiV4Driver` 恢复为抛 `BMAP_CAPABILITY_UNSUPPORTED` 即可——`dist` 不含
  `driver/jsapi-v4/**`，回滚不影响发布产物；四个「默认路径」测试会立刻变红，提示恢复对应的
  断言。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `createJsapiV4Driver` 从「明确失败」变为「装配完成」 | 用 v4 Provider 的组件路径从失败变为可用；`createBMapClient` 默认路径同样 | 正向变化；默认 Provider / Playground / Docs 切换属 #25 |
| `createJsapiV4Driver` 返回类型 `BMapDriver` → `JsapiV4Driver` | 子类型，赋给 `BMapDriver` 的位置不受影响 | 需要 v4 独有面时按 `JsapiV4Driver` 使用 |
| 新增 `JsapiV4Driver` / `ServiceInvocationDriver` / `ServiceResult` / `ServiceCall` / `NativeLayerDriver` 等公共类型 | `src/index.ts` 与 `src/driver/index.ts` 增加类型导出 | 逐步可用；`BMapClient.driver` 的类型收窄属 #25 |
| `ServiceDriver` 不变（创建面） | 既有 7 个 composable 仍走 `create*` + `handle.raw` | 迁到归一化调用面属 M7 #38（ServiceSpec / AsyncTaskController 与之一并设计） |
| `captureJsonpServiceError` 的实现位置 | 从 `webgl-v1/services.ts` 上移到 `normalize/jsonpProbe.ts`，原路径保留再导出 | 无需改动调用方 |
| 原生图层 `supports()` 回答 `false` 的操作 | 调用抛 `BMAP_CAPABILITY_UNSUPPORTED`（原先不存在这个 Facet） | 用 `supports()` 先问，或按 ADR §7 的表 |
| `Heatmap` / `TrackLine` / `PointLayer` / `ClusterLayer` 的未声明继承成员（`setVisible` / `setOpacity` / `setZIndex`） | 真实 4.0 可调用，但本 Facet 按官方文档回答「不支持」 | 见「已知限制」；放开只需改 `operations` 一处 |
| Catalog 新增 `layer.point` / `layer.heatmap` / `layer.track-line` | `supports()` 在 v4 下由「无此能力」变为 true | 能力矩阵与 docs JSON 已重生成（64 条） |
| `service.track-animation` 在 v4 的失败码 | `BMAP_CAPABILITY_UNSUPPORTED`（消息指向 `TrackLine`） | 迁移到原生图层或等 M8 #43 |
| `Panorama#destroy()` 在未加载场景的实例上抛错 | 归一为 `BMAP_SDK_CALL_FAILED`；重复销毁会**真的重试** | 组件路径（M7 #41）先 `setId` / `setPosition` 再销毁。✅ 已由 [2026-09-17](./2026-09-17-control-spec-and-panorama.md) 落地：`<BPanorama>` 在 `onUnmounted` 里销毁（子组件先摘标注），真没场景时**只告警不抛错** |
| `panorama.supported` | 从常量变为**每次读取重新探测**的 getter | 行为更正确；读取有极小开销 |

## 非目标

- 不提供完整 LocalSearch / Route 的 Vue Composable，也不把 7 个既有 service composable 迁到
  归一化调用面（`#38`）。
- 不实现 Native Layer / Panorama 的 Vue 业务组件（issue 明确列为非目标）。
- 不实现 TrackLine 的播放控制（`start/pause/resume/stop/setSpeed/setProcess`）与迁移结论
  （M8 #43）。
- 不做 `enableTraffic` 接线、不做 WMS / WMTS / MVT（`#22` 的欠账与本 issue 无关）。
- 不为扩展 API 的四个类写 augmentation：官方 4.0.4 没有类声明，本 issue 只按结构探测构造器，
  不臆造声明（同 `#22` 对 `PanoramaCoverageLayer` 的口径）。
- 不改 `BMapClient.driver` 的类型收窄与默认 Client / Provider / Playground / Docs 的切换（#25）。

## 真实 AK smoke 记录（2026-09-12）

用 docs 站点示例里的 AK（`docs/examples/layer/panoramaCoverage.vue`）在真实 JSAPI 4.0 上跑
**装配后的 `createJsapiV4Driver`**：headless Chromium（SwiftShader）+ 临时 Vite 页面直接
`import` Facet 源码与**共享探针** `facet-probes`（harness 未入库，跑完移出；AK 只经 URL
查询参数传入，不落盘）。25 项检查全部通过。

| 检查 | 结果 |
| --- | --- |
| 构造器存在性（原生图层 8 + 服务/全景 9） | **全部存在**（含类型包未声明的 `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`） |
| 装配：九个 facet 就位 | geometry / events / map / overlays / controls / layers / services / panorama / nativeLayers |
| Capability Registry vs 真实命名空间 | 16 个能力为 true；`service.track-animation` 为 **false**（Catalog `unsupported`，与预期一致） |
| `panorama.supported` | true |
| `createTrackAnimation` | 抛 `BMAP_CAPABILITY_UNSUPPORTED`（消息指向 `TrackLine`） |
| Service facet：7 个归一化调用 + 取消 | `geocode` success、`reverseGeocode` success、`convert` success(0)、`boundary` success、`locate` **failed(6)**、`locateCity` success、`suggest` success、`canceled` canceled |
| Autocomplete 的输入框形态（三轮 + 四轮复审引出的 fixture 缺陷与新规则） | **detached（readOnly 或可输入）⇒ `new Autocomplete` 抛 `TypeError: Cannot read properties of null (reading 'top')`**；**attached + readOnly ⇒ `suggest=success`**；**attached + 可输入 ⇒ `suggest=failed:BMAP_SERVICE_FAILED`**（通道非独占的前置拒绝）；**不带 input ⇒ 构造 ok 但 3s 内回包数 0** |
| 原生图层逐 kind：探针（走 `supports()`） | 8 个 kind 全部结算；**不支持的操作 100% 显式失败**（`rejectedWhenUnsupported: true`） |
| 原生图层逐 kind：**直接调用 raw**（绕过 `supports()`） | `point-icon/shape/line/fill` 11 项全 ok、`hitTest` 缺成员；`point` 8 项 ok（`setEnablePicked`/`hitTest` ok，状态与 `setMinZoom` 缺成员）；`cluster`/`heatmap`/`track-line` 6 项 ok |
| `Panorama` viewer 生命周期 | `create` / `setPosition` / `setPov` / `setZoom` / `show` / `hide` 全部 ok；**`destroy` 抛 `TypeError: Cannot read properties of undefined (reading 'START')`**（未加载场景的实例） |
| `PanoramaService` 检索 | `getPanoramaById` / `getPanoramaByLocation` 都结算为 `empty`（不存在的 id / 50m 内无全景） |

smoke 顺带确认（并已回写进决策）的运行时事实：

- **扩展 API 的四个类从共享基类继承了 `setVisible` / `setOpacity` / `setZIndex`**（调用不抛错），
  而官方扩展 API 专页没有把它们列为这些类的方法面 → 本 Facet 按**声明的**面回答 `supports()`
  （保守），差异与实测证据登记在「已知限制」。
- `PointLayer#setMinZoom/setMaxZoom` 与 `Heatmap`/`ClusterLayer`/`TrackLine` 的
  `updateState/removeState/clearState` 在运行时**确实不存在** → `supports()` 的 `false` 与实测一致。
- `locate` 在 headless 下得到 `BMAP_STATUS_PERMISSION_DENIED`(6)，并且**归一化结果里
  `sdkStatus === 6`**（状态码确实来自 `getStatus()`，不是猜的）。
- `Panorama#destroy()` 的失败形态（读 `START` of undefined）只在**未加载场景**时出现；
  Driver 因此把记账放在成功之后，重复销毁会真的重试。

## 已知限制（显式接受）

- **`Autocomplete` 需要一个挂到文档上的输入框**：真实 4.0 里 `new BMap.Autocomplete({ input })`
  对**脱离文档**的 input 直接抛 `TypeError: Cannot read properties of null (reading 'top')`，
  挂到文档之后 `search()` 才能真的回包（smoke 实测）。这条前提原先只写在组件用法里，
  三轮复审的排查顺带把它暴露成**共享契约 fixture 的缺陷**（`probeServiceFacet` 的默认输入框
  当时是脱离文档的，导致 live 档的 `suggest` 一直报 `failed`）——已修 fixture，现在 live 档
  `suggest = success`。SSR / 无 DOM 环境下 `suggest()` 不具备可用前提（构造即失败），
  这条限制登记在 M7（#38）与 #25 的真机核对项里。
- **`suggest()` 的两条前置条件**（四轮复审 P2-1/P2-2）：①实例的输入框必须**不可输入**
  （`readOnly` / `disabled` / `type="hidden"`，否则用户输入的回包与程序化的无法区分）；
  ②该实例上不能已有**同关键词**的未完成请求；③待回包记录达到 16 条时新调用被拒绝（不淘汰记录）。
  三者都是**显式失败**而不是猜测。彻底去掉这些限制需要「每次请求一个独立实例」，
  即由调用方或未来的 ServiceSpec 提供独占通道（M7 #38）——真实 AK 已确认「不带 input 的
  实例能构造但不回包」，所以独占通道**必须**有一个挂到文档且不可输入的输入框，DOM 所有权因此
  留在调用方一侧。
- **`Autocomplete` 的回包归属依赖 SDK 填充 `keyword`**：官方把它声明为可选且不承诺填充。
  不填充时退化为顺序 FIFO；填充但与请求参数不同形（例如被归一化）时，匹配失败会让该次
  `suggest()` 走到 `timeout`——这是**刻意**的取舍（宁可超时也不把结果塞给不匹配的调用）。
- **同一实例上同关键词的重叠 `suggest()` 被显式拒绝**（`failed` + `BMAP_SERVICE_FAILED`）：
  `Autocomplete` 的回包不带请求身份，两次同名请求的回包不可区分。要彻底去掉这条限制（以及
  FIFO 的顺序假设）需要「每次请求一个独立实例 + 回调闭包」，登记为 M7（#38）的接口设计项。
- **`locate` 需要浏览器定位授权**：headless 下必然失败（`BMAP_STATUS_PERMISSION_DENIED`）。
  这里验证的是「状态码 → 归一化 `failed` + 可读原因」，不是「能拿到坐标」。
- **`Panorama` 的真实场景渲染未覆盖**（⚠️ 组件路径已由 [2026-09-17 / #41](./2026-09-17-control-spec-and-panorama.md)
  承接：`<BPanorama>` / `<BPanoramaLabel>` / `usePanoramaService` 已交付，销毁顺序按本文档的建议写成
  「先给 `point` / `id`、再销毁」；真实图块加载仍属 live smoke 的观察项）：smoke 只做构造 / 视角 / 显隐 / 销毁 / 检索；真实全景图块
  加载与交互留给 M7 #41。**未加载场景时 `destroy()` 会抛错**（见上），组件路径必须先 `setId` /
  `setPosition`。
- **扩展 API 的继承成员保守回答**：`setVisible` / `setOpacity` / `setZIndex` 在真实运行时可用，
  但不在官方文档的方法面里，本 Facet 不认它们；放开只需把对应操作加进 `operations`（一处）。
- **TrackLine 只支持 `setData`**：播放控制（运行时确实存在：`start/pause/resume/stop/setSpeed/
  setProcess`）不在本 issue 的接口面内，属 M8 #43。
- **服务归一化面的消费者是契约与探针**：7 个既有 service composable 仍在用 `create*` +
  `handle.raw`（`#38` 一并迁移）；本 issue 只保证「seam 已就位」——
  `driver.services.geocode(...)` 这类调用不再需要 raw。
- **`setStyle` 的 `doOnceDraw()` 是显式补的**：官方专页图层不自动重绘，Driver 因此替调用方
  补这一次重绘；如果调用方自己也要 `doOnceDraw()`，多调一次是幂等的。
- **真实 smoke 未覆盖**：真实拖动/点击拾取交互、多分辨率/多浏览器、真实数据渲染结果、
  `PanoramaCoverageLayer` 与原生图层的叠加效果。
- **`layer.cluster` 的 capability 是 `extended`**：`#35`（M6）要做的 fallback 聚类仍待办；
  本 issue 只提供 SDK 原生入口。
- **`BMapClient.driver` 仍是 `BMapDriver`**：组件要直接用 `nativeLayers` / 归一化服务调用需要
  v4 的类型收窄，那是 `#25` 的默认切换的一部分（本 issue 不做，避免在迁移期改动公共客户端类型）。
  > 指针（2026-09-18 / #34）：**运行时的收窄入口已落地** —— `core/layers/nativeLayerAccess.ts`
  > 的 `nativeLayersOf(client)`（与 `jsapiV4ServicesOf` 同一条口径）。共享契约 `BMapDriver` **不动**。

## 提交前的双轴自审（Standards / Spec，各一个子代理）

**Standards 轴**（无硬违规；以下为发现项，全部已修）：

| 发现 | 处置 |
| --- | --- |
| `_AssertRuntimeCtorsUndeclared` 是**非分配式**断言：四个构造器名取联合后整体判断，上游只补齐其中 1~3 个声明时联合仍不整体可赋值 → 断言静默通过（门禁空转） | 改为**逐成员分配式**：先对单个 kind 求条件类型、再取联合，并要求结果是 `never`；`_AssertDeclaredCtors` 同步改成同一形状（`MissingDeclaredCtors extends never`） |
| `Panorama.destroy` 先调 SDK 再记账：可重试但丢了重入保护（与 `#22` 明确保留的「先记账挡重入」口径相反） | 改为 **claim → 调 SDK → 失败 `release`**：重入被挡、失败可重试；Fake 加 `onDestroy` 重入注入 + 一条重入单测 |
| `setStyle` 的 `doOnceDraw` 缺成员时**静默跳过**：样式已写入但画面不会变，调用方无任何提示 | 改为 `warnOnce` 明确告警「样式已更新但不会重绘」 |
| `NativeLayerPointTuple` / `toGeoJsonPosition` 零消费者，且把运行时函数放进 `types/` | 删除（M6 的数据适配层需要时再加）——**已由 #34 落地**（`core/data/geojsonAdapter.ts`；那两个被删的符号**没有**恢复） |
| 单测的 `KINDS` / `OPERATIONS` 与探针里的常量是同一事实的两份真相，且新增操作时契约会**静默漏测** | 单测改为 import 探针常量；探头两张表加 `as const satisfies` + 「必须覆盖全部 kind / 操作」的完备性断言（漏加即编译失败） |
| 同包内两个**同名不同形状**的 `ServiceErrorInfo`（`code` 是否可为 `null`） | JSONP 侧改名 `JsonpServiceErrorInfo`，并删掉 `webgl-v1/services.ts` 里已无消费方的再导出 |
| `ServiceInvocationDriver` 的文档说「不抛错」，但句柄所有权校验会同步抛 `BMAP_HANDLE_FOREIGN` | 修正文档：句柄所有权属**调用方错误**（同步抛，不伪装成「服务失败」）；参数非法则走结果通道 |
| Fake 里大量成员无任何消费方（getter 家族、`PointLayer` 的 `getItems`、`ClusterLayer` 的 getter、`Heatmap` 的 `setGradient/setRadius`、`TrackLine` 的播放控制、`Autocomplete` 的扩展面…），与自身注释「避免 Fake 先于实现膨胀」矛盾 | 全部删除，只留 Driver / 契约真正调用的成员（正是上一个 ADR 反对的形态） |
| `invoke` 的 `default` 分支不可达（保留它反而暗示「可能到达」） | 删掉，改为 switch 之后的 `operation satisfies never`——保留完备性保护，没有死代码 |
| `SERVICE_CALL_TIMEOUT_MS` 与 composable 的 `SERVICE_TIMEOUT_MS` 两份真相（仅靠注释自称同值） | composable 改为从 Driver 导入（单一事实源），保留原名字再导出 |
| 契约 live 档的幂等断言是重言式（`!idempotent ⇒ failed` 天然成立） | 改为「**首次成功** → 重复销毁必须短路」；live 档只要求「结果已记录」 |

**Spec 轴**（issue 逐条核对）：

| 发现 | 处置 |
| --- | --- |
| 实施步骤 1 / 2（callback → Promise/Result、迟到回调 / 空结果 / SDK status 标准化） | 已实现，见 §1 / §2 / §4；测试见 `serviceCall.test.ts` 与 `services.test.ts` |
| 实施步骤 3（原生图层 setData/clearData/style/state/picking） | 已实现，见 §7 |
| 实施步骤 4（对官方类型缺失的扩展成员建立最小 augmentation） | **刻意不做**：augmentation 治理白名单要求「无法通过项目领域类型绕开」，此处已用领域类型 + 结构探测绕开；`#22` 对 `PanoramaCoverageLayer` 是同一口径。已在「非目标」写明，PR 正文复述，避免被按字面判为漏项 |
| 实施步骤 5 / 测试要求 5（同一 Harness 可跑 Fake v4 与真实 smoke 子集） | 探针拆成零 vitest 依赖的 `facet-probes.ts`，vitest 契约与真实 AK 页面共用同一份代码；**smoke 本身是一次性人工验证、不进门禁**（AK 来自 docs 示例，进门禁会把门禁绑到外部配额），此点在 ADR 与 PR 正文都明确标注 |
| 测试要求 1~4 | 逐条对应：`serviceCall.test.ts`(9)、`services.test.ts`(23)、`native-layers.test.ts`（含 8×12 一致性）、`panorama.test.ts`(12)、`v3-jsapi-v4-services-native-layers.test.ts`(12，跑装配后的 Driver) |
| 验收标准 2「后续组件不需要访问 raw BMap 服务或图层」 | **部分达成**：seam 已就位（`driver.services.geocode(...)` / `driver.nativeLayers.*` 不需要 raw），但**现有 7 处 service composable 与 `BAutoComplete.vue` 仍用 `handle.raw`**——迁移属 M7 `#38`（与 ServiceSpec / AsyncTaskController 一并设计）。ADR「迁移影响」与「已知限制」都登记了这条，**不当作已完成** |
| 验收标准 1「v4 Driver 覆盖 Cutover 前现有全部功能」 | 部分：LocalSearch / Route 服务类、TrackLine 播放控制、panorama 声明式能力、`layer.traffic` 均有据顺延（各自的 ADR / issue 已登记） |
| 风险条目「能力探测必须允许加载后就绪」 | 已实现且有用例（§8） |
| 「DoD」7 条 | typecheck / test:unit / build / 边界与声明门禁 / 能力矩阵 / pack + verify:package 全绿；PR 描述含 SDK 依据、生命周期检查与迁移影响 |

## 外部评审轮次记录（PR #63，基线 `36ca01a`）

评审提出 4 项 P2。逐条在仓库内**先写会红的用例**（同一次运行里 5 条断言红）再修；红/绿之间的
失败信息就是复现证据：

| 发现 | 复现结果（红） | 处置 |
| --- | --- | --- |
| P2-1 `Autocomplete` 的回包归属错位：`pendingSuggest` 只有一个槽位 —— (a) 取消 A 之后 A 的迟到回包会结算 B；(b) 取消 A 把 B 的槽位一起清掉、B 最终超时 | (a) `expected 'AAA' to be 'BBB'`（B 拿到 A 的结果）；(b) `expected 'timeout' to be 'success'` | 改为**每实例一个 pending 队列**：回包**优先按 `keyword` 关联**（乱序也不串线）、不带 `keyword` 时退化为 FIFO 队首；`cancel()` 不再动队列（槽位要吸收自己那次 search 的回包）；`search()` 同步抛错时回滚槽位；队列加上界 + 告警。补 4 条用例（锁定 / 交叉取消 / 无 pending 回包 / **乱序回包**） |
| P2-2 全景销毁没有释放 EventDriver 持有的订阅（`groups` 是强引用） | `expected 1 to be +0`（destroy 之后监听器仍在） | `destroy` 先 `events.release(viewer)` 再销毁 SDK 对象；三个状态分开记账（`disposing` / `released` / `destroyed`），重试只补做未完成的一步；解绑失败不阻断销毁但汇总抛出。Panorama Facet 因此新增 `events` 注入，装配点一并传入 |
| P2-3 `locateCity` 没接 JSONP 探针：`_rd` 有错误码时仍返回 `empty` | `expected 'empty' to be 'failed'` | 与 Geocoder / Boundary 同源接入 `captureJsonpServiceError` + `settleNull`；补「有错误 ⇒ failed」「无错误 ⇒ 仍是 empty」两条用例；Fake 的 LocalCity 补 `jsonpError` 注入（同步注册 / 异步回包，与 Geocoder 同形） |
| P2-4 `convert` 的非法坐标绕过结果封装、同步抛 `BMAP_INVALID_POINT` | `'BMapError: Point 非法…' was thrown`（连 `ServiceCall` 都没返回） | 进调用前逐项校验（NaN / Infinity / 缺分量 → `failed + BMAP_INVALID_ARGUMENT`，不触碰 SDK）；几何转换移进受保护流程兜底；补 3 类非法坐标用例 |

评审描述的机制与实测**完全一致**（4/4 确认，没有「机制不同」或「不可复现」项）。这一轮的修复
落在同一条原则上：**「先记账 / 先清状态」与「完成标记」必须分开**（P2-1 的槽位、P2-2 的三个
状态），以及**「不支持」不能与「失败」互相冒充**（P2-3 的 `empty` vs `failed`）。

验证：`pnpm test:unit` **91 files / 959 tests**（+7 条回归用例）；typecheck / build / 边界扫描 /
public-dts / 能力矩阵全绿；真实 AK smoke **25/25**——`destroyError` 现在带上汇总消息且保留原始
`TypeError` 文本，说明新的「解绑 → 销毁 → 汇总」路径在真机上确实走到了。

**残留风险（显式接受）**：当回包**不带** `keyword`（官方声明为可选，运行时是否填充未承诺）时，
归属退化为顺序 FIFO——SDK 若乱序回包或丢了某个回包，后续回包会错位一格（上界保证不会无限累积，
并以告警暴露）。真实 Autocomplete 每次 `search()` 都有回包，且我们优先按 `keyword` 关联，
因此这是防御性条款；「真机是否填充 `keyword`、连发多次 `search()` 的回包顺序」属 M3A.3（#25）
的真机核对项。

**复审之后的补充加固（同一次复审 §1 的「乱序回包测试」要求）**：原实现只有 FIFO，乱序回包会
串线。补上 `keyword` 关联后，「B 的回包先到」也能落到 B 上；用例 `乱序回包（B 的先到）` 在补之前
是红的（`git stash` 该文件可复现），补之后转绿；另有 `回包不带 keyword 时退化为 FIFO` 固定退化路径。
Fake 为此加了 `flushOne(index)`（按索引触发单个回包）与 `includeKeyword`（模拟运行时不填充 keyword）。

## 外部评审第二轮（PR #63，基线 `5ccadb7`）

二轮复审确认 3 项 P2（上一轮的 `locateCity` / `convert` 已关闭；Autocomplete 与 Panorama 被判
「还没完全解决」）。同样先在仓库内写红用例（同一次运行 5 条断言红）再修：

| 发现 | 复现结果（红） | 处置 |
| --- | --- | --- |
| P2-1 「带 `keyword` 但不匹配」还会落回 FIFO：用户输入触发的回包、或被队列上界丢掉的旧请求的迟到回包，都会被结算给队列里的下一个调用 | `expected 'TYPED' to be 'BBB'`；上界场景 `expected 'N0' to be 'N1'` | `shiftPending` 改为**三级判定**：不匹配 ⇒ **返回 `null`、不消费任何槽位**；补 2 条用例 |
| P2-2 `keyword` 不是唯一标识：同名项取第一个 ⇒ 同关键词「超时后重试」与「取消后乱序」都被旧项吞掉 | 重试场景 `expected 'timeout' to be 'success'`；取消+乱序场景新调用 5s 内拿不到结果（挂起） | 同名项取**最后一个**（新回包归新调用，旧回包由旧项自己吸收）；补 2 条用例 |
| P2-3 全景 `released` 记账：SDK 销毁失败后重新订阅，重试会跳过释放 | `expected 1 to be +0`（重试成功后 EventDriver 仍持有订阅） | 删掉 `released`，**每次销毁尝试都释放当前订阅**（`release()` 无分组是 no-op）；`disposing` / `destroyed` 两态保留；补 1 条「销毁失败 → 重新订阅 → 重试成功」用例 |

二轮的另一条主张是「无法确认归属时应明确失败，而不是成功返回可能属于旧请求的数据」——本实现按
这条收口：**带 `keyword` 但不匹配时不再猜测**（宁可让该次调用走到 `timeout`，也不把结果塞给
不匹配的调用）。代价（上游若归一化 `keyword`，匹配会失败 → 该次 `suggest()` 超时）登记在
「已知限制」里，并留作 M3A.3（#25）的真机核对项。

验证：`pnpm test:unit` **91 files / 966 tests**（+5 回归用例）；typecheck / build / 边界扫描（含
`--src` 全树）/ `check:public-dts` / 能力矩阵 / manifest 全绿；真实 AK smoke 25/25。

## 外部评审第三轮（PR #63，基线 `3cbaabe`）

三轮复审只留 1 项 P2：**同关键词请求的归属仍未解决**——「取最新同名项」只是把「取最早」反过来，
依然是在按到达时间猜。四个反例里**有三个是「按请求顺序正常返回」就能触发的**（不需要乱序）：

| 场景 | `3cbaabe` 上的实际结果（红） |
| --- | --- |
| 取消旧 K → 重查 K → 旧回包先到 | 新请求收到 `OLD` |
| 旧 K 超时 → 重查 K → 旧回包先到 | 新请求收到 `OLD` |
| 两次 K 均未取消、按请求顺序回包 | 两个调用的结果互换 |
| 已取消的旧 K 返回空、新 K 随后返回有效 | 新请求提前结算成 `empty`，有效结果被忽略 |

同时指出了我上一轮测试的写法问题：两条「同关键词」用例都只走 `flushOne(1)`（新回包先到），
**恰好迎合了「取最新」的假设**——测试写成了实现的样子。

处置见 §5：**不再调匹配顺序，改为「同一关键词最多一个槽位」的不变式 + 前置拒绝**。相对上一轮：

- 归属回到「最早同名项」，四个反例全部转正确（并新增 3 条拒绝用例 + 1 条「不同关键词两种到达顺序都正确」的用例）；
- 删掉了上一轮那两条**把新回包先到当默认顺序**的用例（它们编码的是已被证伪的「取最新」契约），
  并在测试文件里写明为什么删；
- 三轮复审对「同关键词两次响应内容等价」的否认也被接受：`setLocation` / `setTypes` 可以让相同
  关键词的两次检索语境不同，因此「各归其位」必须是硬要求，不能靠「内容等价」兜底。

验证：`pnpm test:unit` **91 files / 969 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿；真实 AK smoke **26/26**。

三轮复审还顺带暴露了两个我自己没看到的点，都已修：

1. **共享契约 fixture 的缺陷**：`probeServiceFacet` 的默认输入框是**脱离文档**的，而真实
   `new BMap.Autocomplete({ input })` 对脱离文档的输入框直接抛 `TypeError … reading 'top'`——
   于是 live 档的 `suggest` 一直显示 `failed`，我此前把它误读成「headless 没有真实输入交互」。
   三种形态对比后修了 fixture（挂到文档），**live 档 `suggest` 现在真的返回 `success`**。
2. **`keyword` 不足以当请求身份**：参见 §5 的三条反例表。

## 外部评审第四轮（PR #63，基线 `57ef0ad`）

四轮复审接受「同关键词重叠 ⇒ 显式拒绝」的方向（明确不要求支持同关键词并发），但指出两条**绕过
路径**，都会以 `success` 返回错误归属的数据；两条都成立：

| 发现 | 复现结果（红） | 处置 |
| --- | --- | --- |
| P2-1 队列到上限时**淘汰**旧记录，而 `hasPendingKeyword` 只看队列 ⇒ 被淘汰但仍在飞的同关键词请求被误判为「不存在」，它的回包会结算新调用 | 「取消旧 K → 再发起并取消 16 个不同关键词 → 重新 suggest(K)」中，新调用拿到 `K-OLD`（实测以 5s 挂起/成功呈现） | **取消淘汰**：到上限时拒绝新调用（`isQueueFull` + 显式失败），旧记录保留到自己的回包到达；把旧用例改成「第 17 次被拒绝、已登记的 16 个各归其位」 |
| P2-2 `suggest()` 只能看到自己登记的请求，而**输入框的原生检索与它共用 `onSearchComplete`** ⇒ 用户输入的同关键词回包会结算程序化调用（反向亦然） | 「可输入输入框的实例上 `suggest(K)`」实测 `success`（应为拒绝） | 引入**通道独占**前置条件：`suggest()` 只在输入框不可输入（`readOnly` / `disabled` / `type="hidden"`）时放行，否则前置拒绝并给出替代方案；`AutocompleteOptions.input` 与 `suggest()` 的类型文档写明 |

四轮复审还指出「仅增大上限只是推迟触发」——本轮按此改掉了上限的语义（护栏而非淘汰），并且
**没有**重开已关闭的全景 / `locateCity` / `convert` 三项。

真实 AK 实测（本轮新增，决定了 P2-2 的方案）：

| 输入框形态 | 结果 |
| --- | --- |
| 脱离文档 | `new Autocomplete` 抛 `TypeError: Cannot read properties of null (reading 'top')` |
| 挂到文档 + **不可输入**（`readOnly`） | **`suggest = success`** |
| 挂到文档 + 可输入 | **`suggest = failed: BMAP_SERVICE_FAILED`**（新的通道独占前置拒绝真的生效） |
| **不带 `input`** | 构造 ok，但 **3s 内回包数 = 0** → 不能当「程序化专用通道」 |

验证：`pnpm test:unit` **91 files / 972 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿；真实 AK smoke **27/27**。

## 外部评审第五轮（PR #63，基线 `f37b2a7`）

只留 1 项 P2：**「通道独占」被缓存成构造时的状态**，而输入框之后可以恢复可编辑（HTML 控件的
可编辑性看**当前**的 `disabled` / `readonly` / `type`），保护因此失效。四个反例都属于同一根因：

| 状态变化 | `f37b2a7` 上的实际结果（红） |
| --- | --- |
| 构造时 `disabled=true`，之后取消 `disabled` 再 `suggest()` | 放行，程序化调用收到用户输入那次的结果 |
| 构造时 `readOnly=true`，之后取消 `readOnly` 再 `suggest()` | 同上 |
| 构造时 `type="hidden"`，之后改为 `"text"` 再 `suggest()` | 同上 |
| `suggest()` 等待回包期间输入框恢复可编辑 | 原生同关键词回包抢先结算该调用 |

处置（按复审给的口径，**不做「变回只读就恢复资格」的不完整修法**）：

- **调用时校验当前状态**：`exclusivityFailure(raw)` 在每次 `suggest()` 与**每次回包**时重新读
  `boundInput`（构造时保存的输入框引用），不再读构造期标记；
- **观察到即永久失效**：一旦发现可输入，实例进 `lostExclusivity` 并**清空队列、把在飞的程序化
  请求显式失败**（那些回包可能来自用户输入，宁可失败也不猜）；此后 `suggest()` 一律拒绝并提示
  重建实例，input 再变回只读也不恢复；
- 新增 5 条回归用例（三种状态变化 / 等待期间失去独占 / 永久失效），在 `f37b2a7` 上全部为红
  （`expected 'success' to be 'failed'`）。

**残留（显式接受）**：只在「`suggest()` / 回包」这两个 Driver 能执行代码的时刻观察输入框状态，
因此「窗口内短暂可输入、到观察点又变回只读」无法被察觉。要彻底消除，需要监听输入框属性变化
（`MutationObserver`）或真正隔离的程序化实例——两者都要求新的资源与释放路径，归 M7（#38）。

验证：`pnpm test:unit` **91 files / 977 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿；真实 AK smoke **27/27**。

## 外部评审第六轮（PR #63，基线 `240b65b`）

同一项 P2 未完全关闭：五轮改成「调用时 / 回包时检查**当前**状态」后，**检查间隔内的翻转**仍然
无记录——`解除只读 → 用户输入发出原生检索 → 恢复只读` 之后，两道检查看到的都是只读：

| 场景 | `240b65b` 上的实际结果（红） |
| --- | --- |
| 翻转窗口之后调用 `suggest()` | `expected 'success' to be 'failed'`（程序化调用拿到原生那次的 `TYPED`） |
| `suggest()` 等待期间翻转 | 同上（`TYPED` 结算了程序化调用） |

处置（按复审给的观察器方向）：

- 创建实例时对绑定输入框挂 `MutationObserver`（`attributeFilter: ["readonly","disabled","type"]`），
  **按属性变化记录**判定：回调里逐条看 `attributeName`，**不重读当前值**——否则「解除→恢复」
  在同一批记录里看起来从未变过；也刻意不依赖 `attributeOldValue`（本仓库测试环境 happy-dom
  未实现它，只判「相关属性变过」就足够，调用方要用 `suggest()` 就不该在使用期间动这些属性）。
- 观察到变化 ⇒ `loseExclusivity`：永久失效 + 清空队列 + 把在飞的程序化请求显式失败；
  **观察器在终态立即 `disconnect()`**（复审明确要求补齐释放路径）。
- 观察器不可用时（非 DOM 环境）静默退化为「每次检查当前状态」，即五轮的行为。

**试过但撤回的方案**：把「不属于任何程序化请求的回包」也当作失去独占。它会让上一轮已被接受的
行为失效（不匹配回包不消费槽位、后续程序化调用仍各归其位），而观察器已覆盖同一场景，属于
多余的严格化；因此只保留「不消费槽位」这一条。

**残留（显式接受）**：① 观察器回调是**异步**的，所以「同一个同步块内 解除 → 直接用**裸实例**
`search()` → 恢复」这种顺序仍可能漏——真实用户输入必然跨任务，而调用方绕过 `suggest()` 直接操作
裸实例已在本契约之外；② 非 DOM 环境没有观察器，退化为调用时校验。彻底消除仍是 M7（#38）
的隔离实例。

验证：`pnpm test:unit` **91 files / 980 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿；真实 AK smoke **28/28**。

## 外部评审第七轮（PR #63，基线 `d2c6cb9`）

上轮的翻转窗口已通过；本轮两项都属于新增观察器本身：

| 发现 | 处置 |
| --- | --- |
| P2-1 观察器**只在失去独占时**释放——输入框一直保持只读、实例正常结束使用的路径不会清理；SDK 自己的 `dispose()` 也不知道 Driver 挂过观察器。结果：反复创建/销毁会持续累积（复审在真实浏览器里实测 100 次 → 100 个注册） | ① **不再用观察器**（见下），改为带显式解绑的输入活动监听；② 新增 `JsapiV4ServiceDriver.dispose(handle)`：解绑监听器 + 把在飞调用显式失败 + 调用 SDK 自身的 `dispose()`（实例无该成员时跳过），**幂等**，释放后该句柄不再可用于程序化检索；③ `loseExclusivity` 复用同一个解绑函数，但它不再是唯一入口 |
| P2-2 「属性被写过」不等于「曾经可输入」：真实 Chromium 里 `input.readOnly = true` **重复赋同值**也产生属性记录，于是「始终只读、只随 loading 切 `disabled` / `type="hidden"` 时切 `disabled`」这类完全安全的用法被永久禁用 | **换判定信号**：不再观察属性，改为监听输入框的 **`input` 事件**——它是官方文档里原生检索的触发源（「输入框中的字符输入会触发检索」）。属性写入完全不再影响判定（三条用例固定：同值写入 / 只切 `disabled` / `type=hidden` 只切 `disabled` 都不失效），而 `解除只读 → 用户输入 → 恢复只读` 那个窗口仍被覆盖（用户输入必然会触发 `input`） |

**为什么换信号而不是去解析属性记录**：要区分「同值写入」（必须忽略）与「解除→恢复」（必须判失效），
只能比对有序记录 + `attributeOldValue`；而本仓库测试环境 happy-dom **不实现 `attributeOldValue`**
（实测确认），这条逻辑在门禁里无法被验证。改监听输入活动后，判定与属性无关，问题从结构上消失。

**没能在本仓库复现 P2-2**：happy-dom 不为同值写入产生记录，所以那三条「不得失效」的用例在本仓库
是**语义锚**（防回归），不是在 happy-dom 里红过的证据；真实证据是复审给出的 Chromium 复现。

真实 AK 实测（本轮新增，最小 harness，3/3）：

| 检查 | 结果 |
| --- | --- |
| 对照组：`suggest` 正常路径 | `success`（`北京市`） |
| `dispose()` 在真实 4.0 上 | **不抛错**（`disposeThrew: null`）；释放后 `suggest` → `failed: BMAP_SERVICE_FAILED` |
| `dispose()` 幂等 | 连续两次调用不抛错 |

验证：`pnpm test:unit` **91 files / 985 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿。

## 外部评审第八轮（PR #63，基线 `d97de8e`）

上轮的输入活动监听与正常释放已通过；本轮两项都在新加的 `dispose()` 上：

| 发现 | 处置 |
| --- | --- |
| P2-1 `dispose(handle: ServiceHandle<string>)` **契约过宽**：只终止了 Autocomplete 的 `pendingSuggest`，而 `disposed` 只在 Autocomplete 的独占检查里读取——Geocoder 等服务的在飞调用仍会成功回写、释放后仍能再次调用。公开类型却承诺了通用释放 | **收窄为 Autocomplete 专用**：`disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">)`。类型上禁止传其它服务句柄，运行期再按 Handle 品牌校验一次（与 `layers` / `controls` / `native-layers` 同源），传错时抛 `BMAP_INVALID_ARGUMENT` 并说明「其他服务当前没有 Driver 侧资源；统一释放入口属 M7 #38」。类型文档写清了这个边界与原因 |
| P2-2 「先记账再调 SDK」：`disposed.add(raw)` 在 SDK `dispose()` 之前，SDK 抛错后再次调用直接短路 ⇒ 底层资源失去重试清理的入口 | 把状态拆开：`disposed`（一旦释放就不再接受业务调用，**不因失败回滚**）+ `sdkDisposed`（**只有 SDK dispose 成功才记账**）。Driver 侧清理（解绑监听 + 在飞调用显式失败）幂等、每次都跑；SDK 清理失败时抛错给调用方，下次 `disposeAutocomplete()` **重试**未完成的那一步 |

P2-2 的红/绿是实测的：临时把记账顺序还原成旧写法，用例 `SDK dispose 抛错：…再次调用会重试未完成的 SDK 清理`
报 `expected [ 'dispose' ] to have a length of 2 but got 1`（SDK 只被尝试了一次），恢复后转绿。

P2-1 的「通用入口对 Geocoder 什么都不做」与复审复现一致（代码路径上 `pendingSuggest` 无该实例、
`disposed` 无人读、Geocoder 也没有 SDK `dispose()` 成员 ⇒ 静默返回）；现在这个用法在类型上就不成立，
运行期还会显式拒绝，并新增对应用例。

验证：`pnpm test:unit` **91 files / 987 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿。

## 外部评审第九轮（PR #63，基线 `00b5534`）

上轮两项（接口收窄、SDK 清理失败可重试）已关闭；本轮 1 项 P2 + 1 条补充加固：

| 发现 | 处置 |
| --- | --- |
| P2 专用释放入口**漏了 EventDriver 的订阅**：`disposeAutocomplete()` 解绑了输入监听、失败了在飞调用、也调了 SDK `dispose()`，但没有 `events.release(handle)`；Service Facet 的装配也没有注入 `events`。EventDriver 的 `groups` 是强引用 `Map<rawTarget, …>`，SDK 清空自己的监听器**不会**删除这份记录——反复创建/订阅/释放会持续累积 | 与 Map / Panorama 同源：`createJsapiV4ServiceDriver` 现在接收**同一份** `events`（装配点传入），`disposeAutocomplete` 按「业务事件先下线、再销毁 SDK 对象」的顺序调用 `events.release(handle)`；解绑失败不阻断 SDK 销毁，最后**汇总抛出**（重试语义保留：Driver 侧清理每次都跑、SDK 步骤成功才记账） |
| 补充（未列为 P2）：SDK 销毁钩子里**重入** `disposeAutocomplete()` 会让 SDK 销毁执行两次 | 加 `disposing`（清理在飞）标记，与 Map / Panorama 的重入保护同源；Fake 增加 `onDispose` 钩子把这条路径固定成回归用例 |

回归用例 +3：订阅 `confirm` / `highlight` → 释放 → Driver 分组归零（**反复三轮**）、装配后（跨 Facet）
释放同样归零、SDK 销毁钩子重入只销毁一次。

红/绿是实测的：把实现回退到 `00b5534`，订阅用例报 `第 1 轮释放后订阅必须归零: expected 2 to be +0`，
重入用例同样失败；恢复后 58/58 转绿。

验证：`pnpm test:unit` **91 files / 990 tests**；typecheck / build / 边界扫描（含 `--src` 全树）/
`check:public-dts` / 能力矩阵 / manifest 全绿。

## 参考

- issue #23 `[M3A2] 实现 Service/Panorama/Native Layer Facet 并完善 Driver Contract`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 官方 4.0 API 参考：`Geocoder` / `Convertor` / `Boundary` / `LocalCity` / `Geolocation` /
  `Autocomplete` / `ViewAnimation` / `Panorama` / `PanoramaService` / `PointLayer` /
  `ClusterLayer` / `PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer` /
  `Heatmap` / `TrackLine`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`service/*.d.ts`、`panorama/*.d.ts`、
  `layer/{PointIconLayer,PointShapeLayer,LineLayer,FillLayer}.d.ts`、`const/StatusCodes.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/visualization-layers.md`、
  `references/runtime-extended-apis.md`、`references/search-and-geocoding.md`、
  `references/geolocation-and-convertor.md`、`references/panorama.md`、
  `references/data-layers.md`
- 参考实现（社区封装，用于核对「程序化检索的归属」这一层怎么做）：
  `huiyan-fe/react-bmap` 的 `src/hooks/services/useAutocomplete.ts`（`setSearchCompleteCallback`
  + `requestId` 守卫；结论见 §5「参考实现的评估」）
- 代码：`src/driver/jsapi-v4/{services,panorama,native-layers}.ts`、
  `src/driver/normalize/{serviceCall,jsonpProbe}.ts`、`src/driver/createJsapiV4Driver.ts`、
  `src/driver/types/{services,panorama,native-layers,bmap}.ts`、
  `src/driver/capability/catalog.ts`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/{services,native-layers,panorama}.ts`、
  `packages/test-utils/{facet-probes,driver-contract}.ts`
