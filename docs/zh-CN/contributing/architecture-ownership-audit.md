# Ownership-first / Evidence-first 存量审计表

> 对应 issue **#104**（P1，Stable 阻塞，须在 #44 冻结公共出口前完成）。
> 原则四条已写进仓库根的 `AGENTS.md`（「服务层的硬约束」一节之后新增的 Ownership-first 段落）。
> 决策记录侧：[ADR 2026-09-11（视角动画复核注记）](../../adr/2026-09-11-jsapi-v4-map-facet.md)、
> [ADR 2026-09-12 决策 5（已 superseded）](../../adr/2026-09-12-jsapi-v4-service-panorama-native-layers.md)、
> [ADR 2026-09-14 非目标（已兑现）](../../adr/2026-09-14-service-lifecycle-and-local-search.md)、
> [ADR 2026-09-14 删除旧引擎（已知限制第 2 条已被取代）](../../adr/2026-09-14-remove-legacy-engine.md)。

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
| `suggest()` 的程序化归属层：`pendingSuggest` 队列 + 同关键词互斥 + FIFO 退化 + 「通道独占」前置条件（`watchInputActivity` / `isTypableInput` / `loseExclusivity` / `EXCLUSIVITY_LOST_HINT`） | `driver/jsapi-v4/services.ts`（原 814-1053 段） | **生产 0**。只有自身单测与 `facet-probes` 探针；`<BAutoComplete>` 渲染可输入输入框、结构上不可能是消费者 | `FAKE-ONLY`：顺序来自 `FakeV4CallbackQueue` 发明的微任务 FIFO，关键字来自 `includeKeyword` 发明的回填 | **REMOVE** | #104 A1：整段删除。`Autocomplete` **不进归一化调用面**，构造时传 `onSearchComplete` 原样转发；`PlaceSuggestion` 类型与 `ServiceInvocationDriver.suggest` 一并从出口摘掉；`service.autocomplete` 由 `experimental` 回到 `native`（它唯一的降级理由就是这条假设） |
| `LocalSearch` 的「一个实例同一时刻最多一个未结算操作」 | 同文件 `invokeSlotOperation` | 7 个 service composable + 组件 | `OWNED`：身份是**实例自己**，不需要按到达顺序猜 | **KEEP** | — |
| `useBMapServiceTask` 的 `supersede`（取代即换新实例） | `composables/useBMapServiceTask.ts` | 全部 service composable | `OWNED` | **KEEP** | — |
| 超时 / 空结果 / 迟到回调 / 先到者胜 | `driver/normalize/serviceCall.ts`（单一实现点） | 全部归一化调用 | `OWNED` + `OFFICIAL` | **KEEP** | — |
| ADR 2026-09-12 决策 3 的 `normalize/jsonpProbe.ts`（两引擎共用的空/失败嗅探） | — | — | — | 已消失 | #26 单引擎收敛时随文件删除；本表记录在案，避免按 ADR 原文再找这个模块 |

