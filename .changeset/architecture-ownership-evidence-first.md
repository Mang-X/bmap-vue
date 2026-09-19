---
"baidu-map-gl-vue": minor
---

Ownership-first / Evidence-first 存量审计（#104）：删掉两处「恢复上游没有公开的因果身份」的抽象，
把两个动画 hook 收窄到官方公开面，并清掉一批零消费者的公共出口。

**为什么做这件事**：仓库反复出现同一种形态——SDK 不公开 request identity，本库为了给出「更强、更统一」
的语义，在上层加 FIFO / 关键字 / 计数 / 私有嗅探，随后评审或真实运行时证明存在不可判定窗口。
本票是对 main 上已落地实现的存量检查，逐条结论见
[Ownership-first 存量审计表](../docs/zh-CN/contributing/architecture-ownership-audit.md)。

**破坏性变更**

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `Autocomplete` 没有归一化调用面 | `driver.services.suggest(handle, keyword)` 返回 `ServiceResult<PlaceSuggestion[]>`，靠「输入框只读 ⇒ 通道独占」+ 同关键词互斥 + FIFO 猜回包归属 | 已删除。改用 `createAutocomplete({ input, onSearchComplete })` 监听原生回包；需要程序化建议走 `useBMapLocalSearch` 或官方 UI Kit 的 `BPlaceAutocomplete` |
| `PlaceSuggestion` 类型 | 从根入口与 `driver` 出口导出 | 已删除（它只为上面那条调用面存在） |
| `useBMapTrackAnimation` | hook + `INITIAL/PLAYING/STOPPING/…` 状态机 | 已删除（含文档页与示例）。v4 上 `createTrackAnimation()` 必抛 `BMAP_CAPABILITY_UNSUPPORTED`，状态机因此退化成常量；轨迹走原生图层 `track-line`（`<BTrackLineLayer>`），插件侧结论属 #43 |
| `useBMapViewAnimation` 返回面 | `{ viewAnimation, setKeyFrames, start, stop, cancel, proceed, status, ready }`，`status` 有四态 | `{ start(keyFrames), cancel, status, ready }`，`status` 只有 `idle` / `playing`。**没有暂停 / 继续**：4.0 上实例级的暂停/继续只有私有成员 `_pause` / `_continue`，本库不用私有面伪造能力 |
| `UseBMapViewAnimationOptions.disableDragging` | 声明了但从未生效 | 已删除（假支持比没有更糟） |
| `service.autocomplete` 能力等级 | `experimental`（降级理由就是 `suggest()` 的 keyword 假设） | `native`（构造、输入框绑定、`onSearchComplete` 转发都是原生的）。能力矩阵已重生成 |

**同时移除的零消费者出口 / 内部面**（全部经全仓引用核对，含 docs、apps、fixtures、scripts）：

- `core/loader`：`createBaiduSdkUrl()`（旧 CDN 入口拼装，默认路径早在 #71 就走官方 loader）；
- `ResourceScope`：六个定时器/帧调度别名（`requestAnimationFrame`+`frame`、`setTimeout`+`timeout`、
  `setInterval`+`interval`）与 `addCancellable`，以及 `useResourceScope()`；
- `core/context`：`useResolvedTarget()`、`createStaticTarget()`、`useOptionalTargetContext()` 与
  旧 `overlayContextKey` 这条注入面（`InjectionKey` 本身、`<BMarker>` 里那句 `provide()` 一并删；
  新代码走 `useOverlaySpec` 自动 provide 的 `TargetContext`）；
- 其他：`advanced` 的 `defineCapabilityOverride()`、`resolver` 的 `componentTypeNames`、
  `EventBridge` 的 `extractSdkEventNames()`、`diffData` 的 `shouldFullReplace()`、
  `DataLayerManager` 的 `DataLayerOptions`（其唯一成员 `minClusterSize` 类根本不接受）；
- Capability Catalog：`runtime` 整个 family（四条都是本库自身模块，不是 SDK 能力，没有任何地方按 id 问过，
  删的是这四条目录项、联合成员 `"runtime"` 与 `CAPABILITY_FAMILIES` 里的那一项；`CapabilityFamily` 类型和
  `CAPABILITY_FAMILIES` 常量本身保留，它们有真实消费者）、`layer.mvt`、`service.truck-route`
  （ADR 明确「不做」，槽位只被当作测试夹具）。矩阵重生成后为 62 条能力。
