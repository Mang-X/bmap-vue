# ADR 2026-09-12：Fake v4 诊断口径与迁移期双 Driver 矩阵（诊断门禁 / 领域结果比对）

- 状态：已接受（Accepted，**部分退役**）
- 日期：2026-09-12
- 计划键：`M3A3-FAKE-DUAL`（issue #24，追踪 #12）
- 取代：无
- **后续（2026-09-14，issue #26）**：本文的**诊断口径**（`leaks` 恒为 0 / `activity` 不归零 /
  定时器与回调不进泄漏门禁）继续有效并被 `packages/test-utils/fake-bmap-v4/diagnostics.ts` 沿用；
  **双 Driver 矩阵部分已退役**——旧引擎删除后「跨引擎比较」不再存在，`driver-matrix.ts` 的
  `runDriverMatrix` / `expectSameDomainResult` / `createLegacyMatrixEngine` /
  `createMigrationMatrixEngines` 一并删除，只留下组件级装配与领域读数（`fake-v4-harness.ts`）。
  组件级场景（含 100 轮挂载/卸载与逐族活动计数）保留在
  `tests/behavior/v3-component-scenarios.test.ts`。见 [ADR 2026-09-14](./2026-09-14-remove-legacy-engine.md)。
- 相关：[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)、[`2026-09-11-loaded-sdk-client-boundary`](./2026-09-11-loaded-sdk-client-boundary.md)、[`2026-09-11-jsapi-v4-overlay-facet`](./2026-09-11-jsapi-v4-overlay-facet.md)、[`2026-09-11-jsapi-v4-control-layer-facets`](./2026-09-11-jsapi-v4-control-layer-facets.md)、[`2026-09-12-jsapi-v4-service-panorama-native-layers`](./2026-09-12-jsapi-v4-service-panorama-native-layers.md)

## 背景

`#19`~`#23` 在各自的 issue 里**顺带**长出了 Fake v4 的一部分（每个 Facet 的测试都需要它），
但三件事一直没人管：

1. Fake 的统计只有「监听器」一项（`FakeV4EventStats`），而 issue #24 要求诊断覆盖
   **listener / resource / timer / callback** 四类；
2. **跨引擎的共享契约只跑过 webgl-v1**（`tests/behavior/v3-driver-contract.test.ts`）。
   v4 侧只有各 facet 自己的契约，`runMapDriverContract`（需要真实 `BMapClient` 的那一层）
   从未在 Fake v4 上跑过；
3. 「核心组件同时跑旧 Driver 与 v4 Driver」这件事此前没有可复用的形态：既有 webgl-v1
   组件测试全部直接读 `fake.createdMaps` / `fake.stats`，把「怎么读引擎的假账本」写死在
   每个用例里，换引擎等于重写一遍。

动手前必须冻结六个容易写歪的点：

1. **「计数」有歧义**：`listenCalls` 在 100 次挂载后当然是 100 而不是 0，而
   「100 次 mount/unmount 后诊断全归零」这句话说的是另一组数。把两类数混在一个
   `snapshot()` 里，门禁迟早会被写成「反正不为 0 也说得过去」。
2. **不是所有资源都有释放入口**：官方 4.0 的 `Geocoder` / `Convertor` / `Boundary` /
   `Geolocation` / `LocalCity` 没有 `destroy` / `dispose`，它们随 Client 被 GC 回收。
   把它们算进泄漏门禁，门禁就永远无法归零。
3. **「定时器 / 回调没结算」不等于泄漏**：真实 JSONP 的迟到回包是**正确语义**
   （取消之后请求收不回来），把它算成泄漏会逼出「为了骗过门禁而 flush」的假绿。
4. **`map.destroy()` 不代为摘除子资源**：SDK 只管自己的监听器；「先摘子资源再销毁地图」是
   本仓库跨 Facet 的不变式（见 overlay / control / layer 三篇 ADR）。诊断必须让**漏摘可见**，
   而不是在 destroy 时顺手把子资源计数抹平。
5. **双跑不能比较 raw 调用**：两个引擎的方法名、图层分发（v4 统一 `addLayer`，BMapGL 的
   `addDistrictLayer` / `addTileLayer` 落进 `overlays`）、常量表示本来就不同。比较 SDK 调用序列
   只会得到一堆与迁移无关的差异。