## 2. 状态镜像与动画

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `useBMapViewAnimation` 的 `stop()` / `proceed()` → `handle.raw._pause` / `_continue` / `_cancel` | `composables/useBMapViewAnimation.ts`（原 98/105/114 行） | 只有文档页与示例引用 | 官方 4.0.4 **没有**声明这三个成员 ⇒ 私有面 | **REMOVE** | #104 A2：收窄为 `start(keyFrames)` / `cancel()` / `status` / `ready`。静态门禁抓不到 `handle.raw.*`（`check:raw-sdk` 只匹配 `BMap`/`BMapGL` 标识符），所以这条靠审计而不是靠 gate |
| 同 hooks 的 `viewAnimation` 句柄 ref + `setKeyFrames` 两段式 + `disableDragging` | 同上 | 只有文档 | 句柄每次 `start()` 都被换掉、`disableDragging` 从未生效 ⇒ 退化成常量 | **REMOVE** | #104 A2 一并删除；`status` 改成**观察值**（`idle` / `playing`），命令不乐观改写它 —— 唯一例外是本库对自己那次取消的交付确认（形状见下面两行） |
| MapDriver 的视角动画 teardown：`AnimationRecord{started,settled,cancelRequested}` + `Teardown{disposed,disposing,tornDown,released,deferredFinish,fallbackTimer}` | `driver/jsapi-v4/map.ts:193-210` | `MapDriver.destroy` / `startViewAnimation` / `stopViewAnimation`，约 20 条行为用例 | 记账对象是**我们自己**发起的启动/取消/销毁次序 ⇒ `OWNED`，合法；但它的前提「`animationstart` 在内部 Animation 构造前同步派发、启动前 `cancelViewAnimation` 抛 `TypeError`」是 `FAKE-ONLY`（只有 `FakeV4ViewAnimation` 建模，仓库无 probe 脚本、无 live 读数） | **KEEP + 待取证** | #104 B1：保留（它不恢复 SDK 的因果身份），但把口径改成「防御模型」，不得对外承诺该时序；取证登记为下方 **F-1**。ADR 2026-09-11 已加复核注记 |
| 同一处前提在 hooks 侧的两处**残留用法**：① 被取代那一段的三条监听只由该段的 `animationcancel` 释放；② `cancel()` 发的是**整张图**的 `stopViewAnimation(map)` | `composables/useBMapViewAnimation.ts`（`AnimationRun` / `start` / `stopRun`）＋ `driver/jsapi-v4/map.ts` 的动画记录 | 该 hook 自己（`EventDriver.groups` 是强引用 Map，未释放即泄漏）；以及跨 hooks：同一张图上另一个 `useBMapViewAnimation` 的在飞段 | 两处都依赖同一条 `FAKE-ONLY` 时序。②最要命：`stopViewAnimation` 的范围是整张图，于是**「保留重试入口」与「不牵连别人的动画」互斥** —— #105 第三轮以「H1 第二次 cancel 停掉了 H2 的 B」打中一次，第六轮以「延迟取消失败后 H1 永久失去重试入口」打中另一次；把 `cancelCommitted` guard 去掉实测就红，确认两条不能同时满足 | **SIMPLIFY（本票已做）** | 取消换成官方本来就有的**按实例**命令：给 `MapDriver` 加 `cancelViewAnimation(map, animation)`，v4 实现只挑该实例那一条记录、复用 `cancelAnimation`，并返回本库侧的交付状态 `canceled / deferred / already-settled`。hooks 据此把三件事分开：**当前观察对象**（`current`）、**取消是否仍需重试**（`undelivered`）、**每段自己的监听**（交付即释放）：`deferred` 保留重试入口（第二次 `cancel()` 真打到 SDK），已交付则幂等收尾且不补发命令（补发要假设 SDK 幂等，属 F-3 未证）。回归：`v3-useBMapViewAnimation.test.ts` 的「取消失败时保留重试入口」「deferred 与已交付的取消走不同的收尾」「收尾按动画身份收敛」三节，加 Facet 侧 `map.test.ts` 的「只碰传入的那个实例」。**公开的语义不建立在『接管时旧段监听恰好已释放』这个时机上**：接管那一支确实会当场释放旧段监听（晚到的旧段事件因此进不到收尾），但即便某条路径让旧段带监听回来，`finishRun` 的身份守卫也已经挡住它清掉新段的 `playing` —— 所以正确性由守卫保证，不靠巧合 |
| `useBMapTrackAnimation` 的插件状态机（`INITIAL` / `PLAYING` / `STOPPING` / …） | 原 `composables/useBMapTrackAnimation.ts` | **生产 0**：v4 上 `createTrackAnimation()` 必抛 `BMAP_CAPABILITY_UNSUPPORTED` | 状态机的全部可达分支 = 一条失败分支 ⇒ 退化成常量 | **REMOVE** | #104 A3：hook、文档页、示例、行为用例全部删除；轨迹走原生图层 `track-line`，插件侧结论仍在 **#43**。参考实现 `huiyan-fe/react-bmap`（236 个 TS 文件）没有任何 TrackAnimation 抽象 |
| suspension reason 集（`user` / `keepAlive` / `document` / `offscreen` / `disposed`）、boot 单飞 + `deferredWaiters` + 0ms 活性兜底、`tileLoadObserver` 的两本账 | `core/runtime/suspension.ts`、`components/map/BMap.vue:691`、`components/layers/tileLoadObserver.ts` | 生产，组件生命周期 | `OWNED`；`tileLoadObserver` 另有 `PROBED`（`scripts/probe-layer-events.mts` 三臂对照 `12 / 0 / 12`） | **KEEP** | 反面样板：`tileLoadObserver.ts:38-40` 明确**拒绝**做瓦片回包归属，只记所有权 |

