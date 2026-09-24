# ADR 2026-09-24：服务任务分两档 + ResourceScope 收成最小外部资源内核

状态：**Accepted**（#139，1.0 冻结前的收口票）

## 背景

两个统一内核各自过重：

- `useServiceTask`（458 行）对**所有**服务都携带 `pendingReleases` / `instanceStale` /
  `marksStale` / `tryRelease` / `resolveSupersede` / `refuseMessage`。在 7 个简单服务上，
  这些字段**恒为死值**——官方没有为它们提供实例销毁入口，于是「释放失败重试」「取消后
  实例过期」这些机制根本没有触发条件。
- `ResourceScope`（178 行）内嵌 `effectScope(true)` + `run()`，想统一管理 Vue 的 watcher；
  而**全仓只有 1 个生产调用点**，其余 24 处真正的用法是 `scope.add(watch(...))`。

这不是「代码量不好看」的问题，而是**两个归属被搞混了**：

1. 服务实例的所有权（要不要换新实例、谁来释放）——**按服务而不同**，判据是官方事实；
2. Vue effect 的生命周期——**按框架而恒定**，Vue 自己就会停。

把它们焊在一个闭包里，等于让 7 个简单服务为 LocalSearch 的实例身份语义买单，同时让
「谁负责停这个 watcher」有两个答案。

## 决策 1：服务任务分两档，判据是「官方有没有公开的实例销毁入口」

| 档 | 服务 | 官方释放入口 | 实例通道 |
| --- | --- | --- | --- |
| **简单档** | Geocoder / GeocodeDetail / Convertor / Boundary / Geolocation / LocalCity / IpLocation | 无（随 Client 被 GC 回收） | `createSharedInstanceChannel()`：**无状态** |
| **独占档** | LocalSearch / Driving / Riding / Transit / Walking | `disposeLocalSearch` / `disposeRoute` | `createExclusiveInstanceChannel()`：有状态 |

**判据不是「哪个服务看起来复杂」**，而是**一个能在官方声明里核对到的事实**：
`BMap.*` 有没有公开的 `dispose` / `clearResults`。这条事实同时解释了另外两件事——
「释放失败重试」有地方失败、「取消 / 超时后换新实例」有东西可交还。官方没给入口时，
这些机制是**猜测**，不是抽象。

本仓里「带释放入口」恰好等价于「需要 supersede 语义」，所以这一条判据就够了。

**不写两份 `execute()`**：仓库约定「同一个坑不要有两份实现」。做法是**框架无关的共享内核
+ 可注入的实例通道**（`core/services/serviceTaskCore.ts` + `core/services/instanceChannel.ts`）。
共享通道的闭包里**根本不存在** `pendingReleases` / `instanceStale`（`Object.keys` 可断言），
于是 #139 的验收项「simple services 不携带无消费者的 recreate/refuse/pending-release 状态」
在**结构上**成立，而不是「有字段但没人用」。

Vue 侧（`composables/serviceTask.ts`）分 `useSimpleServiceTask` / `useExclusiveServiceTask`：
简单档的选项类型**不接受** `release` / `supersede` / `refuseMessage`，返回值**不暴露**
`invalidateService`——这两条都有用例钉住（含 `@ts-expect-error` 的编译期断言）。

**`release` 的参数只给 `(client, handle)`**：核实了全部 5 个真实释放实现，它们只读
`context.client`。传一个用不上的 `signal` 只会诱使调用方以为「取消会连带释放」——那不是
事实（取消是**逻辑**取消，SDK 侧请求收不回）。通道把实例当初所属的 Client 一并记住并原样
交回，因为**跨 Client 的句柄会被 Driver 拒绝**（`BMAP_HANDLE_FOREIGN`）。

## 决策 2：`ResourceScope` 不再管 Vue 的 effect 生命周期

删掉 `run()` 与内嵌 `effectScope`（含 24 处 `scope.add(watch(...))` 包装、
`useOverlayResource` 的 `addDisposer` 参数）。`ResourceScope` 收成**最小外部资源内核**：
`add` / `fork` / `signal` / `size` / `label` / `isDisposed` / `dispose`。

判据一句话：**Vue 会不会自己停它**——会的交回 Vue，不会的（SDK 监听 / Observer / timer / RAF /
Overlay / plugin）进这里。`Autocomplete.vue` 里那两个 watcher 是**例外也是样板**：它们建在
`await` 之后的 async 钩子里（`getCurrentScope()` 为 `null`），Vue 不会停，所以它们的 `stop`
句柄显式登记为 disposer。