6. **双跑是过渡形态**：`#26` 要删掉 webgl-v1。任何「为了双跑而抽象出的通用层」都必须能随
   legacy 一起删除，不能变成长期负担。

## 决策

### 1. 诊断分两个口径，只有前者进门禁

`packages/test-utils/fake-bmap-v4/diagnostics.ts` 的 `FakeV4Diagnostics`（同一文件里
`FakeV4EventStats` 这个名字被取代，职责已不止事件）：

- **`leaks`（泄漏门禁口径）**：`maps` / `overlays` / `infoWindows` / `contextMenus` /
  `controls` / `layers` / `panoramas` / `autocompletes` / `listeners`。每一项都对应一条**真实
  释放路径**，因此非 0 一定指向没走完的清理，而不是统计噪音。`assertNoLeaks()` 逐项点名失败项。
- **`activity`（活动口径）**：`*Created` / `*Attached` / `*Detached` / `listenCalls` /
  `unlistenCalls` / `timersScheduled` / `callbacksQueued` …，以及两个实时值
  `timersPending` / `callbacksPending`。这组**不**要求归零（它描述「发生过什么」），
  是「不重绑」「只重建一次」「窗口最终结算」这些断言的落点。

`fake.diagnostics` 与 `fake.stats` 指向同一实例：`stats` 是本 issue 之前的旧名，保留为别名
以免打断既有用例（本仓库 test-utils 不对外发布，改名不构成公共契约变更）。

### 2. 记账点放在 Fake 自己的生命周期方法上，destroy 只销自己的账

- `Map` 构造 / `destroy()`、`map.addOverlay` / `removeOverlay`、`openInfoWindow` /
  `closeInfoWindow`、`addContextMenu` / `removeContextMenu`、`addControl` / `removeControl`、
  `addLayer` / `removeLayer`、`Panorama` 构造 / 成功 `destroy()`、`Autocomplete` 构造 /
  成功 `dispose()`。
- **失败路径不销账**（`Panorama#destroy` 抛错、`Autocomplete#dispose` 抛错）：账头留着，
  于是「失败不记账、可以重试」有了可观察依据。
- **两种销账方式**（PR #66 复审 P2-1 之后固定下来）：
  - `FakeV4LifecycleKind`（`map` / `panorama` / `autocomplete`）**按实例**销账。这些对象的
    SDK 语义是「一个实例创建一次、销毁一次」，而 Fake 刻意保留「重复 destroy 每次都真的打到
    SDK」的可观察性（`destroyCalls` / `callLog`）；若诊断只看同类总数，**重复销毁一个实例就会
    抵消另一个存活实例的泄漏**，门禁静默失效。因此 `resourceCreated` / `resourceReleased` 对这三类
    **要求传实例**（TS 重载强制），用 `WeakSet` 记「尚未销账」，第二次释放返回 `false` 且不动总数。
  - `FakeV4AttachmentKind`（`overlay` / `infoWindow` / `contextMenu` / `control` / `layer`）
    **按次数**销账：SDK 不保证去重、同一实例可以挂多次（官方把「同一实例重复添加」列为误用，
    本仓库由 Driver 自己记账），「挂两次、摘一次还剩一个」这条不变式不能被实例去重改掉。
    这些调用点本来就以**容器命中**为前提，身份正确性由容器负责。
- **重复挂载按 SDK 事实计数**：`addControl` / `addLayer` 不去重，诊断就记 2——这样「Driver 是否
  自己记账」不会被假象掩盖。`resourceReleased` 对未登记/未挂载的实例是 no-op，且不会把计数打成负数。
- 只有 `Map` 自己销账：`destroy()` 时仍挂着的覆盖物 / 控件 / 图层会留在 `leaks` 里（漏摘可见）。

### 3. 异步窗口可控注入：`auto` / `delay` / `flush` + 计数

`FakeV4CallbackQueue` 原有 `auto = false` + `flush()` / `flushOne()`（手动时序），本次补
`delay`（毫秒）：`0` 仍是「下一个微任务」（真实 JSONP 的最短延迟），`> 0` 走 `setTimeout`
并计入 timer 口径。回调的「派出 / 结算」全部进 `callbacksQueued` / `callbacksSettled`，
`pendingAsync()` 暴露两个在飞值。