## 3. Loader / Provider / SDK Registry

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| 自研 `ScriptLoader`（script/jsonp transport + 在飞/已完成缓存） | `core/loader/ScriptLoader.ts` | 只有 `customScriptV4Provider`（显式高级路径）；`v3-default-loader-boundary` 证明默认路径不碰它 | `OFFICIAL` 缺口（官方 loader 不支持非标准入口） | **KEEP** | 默认路径已在 #71 回到官方 loader |
| `SharedLoadTask` 的进程级 `callbackRegistry` + 全局名占用 / foreign 回调捕获 | `core/loader/SharedLoadTask.ts:98` | 高级 jsonp 分支 | `ASSUMED`（官方 JSONP 回调命名是我们的读法，未取证） | **KEEP + 待取证** | 唯一保留的「恢复上游未公开身份」处：它服务的是显式高级路径，且**不**进 Stable 承诺。取证登记为 **F-2** |
| `SdkRegistry` 的 `conflictPolicy: "warn" \| "ignore"` + `onConflict` | `core/loader/SdkRegistry.ts:71-73` | 三个 Provider 一律不传 ⇒ 只有单测可达 | 无消费者的分支 | **REMOVE** | 随 **#44** 的出口冻结一起做（同一批还有 `resetProcessSdkRegistryForTests` / `resetGlobalCallbackRegistryForTests` 从 `./core` 公共出口摘掉） |
| `SdkRegistry.cancellable`（官方 loader 不可取消 vs 自研可取消） | 同文件 `:53` | 三条 Provider 路径 | `OFFICIAL` | **KEEP** | — |
| `createBaiduSdkUrl()`（旧 CDN 入口拼装） | 原 `core/loader/url.ts` | **生产 0**，但挂在 `./core` 出口上、被边界测试直接调用 | 迁移期遗留 | **REMOVE** | #104 R9：函数与其私有选项类型一并删除；`v3-default-loader-boundary` 改成**存在性否定**门禁（默认静态模块图里搜不到这个名字，同时正面证明 `core/loader/url.ts` 确实在图中） |
| `providers/official.ts` 的 `OFFICIAL_LOADER_UNSUPPORTED_KEYS` 显式报错 | `:82-110` | 默认路径 | `OFFICIAL`（官方选项面） | **KEEP** | 「接收后忽略 = 假支持」的守卫本身，不是镜像 |
| `markRejectedJsapiV4Global` / `isRejectedJsapiV4Global`（WeakSet 标记自家被拒残留） | `providers/namespace.ts:169-181` | 写入 `providers/load.ts:46`，读取 `providers/reuse.ts:68` | `OWNED`（跟的是我们自己的写） | **KEEP** | — |
| `LoadedSdk = LoadedJsapiV4` 单成员别名；`client.version` 的 `@deprecated` 别名 | `core/loader/loaded.ts:30`、`client/types.ts:53` | 类型层 | #26 删引擎后失去意义 | **SIMPLIFY** | 随 #44 的 public-dts 复核一起收口（先出一次 release note） |

