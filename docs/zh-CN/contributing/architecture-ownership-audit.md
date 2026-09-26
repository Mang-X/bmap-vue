# Ownership-first / Evidence-first 存量审计表

本页记录本库对**已落地实现**做的所有权与证据审计：每个机制是否真有消费者、它的状态站在哪一档
证据上、以及结论是保留（`KEEP`）、收窄（`SIMPLIFY`）还是删除（`REMOVE`）。

审计对象是已发布的实现，不预设它们有问题。每行给出「机制 / 消费者 / 证据 / 结论 / 现状」。

## 为什么要有这张表

上游的 JSONP 风格服务只承诺「单次调用内部的顺序」，**没有**承诺多次请求之间的回调顺序。
因此一条机制能不能进公共契约，取决于它站在哪一档证据上，而不是它看起来是否合理。

顺序是「收窄并发或所有权 → 实例隔离 / 取代即换新 → 最终状态 reconcile」，**最后**才考虑
FIFO / 计数 / 时间 / 事件邻接，且不凭「通常按这个顺序到达」建立 Stable 契约。理由见仓库根的
`AGENTS.md`（Ownership-first / Evidence-before-abstraction 一节）。

## 证据口径

一条结论能不能成为 Stable 契约，只看它站在哪一档证据上：

| 档 | 含义 | 能否支撑 Stable 契约 |
| --- | --- | --- |
| `OFFICIAL` | 官方声明（`@baidumap/jsapi-v4-types@4.0.4`）或官方包行为 | 能 |
| `PROBED` | 仓库里有一次性真实运行时取证（`scripts/probe-*.mts` / `smoke:v4` + 已提交读数） | 能，但要写清取证范围 |
| `OWNED` | 状态由本库自己写入、自己读回（generation / epoch / scope / Registry 记账） | 能（不依赖上游） |
| `ASSUMED` | 对上游行为的推断，没有声明也没有取证 | **不能**，只能作为防御 |
| `FAKE-ONLY` | 只有测试替身演示得出来 | **绝对不能**——这是本表最常见的错处 |

结论三档：**KEEP**（真实消费者 + 站得住的证据）、**SIMPLIFY**（需求真实，但可以用收窄所有权 /
reconcile 少存状态）、**REMOVE**（无消费者、由已推翻前提产生、或官方已提供）。

---

## 1. 回调归属与请求身份

| 机制 | 位置 | 消费者 | 证据 | 结论 | 现状 |
| --- | --- | --- | --- | --- | --- |
| `suggest()` 的程序化归属层：`pendingSuggest` 队列 + 同关键词互斥 + FIFO 退化 + 「通道独占」前置条件 | `driver/jsapi-v4/services.ts` | **生产 0**。只有自身单测与 `facet-probes` 探针；`<Autocomplete>` 渲染可输入输入框、结构上不可能是消费者 | `FAKE-ONLY`：顺序来自 Fake 回调队列发明的微任务 FIFO，关键字来自 `includeKeyword` 发明的回填 | **REMOVE** | 整段已删除。`Autocomplete` **不进归一化调用面**，构造时传 `onSearchComplete` 原样转发；`PlaceSuggestion` 类型与 `ServiceInvocationDriver.suggest` 一并从出口摘掉；`service.autocomplete` 由 `experimental` 回到 `native`（它唯一的降级理由就是这条假设） |
| `LocalSearch` 的「一个实例同一时刻最多一个未结算操作」 | `driver/jsapi-v4/services.ts` 的 `invokeSlotOperation` | 7 个 service composable + 组件 | `OWNED`：身份是**实例自己**，不需要按到达顺序猜 | **KEEP** | — |
| 实例通道的 `supersede`（取代即换新实例） | `core/services/instanceChannel.ts`（**独占档**） | LocalSearch + 四个路线服务 | `OWNED`：依据是「该服务的 SDK 实例**有**公开释放入口」，且取消 / 超时后旧实例上可能有无法区分的回包 | **KEEP（收窄到独占档）** | 7 个官方无销毁入口的简单服务改走**无状态**共享通道，`supersede` / `refuse` / 待释放队列在它们身上是恒空状态，已从那个面上结构性移除 |
| 超时 / 空结果 / 迟到回调 / 先到者胜 | `driver/normalize/serviceCall.ts`（单一实现点） | 全部归一化调用 | `OWNED` + `OFFICIAL` | **KEEP** | — |
| 两引擎共用的空/失败嗅探（`normalize/jsonpProbe.ts`） | — | — | — | 已消失 | 随单引擎收敛时删除；记录在案，避免再找这个模块 |

## 2. 状态镜像与动画