**定时器与回调不进泄漏门禁**，理由见背景第 3 点：它们是「在飞」而非「未释放」。需要的用例
显式断言 `pendingAsync()`。

### 3b. 运行时注入成员有可控开关，不再各自 `delete namespace.X`

官方 4.0 的扩展 API（`PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine`）与
`PanoramaCoverageLayer` 是**运行时注入**的，因此「注入前失败、注入后同一个 Driver 可用」是真实
语义（#23 ADR 决策 4）。此前测试各自 `delete fake.namespace.PointLayer` + `try/finally` 手改
命名空间：忘记恢复就会污染后续用例，而且「注入前 / 注入后」两种时机在各文件里写法不一。

`fake.runtimeExtensions`（`runtime-extensions.ts`）把它变成有名有姓的入口：
`uninstall(member)` / `install(member)` / `uninstalled()` / `restoreAll()`，幂等，
且 **矩阵引擎的 `reset()` 会调用 `restoreAll()`**——一个忘了恢复的用例不会把「命名空间缺成员」
带进下一个用例（那类失败会伪装成「Driver 探测错了」）。

成员名单（`FAKE_V4_RUNTIME_INJECTED_MEMBERS`）是官方事实；「怎么卸、怎么装」是 Fake 特有的建模手段。

### 4. 双跑比较领域结果，引擎差异收在 harness 一侧

`packages/test-utils/driver-matrix.ts`：

- `runDriverMatrix(engines, scenario)`：在每个引擎上各跑一次同一份场景，每个引擎一份全新的
  Provider / 容器，跑之前重置基线；返回 `engine → 结果`。
- `expectSameDomainResult(results, engines)`：先 `diffPaths` 定位差异字段再断言，失败信息
  指向具体路径，而不是丢一坨 deep-equal diff。
- `createJsapiV4MatrixEngine()` / `createLegacyMatrixEngine()`：把「Provider 形状（v4 必须
  自述 `engine`，legacy 只能给裸值）」「挂载计数读哪个容器」「气泡活状态怎么读」这些差异全部
  收进引擎描述。用例只写 `ctx.attached("control")` / `ctx.overlayPositions()` /
  `ctx.openInfoWindows()` / `ctx.assertIdle()`。
- **legacy 的容器必须按实例分类，不能当领域结果用**（PR #66 复审 P2-2）：BMapGL 把覆盖物、图层
  （`addDistrictLayer` / `addTileLayer`）、被打开的气泡**混在** `map.overlays` 一个容器里，所以
  `attached("overlay")` / `attached("layer")` / `overlayPositions()` 都要先按**命名空间构造器**
  （`instanceof fake.DistrictLayer` / `TileLayer` / `PanoramaCoverageLayer` / `InfoWindow`）过滤。
  分类依据刻意不是「有没有 `position`」——接口允许没有位置的覆盖物（`CustomOverlay` 只声明
  `domCreate`），用特征字段识别会把它们误判成图层。
- `createFakeV4Client()`：用**默认路径**（结构化 Provider → `createBMapClient` → 默认 v4 工厂）
  装出 v4 Client，供 `runMapDriverContract` 使用。

`assertIdle()` 是「诊断计数可用于生命周期门禁」的跨引擎形态：v4 用它自己的 `assertNoLeaks()`，
webgl-v1 用 `mapsCreated - mapsDestroyed` 等推导。**两边的实现不同，用例的写法相同。**

### 5. 双跑的验收形态

- `tests/behavior/v4-driver-contract.test.ts`：`runMapDriverContract`（Map / Overlay / Control /
  Layer 全量共享契约 + client 组装前提）在 Fake v4 上全通过；并附反证用例（漏摘图层必须被
  门禁抓住）。
- `tests/behavior/v4-fake-async-lifecycle.test.ts`：迟到回调（取消后回包不复活）、延迟回包
  （timer 口径）、失败重试（服务 JSONP 错误、`dispose` 失败、`destroy` 失败）、target 切换
  （同一覆盖物 / 控件 / 图层在两个 Map 之间移动不翻倍不漏减）、driver 层 100 次
  「建图 → 挂载三件套 → 摘除 → 销毁」后 `leaks` 全归零。
- `tests/behavior/v3-dual-driver-components.test.ts`：Map / Marker / Control / Layer /
  基础服务在两个引擎上跑同一份组件树并比较领域结果；组件层 100 次挂载卸载后 `assertIdle()`。