## 4. MapRuntime / 生命周期

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| 六条资源路径的 generation / epoch stale guard、`PluginHost.epochNumber`、`PluginRegistry.record.generation` | `core/composables/*`、`core/plugins/*` | 生产 | `OWNED`：比较的是「这还是我创建的那个实例/作用域吗」，**不**归属 SDK 回包 | **KEEP** | 本票的非目标：不因「看着复杂」删掉真实所有权机制 |
| `ResourceScope` 的六个定时器别名（`requestAnimationFrame`+`frame`、`setTimeout`+`timeout`、`setInterval`+`interval`）与 `addCancellable` | 原 `core/lifecycle/ResourceScope.ts` | **生产 0**（只有同名测试在用） | 与 `core/scheduler/FrameScheduler` 重复的转发面，且两套语义还不一致（`setTimeout` 返回裸 id、`timeout` 返回 disposer） | **REMOVE** | #104 R1：六个别名 + `addCancellable` 全删；`ResourceScopeV2.test.ts` 里仍有效的 5 条（label/size、onDisposeError、fork×2、parentSignal、dispose reason）并入已存在的 `ResourceScope.test.ts`，3 条定时器/RAF 用例随被删实现一起消失 |
| `useResourceScope.ts` | 原 `core/lifecycle/useResourceScope.ts` | **0**（只有两行出口） | — | **REMOVE** | #104 R2：文件与两处出口删除 |
| `MapRuntimeOptions.clientFactory`（与 `clientContext` 二选一） | `core/runtime/MapRuntime.ts:74` | 只有 3 个测试文件 | 无生产消费者的第二条臂 | **SIMPLIFY** | 后续票（收口要连带改 `v3-context-runtime-lifecycle` 的夹具） |
| `MapRuntimeStatus` 的 `"loading"` 别名 | `core/context/types.ts:30` | 类型层，#71 起运行期不再写 | `OWNED` 但已过时 | **SIMPLIFY** | **本票已修文档承诺**：`docs/zh-CN/components/map.md` 两处不再把 `loading` 写成会发出的状态；类型别名到 #44 一并收 |
| `BMap.vue:819-824` 的防御性前置检查（文件自陈「删掉整句，1799 条用例仍全绿」） | `components/map/BMap.vue` | 无 | `UNKNOWN` | **SIMPLIFY** | 后续票：要么补一条能翻红的用例，要么删 |
| `PanoramaStatus` 七态（运行期只有 `error` 被内部读） | `core/panorama/index.ts:34-50` | `BPanorama.vue` 公开 expose + 文档页列全 | `OWNED` + 已文档化 | **KEEP** | 外部消费者无法自证为零，故不在本票删除 |

## 5. Overlay / Layer / Control / Panorama 与 Capability Catalog