| 机制 | 位置 | 消费者 | 证据 | 结论 | 现状 |
| --- | --- | --- | --- | --- | --- |
| `useViewAnimation` 的 `stop()` / `proceed()` → `handle.raw._pause` / `_continue` / `_cancel` | `composables/useViewAnimation.ts` | 只有文档页与示例引用 | 官方 4.0.4 **没有**声明这三个成员 ⇒ 私有面 | **REMOVE** | 收窄为 `start(keyFrames)` / `cancel()` / `status` / `ready`。静态门禁抓不到 `handle.raw.*`（`check:raw-sdk` 只匹配 `Map`/`BMapGL` 标识符），所以这条靠审计而不是靠 gate |
| 同 hooks 的 `viewAnimation` 句柄 ref + `setKeyFrames` 两段式 + `disableDragging` | 同上 | 只有文档 | 句柄每次 `start()` 都被换掉、`disableDragging` 从未生效 ⇒ 退化成常量 | **REMOVE** | 一并删除；`status` 改成**观察值**（`idle` / `playing`），命令不乐观改写它 —— 唯一例外是本库对自己那次取消的交付确认（形状见下面两行） |
| MapDriver 的视角动画 teardown：`AnimationRecord{started,settled,cancelRequested}` + `Teardown{disposed,disposing,tornDown,released,deferredFinish,fallbackTimer}` | `driver/jsapi-v4/map.ts` | `MapDriver.destroy` / `startViewAnimation`，约 20 条行为用例 | 记账对象是**我们自己**发起的启动/取消/销毁次序 ⇒ `OWNED`，合法；其前提「`animationstart` 在内部控制器构造前派发、启动前 `cancelViewAnimation` 抛 `TypeError`」原为 `FAKE-ONLY`，已由真实 AK 读数升级为 `PROBED`（见下方 F-1） | **KEEP（证据已补）** | 保留（它不恢复 SDK 的因果身份）。口径仍不得升级为「对外的时序承诺」：那两条前提是**官方行为**，官方可以改，gate 就是用来在它改的时候变红的（live gate `view-animation-cancel-window`） |
| 同一处前提在 hooks 侧的两处**残留用法**：① 被取代那一段的三条监听只由该段的 `animationcancel` 释放；② `cancel()` 发的是**整张图**的 `stopViewAnimation(map)` | `composables/useViewAnimation.ts`（`AnimationRun` / `start` / `stopRun`）＋ `driver/jsapi-v4/map.ts` 的动画记录 | 该 hook 自己（`EventDriver.groups` 是强引用 Map，未释放即泄漏）；以及跨 hooks：同一张图上另一个 `useViewAnimation` 的在飞段 | 两处都依赖同一条 `FAKE-ONLY` 时序。②最要命：`stopViewAnimation` 的范围是整张图，于是**「保留重试入口」与「不牵连别人的动画」互斥** —— 实测把 `cancelCommitted` guard 去掉即红，确认两条不能同时满足 | **SIMPLIFY** | 取消换成官方本来就有的**按实例**命令：`MapDriver` 的 `cancelViewAnimation(map, animation)` 在 v4 实现上只挑该实例那一条记录、复用 `cancelAnimation`，并返回本库侧的交付状态 `canceled / deferred / already-settled`。hooks 据此把三件事分开：**当前观察对象**（`current`）、**取消是否仍需重试**（`undelivered`）、**每段自己的监听**（交付即释放）：`deferred` 保留重试入口，已交付则幂等收尾且不补发命令（补发要假设 `cancelViewAnimation` 幂等——**未证**）。回归：`useViewAnimation.test.ts` 的「取消失败时保留重试入口」「deferred 与已交付的取消走不同的收尾」「收尾按动画身份收敛」三节，加 Facet 侧 `map.test.ts` 的「只碰传入的那个实例」。**公开的语义不建立在『接管时旧段监听恰好已释放』这个时机上**：接管那一支按**交付状态**分岔 —— 已交付当场释放旧段监听，未交付则把监听留着、旧段进 `undelivered`，由后续 `cancel()` 与卸载继续推到终态；两条路都由 `finishRun` 的身份守卫挡住旧段清掉新段的 `playing`。一次公开 `cancel()` 里**每段只尝试一次**（快照按 `Set` 去重）。整图命令 `MapDriver.stopViewAnimation(map)` 已**删除**（零生产消费者、且与按实例所有权直接冲突），`cancelAllAnimations` 因此只剩起播前清场 / 销毁两个本库自己的整图动作 |
| `useBMapTrackAnimation` 的插件状态机（`INITIAL` / `PLAYING` / `STOPPING` / …） | 原 `composables/useBMapTrackAnimation.ts` | **生产 0**：v4 上 `createTrackAnimation()` 必抛 `BMAP_CAPABILITY_UNSUPPORTED` | 状态机的全部可达分支 = 一条失败分支 ⇒ 退化成常量 | **REMOVE** | hook、文档页、示例、行为用例全部删除；轨迹走原生图层 `track-line`，插件侧结论见[插件兼容 inventory](./plugin-compat-inventory)。参考实现 `huiyan-fe/react-bmap`（236 个 TS 文件）没有任何 TrackAnimation 抽象 | <!-- brand-gate:allow 存量审计表逐行记录被判定 REMOVE 的对象，旧名本身就是该行的判据 -->
| suspension reason 集（`user` / `keepAlive` / `document` / `offscreen` / `disposed`）、boot 单飞 + `deferredWaiters` + 0ms 活性兜底、`tileLoadObserver` 的两本账 | `core/runtime/suspension.ts`、`components/map/Map.vue`、`components/layers/tileLoadObserver.ts` | 生产，组件生命周期 | `OWNED`；`tileLoadObserver` 另有 `PROBED`（`scripts/probe-layer-events.mts` 三臂对照 `12 / 0 / 12`） | **KEEP** | 反面样板：`tileLoadObserver` 明确**拒绝**做瓦片回包归属，只记所有权 |

## 3. Loader / Provider / SDK Registry