**去掉 `run()` 不丢行为**，这是运行时探针实测的（不是推断）：`effectScope.run()` 确实会**重绑**
watcher（停内层 scope 会停它、停外层不会），但 `useSdkResource.replace()` 只 dispose 每次
创建的 **fork**（`instanceScope`），**从不** dispose 持有 `run()` 的 `componentScope` ⇒ 那个
watcher 本来就只随组件 teardown 而停，与重绑后的行为一致。

### 这条不变式必须被检查，不能只写在注释里

「`spec.watch` / `lifecycle.createWatchers` 必须在 **setup 同步期**被调用」是**非局部不变式**
（横跨 `useSdkResource` / `useOverlayResource` 与多个组件实现）。一旦有人把它们挪进
`onMounted` / async 钩子，watcher 就静默逃出组件的 effect scope ⇒ 卸载后仍触发。

因此在两个测试文件（`useSdkResource.test.ts` / `useOverlayResource.test.ts`）各加一条回归
用例：挂载中会触发、卸载后**不**再触发。两条都实测能在「挪进 async 续体」时翻红。

**观察源必须是组件外部的 ref，不是 props。** 卸载后组件已不在树上，改 props 不会触发任何东西
——那样的断言恒真，测不出逃逸。第一版正栽在这里（写了才发现改 props 后用例照样绿）。

#### 为什么**没有**加运行时守卫

试过 `getCurrentScope() === null` 的 dev 告警，**放弃**：它有假阴性。实测（本仓 Vue 3.5.42）
在 `onMounted(async () => { await …; watch(…) })` 这条会泄漏的路径上，`getCurrentScope()` 的取值
**随钩子时序与测试环境变化**——同一段代码在一种挂载方式下读到 `null`（守卫会响），在另一种
下读到非 null（守卫静默），而两种情况下 watcher **都泄漏**。判「scope 身份是否与首次相同」
同样不行：不同组件实例各有各的 scope，会跨实例假阳。

一个判不准的守卫比没有更糟——它让人以为这条不变式已经被守住。因此**只留回归用例**（能稳定
翻红的那一种），并在两处调用点写明这条依赖与「不要再加守卫」的理由。

#### 这条用例**抓不到**什么

抓不住「把 `scope.add(watch(...))` 加回来」：那份包装在卸载时同样会停（`componentScope`
自己在 `onUnmounted` / `onScopeDispose` 里 dispose），属于冗余但无害。删掉它的理由是
「谁负责停它」不该有两个答案 + 资源账本不该为 Vue 已有的东西计费，不是因为它会漏。

## 决策 3：不引入 `onWatcherCleanup`

Vue 3.5 提供了 `onWatcherCleanup`，issue 也点名要评估它。**结论是不引入**：

- 全仓**生产 0 消费者**（只有 2 个 docs 示例在 watcher 里发服务请求）；
- 本库在 watcher 里做的清理是**切换资源实例**，不是取消「本次 watcher 触发的异步操作」；
- issue 自己写明「没有自然 watcher consumer 时不要强用」。

强行引入只会多出一条无人验证的路径。peer 范围仍是 `vue: ^3.5.0`，该能力保持可用。

## 决策 4：公共面不暴露任务/作用域状态机

`composables/index.ts` 的 `export * from "./useServiceTask"` 整条摘除（连同 `SupersedeMode` /
`SupersedePolicy` / `ServiceInvokeContext` 等类型），api-diff 基线 394 → 387，**只掉这 7 个名字**
（已逐条核对重生成出来的汇总表）。12 个**服务** composable 的出口不受影响。
`tests/behavior/v3-core-surface.test.ts` 已把这批名字加进负向清单。

`ResourceScope` **保留**在根出口与 `./core`：它是 `MapContext.resources` 的公开类型，也确实是
对外的 external-resource 内核。被删的成员自动从导出类型面消失。
`MapRuntimeShape.scope`（`resources` 的零读者别名）一并删除。

## 顺带删掉的死成员

`ResourceScope` 的 `addEventListener` / `observe` / `remove` / `onDisposeError` /
`parentSignal` / `DisposeContext`——生产 0 消费者（`add()` 返回的 remover 已覆盖 `remove()` 的用途）。

**但它们承载的两条行为没丢**：

- 「一个 disposer 抛错不得中断其余释放」：用例改为断言真正的告警通道 `logger.warn`
  （含 `label` 点名）——释放顺序是行为契约，删掉这条断言就没人再钉它；