| 机制 | 位置 | 消费者 | 证据 | 结论 | 处置 |
| --- | --- | --- | --- | --- | --- |
| `LAYER_DESCRIPTORS` 的 `declared` / `signature` / `ctorSlots` / `mutable` / `bagSetters` + 约 10 条类型层断言（含**负向**断言：`district` 不得长出 `setZIndex`） | `driver/jsapi-v4/layers.ts:108-248` | 生产（`LayerSpec` → `useLayerResource`） | `OFFICIAL` | **KEEP** | 正面样板：读不回就**拒绝**，不猜 |
| `native-layers.ts:111-115`：实测扩展图层**确实**继承了 `setVisible/setOpacity/setZIndex`，但 `supports()` 仍答 unsupported | 同文件 | 生产 | `PROBED` 且刻意不采纳 | **KEEP** | 与「用私有面补齐」相反的选择 |
| `engines` 维度 + `CapabilityReason: "engine-unsupported"` | `driver/capability/catalog.ts:118-129` | 单引擎后只剩「目录未收录」一条可达路径（用例已把这句话说成结论） | 已登记的退化 | **SIMPLIFY** | 已在 ADR 2026-09-14 记为独立欠账，须与矩阵列一起重生成 ⇒ 后续票 |
| `runtime` 能力族四条（`resource-scope` / `capability-override` / `fake-sdk` / `async-task`） | 同文件（原 `:745-776`） | **没有任何** `supports()` / 组件 / 测试按 id 问过；只被「每个 family ≥1 条」这条断言养着 | 类别错误（拿自家模块冒充实测风险等级） | **REMOVE** | #104 R10：删掉这一**族**——四条目录项、`CapabilityFamily` 联合里的 `"runtime"`、以及 `CAPABILITY_FAMILIES` 数组里的那一项；矩阵与 JSON 重生成（62 条能力），「每个 family ≥1 条」的循环随之变成五族。`CapabilityFamily` 类型与 `CAPABILITY_FAMILIES` 常量**本身保留**（`registry.ts:48` 的字段类型、`registry.test.ts:202/292` 在读），本票没删符号。合并 main 之后又扫出同一个幽灵值的最后一处：`registry.ts` 的 `explain()` 里 `?? ("runtime" as CapabilityFamily)` 兜底。（无）（`does.not-exist` 这类未收录 id 是单引擎下 `engine-unsupported` 的唯一入口，两条用例都在走），所以不能删兜底 —— 改成 `CapabilityExplanation.family?` 留空：没有描述符就没有 family 可报，不编一个值。断言在 `registry.test.ts` 的「目录未收录的 id 按 engine-unsupported 拒绝」里 |
| `layer.mvt`、`service.truck-route` 目录槽位 | 同文件 `:487`、`:645` | 只被当作 override/过滤用例的任意 id；ADR 明说「不做 MVT」「不做 TruckRoute」 | 为未实现功能留位 | **REMOVE** | #104 R10（用例改用真实存在的 id，例如 `overlay.mapvgl`） |
| `DataLayerManager.sync(items, getKey, itemVersion, force)` 的 `itemVersion` 形参 | 原 `core/data/DataLayerManager.ts:34` | 两个 data 组件都在传，但 `apply()` **从不读**它（R6 删掉 `shouldFullReplace` 之后彻底没有实现） | 无消费者的参数＝假支持；但类挂在 `./core` 公共出口上，外部调用方按位置传参时会把第 4 个实参错位成 `force` | **SIMPLIFY（已由 #34 落地）** | 本票只登记不删（要连带改 `./core` 的位置签名，与 `SdkResourceAdapter` 同批归 #44）。**main 上的 #34 已经把它做掉了**：`sync(input: DataLayerSync)` 改成对象入参，`version` 真实生效（同引用 + 同版本 ⇒ 零 SDK 调用；版本变 ⇒ 重新读坐标逐项下发），四个位置参数留下的「谁也没表态」问题随之消失。本行保留是为了记住这个形状的坑曾在这里。组件的 `dataVersion` prop 依然成立，走的是同一套版本语义 |
| `useResolvedTarget`（含「找不到 TargetContext 就回落到 Map 的 add/remove」闭包）、`createStaticTarget`、`useOptionalTargetContext`、`useParentOverlayHandle` 里旧 `overlayContextKey` 那条读法 | 原 `core/context/target.ts` | 测试或 0（生产走 `useOverlaySpec` provide 的 `TargetContext`，旧臂在仓内不可达） | 为「可能有外部消费者」留的兼容面，且无任何文档承诺 | **REMOVE** | #104 R7：三个出口与旧读法全删，`overlayContextKey` 这个 InjectionKey 也随最后一个读写点消失；最近 TargetContext / 晚就绪的行为由 `tests/behavior/v3-overlay-spec.test.ts` 的 `TargetProbe` 继续钉住 |
| `optionKey()` 对 `stableKeyOf` 的一行转发 | `core/controls/optionKey.ts:39` | 生产 | 命名转发，无逻辑 | **SIMPLIFY** | 后续票（同文件的 `optionSnapshot` / `changedOptionKeys` 是 #95 的真实修复，KEEP） |
| `DataLayerOptions<Item>`（唯一成员 `minClusterSize` 全仓再无处出现，类也不接受该参数） | 原 `core/data/DataLayerManager.ts` | 0 | 幽灵字段 | **REMOVE** | #104 R8 |
| `#101` 的 InfoWindow `openOutstanding` / `closeOutstanding` / `explicitClosePair` 一族 | `core/overlays/*`、`BInfoWindow.vue` | — | — | 不在本票 | #101 已在原 PR 内按 ownership/reconcile 方向纠正；本票只登记为「非目标」，避免以为还欠着 |