| 机制 | 位置 | 消费者 | 证据 | 结论 | 现状 |
| --- | --- | --- | --- | --- | --- |
| 自研 `ScriptLoader`（script/jsonp transport + 在飞/已完成缓存） | `core/loader/ScriptLoader.ts` | 只有 `customScriptV4Provider`（显式高级路径）；`default-loader-boundary` 证明默认路径不碰它 | `OFFICIAL` 缺口（官方 loader 不支持非标准入口） | **KEEP** | 默认路径走官方 loader |
| `SharedLoadTask` 的进程级 `callbackRegistry` + 全局名占用 / foreign 回调捕获 | `core/loader/SharedLoadTask.ts` | 高级 jsonp 分支 | `ASSUMED` → **已取证（`PROBED`）**：`callback=<名>` 契约（就绪控件 `readyAtCall`：首次 callback 当下同步采样，Map/Point/Marker 齐全口径）、foreign 捕获与释放、官方新增全局 三组读数见 `tests/behavior/fixtures/probe-jsonp-callback.live.json`；probe + 判定层 + 三态用例已落地（`pnpm probe:jsonp-callback`） | **KEEP（证据已补）** | 唯一保留的「恢复上游未公开身份」处：它服务的是**显式高级路径**，且**不**进 Stable 承诺。guarantee 措辞写在 `SharedLoadTask.ts` 模块头（本库保证 install/release 可靠 vs 官方行为可改）；**可回归 gate** = `probe-jsonp-callback-verdicts.test.ts` 的 COMPLETE ↔ live fixture 一致性 + `ScriptLoader.test.ts` 的 foreign 单测（`OWNED` 侧） |
| `SdkRegistry` 的 `conflictPolicy: "warn" \| "ignore"` + `onConflict` | `core/loader/SdkRegistry.ts` | 三个 Provider 一律不传 ⇒ 只有单测可达 | 无消费者的分支 | **REMOVE** | 两个选项、`SdkConflictPolicy` / `SdkConflictInfo` 类型与 `policy` getter 一并删除，冲突处置收成唯一行为（恒 reject `BMAP_SDK_CONFIG_CONFLICT`）。同一批把 `resetProcessSdkRegistryForTests` 从 `./core` 出口摘掉（测试辅助不进公共声明面）——`resetGlobalCallbackRegistryForTests` 此前就没在出口上 |
| `SdkRegistry.cancellable`（官方 loader 不可取消 vs 自研可取消） | `core/loader/SdkRegistry.ts` 的 `SdkRegistryLoadRequest` | 三条 Provider 路径 | `OFFICIAL` | **KEEP** | — |
| `createBaiduSdkUrl()`（旧 CDN 入口拼装） | 原 `core/loader/url.ts` | **生产 0**，但挂在 `./core` 出口上、被边界测试直接调用 | 迁移期遗留 | **REMOVE** | 函数与其私有选项类型一并删除；`default-loader-boundary` 改成**存在性否定**门禁（默认静态模块图里搜不到这个名字，同时正面证明 `core/loader/url.ts` 确实在图中） |
| `providers/official.ts` 的 `OFFICIAL_LOADER_UNSUPPORTED_KEYS` 显式报错 | `providers/official.ts` | 默认路径 | `OFFICIAL`（官方选项面） | **KEEP** | 「接收后忽略 = 假支持」的守卫本身，不是镜像 |
| `markRejectedJsapiV4Global` / `isRejectedJsapiV4Global`（WeakSet 标记自家被拒残留） | `providers/namespace.ts` | 写入 `providers/load.ts`，读取 `providers/reuse.ts` | `OWNED`（跟的是我们自己的写） | **KEEP** | — |
| `LoadedSdk = LoadedJsapiV4` 单成员别名；`client.version` 的 `@deprecated` 别名 | `core/loader/loaded.ts`、`client/types.ts` | 类型层 | 单引擎收口后失去意义 | **REMOVE** | `client.version` 别名与其赋值、断言一并删除，`BMapClient` 只按语义分列 `libraryVersion` / `sdkVersion`。`LoadedSdk` 单成员别名随后也删除——公共面只保留 `LoadedJsapiV4` 这个名字 |

## 4. MapRuntime / 生命周期