- `<BAutoComplete>` 卸载路径上那句「按结构化成员探测 `disposeAutocomplete`，探测不到就静默跳过」的
  引擎分支：#26 之后 `BMapEngine` 只有 `jsapi-v4`，分支永不成立，而它跳过的是 Driver 侧的订阅记账。
  现在走 `jsapiV4ServicesOf()` 这个可运行时检查的收窄点直接调用。

**行为不变但口径写清的**：

- `useBMapViewAnimation` 的 `status` 是**观察值**，只由公开的 `animationstart` / `animationend` /
  `animationcancel` 写；命令不再乐观改它，因此「发了播放但 SDK 一次都没回调」会如实停在 `idle`。
- `MapDriver` 的视角动画 teardown **保留**：它记的是本库自己发起的启动 / 取消 / 销毁次序，
  不是「这条回包属于哪次命令」。但它的前提（`animationstart` 在内部 Animation 构造前同步派发、
  启动前 `cancelViewAnimation` 抛 `TypeError`）目前只有 Fake 建模、没有真实运行时取证，
  因此按**防御模型**对待，不作为对外的时序承诺（审计表 F-1）。
- `<BAutoComplete>` 不再往你的输入框上挂任何事件监听（也就没有「忘摘」的可能）。
- `useBMapViewAnimation` 的三个既有缺陷（首次给它写行为用例与评审时才暴露）：取消动画原先排在微任务里，
  而地图在父组件 `onUnmounted` 销毁 ⇒ 每次卸载抛一个无人接收的 `BMAP_RESOURCE_DISPOSED`；
  监听释放原先共用一个槽位 ⇒ 连续播放时被取代那段的 `animationcancel` 会摘掉新段的订阅，
  并把状态错误地写回 `idle`。现在每段动画自带现场，取消在卸载时同步发出。
  第三处同源：被取代那段的监听**只**由 SDK 的 `animationcancel` 释放，而「上一段一定会收到该事件」
  恰恰是审计表 F-1 那条未取证的时序（只有 Fake 建模）——本库自己的订阅记账不该等 SDK 回调，
  现在接管时同步释放，事件只负责写状态。
- Fake SDK 同步瘦身：`Autocomplete` 的 `respond` / `includeKeyword` 与回包的 `keyword` 一并删除，
  避免有人再按关键字建归属。

**`useBMapViewAnimation` 的失败路径口径（#105 评审后明确）**：

- `cancel()` 在**取消失败**时把错误抛给调用方，并保留这一段的归属 ⇒ 可以直接再调一次重试
  （`MapDriver` 的既有契约是「取消失败时动画记录保留，下一次 `stopViewAnimation` / `destroy` 可重试」）。
  原先的实现会先把归属清掉，第二次 `cancel()` 变成 no-op，而 SDK 那边还在播。
- `start()` 是**两阶段提交**：它的 Promise 表示「地图 ready + 起播命令被接受」，**不是**动画播完；
  播完要听 `animationend`（`loop: "INFINITE"` 时不会来）或由 `status` 驱动。起播前 Driver 要先取消
  上一段，取消失败时它拒绝替换 ⇒ `start()` 随之 reject，上一段继续被观察、仍可 `cancel()` 重试；
  从未起播的那一段不留订阅。
- 卸载时取消失败**不再打断卸载**，并且**可观测**：本段订阅无条件下线，失败同时经
  `resource:error` 诊断总线交出（`component: "useBMapViewAnimation"`）。只靠 `logger.warn` 不够——
  它在 production 构建里会被折叠掉，而地图自己的销毁路径若也停不掉这段动画，失败就只剩一条
  开发模式下的控制台痕迹。
- 取消是**地图级**命令：`cancel()` 的守卫只看 hooks 自己有没有在飞段，因此不保证一定不牵连同图
  其它动画（文档与类型注释已改成这个口径，而不是反过来承诺归属）。
- 一次 `stopViewAnimation()` **正常返回之后就不再重复发**（返回只代表这一次请求被 Driver 接手：
  动画还没起播时它只登记 `cancelRequested`，真正的 SDK 取消留给安全窗口，既不等于「SDK 已取消」
  也不等于「动画已停」）：同一 hooks 之后再调 `cancel()` 是 no-op。
  此前它会在「取消已成功、但 SDK 没派发 `animationcancel`」时保留发 stop 的资格，下一次调用就会停掉
  这张图上**任何人**正在播的动画（包括另一个 `useBMapViewAnimation` 刚起的那一段）。
  「还在观察事件」与「还有资格再发一次地图级 stop」现在是两件事。