## 6. 无当前消费者的公共出口（#44 冻结前必须清）

| 出口 | 位置 | 消费者 | 结论 | 处置 |
| --- | --- | --- | --- | --- |
| `componentTypeNames` | 原 `src/resolver/index.ts` | 0（`componentManifest` 才是事实源） | **REMOVE** | #104 R4 |
| `defineCapabilityOverride` | 原 `src/advanced.ts` | 0（含 docs / apps / fixtures / scripts） | **REMOVE** | #104 R3 |
| `extractSdkEventNames` | 原 `core/events/EventBridge.ts` | 只有自身测试 | **REMOVE** | #104 R5 |
| `shouldFullReplace` | 原 `core/data/diffData.ts` | 只有自身测试 | **REMOVE** | #104 R6 |
| `useBMapServiceTask`（经 `export * from "./composables"` 外泄） | `src/index.ts:9` | 内部引擎（18 个文件），文档只字未提 | **SIMPLIFY** | 归 **#44**：要么给文档页要么从出口收窄 |
| `SdkResourceAdapter` / `UseSdkResourceOptions` | `core/index.ts:84,89` | 定义处 | **SIMPLIFY** | 归 **#44** 的 `./core` 出口收窄 |
| `BAutoComplete` 里按结构化成员探测 `disposeAutocomplete` 的分支（`as { disposeAutocomplete?: … }`，探测失败即**静默不释放**） | 原 `components/autocomplete/BAutoComplete.vue` 的 `disposeService()` | 0：#26 之后 `BMapEngine` 只有 `jsapi-v4` 一个成员，分支永不成立（注释自己写着「#26 删除 webgl-v1 后这个探测可以收成直接调用」） | **REMOVE** | #104 R11：改成 `jsapiV4ServicesOf(client).disposeAutocomplete(instance)`——按 ADR 2026-09-14 的口径走**可运行时检查**的收窄点，而不是组件里另写一份 `as`。留着的代价不只是死代码：那条静默分支正好会跳过 Driver 侧的订阅记账 |

## 7. Fake 建模反向成为生产契约

原则：**Fake 独有、真实 SDK 未验证的关键语义只能登记为「时序注入 / 防御模型」，不能反过来当证据。**