| 机制 | 位置 | 消费者 | 证据 | 结论 | 现状 |
| --- | --- | --- | --- | --- | --- |
| 六条资源路径的 generation / epoch stale guard、`PluginHost.epochNumber`、`PluginRegistry.record.generation` | `core/composables/*`、`core/plugins/*` | 生产 | `OWNED`：比较的是「这还是我创建的那个实例/作用域吗」，**不**归属 SDK 回包 | **KEEP** | 不因「看着复杂」删掉真实所有权机制 |
| `ResourceScope` 的六个定时器别名（`requestAnimationFrame`+`frame`、`setTimeout`+`timeout`、`setInterval`+`interval`）与 `addCancellable` | 原 `core/lifecycle/ResourceScope.ts` | **生产 0**（只有同名测试在用） | 与 `core/scheduler/FrameScheduler` 重复的转发面，且两套语义还不一致（`setTimeout` 返回裸 id、`timeout` 返回 disposer） | **REMOVE** | 已删。随之一起消失的还有 `onDisposeError` / `parentSignal` 两条构造选项（同样生产 0 消费者）——但**它们承载的行为没丢**：容错改为断言 `logger.warn` 通道、「父释放 ⇒ 子释放」由 `fork()` 的 disposer 链路继续保证并补了一条「父已释放时 `fork()` 的子**同步**被释放」。`ResourceScope` 由此收成**最小外部资源内核**（`add` / `fork` / `signal` / `size` / `label` / `isDisposed` / `dispose`），`run()` 与内嵌 `effectScope` 一并删除——Vue 的 effect 生命周期交回 Vue |
| `useResourceScope.ts` | 原 `core/lifecycle/useResourceScope.ts` | **0**（只有两行出口） | — | **REMOVE** | 文件与两处出口删除 |
| `MapRuntimeOptions.clientFactory`（与 `clientContext` 二选一） | `core/runtime/MapRuntime.ts` | 只有 3 个测试文件 | 无生产消费者的第二条臂 | **SIMPLIFY** | 第二条臂删除，实现与夹具收敛到 `clientContext`；`MapRuntimeOptions` 随 `./core` 取消只在内部 barrel 上 |
| `MapRuntimeStatus` 的 `"loading"` 别名 | `core/context/types.ts` | 类型层，运行期不再写 | `OWNED` 但已过时 | **SIMPLIFY** | 别名类型删除，唯一名字是 `MapStatus`；文档里也不再把 `loading` 写成会发出的状态 |
| `mountMap()` 的前置检查 | `components/map/Map.vue` | `ensureUsableRecheck` 的每帧复查 + `onContainerReady` | **已取证**：`ensureUsableRecheck` 每帧调 `mountMap()`，容器仍 0×0 时少了这句就会 `startBoot()` | **KEEP** | 保留并配一条能翻红的用例（「挂起的 retry 期间每帧复查不得启动 boot」——删掉该句实测变红）。它拦的不是「0×0 建图」（那由 `waitForUsableContainer()` 兜底），而是「启动一次注定被拦的 boot」：失败态下状态从 `error` 被推进到 `creating`，`#error` 插槽连同它的重试按钮被 `#loading` 顶掉，业务「重试一次」的入口凭空消失，而这次重试其实一条命令都没发出去 |
| `PanoramaStatus` 七态（运行期只有 `error` 被内部读） | `core/panorama/index.ts` | `Panorama.vue` 公开 expose + 文档页列全 | `OWNED` + 已文档化 | **KEEP** | 外部消费者无法自证为零，故不删 |
| 启动 / 重试状态机（`mountStarted` / `bootTask` / `nextBootWaiters` / `deferredWaiters` / `containerUsableWaiters` / `assembledMap` / `whenMapCreated`） | `components/map/Map.vue`、`core/runtime/MapRuntime.ts` | 组件挂载 / `@error` 重试 / 容器放行 / 建图等待点 | `OWNED`：记的是**本库自己**发起的建图 / 重试 / 放行次序；每个符号都有行为用例钉住外部后果。**不是** `PROBED` —— 按本表「证据口径」，`PROBED` 要求真实运行时读数，这里只有测试替身场景 | **KEEP** | 逐符号复核的结论：这一组记的是**外部资源状态**（WebGL 句柄、0×0 容器、KeepAlive 下 `onUnmounted` 不触发），对手方是 SDK 与浏览器而非 Vue 组件树 ⇒ Vue 生命周期覆盖不到。能自然表达的那半**已经是** Vue-native（`onActivated`/`onDeactivated` 直接驱动 `keep-alive` 原因，容器 watcher 直接驱动放行），不存在「Vue 已有 watcher 又并排建一套状态机」的重叠 |
| `<Map>` 四个视野字段的受控接线（`centerState` / `zoomState` / `headingState` / `tiltState`） | `components/map/Map.vue` | 组件自身 | `OWNED`；父↔子那一腿是 `value: () => props.center`（对 props 的 getter）+ 普通 `emit`，即 `v-model` 的展开形态 | **KEEP** | 「Vue owns Vue state」在**接线**上已成立，没有第二套父↔子状态机。对照实测表明 Vue 的 `useModel` 表达不了冻结的「受控 → 非受控保留最后一次外部值」，也没有 `default*` 只读一次 / 容差相等 / `copy` / `reset` ⇒ 保留 `useControllableState` 作为通用原语，`<Map>` 接线不动 |
| `isControlled`（`ControllableState` 返回值之一） | `composables/useControllableState.ts` | **生产 0**（`<Map>` 用即时的 `value() !== undefined`） | 零消费者 —— 按 `AGENTS.md` 本应删；但它挂在**已发布的公共 composable** 的返回类型上，属冻结契约 | **KEEP（惰性）+ 标注** | 处置是**改成惰性创建**（`get` 取用时才建），公共返回类型一字未改，`<Map>` 零消费者路径上**不再分配**。⚠️ effect 计数看不见这一类对象（`computed` 不计入 `getCurrentScope().effects.length`），所以用例直接数分配次数 |
| 告警去重 `Set`（`warned`） | `composables/useControllableState.ts` | **生产 0**（无告警时不建） | 唯一作用是「某条告警真的发生后记住 key」；正常生命周期里既无档位冲突也无 `default*` 后续写入 ⇒ 从创建到销毁一次都不会被碰。`<Map>` 四个视野字段＝每次实例化白扔 4 个 Set | **KEEP（惰性）** | 改为 `warnOnce` 里 `??= new Set()`。**告警行为是冻结的，不等于去重容器必须在构造期分配**。⚠️ 用例不能只断言「告警次数」——eager 版次数完全一样；且 `vi.spyOn(globalThis,'Set')` 必须在其它 spy **之后**建立再取基线（`vi.spyOn(console,'warn')` 自身会分配 `Set`） |
| `defaultValue` 的 dev 告警 watcher | `composables/useControllableState.ts` | **生产 0**（`warn && isDev()` 才注册） | `<Map>` 四个视野字段**始终**传 `defaultValue` ⇒ 每次实例化恒定 4 个 `ReactiveEffect`，唯一用途是将来给一条 dev warning。`warn:false` 或 production 下永不产生任何可观察输出 | **KEEP（按条件注册）** | `warnOnce` 的短路必须放在**分配 Set 之前**；`isDev()` 与 `devWarn` **同源**避免两边分歧，判定仍保留 `process.env.NODE_ENV` 标记交消费方折叠。⚠️ `process.env?.NODE_ENV` 的 optional chaining **只保护 `env`、不保护裸标识符 `process`**，构建还会剥掉它 ⇒ 裸浏览器 `ReferenceError`；已补 `typeof process === "undefined" ||` 并用 `node:vm` 空沙箱钉成常驻用例 |
| 告警档位 `mode`（`"controlled" \| "uncontrolled"`） | `composables/useControllableState.ts` | **生产 0**（`warningsEnabled` 为假时是 `undefined`） | 唯一消费者是「受控 ↔ 非受控」那条 dev warning，**不参与** `value` / `internal` / 容差相等 / `reset()` / SDK reconcile。却是无条件初始化 + 无条件维护 | **KEEP（按条件存在且不维护）** | watcher 注册 / `warnOnce` 短路 / `mode` 本身**统一读 `warningsEnabled = warn && isDev()`**，且 `mode` 的两处读写一并 gate——只 gate 初始化不够，第一次 `syncExternal` 就会让它复活。可观察后果：每次外部同步少做一次**只为告警服务**的容差比较。⚠️ 用例有**两条**：① `value()` getter 调用次数（构造期），production / `warn:false` 为 1、development 为 2；② `equals` 调用次数（外部同步期间），production / `warn:false` 恒为 0、development 为 1（序列须走满「受控 → 非受控 → 受控」三步）——它既非 effect、也不改变任何可观察结果，行为断言与 effect 计数都分辨不出 |

## 5. Overlay / Layer / Control / Panorama 与 Capability Catalog