## 后果

### 正面

- 泄漏门禁第一次有了**逐族、可点名**的失败信息（`[v4 client 循环] 资源未释放: layers=1`）。
- 共享契约在 v4 上的空白被补上：`runMapDriverContract` 通过，说明「Fake v4 能支撑普通 PR 的
  全部行为测试」这句话成立。
- 后续组件迁移（`#25` 默认切换、`#26` 删码）可以复用矩阵：`#26` 之后删掉 legacy 引擎描述与
  `runDriverMatrix` 的多引擎循环即可，用例本身不用重写。
- 双跑查出了一个真实缺口（见「已知限制」1），这正是「验证」而不是「顺手改组件」的价值。

### 回滚

- 诊断与矩阵都在 `packages/test-utils/**`（不在 raw SDK 扫描范围内，也不进发布声明产物）：
  回滚只需还原该目录与本 issue 的三个测试文件，无公共 API 影响。
- `FakeV4EventStats` → `FakeV4Diagnostics` 是 test-utils 内部改名，仓库内无外部消费者。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `packages/test-utils` 不再导出 `FakeV4EventStats` | 仅 test-utils 内部使用（grep 确认无 tests/ src 消费者） | 改用 `FakeV4Diagnostics`；`fake.stats.*` 旧读法继续可用 |
| `FakeV4Diagnostics` 新增 `resourceCreated/Released` 等记账入口 | Fake 内部类构造函数多拿到诊断对象的**子类型**（仍是同一个对象） | 无调用方改动 |
| `FakeV4CallbackQueue` 新增 `delay` | 默认 0，行为与之前一致（仍是下一个微任务） | 无 |
| Service / Panorama Fake 构造函数新增可选 `diagnostics` 参数 | 省略时回包不进诊断 | `createFakeBMapV4()` 已显式传入 |
| 组件与公共 API | **无变化**（本次不动 `src/**` 的任何非测试文件） | — |

## 非目标

- **不修组件**。`<BInfoWindow>` 在 v4 上挂不起来是 M5（`#32` 重构 BInfoWindow：Teleport、
  状态机与 InfoWindowManager）的活；本 issue 只把它钉成可断言的现状。
- 不让 Fake 模拟更多官方 API：仍只覆盖「组件 / Facet 会调用 + 契约会断言」的成员。
- 不把 Fake 的宽松行为当作真实 SDK 规范（数值归一、投影公式等仍是 Fake 专有的近似，
  真实行为由 `#25` 的浏览器 smoke 负责）。
- 不为双跑建立长期兼容层：双跑只用于验证，`#26` 删除 webgl-v1 时一并退场。
- 不给 `tests/**` 与 `packages/test-utils/**` 新增 typecheck 门禁（属 M9 / `#45` 的 CI 硬化）；
  本次用一次性 `vue-tsc` 校验并记录结论。

## 已知限制（显式接受）

1. **`<BInfoWindow>` 在 v4 上挂不起来**（双跑查出）。
   组件的 `onMounted` 仍调用 `overlays.add({ kind: "map" }, infoWindow)`，而 v4 OverlayDriver
   明确拒绝这条路（InfoWindow 是地图级 API）并抛 `BMAP_INVALID_ARGUMENT`。
   `tests/behavior/v3-dual-driver-components.test.ts` 把这条现状钉成断言（v4 上
   `mountedOnDriver: false` / `errorCode: BMAP_INVALID_ARGUMENT`），`#32` 落地后该断言会失败，
   从而强制更新。**`#25`（默认 cutover）必须先于或同时解决它**，否则切换默认 Provider 会
   让 `<BInfoWindow>` 在所有用户那里直接报错。
2. **`useBMapGeocoder` 仍直读 `geocoder.raw.getPoint()`**，并从 `driver/webgl-v1/services`
   导入 `captureJsonpServiceError`（该模块在 `#26` 会被删除）。双跑证明它在两个引擎上都能结算，
   但这条路径越过 Driver 的归一化调用面，属 M7（`#38` ServiceSpec / AsyncTaskController）的欠账；
   `#26` 删码时必须先把这个导入迁到 `driver/normalize`。
3. **BMapGL 的假账本把覆盖物 / 图层 / 气泡混在 `map.overlays`**：读数必须按命名空间构造器分类
   （见决策 4）。分类逻辑住在 legacy 引擎描述里，随 `#26` 删除旧 Driver 一起消失；
   v4 侧的诊断天然分族，不需要这层归一。