| Fake 建模 | 位置 | 生产是否依赖 | 结论 | 处置 |
| --- | --- | --- | --- | --- |
| `FakeV4CallbackQueue` 的微任务 FIFO + `delay` + `flushOne(index)` | `fake-bmap-v4/async.ts` | 曾经是唯一「suggest 归属成立」的证据 | **KEEP 为测试工具**，禁止再用于认证任何跨请求顺序 | A1 之后其消费者只剩 LocalSearch 的实例身份路径；`flushOne` 的正当用途恰恰是**打乱**顺序 |
| `FakeV4Autocomplete.respond` / `.includeKeyword` / `AutocompleteResult.keyword` | `fake-bmap-v4/services.ts` | 生产已不读 `keyword` | **REMOVE** | #104 A1 一并删（留着就会有人重新按 keyword 建归属） |
| `FakeMap.destroy()` 幂等 | `fake-bmap-v4/FakeMap.ts:667` | 我们的 guard 保留 | `ASSUMED` ⇒ guard 可以留，**契约不能这么写** | 后续票：`driver-contract.ts:504`、`:610` 那两行注释里的「SDK 侧的移除对未挂载资源是 no-op」要删掉或标明是**对本库记账**的断言——这两条现在只能证伪我们自己的计数，证不伪 SDK 的幂等性（另见 F-3） |
| 销毁期回调重入（`Autocomplete.onDispose` 等） | `fake-bmap-v4/services.ts:328-343` | Map / Panorama / service 三处 guard | `ASSUMED`（注释自己写的是「**可能**触发」） | **KEEP guard**，措辞保持「可能」，登记 **F-3** |
| `addEventListener` 按函数身份去重（注释称「与官方一致」） | `fake-bmap-v4/event-target.ts:24-42` | 生产中立；只有某条用例的期望数字按它算 | `FAKE-ONLY` | 后续票：把该断言改成「夹具记账」口径，或 probe 一次（F-4） |
| Fake 刻意比官方宽松（不剔除未声明 setter） | `fake-bmap-v4/objects.ts:53` 等 | 策略表仍按官方声明守 | **KEEP**（刻意的不对称，`FakeMap.ts:692` 已说明：宽松的夹具会藏 bug） | — |
| `FakeV4ViewAnimation.suppressCancelEvent`（**新加的测试辅助**：取消成功但**不**派发 `animationcancel`） | `fake-bmap-v4/FakeMap.ts` | 只被防御性用例读：取消已交付时 hooks 必须收敛所有权；两个 hooks 共用一张地图时 H1 的重试与卸载都不得碰 H2 的动画 | 它建模的是 F-1 **未证的反面**（官方可能不派发该事件），因此**不能**当官方行为读 | **KEEP 为测试工具** | #105 评审第三轮：Fake 默认一定派发该事件，于是「等事件才交回所有权」在夹具里永远不会出错——生产实现是否依赖它，只有把派发关掉才看得出来。该用例（`第一段取消成功但无 animationcancel…`）证伪的是我们的依赖，不是官方的时序 |
| `driver-contract` 适配器上的 `expectation?: "fixture" \| "live"` 一档 | `test-utils/driver-contract.ts:685`、`:794`（跳过逻辑在 `:720`、`:812`、`:821`） | **两个调用方都传 `"fixture"`**（`v3-jsapi-v4-services-native-layers.test.ts:51`、`:71`），`"live"` 零使用者 | 这是**共享契约适配器**上的一档开关，不是 Fake 对象自身的属性；`smoke-jsapi-v4.mts --mode=live` 是另一条 runner，没有任何代码把这档喂给它 | **SIMPLIFY** | 后续票：要么删掉这一档（连同三处跳过分支），要么真的把它接到 live runner 上再留。本票不动——它不在删除面里，且改它要连带改契约适配器的入参形状 |

---

## 待取证（probe 债务）

| 编号 | 待证事实 | 当前状态 | 拿到读数前的约束 |
| --- | --- | --- | --- |
| F-1 | `startViewAnimation` 的启动窗口：`animationstart` 是否真的在内部 Animation 构造前同步派发、启动前 `cancelViewAnimation` 是否真的抛 `TypeError` | 只有 `FakeV4ViewAnimation` 建模 | Driver 的 teardown 按防御模型保留；对外只承诺「`stopViewAnimation` 之后以 `animationend` / `animationcancel` 为准」。取到读数之前，**任何一处代码都不许把「该事件一定会到」当成所有权判据**——`useBMapViewAnimation` 因此改按「本库自己的交付状态」收敛（`MapDriver.cancelViewAnimation` 的返回值），并由 `suppressCancelEvent` 那几条防御用例钉住（见第 2、7 节）。**F-1 只覆盖「start 窗口 + 取消时序」这一条**：Map 级 `pauseViewAnimation` / `continueViewAnimation` 既没有生产者、也没有取证计划（`plugins/compat-inventory.ts` 里那两条只是外部插件用到的成员清单），要开放它得先单立一张 probe 票，不算本条已覆盖范围 |
| F-2 | 官方 JSAPI 的 JSONP 回调全局名占用与「别人也注册了同名回调」的判定 | `ASSUMED` | 只在 `customScriptV4Provider` 的 jsonp 分支生效，不进 Stable 承诺 |
| F-3 | SDK 实例 `destroy()` / `dispose()` 是否幂等、销毁期是否真会回调业务 | 已有反例（空 Panorama 的 `destroy()` 会抛），正向未证 | guard 保留；契约措辞一律写「本库保证」而非「官方保证」 |
| F-4 | 原生 `addEventListener` 在同一函数重复注册时是否去重 | 未证 | 只影响测试期望数字，不影响生产路径 |