| 机制 | 位置 | 消费者 | 证据 | 结论 | 现状 |
| --- | --- | --- | --- | --- | --- |
| `LAYER_DESCRIPTORS` 的 `declared` / `signature` / `ctorSlots` / `mutable` / `bagSetters` + 约 10 条类型层断言（含**负向**断言：`district` 不得长出 `setZIndex`） | `driver/jsapi-v4/layers.ts` | 生产（`LayerSpec` → `useLayerResource`） | `OFFICIAL` | **KEEP** | 正面样板：读不回就**拒绝**，不猜 |
| `native-layers.ts`：实测扩展图层**确实**继承了 `setVisible/setOpacity/setZIndex`，但 `supports()` 仍答 unsupported | `driver/jsapi-v4/native-layers.ts` | 生产 | `PROBED` 且刻意不采纳 | **KEEP** | 与「用私有面补齐」相反的选择 |
| `engines` 维度 + `CapabilityReason: "engine-unsupported"` | `driver/capability/catalog.ts` | 单引擎后只剩「目录未收录」一条可达路径 | 已登记的退化 | **SIMPLIFY** | 按 Evidence-before-abstraction 判据选择**删列**：写不出会变红的用例 ⇒ 删掉 `CapabilityDescriptor.engines`（含 63 行赋值与 `JSAPI_V4` 常量）、判定链的恒真白名单分支、生成器的引擎列，并矩阵 / JSON 重生成（63 条能力不变）；`engine-unsupported` **改名** `unlisted-capability`（唯一可达路径=描述符缺失，名字与路径一致）。用例把「每条能力必须声明当前引擎」改成「描述符**没有** `engines` 属性」。引擎身份在 `CapabilityExplanation.engine` / `UnsupportedCapabilityError` 上保留（那里有消费者） |
| `runtime` 能力族四条（`resource-scope` / `capability-override` / `fake-sdk` / `async-task`） | `driver/capability/catalog.ts` | **没有任何** `supports()` / 组件 / 测试按 id 问过；只被「每个 family ≥1 条」这条断言养着 | 类别错误（拿自家模块冒充实测风险等级） | **REMOVE** | 删掉这一**族**——四条目录项、`CapabilityFamily` 联合里的 `"runtime"`、以及 `CAPABILITY_FAMILIES` 数组里的那一项；矩阵与 JSON 重生成，「每个 family ≥1 条」的循环随之变成五族。`CapabilityFamily` 类型与 `CAPABILITY_FAMILIES` 常量**本身保留**（`registry.ts` 的字段类型、`registry.test.ts` 在读）。`registry.ts` 的 `explain()` 里 `?? ("runtime" as CapabilityFamily)` 兜底改成 `CapabilityExplanation.family?` 留空：没有描述符就没有 family 可报，不编一个值（`does.not-exist` 这类未收录 id 是「目录未收录」这条拒绝路径的唯一入口） |
| `service.truck-route` 目录槽位 | `driver/capability/catalog.ts` | 只被当作 override/过滤用例的任意 id；本库明说「不做 TruckRoute」 | 为未实现功能留位 | **REMOVE** | 删除（用例改用真实存在的 id，例如 `overlay.mapvgl`） |
| `DataLayerManager.sync(items, getKey, itemVersion, force)` 的 `itemVersion` 形参 | 原 `core/data/DataLayerManager.ts` | 两个 data 组件都在传，但 `apply()` **从不读**它 | 无消费者的参数＝假支持；但类挂在 `./core` 公共出口上，外部调用方按位置传参时会把第 4 个实参错位成 `force` | **SIMPLIFY** | `sync(input: DataLayerSync)` 改成对象入参，`version` 真实生效（同引用 + 同版本 ⇒ 零 SDK 调用；版本变 ⇒ 重新读坐标逐项下发），四个位置参数留下的「谁也没表态」问题随之消失。组件的 `dataVersion` prop 依然成立，走的是同一套版本语义 |
| `useResolvedTarget`（含「找不到 TargetContext 就回落到 Map 的 add/remove」闭包）、`createStaticTarget`、`useOptionalTargetContext`、`useParentOverlayHandle` 里旧 `overlayContextKey` 那条读法 | 原 `core/context/target.ts` | 测试或 0（生产走 `useOverlaySpec` provide 的 `TargetContext`，旧臂在仓内不可达） | 为「可能有外部消费者」留的兼容面，且无任何文档承诺 | **REMOVE** | 三个出口与旧读法全删，`overlayContextKey` 这个 InjectionKey 也随最后一个读写点消失；最近 TargetContext / 晚就绪的行为由 `tests/behavior/overlay-spec.test.ts` 的 `TargetProbe` 继续钉住 |
| `optionKey()` 对 `stableKeyOf` 的一行转发 | `core/controls/optionKey.ts` | 生产 | 命名转发，无逻辑 | **SIMPLIFY** | 同文件的 `optionSnapshot` / `changedOptionKeys` 是真实修复，KEEP |
| `DataLayerOptions<Item>`（唯一成员 `minClusterSize` 全仓再无处出现，类也不接受该参数） | 原 `core/data/DataLayerManager.ts` | 0 | 幽灵字段 | **REMOVE** | — |
| InfoWindow `openOutstanding` / `closeOutstanding` / `explicitClosePair` 一族 | `core/overlays/*`、`InfoWindow.vue` | — | — | 非本表范围 | 按 ownership/reconcile 方向在 InfoWindow 自身的工作内纠正，本表只登记，避免以为还欠着 |

## 6. 无当前消费者的公共出口