4. **`BMap` 组件在 v4 上仍会打印两条告警**（`restrictCenter` 无对应构造项、
   `setTraffic` 需经 Layer Facet）。它们是既有行为，不是本次改动引入；`setTraffic` 的接线属
   M7（`#40` LayerSpec）。
5. **定时器 / 回调不计入泄漏门禁**（见决策 3）。要断言「没有在飞窗口」必须显式写
   `expect(fake.diagnostics.pendingAsync()).toEqual({ timers: 0, callbacks: 0 })`。

## 提交前的双轴自审（Standards / Spec，各一个子代理）

两个轴各起一个并行子代理（拿完整 diff + 各自的评审依据），结论与据此做的修改：

**Standards 轴**（依据 AGENTS.md / CONTRIBUTING.md + Fowler 气味基线）：

| 发现 | 处置 |
| --- | --- |
| 泄漏检查清单是手抄字段名数组，与 `FakeV4LeakCounters` / `snapshot()` 三处重复——新增 leak 字段会被 `assertNoLeaks()` 静默漏查（门禁空转） | **已修**：改成 `LEAK_FIELD_BY_KIND`（穷尽 `Record`，漏登记即编译失败）为唯一事实源，`assertNoLeaks()` 直接遍历 `snapshot().leaks` |
| `listeners` 的口径注释只写了「add − remove」，漏了 `map.destroy()` 清残留监听器那一半 | **已修**：注释补全 |
| 「打开新气泡顶掉旧实例」被记成 `activity.infoWindowsClosed`，但旧实例并未 `open=false`、也没 emit `close` | **已修**：字段更名 `infoWindowsReleased` 并注明销账的两种来源 |
| `PanoramaService` 没进 `servicesCreated`，与「基础服务只进活动口径」的文档不一致 | **已修**：构造函数补 `serviceInstanceCreated()` |
| `Autocomplete` 的默认参数会 new 一份丢弃的影子诊断，与其余服务「省略即不进诊断」口径相反 | **已修**：在构造函数上写明这是 `super()` 需要的私有宿主，生产路径一律传共享诊断 |
| `expectSameDomainResult` 在引擎不足两个时静默返回（比对没发生却看起来通过了） | **已修**：改为显式抛错，单引擎场景必须直接断言结果 |
| Duplicated Code：两个引擎各抄一份 `lastMap()` / 位置投影 | **已修**：抽 `lastCreatedMap()` / `toPositions()` |
| 气味（judgement，不改）：`attached(kind)` 的 3 分支 if 级联在两处；4 个测试文件各有一份 4 行 `container()` | 保留：分支各自表达一个引擎的假账本位置，抽公共映射反而要引入一层间接；测试内的 `container()` 是刻意的「文件自洽」 |
| 风格不一致：`fake-bmap-v4/**` 既有文件是单引号无分号，新文件用双引号 + 分号 | 保留：同目录的 `driver-contract.ts` / `facet-probes.ts` 就是双引号 + 分号，且根目录无格式化门禁；整目录统一属独立清理 |
| 计划键写法在测试文件里漂移（`M3A3-DUAL-DRIVER` vs issue 的 `M3A3-FAKE-DUAL`） | **已修**：统一为 issue 的计划键 |
| 唯一擦边：CONTRIBUTING「改动架构约定时一起更新 AGENTS.md」——新约定只写进了 ADR | **已修**：AGENTS.md 增加「测试基建（`packages/test-utils`）」一节 |

**Spec 轴**（逐条核对 issue #24 的背景 / 目标与范围 / 实施步骤 / 测试要求 / 验收标准 / 非目标）：