新增 probe 的落点与既有三臂对照实验的写法，照 `scripts/probe-layer-events.mts` / `probe-plugin-runtime.mts`（读数提交进 inventory 或 `tests/behavior/fixtures/*.live.json`）。

## 本票的代码处置

- **A1**：删除 `Autocomplete` 的程序化检索与归属层（Driver 侧约 640 行 + 类型面 + 出口 + 探针槽位 + 契约条目 + 归属类用例），Fake 侧同步删掉 `keyword`/`respond` 建模。
- **A2**：`useBMapViewAnimation` 重写成公开面（`start` / `cancel` / `status` / `ready`），删除私有成员读写与 `setKeyFrames` 两段式。补上的首份行为用例（该 hook 原先零覆盖）另外暴露出两处既有缺陷：取消原先排在微任务里，而 `<BMap>` 在父组件 `onUnmounted` 销毁地图 ⇒ 每次卸载抛一个无人接收的 `BMAP_RESOURCE_DISPOSED`；监听释放原先共用一个槽位 ⇒ 被取代那段的 `animationcancel` 会摘掉新段的订阅并把状态写回 `idle`。两处都改为**每段自带现场 + 同步取消**。#105 评审第二、三、六轮又追出四处同源问题（详见第 2 节的动画各行）：归属被提前清掉（丢重试入口）、新段在起播被拒前就提交现场、卸载中取消失败打断钩子并留下订阅、以及把「收到 `animationcancel`」当成所有权交付的唯一凭据；现在分成**观察对象 / 订阅释放 / 是否仍需重试**三件事，收尾统一走带身份守卫的 `finishRun`，共补 8 条回归；为此给 `MapDriver` **新增**了 `cancelViewAnimation(map, animation)`（官方 `Map#cancelViewAnimation(viewAnimation)` 的形状），它随本票一起进 #44 的冻结面。
- **A3**：删除 `useBMapTrackAnimation`（hook + 文档页 + 示例 + 行为用例 + 侧栏条目），并把「不向用户承诺该 hook」钉成一条审计用例。
- **B1**：MapDriver 动画 teardown 判 **KEEP**，同时把其前提降级为防御模型（ADR 注记 + 本表 F-1）。
- **R1–R11**：全部落地，逐项删净实现、出口、引用、生成物与文档承诺（矩阵与 JSON 重生成后为 **62 条能力**；`v3-default-loader-boundary` 从「调用它」改成「断言它不存在」）。R6 删掉 `shouldFullReplace` 之后暴露出的 `DataLayerManager.sync` 死形参登记在第 5 节，**main 上的 #34 已把它连同整个位置签名一起改掉**。
- 文档纠偏：`AGENTS.md` 的归属约束与能力族清单（`Runtime` 已随 R10 删除）、`<BAutoComplete>` 组件页、`useBMapViewAnimation` 文档与示例、迁移对照表新增三行、`docs/zh-CN/components/map.md` 的 `status` 取值、五处 ADR 的 superseded / 复核指针、能力矩阵重生成。

**没有**为了本次审计新建任何通用 Runtime / 状态框架（验收项 4）。上表标 SIMPLIFY 而本票未做的行，全部是「要连带改夹具或改公共出口」的一类，逐条落到 **#44** 之后的独立票，不混进本票以免评审分不清两件事。

**GitHub 侧交接：已完成**。#104 验收要求把四条约束写进 #12 与所有未开工的 roadmap issue。
按 issue 正文核对（不是按印象）：**#12 / #32 / #33 / #35 / #36 / #37 / #43 / #44 / #45 / #46 十张票
都带 `<!-- ownership-first:2026-09-19 -->` 标记与对应约束**（fallback 不恢复内部身份、不建第二套
Runtime、先做具体场景再提共性、测试以业务结果与资源释放为主）。约束同时已进 `AGENTS.md`，本表是事实源。
后续开新票时沿用这个标记，`gh issue view <n> --json body` 就能扫出覆盖面。