| 出口 | 位置 | 消费者 | 结论 | 现状 |
| --- | --- | --- | --- | --- |
| `componentTypeNames` | 原 `src/resolver/index.ts` | 0（`componentManifest` 才是事实源） | **REMOVE** | 已删 |
| `defineCapabilityOverride` | 原 `src/advanced.ts` | 0（含 docs / apps / fixtures / scripts） | **REMOVE** | 已删 |
| `extractSdkEventNames` | 原 `core/events/EventBridge.ts` | 只有自身测试 | **REMOVE** | 已删 |
| `shouldFullReplace` | 原 `core/data/diffData.ts` | 只有自身测试 | **REMOVE** | 已删 |
| `useServiceTask`（经 `export * from "./composables"` 外泄） | 原 `src/index.ts` | 内部引擎（18 个文件），文档只字未提 | **REMOVE** | `export * from "./useServiceTask"` 整条摘除，12 个**服务** composable 的出口不受影响。任务内核改名为 `composables/serviceTask.ts`（两档），一律只作内部实现——`tests/behavior/v3-core-surface.test.ts` 已把这 7 个名字加进负向清单钉住 |
| `useMapResource` / `SdkResourceAdapter` / `UseMapResourceResult` | 原 `core/composables/useMapResource.ts`（`core/index.ts` 出口） | **生产 0**（只有它自己的单测） | **REMOVE** | 文件与单测删除、三处出口名一并摘掉。被同目录的 `useSdkResource` 取代 |
| `UseSdkResourceOptions`（经 `./core` 出口） | `core/index.ts` | 定义处 | **SIMPLIFY** | 随 `./core` 子入口取消而内部化，`UseUnifiedSdkResourceResult` 别名一并删除（`useSdkResource` 仍以 `UseSdkResourceResult` 从根入口导出）。如实登记的欠账：`UseSdkResourceOptions` 仍作为**未导出**的参数类型出现在 `dist/index.d.ts` 的 `useSdkResource` 签名里，消费方无法为它命名 ⇒ 它**不能**进「声明文本里不得出现」的负向名单，否则必然误报 |
| `Autocomplete` 里按结构化成员探测 `disposeAutocomplete` 的分支（`as { disposeAutocomplete?: … }`，探测失败即**静默不释放**） | 原 `components/autocomplete/Autocomplete.vue` 的 `disposeService()` | 0：单引擎之后 `BMapEngine` 只有 `jsapi-v4` 一个成员，分支永不成立 | **REMOVE** | 改成 `jsapiV4ServicesOf(client).disposeAutocomplete(instance)`——走**可运行时检查**的收窄点，而不是组件里另写一份 `as`。留着的代价不只是死代码：那条静默分支正好会跳过 Driver 侧的订阅记账 |

**`./core` 子入口已取消**：`package.json#exports` 去掉 `./core`，4 个有真实扩展消费者的 v4 Provider 值迁到
`./advanced`，其余留在内部 barrel。口径说明：某一时点读到过 113 个值导出，那是删掉 `useMapResource`
一族**之前**的数；4 迁出 + 101 留在内部。

## 7. Fake 建模反向成为生产契约

原则：**测试替身独有、真实 SDK 未验证的关键语义只能登记为「时序注入 / 防御模型」，不能反过来当证据。**

| Fake 建模 | 位置 | 生产是否依赖 | 结论 | 现状 |
| --- | --- | --- | --- | --- |
| Fake 回调队列的微任务 FIFO + `delay` + `flushOne(index)` | `fake-bmap-v4/async.ts` | 曾经是唯一「suggest 归属成立」的证据 | **KEEP 为测试工具**，禁止再用于认证任何跨请求顺序 | 归属层删除后其消费者只剩 LocalSearch 的实例身份路径；`flushOne` 的正当用途恰恰是**打乱**顺序 |
| `FakeV4Autocomplete.respond` / `.includeKeyword` / `AutocompleteResult.keyword` | `fake-bmap-v4/services.ts` | 生产已不读 `keyword` | **REMOVE** | 已删（留着就会有人重新按 keyword 建归属） |
| `FakeMap.destroy()` 幂等 | `fake-bmap-v4/FakeMap.ts` | 我们的 guard 保留 | `ASSUMED` ⇒ guard 可以留，**契约不能这么写** | `driver-contract.ts` 里那两处「dispose 幂等」的注释与两条用例标题不再声称「SDK 侧的移除对未挂载资源是 no-op」——那两条断言的判据是 `harness.attachedCount()`，也就是**夹具那一侧的假账本**，因此它既不是官方幂等性的证据，也不是生产库 Driver/Registry 记账的证据（另见 F-3） |
| 销毁期回调重入（`Autocomplete.onDispose` 等） | `fake-bmap-v4/services.ts` | Map / Panorama / service 三处 guard | `ASSUMED`（注释自己写的是「**可能**触发」） | **KEEP guard**，措辞保持「可能」，登记 **F-3** |
| `addEventListener` 按函数身份去重（原注释称「与官方一致」） | `fake-bmap-v4/event-target.ts` | 生产中立；只有泄漏门禁与活动计数按它算 | `FAKE-ONLY` | 按 reclassification（remove-first / probe-if-retained）收成**夹具记账**：它不属 1.0 当前 `./advanced` / SDK 生命周期契约 ⇒ **不 probe**。文件头改写为「夹具记账（F-4）」——两条语义声明为**本 Fake 的建模选择**，不是对官方 EventTarget 的断言；原「与官方一致」的 `FAKE-ONLY` 推断已删除。行为未变，期望数字仍按夹具口径 |
| Fake 刻意比官方宽松（不剔除未声明 setter） | `fake-bmap-v4/objects.ts` | 策略表仍按官方声明守 | **KEEP**（刻意的不对称，`FakeMap.ts` 已说明：宽松的夹具会藏 bug） | — |
| Fake 视角动画的 `suppressCancelEvent`（**测试辅助**：取消成功但**不**派发 `animationcancel`） | `fake-bmap-v4/FakeMap.ts` | 只被防御性用例读：取消已交付时 hooks 必须收敛所有权；两个 hooks 共用一张地图时 H1 的重试与卸载都不得碰 H2 的动画 | 它建模的是 F-1 **未证的反面**（官方可能不派发该事件），因此**不能**当官方行为读 | **KEEP 为测试工具** | Fake 默认一定派发该事件，于是「等事件才交回所有权」在夹具里永远不会出错——生产实现是否依赖它，只有把派发关掉才看得出来。该用例证伪的是我们的依赖，不是官方的时序。F-1 结清后这一条仍然成立：实测只覆盖了**成功取消会派发** `animationcancel` 这一侧，「取消成功却没有事件」依旧未证 |
| Fake 视角动画把 `delay: 0` 建模成「一个 0ms 定时器后启动」 | `fake-bmap-v4/FakeMap.ts` 的 `scheduleStart` / `startInternal` | `driver/jsapi-v4/map.test.ts` 的「`delay: 0` 的官方推荐路径仍然是『先取消、再销毁 SDK 对象』」 | **FAKE-ONLY 时序**：真实 4.0 在 `delay: 0` 下启动也要 **5–120ms**（F-1 读数），比销毁路径上那个 0ms 兜底**晚**，所以「先取消、再销毁」对**待启动**的动画在真实运行时大概率不成立 | **KEEP 为测试工具 + 登记** | 夹具的「几乎瞬时启动」是让「推迟到安全窗口」这条路径**可测**的必要简化（否则只能用真实时间等 100ms，用例会脆）。口径：该用例证明的是**本库的排序逻辑**在窗口成立时正确，不证明真实运行时一定落在那个顺序上 |
| ~~`driver-contract` 适配器上的 `expectation?: "fixture" \| "live"` 一档~~ | ~~`test-utils/driver-contract.ts`（一支开关 + 三处跳过分支）~~ | — | — | **REMOVE** | 这一档 + 三处跳过分支已删，两个 harness 的 `expectation` 字段一并摘掉。**为什么不留**：live 侧并不是「没有契约」，而是有**本文件不提供的第三档口径** —— `tests/browser/jsapi-v4/` 那条 runner 把「前置不成立」（AK 权限 / 配额 / Referer / 网络）记成 `blocked`（退出码 3，不可放行），与「库回归」的 `fail` 严格分开。真实环境「必须成功」既做不到也不该写进契约；而这一档的处置只是把断言**静默跳过**，两头不靠。删除不丢覆盖：两个调用方都传 `"fixture"`，那三处 `live` 分支是**死代码**，而 `panorama-viewer` 在 live 档本就不登记（「live 需要真实全景场景」） |