- 「父释放 ⇒ 子释放」：`fork()` 早已把 `disposeChild` 登记进父的 disposer 集合，这条**保留**；
  被删的 `parentSignal` 只是**冗余的第二条链路**（它额外带来的 `queueMicrotask` 延迟路径在
  `fork()` 上不可达，因为 `fork()` 已有「父已释放 ⇒ 子**同步**被释放」的兜底）。

`fork()` 里「覆盖 `child.dispose` 以便从父摘除」的机制也保留，并补了用例钉住它的**理由**：
覆盖物/图层反复重建而父只 dispose 一次，不摘除则父的 `disposers` 无界增长、`size` 账本失真。

## 保留的成员：`size` 不是死代码

探索时曾判定 `size` 零消费者——**错的**：`tests/behavior/v3-component-scenarios.test.ts`
读 `ctx.resources.size` 断言「卸载后没有遗留的 SDK 资源 disposer」。它是**外部资源账本**，
不是「effect 数量」，因此必须精确反映 `disposers`、不能被任何内部记账抵消。

这条反例本身是本 ADR 的一句话结论：**测试即消费者**，「看起来没人用」不等于零消费者。

## 评审发现与修正（/code-review）

四条来自评审的**真**发现，都在本次改动内修掉了：

1. **`execute()` 卸载后仍可被调用 ⇒ 把状态永久钉在 `loading`**。`onState({ status: "loading" })`
   位于首个 `disposed` 检查**之前**，而 `execute` 是可能被保留的公开句柄（watcher 回调 /
   `setTimeout` / `await search()` 的续体）。实测卸载后 `await task.execute()` 会让
   `status === "loading"` 停在那里。**旧实现有同一个洞**（所以不是回归），但新代码把「冻结
   回写」写进了接口注释，就得真的守住 ⇒ 在 `execute` 最前面加 `if (disposed) return canceled`，
   并补一条用例（实测能翻红）。
2. **`serviceTaskCore.test.ts` 的 `release` 桩类型错了**：写成 `release: (handle) =>`，
   实际收到的是 **client**，于是「释放失败重试」那条 PR #89 P2-1 用例建在一个类型错误的桩上
   却照样绿。该文件**不在任何 typecheck gate 范围内**（`tsconfig.build.json` 排除
   `*.test.ts`，`tsconfig.tests.json` 只含 `tests/performance` 与 `tests/browser/live-performance`）。
   ⇒ 改成 `(client, handle)` 并补一条**「释放用的是实例当初所属的那个 Client」**的用例——
   这正是签名收窄要保住的不变量，原来根本没被测到。
3. **「简单档在结构上不带死状态」那条门禁是恒真的**。`Object.keys` 看不见**闭包变量**，而
   独占档的 `pendingReleases` / `instanceStale` / `marksStale` 恰恰是闭包变量 ⇒ 带死状态的实现
   也能过。ADR 与 `AGENTS.md` 却拿它当「在**结构上**成立」的证明。⇒ 补两道门禁：① `Object.keys`
   改成**白名单**（恰好是接口 9 个成员，挡住属性形态）；② 读 `createSharedInstanceChannel.toString()`
   断言那三个名字一次都没出现（挡闭包形态）。两道都实测能在注入死状态时翻红。
4. **`ServiceTaskCore.isDisposed` 零消费者** ⇒ 按本仓「零消费者的扩展面一律删掉」的规则删除。

> 顺带记一条**没有**修的既存缺口：`packages/bmap-vue/src/**/*.test.ts` 共 64 处既存类型错误
> （`layers.test.ts` 16 / `useMapStatus.test.ts` 13 / `overlays.test.ts` 10 …），因此**整目录的
> typecheck 门禁今天建不起来**（建了立刻红）。本次新增/修改的测试文件已逐个确认类型干净。
> 清这 64 处是另一个票的量，不该塞进这张票——但它意味着**「测试文件里的类型错误只能靠人眼发现」
> 这件事今天仍然成立**，值得单独记一笔。

## 后果

- 简单服务路径上不再有「万一用得上」的状态；独占服务的复杂度**只**由官方释放入口触发；
- Vue effect 生命周期回到 Vue；外部 SDK 资源仍严格按逆序释放且释放失败有信号；
- 卸载后不回写（无迟到回包写入）、无跨 Client 句柄泄漏的验收项由既有门禁继续守；
- 公共 API 不再承诺内部任务/作用域状态机的形状。
