# Ownership-first / Evidence-first 存量审计表

> 对应 issue **#104**（P1，Stable 阻塞，须在 #44 冻结公共出口前完成）。
> 原则四条已写进仓库根的 `AGENTS.md`（「服务层的硬约束」一节之后新增的 Ownership-first 段落）。
> 决策记录侧：[ADR 2026-09-10 决策 6 的后半句（已取代）](../../adr/2026-09-10-sdk-conflict-domain.md)、
> [ADR 2026-09-11（视角动画复核注记）](../../adr/2026-09-11-jsapi-v4-map-facet.md)、
> [ADR 2026-09-12 决策 5（已 superseded）](../../adr/2026-09-12-jsapi-v4-service-panorama-native-layers.md)、
> [ADR 2026-09-13（默认路径委托官方 Loader；对照表已按第三批更新）](../../adr/2026-09-13-default-online-loader-cutover.md)、
> [ADR 2026-09-14 非目标（已兑现）](../../adr/2026-09-14-service-lifecycle-and-local-search.md)、
> [ADR 2026-09-14 删除旧引擎（已知限制第 2 条已被取代）](../../adr/2026-09-14-remove-legacy-engine.md)。

三个批次的落地 PR：[#105](https://github.com/Mang-X/bmap-vue/pull/105)（第一批，A1–A3 / B1 / R1–R11）、
[#122](https://github.com/Mang-X/bmap-vue/pull/122)（第二批，实施步骤 4：动画 teardown + F-1 取证）、
[#129](https://github.com/Mang-X/bmap-vue/pull/129)（第三批，实施步骤 6：`./core` 公共面复核）。

审计对象是 **main 上已落地** 的实现，不预设它们有问题；每行给出「机制 / 消费者 / 证据 / 结论 / 处置」。

## 证据口径

一条结论能不能成为 Stable 契约，只看它站在哪一档证据上：

| 档 | 含义 | 能否支撑 Stable 契约 |
| --- | --- | --- |
| `OFFICIAL` | 官方声明（`@baidumap/jsapi-v4-types@4.0.4`）或官方包行为 | 能 |
| `PROBED` | 仓库里有一次性真实运行时取证（`scripts/probe-*.mts` / `smoke:v4` + 已提交读数） | 能，但要写清取证日期 |
| `OWNED` | 状态由本库自己写入、自己读回（generation / epoch / scope / Registry 记账） | 能（不依赖上游） |
| `ASSUMED` | 我们对上游行为的推断，没有声明也没有取证 | **不能**，只能作为防御 |
| `FAKE-ONLY` | 只有我们自己的 Fake 演示得出来 | **绝对不能**——这是本表最常见的错处 |

结论三档：**KEEP**（真实消费者 + 站得住的证据）、**SIMPLIFY**（需求真实，但可以用收窄所有权 / reconcile 少存状态）、**REMOVE**（无消费者、由已推翻前提产生、或官方已提供）。

---

## 1. 回调归属与请求身份

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `suggest()` 的程序化归属层：`pendingSuggest` 队列 + 同关键词互斥 + FIFO 退化 + 「通道独占」前置条件（`watchInputActivity` / `isTypableInput` / `loseExclusivity` / `EXCLUSIVITY_LOST_HINT`） | `driver/jsapi-v4/services.ts`（原 814-1053 段） | **生产 0**。只有自身单测与 `facet-probes` 探针；`<Autocomplete>` 渲染可输入输入框、结构上不可能是消费者 | `FAKE-ONLY`：顺序来自 `FakeV4CallbackQueue` 发明的微任务 FIFO，关键字来自 `includeKeyword` 发明的回填 | **REMOVE** | #104 A1：整段删除。`Autocomplete` **不进归一化调用面**，构造时传 `onSearchComplete` 原样转发；`PlaceSuggestion` 类型与 `ServiceInvocationDriver.suggest` 一并从出口摘掉；`service.autocomplete` 由 `experimental` 回到 `native`（它唯一的降级理由就是这条假设） |
| `LocalSearch` 的「一个实例同一时刻最多一个未结算操作」 | 同文件 `invokeSlotOperation` | 7 个 service composable + 组件 | `OWNED`：身份是**实例自己**，不需要按到达顺序猜 | **KEEP** | — |
| 实例通道的 `supersede`（取代即换新实例） | `core/services/instanceChannel.ts`（**独占档**） | LocalSearch + 四个路线服务 | `OWNED`：依据是「该服务的 SDK 实例**有**公开释放入口」，且取消 / 超时后旧实例上可能有无法区分的回包 | **KEEP（收窄到独占档）** | #139：7 个官方无销毁入口的简单服务改走**无状态**共享通道，`supersede` / `refuse` / 待释放队列在它们身上是恒空状态，已从那个面上结构性移除 |
| 超时 / 空结果 / 迟到回调 / 先到者胜 | `driver/normalize/serviceCall.ts`（单一实现点） | 全部归一化调用 | `OWNED` + `OFFICIAL` | **KEEP** | — |
| ADR 2026-09-12 决策 3 的 `normalize/jsonpProbe.ts`（两引擎共用的空/失败嗅探） | — | — | — | 已消失 | #26 单引擎收敛时随文件删除；本表记录在案，避免按 ADR 原文再找这个模块 |

## 2. 状态镜像与动画

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `useViewAnimation` 的 `stop()` / `proceed()` → `handle.raw._pause` / `_continue` / `_cancel` | `composables/useViewAnimation.ts`（原 98/105/114 行） | 只有文档页与示例引用 | 官方 4.0.4 **没有**声明这三个成员 ⇒ 私有面 | **REMOVE** | #104 A2：收窄为 `start(keyFrames)` / `cancel()` / `status` / `ready`。静态门禁抓不到 `handle.raw.*`（`check:raw-sdk` 只匹配 `Map`/`BMapGL` 标识符），所以这条靠审计而不是靠 gate |
| 同 hooks 的 `viewAnimation` 句柄 ref + `setKeyFrames` 两段式 + `disableDragging` | 同上 | 只有文档 | 句柄每次 `start()` 都被换掉、`disableDragging` 从未生效 ⇒ 退化成常量 | **REMOVE** | #104 A2 一并删除；`status` 改成**观察值**（`idle` / `playing`），命令不乐观改写它 —— 唯一例外是本库对自己那次取消的交付确认（形状见下面两行） |
| MapDriver 的视角动画 teardown：`AnimationRecord{started,settled,cancelRequested}` + `Teardown{disposed,disposing,tornDown,released,deferredFinish,fallbackTimer}` | `driver/jsapi-v4/map.ts:193-210` | `MapDriver.destroy` / `startViewAnimation`，约 20 条行为用例 | 记账对象是**我们自己**发起的启动/取消/销毁次序 ⇒ `OWNED`，合法；其前提「`animationstart` 在内部控制器构造前派发、启动前 `cancelViewAnimation` 抛 `TypeError`」原为 `FAKE-ONLY`，**2026-09-21 已由真实 AK 读数升级为 `PROBED`**（见下方 F-1） | **KEEP（证据已补）** | #104 B1：保留（它不恢复 SDK 的因果身份）；F-1 已结清，并落成 live gate `view-animation-cancel-window`。口径仍不得升级为「对外的时序承诺」：那两条前提是**官方行为**，官方可以改，gate 就是用来在它改的时候变红的。ADR 2026-09-11 已加取证注记 |
| 同一处前提在 hooks 侧的两处**残留用法**：① 被取代那一段的三条监听只由该段的 `animationcancel` 释放；② `cancel()` **当时**发的是**整张图**的 `stopViewAnimation(map)`（#105 已改为按实例；那条整图命令本身在第二批也已删除，见本行末） | `composables/useViewAnimation.ts`（`AnimationRun` / `start` / `stopRun`）＋ `driver/jsapi-v4/map.ts` 的动画记录 | 该 hook 自己（`EventDriver.groups` 是强引用 Map，未释放即泄漏）；以及跨 hooks：同一张图上另一个 `useViewAnimation` 的在飞段 | 两处都依赖同一条 `FAKE-ONLY` 时序。②最要命：`stopViewAnimation` 的范围是整张图，于是**「保留重试入口」与「不牵连别人的动画」互斥** —— #105 第三轮以「H1 第二次 cancel 停掉了 H2 的 B」打中一次，第六轮以「延迟取消失败后 H1 永久失去重试入口」打中另一次；把 `cancelCommitted` guard 去掉实测就红，确认两条不能同时满足 | **SIMPLIFY（本票已做）** | 取消换成官方本来就有的**按实例**命令：给 `MapDriver` 加 `cancelViewAnimation(map, animation)`，v4 实现只挑该实例那一条记录、复用 `cancelAnimation`，并返回本库侧的交付状态 `canceled / deferred / already-settled`。hooks 据此把三件事分开：**当前观察对象**（`current`）、**取消是否仍需重试**（`undelivered`）、**每段自己的监听**（交付即释放）：`deferred` 保留重试入口（第二次 `cancel()` 真打到 SDK），已交付则幂等收尾且不补发命令（补发要假设 SDK 幂等，属 F-3 未证）。回归：`v3-useViewAnimation.test.ts` 的「取消失败时保留重试入口」「deferred 与已交付的取消走不同的收尾」「收尾按动画身份收敛」三节，加 Facet 侧 `map.test.ts` 的「只碰传入的那个实例」。**公开的语义不建立在『接管时旧段监听恰好已释放』这个时机上**：接管那一支按**交付状态**分岔 —— 已交付（`canceled` / `already-settled`）当场释放旧段监听，未交付（`deferred`）则把监听留着、旧段进 `undelivered`，由后续 `cancel()` 与卸载继续推到终态（#105 第八/九/十轮）；两条路都由 `finishRun` 的身份守卫挡住旧段清掉新段的 `playing`。一次公开 `cancel()` 里**每段只尝试一次**：当前段被 deferred 时它同时是 `current` 与 `undelivered` 的成员，快照按 `Set` 去重，否则「抛错说没交付」与「同一次调用里第二份已重试成功并收尾」会自相矛盾（#105 第十一轮 P1）。**第二批收口**：「② 的根源」——整图命令 `MapDriver.stopViewAnimation(map)` 已**删除**（它零生产消费者、唯一的书面理由是「与 #26 已删除的 webgl-v1 一致」、且与按实例所有权直接冲突），`cancelAllAnimations` 因此只剩两个本库自己的整图动作（起播前清场 / 销毁） |
| `useBMapTrackAnimation` 的插件状态机（`INITIAL` / `PLAYING` / `STOPPING` / …） | 原 `composables/useBMapTrackAnimation.ts` | **生产 0**：v4 上 `createTrackAnimation()` 必抛 `BMAP_CAPABILITY_UNSUPPORTED` | 状态机的全部可达分支 = 一条失败分支 ⇒ 退化成常量 | **REMOVE** | #104 A3：hook、文档页、示例、行为用例全部删除；轨迹走原生图层 `track-line`，插件侧结论仍在 **#43**。参考实现 `huiyan-fe/react-bmap`（236 个 TS 文件）没有任何 TrackAnimation 抽象 |
| suspension reason 集（`user` / `keepAlive` / `document` / `offscreen` / `disposed`）、boot 单飞 + `deferredWaiters` + 0ms 活性兜底、`tileLoadObserver` 的两本账 | `core/runtime/suspension.ts`、`components/map/Map.vue:691`、`components/layers/tileLoadObserver.ts` | 生产，组件生命周期 | `OWNED`；`tileLoadObserver` 另有 `PROBED`（`scripts/probe-layer-events.mts` 三臂对照 `12 / 0 / 12`） | **KEEP** | 反面样板：`tileLoadObserver.ts:38-40` 明确**拒绝**做瓦片回包归属，只记所有权 |

## 3. Loader / Provider / SDK Registry

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| 自研 `ScriptLoader`（script/jsonp transport + 在飞/已完成缓存） | `core/loader/ScriptLoader.ts` | 只有 `customScriptV4Provider`（显式高级路径）；`v3-default-loader-boundary` 证明默认路径不碰它 | `OFFICIAL` 缺口（官方 loader 不支持非标准入口） | **KEEP** | 默认路径已在 #71 回到官方 loader |
| `SharedLoadTask` 的进程级 `callbackRegistry` + 全局名占用 / foreign 回调捕获 | `core/loader/SharedLoadTask.ts:98` | 高级 jsonp 分支 | `ASSUMED`（官方 JSONP 回调命名是我们的读法，未取证） | **KEEP + 待取证** | 唯一保留的「恢复上游未公开身份」处：它服务的是显式高级路径，且**不**进 Stable 承诺。取证登记为 **F-2** |
| `SdkRegistry` 的 `conflictPolicy: "warn" \| "ignore"` + `onConflict` | `core/loader/SdkRegistry.ts` | 三个 Provider 一律不传 ⇒ 只有单测可达 | 无消费者的分支 | **REMOVE** | **第三批已落地**：两个选项、`SdkConflictPolicy` / `SdkConflictInfo` 类型与 `policy` getter 一并删除，冲突处置收成唯一行为（恒 reject `BMAP_SDK_CONFIG_CONFLICT`）。ADR 2026-09-10 决策 6 已加取代注记（前半句不变）。同一批把 `resetProcessSdkRegistryForTests` 从 `./core` 出口摘掉（测试辅助不进公共声明面）——`resetGlobalCallbackRegistryForTests` 此前就没在出口上，无需处理 |
| `SdkRegistry.cancellable`（官方 loader 不可取消 vs 自研可取消） | `core/loader/SdkRegistry.ts` 的 `SdkRegistryLoadRequest` | 三条 Provider 路径 | `OFFICIAL` | **KEEP** | — |
| `createBaiduSdkUrl()`（旧 CDN 入口拼装） | 原 `core/loader/url.ts` | **生产 0**，但挂在 `./core` 出口上、被边界测试直接调用 | 迁移期遗留 | **REMOVE** | #104 R9：函数与其私有选项类型一并删除；`v3-default-loader-boundary` 改成**存在性否定**门禁（默认静态模块图里搜不到这个名字，同时正面证明 `core/loader/url.ts` 确实在图中） |
| `providers/official.ts` 的 `OFFICIAL_LOADER_UNSUPPORTED_KEYS` 显式报错 | `:82-110` | 默认路径 | `OFFICIAL`（官方选项面） | **KEEP** | 「接收后忽略 = 假支持」的守卫本身，不是镜像 |
| `markRejectedJsapiV4Global` / `isRejectedJsapiV4Global`（WeakSet 标记自家被拒残留） | `providers/namespace.ts:169-181` | 写入 `providers/load.ts:46`，读取 `providers/reuse.ts:68` | `OWNED`（跟的是我们自己的写） | **KEEP** | — |
| `LoadedSdk = LoadedJsapiV4` 单成员别名；`client.version` 的 `@deprecated` 别名 | `core/loader/loaded.ts:30`、`client/types.ts:53` | 类型层 | #26 删引擎后失去意义 | **SIMPLIFY** | 随 #44 的 public-dts 复核一起收口（先出一次 release note） |

## 4. MapRuntime / 生命周期

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| 六条资源路径的 generation / epoch stale guard、`PluginHost.epochNumber`、`PluginRegistry.record.generation` | `core/composables/*`、`core/plugins/*` | 生产 | `OWNED`：比较的是「这还是我创建的那个实例/作用域吗」，**不**归属 SDK 回包 | **KEEP** | 本票的非目标：不因「看着复杂」删掉真实所有权机制 |
| `ResourceScope` 的六个定时器别名（`requestAnimationFrame`+`frame`、`setTimeout`+`timeout`、`setInterval`+`interval`）与 `addCancellable` | 原 `core/lifecycle/ResourceScope.ts` | **生产 0**（只有同名测试在用） | 与 `core/scheduler/FrameScheduler` 重复的转发面，且两套语义还不一致（`setTimeout` 返回裸 id、`timeout` 返回 disposer） | **REMOVE** | #104 R1 已删。#139 续：随之一起从 `ResourceScope.test.ts` 消失的还有「`onDisposeError` / `parentSignal`」两条构造选项（同样生产 0 消费者）——但**它们承载的行为没丢**：容错改为断言 `logger.warn` 通道、「父释放 ⇒ 子释放」由 `fork()` 的 disposer 链路继续保证并补了一条「父已释放时 `fork()` 的子**同步**被释放」。`ResourceScope` 由此收成**最小外部资源内核**（`add` / `fork` / `signal` / `size` / `label` / `isDisposed` / `dispose`），`run()` 与内嵌 `effectScope` 一并删除——Vue 的 effect 生命周期交回 Vue |
| `useResourceScope.ts` | 原 `core/lifecycle/useResourceScope.ts` | **0**（只有两行出口） | — | **REMOVE** | #104 R2：文件与两处出口删除 |
| `MapRuntimeOptions.clientFactory`（与 `clientContext` 二选一） | `core/runtime/MapRuntime.ts:74` | 只有 3 个测试文件 | 无生产消费者的第二条臂 | **SIMPLIFY** | 后续票（收口要连带改 `v3-context-runtime-lifecycle` 的夹具） |
| `MapRuntimeStatus` 的 `"loading"` 别名 | `core/context/types.ts:30` | 类型层，#71 起运行期不再写 | `OWNED` 但已过时 | **SIMPLIFY** | **本票已修文档承诺**：`docs/zh-CN/components/map.md` 两处不再把 `loading` 写成会发出的状态；类型别名到 #44 一并收 |
| `Map.vue:813-825` 的 `mountMap()` 前置检查（曾自陈「删掉整句，1799 条用例仍全绿」） | `components/map/Map.vue` | `ensureUsableRecheck` 的每帧复查 + `onContainerReady` | **已取证**：`ensureUsableRecheck` 每帧调 `mountMap()`，容器仍 0×0 时少了这句就会 `startBoot()` | **KEEP（#127 落地）** | **#127 选了 (a) 保留并补上能翻红的用例**：`v3-component-scenarios` 的「挂起的 retry 期间每帧复查不得启动 boot」—— 删掉该句实测变红（`expected 'creating' to be 'error'`）。它拦的不是「0×0 建图」（那由 `waitForUsableContainer()` 兜底），而是「启动一次注定被拦的 boot」：失败态下状态从 `error` 被推进到 `creating`，`#error` 插槽连同它的重试按钮被 `#loading` 顶掉，业务「重试一次」的入口凭空消失，而这次重试其实一条命令都没发出去 |
| `PanoramaStatus` 七态（运行期只有 `error` 被内部读） | `core/panorama/index.ts:34-50` | `Panorama.vue` 公开 expose + 文档页列全 | `OWNED` + 已文档化 | **KEEP** | 外部消费者无法自证为零，故不在本票删除 |

## 5. Overlay / Layer / Control / Panorama 与 Capability Catalog

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `LAYER_DESCRIPTORS` 的 `declared` / `signature` / `ctorSlots` / `mutable` / `bagSetters` + 约 10 条类型层断言（含**负向**断言：`district` 不得长出 `setZIndex`） | `driver/jsapi-v4/layers.ts:108-248` | 生产（`LayerSpec` → `useLayerResource`） | `OFFICIAL` | **KEEP** | 正面样板：读不回就**拒绝**，不猜 |
| `native-layers.ts:111-115`：实测扩展图层**确实**继承了 `setVisible/setOpacity/setZIndex`，但 `supports()` 仍答 unsupported | 同文件 | 生产 | `PROBED` 且刻意不采纳 | **KEEP** | 与「用私有面补齐」相反的选择 |
| `engines` 维度 + `CapabilityReason: "engine-unsupported"` | `driver/capability/catalog.ts`（原 `:118-129` 的 `JSAPI_V4` 常量与 `engines` 字段声明） | 单引擎后只剩「目录未收录」一条可达路径（用例已把这句话说成结论） | 已登记的退化 | **SIMPLIFY（已由 #126 落地）** | #126 按 Evidence-before-abstraction 判据选择**删列**：写不出会变红的用例 ⇒ 删掉 `CapabilityDescriptor.engines`（含 63 行赋值与 `JSAPI_V4` 常量）、判定链的恒真白名单分支、生成器的引擎列，并矩阵 / JSON 重生成（63 条能力不变）；`engine-unsupported` **改名** `unlisted-capability`（唯一可达路径=描述符缺失，名字与路径一致）。用例把「每条能力必须声明当前引擎」改成「描述符**没有** `engines` 属性」（`not.toHaveProperty`）。ADR：`2026-09-24-single-engine-capability-catalog`（结算 #26 已知限制第 4 条；按仓库约定该已接受 ADR **未被改写**，取代指针记在新 ADR 的「取代范围」与本表）。引擎身份在 `CapabilityExplanation.engine` / `UnsupportedCapabilityError` 上保留（那里有消费者） |
| `runtime` 能力族四条（`resource-scope` / `capability-override` / `fake-sdk` / `async-task`） | 同文件（原 `:745-776`） | **没有任何** `supports()` / 组件 / 测试按 id 问过；只被「每个 family ≥1 条」这条断言养着 | 类别错误（拿自家模块冒充实测风险等级） | **REMOVE** | #104 R10：删掉这一**族**——四条目录项、`CapabilityFamily` 联合里的 `"runtime"`、以及 `CAPABILITY_FAMILIES` 数组里的那一项；矩阵与 JSON 重生成（62 条能力），「每个 family ≥1 条」的循环随之变成五族。`CapabilityFamily` 类型与 `CAPABILITY_FAMILIES` 常量**本身保留**（`registry.ts:48` 的字段类型、`registry.test.ts:202/292` 在读），本票没删符号。合并 main 之后又扫出同一个幽灵值的最后一处：`registry.ts` 的 `explain()` 里 `?? ("runtime" as CapabilityFamily)` 兜底。（无）（`does.not-exist` 这类未收录 id 是「目录未收录」这条拒绝路径的唯一入口，两条用例都在走；该 reason 已随 #126 改名 `unlisted-capability`），所以不能删兜底 —— 改成 `CapabilityExplanation.family?` 留空：没有描述符就没有 family 可报，不编一个值。断言在 `registry.test.ts` 的「目录未收录的 id 按 unlisted-capability 拒绝」里 |
| `service.truck-route` 目录槽位 | 同文件 `:645` | 只被当作 override/过滤用例的任意 id；ADR 明说「不做 TruckRoute」 | 为未实现功能留位 | **REMOVE** | #104 R10（用例改用真实存在的 id，例如 `overlay.mapvgl`） |
| `DataLayerManager.sync(items, getKey, itemVersion, force)` 的 `itemVersion` 形参 | 原 `core/data/DataLayerManager.ts:34` | 两个 data 组件都在传，但 `apply()` **从不读**它（R6 删掉 `shouldFullReplace` 之后彻底没有实现） | 无消费者的参数＝假支持；但类挂在 `./core` 公共出口上，外部调用方按位置传参时会把第 4 个实参错位成 `force` | **SIMPLIFY（已由 #34 落地）** | 本票只登记不删（要连带改 `./core` 的位置签名，与 `SdkResourceAdapter` 同批归 #44）。**main 上的 #34 已经把它做掉了**：`sync(input: DataLayerSync)` 改成对象入参，`version` 真实生效（同引用 + 同版本 ⇒ 零 SDK 调用；版本变 ⇒ 重新读坐标逐项下发），四个位置参数留下的「谁也没表态」问题随之消失。本行保留是为了记住这个形状的坑曾在这里。组件的 `dataVersion` prop 依然成立，走的是同一套版本语义 |
| `useResolvedTarget`（含「找不到 TargetContext 就回落到 Map 的 add/remove」闭包）、`createStaticTarget`、`useOptionalTargetContext`、`useParentOverlayHandle` 里旧 `overlayContextKey` 那条读法 | 原 `core/context/target.ts` | 测试或 0（生产走 `useOverlaySpec` provide 的 `TargetContext`，旧臂在仓内不可达） | 为「可能有外部消费者」留的兼容面，且无任何文档承诺 | **REMOVE** | #104 R7：三个出口与旧读法全删，`overlayContextKey` 这个 InjectionKey 也随最后一个读写点消失；最近 TargetContext / 晚就绪的行为由 `tests/behavior/v3-overlay-spec.test.ts` 的 `TargetProbe` 继续钉住 |
| `optionKey()` 对 `stableKeyOf` 的一行转发 | `core/controls/optionKey.ts:39` | 生产 | 命名转发，无逻辑 | **SIMPLIFY** | 后续票（同文件的 `optionSnapshot` / `changedOptionKeys` 是 #95 的真实修复，KEEP） |
| `DataLayerOptions<Item>`（唯一成员 `minClusterSize` 全仓再无处出现，类也不接受该参数） | 原 `core/data/DataLayerManager.ts` | 0 | 幽灵字段 | **REMOVE** | #104 R8 |
| `#101` 的 InfoWindow `openOutstanding` / `closeOutstanding` / `explicitClosePair` 一族 | `core/overlays/*`、`InfoWindow.vue` | — | — | 不在本票 | #101 已在原 PR 内按 ownership/reconcile 方向纠正；本票只登记为「非目标」，避免以为还欠着 |

## 6. 无当前消费者的公共出口（#44 冻结前必须清）

| 出口 | 位置 | 消费者 | 结论 | 处置 |
| --- | --- | --- | --- | --- |
| `componentTypeNames` | 原 `src/resolver/index.ts` | 0（`componentManifest` 才是事实源） | **REMOVE** | #104 R4 |
| `defineCapabilityOverride` | 原 `src/advanced.ts` | 0（含 docs / apps / fixtures / scripts） | **REMOVE** | #104 R3 |
| `extractSdkEventNames` | 原 `core/events/EventBridge.ts` | 只有自身测试 | **REMOVE** | #104 R5 |
| `shouldFullReplace` | 原 `core/data/diffData.ts` | 只有自身测试 | **REMOVE** | #104 R6 |
| `useServiceTask`（经 `export * from "./composables"` 外泄） | 原 `src/index.ts:9` | 内部引擎（18 个文件），文档只字未提 | **已结（#139）** | **REMOVE**：`export * from "./useServiceTask"` 整条摘除，12 个**服务** composable 的出口不受影响。任务内核改名为 `composables/serviceTask.ts`（两档），一律只作内部实现——`tests/behavior/v3-core-surface.test.ts` 已把这 7 个名字加进负向清单钉住 |
| `useMapResource` / `SdkResourceAdapter` / `UseMapResourceResult` | 原 `core/composables/useMapResource.ts`（`core/index.ts` 出口） | **生产 0**（只有它自己的单测） | 被同目录的 `useSdkResource` 取代——后者的文件头写着「替代行为各异的 `useMapResource` / `useOverlayResource` / `useControlResource` / `useLayerResource`」 | **REMOVE** | **第三批已落地**：文件与单测删除、三处出口名一并摘掉 |
| `UseSdkResourceOptions`（经 `./core` 出口） | `core/index.ts` | 定义处 | 与 `SdkResourceAdapter` 同批登记的出口收窄项；`useSdkResource` 本身有生产消费者，收窄要连带它的导出形状 | **SIMPLIFY** | 归 **#44**：`./core` 出口收窄时一并决定（`useServiceTask` / `MapRuntimeOptions.clientFactory` 等同类项也在那里） |
| `Autocomplete` 里按结构化成员探测 `disposeAutocomplete` 的分支（`as { disposeAutocomplete?: … }`，探测失败即**静默不释放**） | 原 `components/autocomplete/Autocomplete.vue` 的 `disposeService()` | 0：#26 之后 `BMapEngine` 只有 `jsapi-v4` 一个成员，分支永不成立（注释自己写着「#26 删除 webgl-v1 后这个探测可以收成直接调用」） | **REMOVE** | #104 R11：改成 `jsapiV4ServicesOf(client).disposeAutocomplete(instance)`——按 ADR 2026-09-14 的口径走**可运行时检查**的收窄点，而不是组件里另写一份 `as`。留着的代价不只是死代码：那条静默分支正好会跳过 Driver 侧的订阅记账 |

## 7. Fake 建模反向成为生产契约

原则：**Fake 独有、真实 SDK 未验证的关键语义只能登记为「时序注入 / 防御模型」，不能反过来当证据。**

| Fake 建模 | 位置 | 生产是否依赖 | 结论 | 处置 |
| --- | --- | --- | --- | --- |
| `FakeV4CallbackQueue` 的微任务 FIFO + `delay` + `flushOne(index)` | `fake-bmap-v4/async.ts` | 曾经是唯一「suggest 归属成立」的证据 | **KEEP 为测试工具**，禁止再用于认证任何跨请求顺序 | A1 之后其消费者只剩 LocalSearch 的实例身份路径；`flushOne` 的正当用途恰恰是**打乱**顺序 |
| `FakeV4Autocomplete.respond` / `.includeKeyword` / `AutocompleteResult.keyword` | `fake-bmap-v4/services.ts` | 生产已不读 `keyword` | **REMOVE** | #104 A1 一并删（留着就会有人重新按 keyword 建归属） |
| `FakeMap.destroy()` 幂等 | `fake-bmap-v4/FakeMap.ts` | 我们的 guard 保留 | `ASSUMED` ⇒ guard 可以留，**契约不能这么写** | **第三批已落地**：`driver-contract.ts` 里那两处「dispose 幂等」的注释与两条用例标题不再声称「SDK 侧的移除对未挂载资源是 no-op」——那两条断言的判据是 `harness.attachedCount()`，也就是**夹具那一侧的假账本**（本文件 `attachedCount()` 的说明写着「把假账本放在 harness 一侧」），因此它既不是官方幂等性的证据，也不是生产库 Driver/Registry 记账的证据（另见 F-3） |
| 销毁期回调重入（`Autocomplete.onDispose` 等） | `fake-bmap-v4/services.ts:328-343` | Map / Panorama / service 三处 guard | `ASSUMED`（注释自己写的是「**可能**触发」） | **KEEP guard**，措辞保持「可能」，登记 **F-3** |
| `addEventListener` 按函数身份去重（注释称「与官方一致」） | `fake-bmap-v4/event-target.ts:24-42` | 生产中立；只有某条用例的期望数字按它算 | `FAKE-ONLY` | 后续票：把该断言改成「夹具记账」口径，或 probe 一次（F-4） |
| Fake 刻意比官方宽松（不剔除未声明 setter） | `fake-bmap-v4/objects.ts:53` 等 | 策略表仍按官方声明守 | **KEEP**（刻意的不对称，`FakeMap.ts:692` 已说明：宽松的夹具会藏 bug） | — |
| `FakeV4ViewAnimation.suppressCancelEvent`（**新加的测试辅助**：取消成功但**不**派发 `animationcancel`） | `fake-bmap-v4/FakeMap.ts` | 只被防御性用例读：取消已交付时 hooks 必须收敛所有权；两个 hooks 共用一张地图时 H1 的重试与卸载都不得碰 H2 的动画 | 它建模的是 F-1 **未证的反面**（官方可能不派发该事件），因此**不能**当官方行为读 | **KEEP 为测试工具** | #105 评审第三轮：Fake 默认一定派发该事件，于是「等事件才交回所有权」在夹具里永远不会出错——生产实现是否依赖它，只有把派发关掉才看得出来。该用例（`第一段取消成功但无 animationcancel…`）证伪的是我们的依赖，不是官方的时序。F-1 于 2026-09-21 结清后这一条仍然成立：实测只覆盖了**成功取消会派发** `animationcancel` 这一侧，「取消成功却没有事件」依旧未证 |
| `FakeV4ViewAnimation` 把 `delay: 0` 建模成「一个 0ms 定时器后启动」 | `fake-bmap-v4/FakeMap.ts` 的 `scheduleStart` / `startInternal` | `driver/jsapi-v4/map.test.ts` 的「`delay: 0` 的官方推荐路径仍然是『先取消、再销毁 SDK 对象』」 | **FAKE-ONLY 时序**：真实 4.0 在 `delay: 0` 下启动也要 **5–120ms**（F-1 读数），比销毁路径上那个 0ms 兜底**晚**，所以「先取消、再销毁」对**待启动**的动画在真实运行时大概率不成立 | **KEEP 为测试工具 + 登记** | 夹具的「几乎瞬时启动」是让「推迟到安全窗口」这条路径**可测**的必要简化（否则只能用真实时间等 100ms，用例会脆）。口径：该用例证明的是**本库的排序逻辑**在窗口成立时正确，不证明真实运行时一定落在那个顺序上——真实排序见 ADR 已知限制「动画的迟到启动窗口无法彻底关闭」 |
| ~~`driver-contract` 适配器上的 `expectation?: "fixture" \| "live"` 一档~~ | ~~`test-utils/driver-contract.ts`（一支开关 + 三处跳过分支）~~ | — | — | **REMOVE（#127 落地）** | **#127 选了 (a) 删除**：这一档 + 三处跳过分支已删，两个 harness 的 `expectation` 字段一并摘掉。**为什么 (b) 在道理上就不成立**：live 侧并不是「没有契约」，而是有**本文件不提供的第三档口径** —— `tests/browser/jsapi-v4/` 那条 runner 把「前置不成立」（AK 权限 / 配额 / Referer / 网络）记成 `blocked`（退出码 3，不可放行），与「库回归」的 `fail` 严格分开（规则见 `report.mts`；`registry.mts` 只负责把 `service-geocode` 登记进 live 档）。真实环境「必须成功」既做不到也不该写进契约；而这一档的处置只是把断言**静默跳过**，两头不靠。删除不丢覆盖：两个调用方都传 `"fixture"`，那三处 `live` 分支是**死代码**，而 `panorama-viewer` 在 live 档本就不登记（`registry.mts`，「live 需要真实全景场景」） |

---

## 待取证（probe 债务）

| 编号 | 待证事实 | 当前状态 | 约束 / 处置 |
| --- | --- | --- | --- |
| F-1 | `startViewAnimation` 的启动窗口：`animationstart` 是否真的在内部 Animation 构造前同步派发、启动前 `cancelViewAnimation` 是否真的抛 `TypeError` | **已结清（2026-09-21，真实 AK + headless Chromium）**。读数（同一轮里逐条复现，判据全部是「对象自身的结果」）：① `delay: 0` 时 `animationstart` 在调用返回后 **5–120ms** 才到（**不是**同步派发；`delay: 900` 时约 **1.28s**）；② 从未起播的实例上 `cancelViewAnimation` → `TypeError: Cannot read properties of undefined (reading 'cancel')`（`pauseViewAnimation` 报 `reading 'pause'`、`continueViewAnimation` 报 `reading '_doStart'`）；③ 在 `animationstart` **处理器里同步**取消 → 同样抛 `reading 'cancel'`，且动画照旧跑到末帧（视图确实推进 ⇒ 那次取消没生效）；④ 在 `animationstart` 之后的**微任务**里取消 → 不抛错、派发 `animationcancel`，视图停在**该段首帧**（末帧未到达）；⑤ 未显式取消就再 start 一段：前一段**不**派发 `animationcancel`、照旧跑到自己的 `animationend`，新一段的启动被推迟到不可预期时刻（实测 +0.9~1.6s）⇒ 重叠期里两段都在推进视角，「一张地图同时跑两段动画」不可依赖；⑥ 未启动时直接 `map.destroy()` 不抛错，之后仍派发一次 `animationstart` 且再无 end/cancel（销毁后动画就地停摆）；⑦ **待启动旧段的「清场」只能延后交付**（2026-09-21 追加，#122 评审 P1）：`startViewAnimation` 提交新段时，旧段仍在启动窗口 ⇒ `cancelViewAnimation` 拿不到交付（`TypeError`），**新段先提交**，旧段的取消落在**它自己的** `animationstart` 上（实测两段事件相隔 **0.0–0.3ms**）。实测这条路径的代价很小：两段朝**相反**方向走时，重叠期的最低 zoom 是 **14.07**（起始 14、旧段末帧 10、新段末帧 17）⇒ 旧段来不及驱动视角，轨迹只朝新段末帧走。**gate**：live smoke 的 `view-animation-cancel-window`（required）把 ①②③④ + ⑤/⑦ 的形状变成可回归断言，并自带正证控件（一段正常播放必须真的把视图推到末帧，否则「取消之后没推进」是空转；⑦ 的子场景也要求新段跑到自己的末帧） | 据此把 ADR 的措辞精确化（「同步」只存在于**派发与内部控制器构造之间**，相对 `startViewAnimation()` 返回是异步的）；把「起播前清场」按**两条路径**拆开写（已启动=提交前交付 / 待启动=旧段自己的安全窗口交付），并写明承诺粒度是「在最早的合法时刻交付取消」而不是「提交新段前图上一段不剩」；同时写明「0ms 兜底几乎总是先于动画启动到期」这一真实排序。**仍然不许把该时序升级为对外承诺**：它是官方行为，官方可以改 —— 这正是 gate 的用途。**本条只覆盖「start 窗口 + 取消时序」**：Map 级 `pauseViewAnimation` / `continueViewAnimation` 既没有生产者、也没有取证计划（`plugins/compat-inventory.ts` 里那两条只是外部插件用到的成员清单），要开放它得先单立一张 probe 票，不算本条已覆盖范围 |
| F-2 | 官方 JSAPI 的 JSONP 回调全局名占用与「别人也注册了同名回调」的判定 | `ASSUMED` | 只在 `customScriptV4Provider` 的 jsonp 分支生效，不进 Stable 承诺 |
| F-3 | SDK 实例 `destroy()` / `dispose()` 是否幂等、销毁期是否真会回调业务 | 已有反例、无正向读数：**唯一相关读数是 ADR 2026-09-12 的 smoke 记录**「真实 4.0 在**未加载场景**的实例上 `destroy()` 会抛 `TypeError`」（见该 ADR 的「真实 AK smoke 记录」）。它只能说明「不是无条件幂等」，**不能**支撑「重复 destroy 不抛错」 | guard 保留；契约措辞一律写「本库保证」而非「官方保证」。归 **#128** 取证；在取证之前，这类断言**不允许**被写成官方承诺（`driver-contract.ts` 的两处注释已在第三批按此收窄） |
| F-4 | 原生 `addEventListener` 在同一函数重复注册时是否去重 | 未证 | 只影响测试期望数字，不影响生产路径 |

> F-1 的读数原始输出不入库（与仓库既有约定一致，见 `docs/zh-CN/contributing/official-packages.md`）。
> 复现方式是单跑那条 gate（`BAIDU_MAP_AK=<ak> pnpm smoke:v4`），它的 `detail` 就是上面那几条读数。
> **F-2 / F-3 / F-4 仍未取证**，各自的约束照上表执行；本票只结清 F-1。

新增 probe 的落点与既有三臂对照实验的写法，照 `scripts/probe-layer-events.mts` / `probe-plugin-runtime.mts`（读数提交进 inventory 或 `tests/behavior/fixtures/*.live.json`）。

## 本票的代码处置

- **A1**：删除 `Autocomplete` 的程序化检索与归属层（Driver 侧约 640 行 + 类型面 + 出口 + 探针槽位 + 契约条目 + 归属类用例），Fake 侧同步删掉 `keyword`/`respond` 建模。
- **A2**：`useViewAnimation` 重写成公开面（`start` / `cancel` / `status` / `ready`），删除私有成员读写与 `setKeyFrames` 两段式。补上的首份行为用例（该 hook 原先零覆盖）另外暴露出两处既有缺陷：取消原先排在微任务里，而 `<Map>` 在父组件 `onUnmounted` 销毁地图 ⇒ 每次卸载抛一个无人接收的 `BMAP_RESOURCE_DISPOSED`；监听释放原先共用一个槽位 ⇒ 被取代那段的 `animationcancel` 会摘掉新段的订阅并把状态写回 `idle`。两处都改为**每段自带现场 + 同步取消**。#105 评审第二、三、六轮又追出四处同源问题（详见第 2 节的动画各行）：归属被提前清掉（丢重试入口）、新段在起播被拒前就提交现场、卸载中取消失败打断钩子并留下订阅、以及把「收到 `animationcancel`」当成所有权交付的唯一凭据；现在分成**观察对象 / 订阅释放 / 是否仍需重试**三件事，收尾统一走带身份守卫的 `finishRun`，共补 12 条回归；为此给 `MapDriver` **新增**了 `cancelViewAnimation(map, animation)`（官方 `Map#cancelViewAnimation(viewAnimation)` 的形状），它随本票一起进 #44 的冻结面。
- **A3**：删除 `useBMapTrackAnimation`（hook + 文档页 + 示例 + 行为用例 + 侧栏条目），并把「不向用户承诺该 hook」钉成一条审计用例。
- **B1**：MapDriver 动画 teardown 判 **KEEP**；其两条前提原为 `FAKE-ONLY`，**第二批已用真实 AK 取证**
  并升级为 `PROBED`（ADR 注记 + 本表 F-1 + live gate `view-animation-cancel-window`）。
- **R1–R11**：全部落地，逐项删净实现、出口、引用、生成物与文档承诺（矩阵与 JSON 重生成后为 **62 条能力**；`v3-default-loader-boundary` 从「调用它」改成「断言它不存在」）。R6 删掉 `shouldFullReplace` 之后暴露出的 `DataLayerManager.sync` 死形参登记在第 5 节，**main 上的 #34 已把它连同整个位置签名一起改掉**。
- **第三批（实施步骤 6，公共面复核）**：`useMapResource` 一族 **REMOVE**、`SdkRegistry` 的零消费者
  冲突开关（`conflictPolicy` / `onConflict` / 两个类型）**REMOVE**、`resetProcessSdkRegistryForTests`
  **内部化**、`driver-contract` 的「dispose 幂等」注释与用例标题按 F-3 收窄；复核结论落成门禁
  `tests/behavior/v3-core-surface.test.ts`。详见文末「第三批」一节。
- 文档纠偏：`AGENTS.md` 的归属约束与能力族清单（`Runtime` 已随 R10 删除）、`<Autocomplete>` 组件页、`useViewAnimation` 文档与示例、迁移对照表新增三行、`docs/zh-CN/components/map.md` 的 `status` 取值、六处 ADR 的 superseded / 复核指针、能力矩阵重生成。

**没有**为了本次审计新建任何通用 Runtime / 状态框架（验收项 4）。上表标 SIMPLIFY 而三批都未做的行，全部是「要连带改夹具或改公共出口」的一类：**第三批把其中「纯删就完事」的收掉了，剩下的逐条登记到 #44**（评论已留），需要独立决策 / 测试 / 取证的另开票（#126 / #127 / #128），都不混进本票以免评审分不清两件事。

## 第二批（2026-09-21，PR #122）：issue「实施步骤 4」的动画面

issue 的实施顺序里第 4 步是「**MapDriver animation teardown**：在 2/3 收窄后重新评估，可删多少删多少，
但真实 destroy 责任保留」，而第 1–3 步（Autocomplete `suggest` / `useViewAnimation` /
`useBMapTrackAnimation`）都在第一批完成了。这一批做的正是第 4 步，顺序是**先取证再动手**：

1. **F-1 取证**（真实 AK + headless Chromium，七条读数见上表）：两条前提成立，措辞需要精确化；
   另外顺手量到四条此前没有依据的行为（未显式取消就再起播、销毁后迟到启动、清场前先应用首帧、
   待启动旧段的清场只能延后交付）。
2. **落成 gate**：live smoke 新增 `view-animation-cancel-window`（required），把四条最关键的行为
   拿到可回归断言里 + 一个正证控件；**#122 评审 P1 之后又补了第 5 个子场景**（待启动旧段的清场时机）。
3. **删掉能删的那一个**：`MapDriver.stopViewAnimation(map)` —— 零生产消费者、理由是已删除的
   webgl-v1、语义与按实例所有权冲突。`cancelAllAnimations` 因此只剩起播前清场与销毁两个调用者。
4. **teardown 本身判 KEEP**：取证之后它的每一部分都有人管（`started` 是安全窗口判据、
   `deferredFinish` + `fallbackTimer` 保证销毁既不早于取消也不被一个不启动的动画挂住、
   `released` / `tornDown` 是重试入口的记账）。清场的实测依据要**按两条路径分开读**（详见 F-1 ⑤ 与 ⑦）：
   **已启动**的旧段是即时交付的，不显式取消时实测两段会在重叠期同时推进视角 —— 这是「取消失败就拒绝替换」
   与「起播前尽力清场」的真实依据；**待启动**的旧段此刻交付不了（新段先提交），
   所以这里的承诺是「在最早的合法时刻交付取消」，不是「提交新段之前图上一段不剩」
   （#122 评审 P1 纠正的就是这一点）。

**这一批刻意不做的**：Map 级 `pauseViewAnimation` / `continueViewAnimation`（没有消费者，
F-1 不覆盖它们，要开放得先单立 probe 票）；`FakeV4ViewAnimation` 的 0ms 启动建模（它是让安全窗口
路径可测的必要简化，按第 7 节登记，不改成真实时间等待）。

**GitHub 侧交接：已完成**。#104 验收要求把四条约束写进 #12 与所有未开工的 roadmap issue。
按 issue 正文核对（不是按印象）：**#12 / #32 / #33 / #35 / #36 / #37 / #43 / #44 / #45 / #46 十张票
都带 `<!-- ownership-first:2026-09-19 -->` 标记与对应约束**（fallback 不恢复内部身份、不建第二套
Runtime、先做具体场景再提共性、测试以业务结果与资源释放为主）。约束同时已进 `AGENTS.md`，本表是事实源。
后续开新票时沿用这个标记，`gh issue view <n> --json body` 就能扫出覆盖面。

## 第三批（2026-09-22，PR #129）：issue 实施步骤 6 的「#44 冻结前公共面复核」

前两批做的是实施步骤 1–4（删抽象 / 收窄 hooks / 取证动画窗口）。这一批做**最后一步**：

> 6. **#44 冻结前完成 API/public-dts 复核，确保内部恢复机制不被误冻结成公共 API。**

「复核」在本仓的形态是**逐项判据 + 一条会真变红的门禁**，不是一次阅读。做法：

1. **逐项核对 `./core` 上「零消费者、但会随 #44 冻结进 3.0」的名字**，然后按「改它要不要连带动夹具或
   命名约定」分成两堆 —— 纯删的一堆在本批做掉，牵连夹具 / 命名约定的一堆**登记到 #44**（评论已留，
   清单在那条评论里；本表第 3–6 节的处置列同步指向它）。
2. **落成门禁**：`tests/behavior/v3-core-surface.test.ts`。三层判定，各自都能被证伪：
   - **值导出层**（`Object.keys`）：被删的值导出不得出现在根入口 / `./core` / `./advanced` 任一处；
   - **声明文本层**（`Object.keys` 看不到的类型与选项字段）：剥注释后扫 `dist/*.d.ts`，
     并配 **正证**（同一条判定式对一个确实在面上的名字必须命中）与 **反误报**
     （注释里提到不得命中 —— 本文件与 `core/index.ts` 都在注释里写了这些名字）；
   - **机制仍在层**：被「内部化」的东西必须仍在源码里。只写「它不在出口上」时，
     「机制被整段删掉」与「机制被内部化」都会绿，但两者结论不同。
   - 另加一条**可推广的不变量**：公共出口不得出现 `*ForTests` 后缀的名字（测试辅助不该被承诺）。
3. **反证（本批最值钱的一步）**：在 `git archive HEAD` 出的干净快照上（补 `dist` 与软链 `node_modules`）
   跑同一份门禁 → **3 条红、3 条绿**，且绿的那 3 条正是正证与包级前提。这证明门禁的
   判别力来自「有没有收口」，而不是来自「判定式恒真」。

**本批的代码处置**（逐条依据见上表对应行）：

| 项 | 结论 | 处置 |
| --- | --- | --- |
| `useMapResource()` / `SdkResourceAdapter` / `UseMapResourceResult` | **REMOVE** | 文件 + 单测删除，三处出口名摘掉（零生产消费者；被 `useSdkResource` 取代，后者文件头自陈） |
| `SdkRegistry` 的 `conflictPolicy: "warn" \| "ignore"` / `onConflict` / `SdkConflictPolicy` / `SdkConflictInfo` / `policy` | **REMOVE** | 冲突处置收成唯一行为（恒 reject `BMAP_SDK_CONFIG_CONFLICT`）；ADR 2026-09-10 决策 6 加取代注记（**点名取代「后半句」**），ADR 2026-09-13 与本表第 3 节同步；`url.ts` / `url.test.ts` / `official-packages.md` 里「指纹会进 … 与 `onConflict`」的凭据脱敏依据改写为「指纹会进冲突消息」 |
| `resetProcessSdkRegistryForTests` | **内部化** | 从 `./core` 出口摘掉（实现与行为不变；仓库内测试一直按相对路径 import 源文件）。`v3-advanced-contract.test.ts` 的正证清单随之调整，那份「它必须在 `./core` 里」的正证改由新门禁的负向清单承担 |
| `driver-contract.ts` 两处「dispose 幂等」注释 + 两条用例标题 | **措辞按 F-3 收窄** | 不再声称「SDK 侧的移除对未挂载资源是 no-op」；明确判据是**夹具（Fake）那一侧的假账本**（销账不变成负数），它既不是官方幂等性的证据，也不是生产库记账的证据 |

**本批刻意不做的**（都写清去处，不留悬空）：

- `MapRuntimeOptions.clientFactory`、`MapRuntimeStatus` 的 `"loading"` 别名、单成员别名 `LoadedSdk`、
  `client.version`、`optionKey()` 的一行转发、`UseSdkResourceOptions`
  → **#44 的出口收窄**（清单与理由已在 #44 的评论里，含「为什么要连带改夹具」）。
  （`useServiceTask` 的根出口外泄**已由 #139 结清**，见上表处置列；）
- 能力目录的 `engines` 维度与 `engine-unsupported` 原因 → **#126**（Decision；**已落地**：
  删列 + reason 改名 `unlisted-capability`，见上表处置列与 ADR `2026-09-24-single-engine-capability-catalog`）；
- 两处无判别力的内部判据（`BMap.mountMap()` 的防御性前置、`driver-contract` 的 `expectation` 档）→ **#127**（Test Debt）—— **已结清**：`mountMap()` 的前置保留并补上能翻红的用例，`expectation` 档连同三处跳过分支删除；
- 探针债务 F-2 / F-3 / F-4 → **#128**（Probe Debt）；
- **不冻结 `./core` 的全量导出面**（113 个值导出）：那是 #44「冻结 core 出口」的交付物，#104 只负责
  「把不该被冻结的先收掉」。门禁里刻意写成「被删名单 + 不变量」而不是精确集合，就是为了不抢这一步。

## 剩余欠账与归宿（#104 关闭条件 4）

本票的关闭条件是「剩余非阻塞欠账都有独立 Issue 和清楚的分类」。逐条对照：

| 欠账 | 分类 | 归宿 |
| --- | --- | --- |
| 能力目录 `engines` 维度 / `engine-unsupported` | Decision | #126（**已关闭**：删列 + 改名 `unlisted-capability`） |
| ~~`BMap.mountMap()` 防御性前置、`driver-contract` 的 `expectation` 档~~ | Test Debt | ~~#127~~ **已结清**：`mountMap()` 保留 + 补出能翻红的用例（删掉实测变红）；`expectation` 档删除 |
| F-2 / F-3 / F-4 三条未取证的第三方语义 | Probe Debt | #128。**其中 F-2 是 issue 验收标准第 5 条点名的那一类例外**：`SharedLoadTask` 的进程级 `callbackRegistry`（全局名占用 / foreign 回调判定）是审计表里**唯一保留**的「恢复上游未公开身份」处，而该验收标准要求「若存在例外，必须逐项写明 live guarantee 与 gate」——现状只有「不进 Stable 承诺」这句措辞与一张 probe 票，**既没有 live guarantee 也没有 gate**。→ 这一条在 #104 的账面上**记为未满足**（不是「已登记即满足」）：#128 的第一次取证必须先给出 guarantee 措辞与可回归 gate，在给出之前它**不得**被 #44 冻结进 Stable 承诺 |
| 7 项出口收窄 / 命名收口（第 3–6 节的 SIMPLIFY 行） | Stable 冻结前动作 | #44（评论已登记）+ 本表处置列 |
| `useServiceTask` 文档只字未提 | 同上（#44 的出口收窄） | **#139 已结**（内部化，不给文档页） |
| `getProcessSdkRegistry(domain, options)` 的首参与 `options.domain` 语义重复（删掉冲突开关后 `SdkRegistryOptions` 只剩 `domain`，三个 Provider 都写成 `getProcessSdkRegistry(JSAPI_V4_DOMAIN, { domain: JSAPI_V4_DOMAIN })`） | 出口形状收窄 | #44（与上面 7 项同批；本批只登记，不顺手改签名） |
| `#101` 的 InfoWindow `openOutstanding` 一族 | 非目标 | 已在 #101 原 PR 内按 ownership/reconcile 纠正 |
| `DataLayerManager` / Native Layer 失败恢复的直接测试 | Test Debt | #113。前置已满足：本表第 4 节（generation / epoch stale guard）与第 5 节（`native-layers.ts` 的 `supports()` 刻意不采纳实测可用的成员）都判 **KEEP**，即那套机制属于「真实所有权复杂度」而不是要 SIMPLIFY 的镜像状态（注意：本表**没有**「失败恢复状态机」的专行，`#113` 正文里的「前置」指的是这两行） |
| `docs/.vitepress` 里那个插件名残留的死文件 | 文档卫生 | #90（纯 docs 清理，不阻塞发布） |

**不需要等这些票关闭才关 #104** —— 否则又会把「证据优先」变成「发布前补全一切」。