---

## 取证记录

| 编号 | 事实 | 结论 | 约束 / 处置 |
| --- | --- | --- | --- |
| F-1 | `startViewAnimation` 的启动窗口：`animationstart` 是否真的在内部 Animation 构造前同步派发、启动前 `cancelViewAnimation` 是否真的抛 `TypeError` | **已结清**（真实 AK + headless Chromium）。读数（同一轮里逐条复现，判据全部是「对象自身的结果」）：① `delay: 0` 时 `animationstart` 在调用返回后 **5–120ms** 才到（**不是**同步派发；`delay: 900` 时约 **1.28s**）；② 从未起播的实例上 `cancelViewAnimation` → `TypeError: Cannot read properties of undefined (reading 'cancel')`（`pauseViewAnimation` 报 `reading 'pause'`、`continueViewAnimation` 报 `reading '_doStart'`）；③ 在 `animationstart` **处理器里同步**取消 → 同样抛 `reading 'cancel'`，且动画照旧跑到末帧（视图确实推进 ⇒ 那次取消没生效）；④ 在 `animationstart` 之后的**微任务**里取消 → 不抛错、派发 `animationcancel`，视图停在**该段首帧**（末帧未到达）；⑤ 未显式取消就再 start 一段：前一段**不**派发 `animationcancel`、照旧跑到自己的 `animationend`，新一段的启动被推迟到不可预期时刻（实测 +0.9~1.6s）⇒ 重叠期里两段都在推进视角，「一张地图同时跑两段动画」不可依赖；⑥ 未启动时直接 `map.destroy()` 不抛错，之后仍派发一次 `animationstart` 且再无 end/cancel（销毁后动画就地停摆）；⑦ **待启动旧段的「清场」只能延后交付**：`startViewAnimation` 提交新段时，旧段仍在启动窗口 ⇒ `cancelViewAnimation` 拿不到交付（`TypeError`），**新段先提交**，旧段的取消落在**它自己的** `animationstart` 上（实测两段事件相隔 **0.0–0.3ms**）。实测这条路径的代价很小：两段朝**相反**方向走时，重叠期的最低 zoom 是 **14.07**（起始 14、旧段末帧 10、新段末帧 17）⇒ 旧段来不及驱动视角，轨迹只朝新段末帧走。**gate**：live smoke 的 `view-animation-cancel-window`（required）把 ①②③④ + ⑤/⑦ 的形状变成可回归断言，并自带正证控件（一段正常播放必须真的把视图推到末帧，否则「取消之后没推进」是空转；⑦ 的子场景也要求新段跑到自己的末帧） | 据此把措辞精确化（「同步」只存在于**派发与内部控制器构造之间**，相对 `startViewAnimation()` 返回是异步的）；把「起播前清场」按**两条路径**拆开写（已启动=提交前交付 / 待启动=旧段自己的安全窗口交付），并写明承诺粒度是「在最早的合法时刻交付取消」而不是「提交新段前图上一段不剩」；同时写明「0ms 兜底几乎总是先于动画启动到期」这一真实排序。**仍然不许把该时序升级为对外承诺**：它是官方行为，官方可以改 —— 这正是 gate 的用途。**本条只覆盖「start 窗口 + 取消时序」**：Map 级 `pauseViewAnimation` / `continueViewAnimation` 既没有生产者、也没有取证计划（`plugins/compat-inventory.ts` 里那两条只是外部插件用到的成员清单），不属本条覆盖范围 |
| F-2 | 官方 JSAPI 的 JSONP 回调全局名占用与「别人也注册了同名回调」的判定 | **已取证**（真实 AK + headless Chromium）：`callback=<名>` 契约 / foreign 捕获与释放 / 官方新增全局 三组读数见 `tests/behavior/fixtures/probe-jsonp-callback.live.json`；probe 脚本 `scripts/probe-jsonp-callback.mts`（`pnpm probe:jsonp-callback`）；判定层 `scripts/probe-jsonp-callback-verdicts.mts` + 三态用例 `tests/behavior/probe-jsonp-callback-verdicts.test.ts`（COMPLETE ↔ live 漂移守卫即本条的可回归 gate）。**就绪控件是 `control.readyAtCall`**（**首次** callback 当下 handler 内同步采样，口径对齐生产 `requireJsapiV4Global` 的 `JSAPI_V4_REQUIRED_MEMBERS` = Map/Point/Marker，且身份/args/成员快照均只取 first-call——生产只消费第一次回调）；`control.bmapReady` 仅为诊断读数，不得代替它。**只在 `customScriptV4Provider` 的 jsonp 分支生效，不进 Stable 承诺**；guarantee 措辞写在 `SharedLoadTask.ts` 模块头（本库保证 vs 官方行为分列） | 见第 3 节 KEEP 行 |
| F-3 | SDK 实例 `destroy()` / `dispose()` 是否幂等、销毁期是否真会回调业务 | 已有反例、正向读数：真实 4.0 在**未加载场景**的 `Panorama#destroy()` 抛 `TypeError`，另有真实 AK + headless Chromium 的读数见 `tests/behavior/fixtures/probe-destroy-idempotency.live.json`（`pnpm probe:destroy-idempotency`；`resolveBrowser()` **只**自动解析 chrome-headless-shell，系统 Chrome 仅 `SMOKE_BROWSER` 显式 opt-in——系统 Chrome 在 headless 下 `setId` 会挂死主线程）。**结论**：① **Map 第二次 `destroy()` 抛错**（`Cannot set properties of undefined (setting 'enableAutoResize')`）⇒ 重复销毁**不是** no-op，契约只能写「本库保证」；② Autocomplete 重复 `dispose()` 不抛（本轮窗口）；③ `setId` 调用本身不抛，但 headless 下场景常**未真正加载**（无 `id_changed`/`dataload`），Panorama **首次 `destroy()` 即抛 `START`**（与已知反例同形）——**first 已抛错时 second 不构成幂等取证**（判定层据此不得落「有条件幂等」）；④ **销毁期回调分路径**：Map `destroy` 事件 count=1 ⇒ Map 路径「会回调业务」；Autocomplete 侧有**对照组** `auto.control.callbackObserved`（同环境不 dispose 时 `onSearchComplete` 到达）——对照组成立且 dispose 臂 0/0 才落「dispose 窗口内未见回调」，对照组缺失/为 0 时 Autocomplete 半边第三态（不得借 Map 的 destroy 事件外推）。半边前置（进结论、**不**进 `controlFailures`——否则 exit 1 时不再打印另一半有效结论；但打印后须走 `conclusionExitCode`：任一结论含「无法判定」⇒ 退出码 1，对齐「0 = 全 pass」）：`map.control.destroyListener.threw === false`（否则 Map 半边第三态，`destroyEventCount=0` 不构成「未见回调」）；`auto.search.threw === false`（否则 Autocomplete 半边第三态，dispose 臂 0/0 不构成「未见回调」）。对照组另加 `auto.control.search.threw === false`（显式 search 必须发出，否则 `callbackObserved` 可能来自其它触发）进 `controlFailures`。**取证范围**：service 侧只探了 Autocomplete（Panorama / Map 另有读数） | guard 保留；契约措辞仍一律写「**本库保证**」而非「官方保证」（取证不等于把官方行为升级为承诺——官方可改）。`driver-contract.ts` 的三处 F-3 注释已按真实读数更新（Map 侧由「未取证」改为「已证：官方第二次抛错、本库 guard 保证短路」） |
| F-4 | 原生 `addEventListener` 在同一函数重复注册时是否去重 | **不 probe（reclassification：remove-first / probe-if-retained）**：它只活在 Fake 夹具里、**不是** 1.0 当前 `./advanced` / SDK 生命周期契约的一部分 ⇒ 按「只为夹具/历史推断存在的机制，直接收掉假设、不为它写 probe」处理。原注释「与官方一致」是 `FAKE-ONLY` 推断，已改写为「**夹具记账**」——两条语义声明为本 Fake 的建模选择，生产路径本就中立，只有泄漏门禁与活动计数按它算 | reclassification 先于「取证后二选一」——生产中立、不属 retained 契约面，探针只会增加噪音；期望数字仍按夹具口径，行为未变 |