| 发现 | 处置 |
| --- | --- |
| 「Map、Marker、InfoWindow、Control、Layer、基础服务双跑」中 InfoWindow 没有比对领域结果 | 如实记录：InfoWindow **两个引擎都跑了**，v4 侧挂不起来（欠账 → #32）。见「已知限制」1，不修组件 |
| 实施步骤 3 的「runtime 扩展」没落实 | **已补**：决策 3b 的可控注入开关 + `v4-fake-async-lifecycle.test.ts` 的注入时机用例 |
| 实施步骤 1（按 Facet 实现 Fake 类与 namespace）本 PR 未做 | 属 #19~#23 的既有交付；本 PR 只补诊断、矩阵与双跑，见 PR 的「刻意不做」 |
| 验收「双 Driver 测试证明组件未依赖旧 raw SDK」这句话立不住：`useBMapGeocoder` 仍直读 `raw.getPoint` 并从将删的 `webgl-v1/services` 导入嗅探 | 不扩大结论：PR 里把结论限定为「组件层不再依赖 webgl-v1 命名空间（Provider 分派 + 矩阵证明）」，并在「已知限制」2 记录欠账（→ #38 / #26） |
| 测试要求「100 次 mount/unmount 后 diagnostics **全归零**」，实现只让 `leaks` 归零 | **已补**：组件层用例补 `pendingAsync()` 归零断言；driver 层用例本就断言了两个在飞值。`activity` 不归零是决策 1 的刻意设计 |
| ADR + README 索引不在「预计变更区域」 | 保留：`docs/adr/README.md` 的约定要求「涉及公共 API 契约 / 架构的改动必须先有 ADR」，本 PR 引入了新的测试基建约定 |

## 外部评审轮次记录（PR #66，基线 `697488e`）

一轮外部评审给出 2 个 P2，**两条都先在仓库里复现成失败测试**（红），再修（绿）：

| 发现 | 复现（修复前的实测输出） | 根因 | 处置 |
| --- | --- | --- | --- |
| **P2-1** `resourceReleased()` 只看同类总数，重复销毁同一实例会抵消另一个实例的泄漏 | `两个 Panorama：重复销毁 A 一次，B 的泄漏必须还在` → `expected +0 to be 1`（`leaks.panoramas`）；Autocomplete 同形 | 生命周期类资源按**池化计数**销账，没有实例身份；而 `Panorama#destroy` / `Autocomplete#dispose` 刻意保留「重复调用都真的打到 SDK」（`destroyCalls` / `callLog` 可观察） | 记账方式分两类：`FakeV4LifecycleKind`（map / panorama / autocomplete）**按实例**销账（TS 重载强制传实例 + `WeakSet` 记未销账），`FakeV4AttachmentKind` 仍按次数销账（保留「挂两次摘一次还剩一个」）。新增 3 条反证用例 |
| **P2-2** legacy 引擎把 `overlay` / `layer` 都读成同一个 `map.overlays`，位置投影也不排除图层，混挂场景产生**虚假的领域差异** | `Marker + Layer 混挂的领域结果：webgl-v1 与 jsapi-v4 在这些字段上不一致: ['$.overlays', '$.layers', …]`（v4 读 1/1，legacy 读 2/2） | 引擎描述把 raw 容器当成了归一化的领域结果 | legacy 引擎按**命名空间构造器**（`instanceof`）分类覆盖物 / 图层 / 气泡后再投影；新增「Marker + Layer 混挂」双跑用例，并把 100 次门禁的逐族断言收紧到三个族 |

该轮还顺手发现一个**静默覆盖**陷阱：修复 P2-1 时新增了带重载的 `resourceReleased`，而文件里
旧的同名实现没删掉——JS 里后者覆盖前者，测试继续以旧行为通过（第一次「修复」后仍是红）。
教训记在这里：**给方法加重载时先确认没有同名旧实现幸存**（本仓库没有 lint 门禁会报
`no-dupe-class-members`；`oxlint` 已装但未接入 CI）。

## 参考

- `packages/test-utils/fake-bmap-v4/diagnostics.ts`（诊断口径的单一事实源）
- `packages/test-utils/fake-bmap-v4/runtime-extensions.ts`（运行时注入成员的可控开关）
- `packages/test-utils/driver-matrix.ts`（双跑形态与引擎差异的收口点）
- `packages/test-utils/driver-contract.ts`（共享契约；本 issue 补的是它在 v4 上的消费者）
- `tests/behavior/v4-driver-contract.test.ts`、`tests/behavior/v4-fake-async-lifecycle.test.ts`、
  `tests/behavior/v3-dual-driver-components.test.ts`
- issue #24（`M3A3-01` 诊断 / `M3A3-02` 双跑矩阵）、issue #12（路线图）、
  issue #25 / #26（M3A.3 的后续）、issue #32（BInfoWindow 重构）、issue #38（Service 生命周期）
