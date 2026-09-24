# AGENTS.md

## 项目

`bmap-vue`：Vue 3 的百度地图组件/hooks 库。

工程：pnpm workspace（Node >= 24，pnpm >= 12），Vite + vue-tsc + Vitest + VitePress。

## 版本模型

| 维度 | 说明 |
| --- | --- |
| 组件库版本 | `packages/bmap-vue/package.json` |
| SDK engine（内部） | `jsapi-v4`（唯一；旧引擎 `webgl-v1` / `jsapi-v3` 已在 #26 删除） |
| SDK version | `4.0`（`v=4.0`） |

讨论「升级」时需说明是哪一种版本。

## 架构与模块分布

组件库源码在 `packages/bmap-vue/src`，顶层模块：

- `driver`：raw SDK 边界与 Facet Driver。
- `client`：`createBMapClient`，聚合 Driver 与运行时能力。
- `core`：loader/provider、context、lifecycle、runtime、events、errors 等底座。
- `core/services`：**框架无关**的服务层底座（状态口径 `BMapServiceStatus`、请求序列守卫
  `createRequestGuard`、顺序批处理 `runSequential`、归一化调用面的收窄点 `jsapiV4ServicesOf`）。
  任务内核是 `core/services/serviceTaskCore.ts`（**框架无关**，只有状态口径：能力门 / 实例缓存 /
  只读状态 / 过期保护），实例所有权交给 `core/services/instanceChannel.ts` 的两种通道。
  Vue 侧的绑定是 `composables/serviceTask.ts`，分两档（#139）：
  **简单档** `useSimpleServiceTask`（7 个 composable：`useGeocoder` / `useGeocodeDetail` /
  `useConvertor` / `useAreaBoundary` / `useGeolocation` / `useIpLocation` / `usePanoramaService`
  —— 官方**没有**实例销毁入口，走**无状态**通道，**不暴露** `invalidateService`）与
  **独占档** `useExclusiveServiceTask`（`useLocalSearch` + 四个路线 composable ——
  官方**有** `disposeLocalSearch` / `disposeRoute`，走有状态通道 + `invalidateService`）。
  **分档判据是「该服务的 SDK 实例有没有公开的释放入口」**，不是「哪个服务看起来复杂」。
  名单**统一按 composable 名字**列（不要混用 SDK service 类名，`useIpLocation` 背后才是官方
  `BMap.LocalCity`，`useGeocodeDetail` 与 `useGeocoder` 共用 `service.geocoder` 能力）——判据要能
  被逐个核对，混层会让审计判据本身变得困难。完整名单与逐条依据见
  `src/core/services/instanceChannel.ts` 文件头。
  两档共用同一个内核，**不要**再各写一套 Promise + 定时器；任务内核一律**不**进公共出口。
- `components`、`composables`：面向使用者的 Vue 组件与 hooks。
- `plugins`、`resolver`、`advanced`：插件适配、按需解析、raw SDK 逃生口。
- `integrations`：对接**官方包**的薄封装（当前只有 `integrations/ui-kit` → `./ui-kit` 子入口）。
- `types`、`manifest`：公共类型与组件清单。