> 取证的原始 live 输出**不入库**（含 UA / 时间戳等运行产物）。`tests/behavior/fixtures/probe-*.live.json`
> 抄录一次成功 live 的 `phase` / `sdk` / **全部 `readings`**（判定层消费其中子集；fixture `note` 同步写明生成方式）。
> 复现方式是单跑对应 gate（如 `BAIDU_MAP_AK=<ak> pnpm smoke:v4`），它的 `detail` 就是上表那几条读数。
>
> 新增 probe 的落点与既有三臂对照实验的写法，照 `scripts/probe-layer-events.mts` / `probe-plugin-runtime.mts`
> （读数提交进 inventory 或 `tests/behavior/fixtures/*.live.json`）。

## 收窄后的边界（不属于本表范围、但同样确定）

- `DataLayerManager` / Native Layer 失败恢复的直接测试：前置已满足——第 4 节（generation / epoch stale guard）
  与第 5 节（`native-layers.ts` 的 `supports()` 刻意不采纳实测可用的成员）都判 **KEEP**，即那套机制属于
  「真实所有权复杂度」而不是要 SIMPLIFY 的镜像状态。
- `MapRuntimeStatus` 的 `loading` 别名、`optionKey()` 的一行转发、`UseSdkResourceOptions`、
  `getProcessSdkRegistry` 的首参与 `options.domain` 语义重复：均已收窄。`getProcessSdkRegistry` 签名收成
  单参 `getProcessSdkRegistry(domain = DEFAULT_DOMAIN)`，且随 `./core` 取消只在内部 barrel 上。