约定：`BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK 与最小类型边界；组件/composable/runtime 只依赖项目领域类型与 Facet Driver，不得直接访问全局 SDK。所有监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF 与动画都必须有释放路径。

**服务层的两条硬约束**（ADR `2026-09-14-service-lifecycle-and-local-search`）：

- service composable **不得**读 `handle.raw`：调用一律走 Driver 的归一化调用面（`driver.services.geocode()`
  等，返回 `ServiceCall<ServiceResult<T>>`），网络语义（超时 / 空结果 / 迟到回调 / 先到者胜）只在
  `driver/normalize/serviceCall.ts` 一处实现；拿调用面必须经 `core/services` 的 `jsapiV4ServicesOf()`
  收窄（可运行时检查），**不要**无条件 `as JsapiV4ServiceDriver`。
- 服务结果的状态口径（`idle`/`loading`/`success`/`empty`/`failed`/`timeout`/`canceled`/`unsupported`）
  只在 `core/services/serviceStatus.ts` 定义：`empty` = 没有结果**或**服务当前不可用（官方没有公开原因），
  `unsupported` = 当前引擎没有该能力且**没有发起任何请求**；「请求发了但结果不好」是 `failed`。
  两者的区分是调用方能不能「重试」的依据，不要合并。
- **回调归属不许按到达顺序猜**：官方对 JSONP 风格的服务只承诺「单次调用内部的顺序」，**没有**承诺
  多次请求之间的回调顺序（`LocalSearch` 的 4.0.4 声明里也没有）。因此归属只能靠**可验证的身份**：
  `LocalSearch` 用「**一个实例一个未结算操作**」+ 调用方侧「取代即换新实例」（独占档的实例通道）
  的 `supersede` 策略）。没有身份可依据时**不建推断层**：`Autocomplete` 因此**没有**归一化调用面
  （#104 删掉了按 keyword/FIFO 猜回包的 `suggest()`），构造时传 `onSearchComplete` 原样转发，
  「这条结果属于哪次输入」由持有输入框的一方判断。
- **Ownership-first / Evidence-before-abstraction（#104）**：上游没有公开的 request identity 时，
  顺序是「收窄并发或所有权 → 实例隔离 / supersede 重建 → 最终状态 reconcile」，**最后**才考虑
  FIFO / 计数 / 时间 / 事件邻接，且不凭「通常按这个顺序到达」建立 Stable 契约。不镜像读不回的 SDK
  内部状态（视角动画只观察公开事件，暂停/继续只有私有成员 ⇒ 不提供）。未知运行时行为先 probe 再建
  抽象；判据退化成常量、没有消费者或官方已提供的抽象一律删除，不留「以后可能有用」的扩展面。
  存量审计表见 `docs/zh-CN/contributing/architecture-ownership-audit.md`。

`integrations/**` 与 `components` / `composables` 同属禁区（不在 raw SDK 白名单内）：它只能经
`MapHandle`（`unwrapRaw()`）与 Facet Driver 与引擎交互。`./ui-kit` 另有两条硬约束，见
ADR `2026-09-13-ui-kit-subpath-and-type-boundary`：根入口不重导出 UI、也不静态引入
`@baidumap/jsapi-ui-kit`（它是 optional peer，且 import 即碰 `document`）；公共类型自持，
构建期经 `tsconfig.build.json` 的 `paths` 把该 specifier 映射到占位文件（上游声明自身不可消费）。

## SDK 边界与门禁

边界配置的单一事实源：`scripts/raw-sdk-boundary.mts`（白名单 + 命名空间/全局对象清单 +
旧引擎残留的 engine 取值清单）；检测引擎：`scripts/raw-sdk-detector.mts`（边界规则与
旧引擎残留两个规则集，源码门禁与公共声明门禁共用）；文件收集与 SFC 解析层：
`scripts/source-scan.mts`。三条命令（`check:raw-sdk` / `check:raw-sdk:tree` /
`check:raw-sdk:declarations`）是**同一个**门禁脚本的三种模式。

raw SDK 白名单（相对 `packages/bmap-vue/src`）：`driver/**`、`client/**`、`core/loader/**`、`plugins/**`；
`packages/test-utils` 作为 Fake 边界在扫描范围之外。其余目录（`components`、`composables`、`core/runtime` 等）为禁区。

`BMapGL`（旧引擎命名空间）自 #26 起**整棵运行时源码与公共声明都不允许出现**——它与白名单
无关，所以 `check:raw-sdk:tree` 对白名单目录也跑这条规则（#136 起并入 `check:raw-sdk`，
原先那个独立的 `check:no-bmapgl` 门禁已删除）。官方插件命名空间 `BMapGLLib` 与官方 4.0 runtime
自己挂的别名不受影响。

| 命令 | 作用 |
| --- | --- |
| `pnpm check:raw-sdk` | 禁区目录静态扫描（`window.BMap`、`new BMap.*`、`BMap.*` 类型、`namespace BMap`、官方类型包导入） |
| `pnpm check:raw-sdk:tree` | 扫描整棵 `src`：非白名单路径跑全套边界规则，白名单路径只跑旧引擎残留规则（`BMapGL` / `"webgl-v1"` / `"jsapi-v3"`） |
| `pnpm check:raw-sdk:declarations` | `dist/**/*.d.ts` 的旧引擎残留不变量（需先 `pnpm build:package`；`check:public-dts` 不管 engine 取值） |
| `pnpm check:public-dts` | `dist/**/*.d.ts` 不得泄漏 `BMap.*` / `BMapGL` / 官方类型包引用（需先 `pnpm build:package`） |
| `pnpm generate:capability-matrix:check` | Capability Catalog 能力矩阵无漂移 |
| `pnpm generate:api-diff:check` | 公开 API 对照表（vs 官方 React 参考）无漂移 |
| `pnpm generate:overlay-emits:check` | 覆盖物 `defineEmits` 静态契约（`core/overlays/overlayEventEmits.generated.ts`）无漂移 |

类型边界 augmentation 位于 `src/driver/jsapi-v4/augmentations/`，治理规则与元数据模板见该目录 `README.md`；
每个文件必须带 `@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` 元数据，禁止 `any`。

Capability Catalog 是能力清单的单一事实源（`src/driver/capability/catalog.ts`），
覆盖 Map / Overlay / Layer / Service / Panorama，用 `status`（`native` / `extended` / `experimental` / `unsupported`）与 `runtimeOnly` 表达能力语义；
能力矩阵由 `pnpm generate:capability-matrix` 生成，禁止手工编辑。

覆盖物的事件**静态声明**同样是生成物（`src/core/overlays/overlayEventEmits.generated.ts`），
事实源四处：`core/overlays/overlayEventCatalog.ts` 的矩阵、`core/deprecations/aliases.ts` 的事件别名表，
以及 `scripts/generate-overlay-emits.mts` 内的非 SDK 事件表（附**派发点**，逐条回源码核对）
与显式排除表（矩阵里有、但本库无派发点的键）。SFC 一律 `defineEmits<MarkerEmits>()` 消费它，
**禁止**在组件里手抄键名——`@vue/compiler-sfc` 解析不了 mapped type，键名只能由生成器写死一次。

## Official-first 约束

**官方已经提供的能力一律不自研。** 决策与全部依据见 ADR `2026-09-13-official-first-loader-and-ui-kit`，
锁定的发布契约见 `docs/zh-CN/contributing/official-packages.md`。

| 场景 | 必须走 | 禁止 |
| --- | --- | --- |
| 默认在线加载 JSAPI | 官方 `@baidumap/jsapi-loader`（精确锁定 `1.0.0`） | 默认路径自研 JSONP transport / 自拼入口 URL / 自管回调；官方失败时静默回退自研 |
| 非标准入口 / 企业自托管 / 宿主已加载 | 显式 `customScriptV4Provider` / `existingGlobalV4Provider`（自研 `ScriptLoader` 只服务这两条路径） | 把高级路径写成默认，或为「省事」复用它的实现 |
| 标准 UI（建议、结果列表、翻页、键盘导航、详情面板、路线面板、主题） | 官方 `@baidumap/jsapi-ui-kit`（精确锁定 `1.1.2`，optional peer） | 自研标准 UI；复制官方 UI 的内部 DOM / 交互算法；UI 与 headless 同时发同一份请求 |
| 上游没有的能力 | 按 Capability Catalog 标 `unsupported` / `unverified` | 访问 `_rd` 回调表、`qt=` 私有请求码、`getSeckeyAndSign` 等私有面来「补齐」 |

生命周期与共享状态（**没有任何组件有权处置**）：

- 不要调用官方 `reset()`（它会删进程级 `window.BMap` / `BMapGL`），只允许出现在测试与热更新；
- 不要删除 / 改写上游注入的 SDK `<script>`、回调全局或 namespace；
- **组件取消等待** = 解绑消费者 + 丢弃回包；**不等于**终止上游加载。官方没有公开取消接口，
  全部消费者取消后**保留**底层在飞任务，且不得为后续请求另插重复 script；
- 上游**没有**的脚本属性（`nonce` / `integrity` / `crossOrigin` / `referrerPolicy`）必须明确报错或
  指引外部预加载，**接收后忽略属于假支持**；
- `timeout` 与上面不同：它是**官方支持**的参数，只是语义需要显式映射——`0` = **不超时**（不是「默认超时」）。
  契约里关于 `timeout` 的语义以 ADR / 契约表为准，不要把它归进「不支持项」；
- UI Kit 在无 DOM 环境 **import 即失败**（无 `exports` 字段，`main` 指向 IIFE）：`./ui-kit` 与其 Vue 封装
  只能动态 import，不得进入根入口或任何 SSR 可达的模块图；
- 泄漏门禁按**来源**归因：真实 SDK 与百度统计脚本也会往 `document` 上挂监听且不释放，
  只数「净增 / 归零」会得到假红或假绿。

## 测试基建（`packages/test-utils`）

Fake SDK 在 raw SDK 扫描范围之外，是「组件/Facet 与 SDK 之间」的替身边界。两条约定：

- **诊断分两个口径**：`fake.diagnostics.snapshot()` 返回 `leaks`（当前**未释放**的资源，门槛值恒为 0，`assertNoLeaks()` 逐项点名）与 `activity`（累计发生过什么，不要求归零）。定时器与回调是「在飞」而非「未释放」，**只进 `activity` 与 `pendingAsync()`**——需要断言「没有在飞窗口」时要显式写出来。新增资源种类必须同时登记进 `LeakCounters` 与 `LEAK_FIELD_BY_KIND`（后者穷尽，漏登记会编译失败），并选对销账方式：`map` / `panorama` / `autocomplete` 是**生命周期类**（按实例销账，重复销毁同一个实例不能抵消别的实例的泄漏），其余是**挂载类**（按次数销账，因为 SDK 不去重、挂两次就要摘两次）。
- **单一引擎的组件级场景用 Fake v4 harness**：`packages/test-utils/fake-v4-harness.ts` 提供 `createFakeV4Harness()`（结构化 Provider / 带尺寸容器 / 基线重置 / 泄漏门禁 / 逐族读数）与 `createFakeV4Client()`（走**默认路径**装 Client：Provider 归一 → `assertLoadedSdk` → 默认 Driver 工厂 → 组装）。组件级场景写在 `tests/behavior/component-scenarios.test.ts`，用例只写领域语言（`harness.attached('overlay')` / `harness.assertIdle()`），不碰字段名。
