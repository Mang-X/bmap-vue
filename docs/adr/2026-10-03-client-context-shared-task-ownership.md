# ADR 2026-10-03：Client Context 的共享任务所有权与「取消 = 逻辑取消」

状态：**Accepted**（#186，1.0 冻结前的收口票）

## 背景

`createClientContext`（`core/context/client.ts`）是 SDK Client 的**唯一收口点**：`<Map>` /
`<BMapProvider>` / `resolveMapContext` / 插件默认 definition 全部经它创建 Client。它同时是
**共享**的——`<BMapProvider>` 一次 `provide`，子树里每个 `<Map>`、每个服务 composable 都调
同一个 `load()`。

旧实现把「共享生产任务」与「第一个调用者的等待」写成了同一件事：

```ts
loadPromise = doLoad(signal);   // ← signal 是**第一个调用者**的
```

于是三条缺陷都是结构性的，不是边界条件（审计基线 `33420a9`）：

| # | 现象 | 根因 |
| --- | --- | --- |
| 1 | 先加入者取消 ⇒ **未取消的后来者一并被拒** | 第一个调用者的 signal 进了共享任务，之后所有等待者都挂在那条被取消的链上 |
| 1' | 后来者取消 ⇒ 只有自己被拒 | 它走 `Promise.race(loadPromise, abort)`，与 #1 语义**不对称** |
| 2 | `dispose()` 之后的迟到成功/失败把终态 `disposed` 改写成 `ready` / `error` | `dispose()` 只置位，写入点没有终态守卫 |
| 3 | 正常完成时等待者的 abort 监听器没解绑 | `Promise.race` 里 `addEventListener(..., { once: true })` 从未被移除 |

实测读数（本票新增的用例，摘掉新实现即翻红）：

| 读数 | 旧实现 | 新实现 |
| --- | --- | --- |
| A 带 signal 首次 `load`，B 无 signal 复用；A 取消 | A rejected / **B 也 rejected** | A rejected / B 拿到 Client |
| B 带 signal 后加入并取消；A 无 signal | A 成功 / B rejected / Provider 调用 1 次 | 同左（**未回归**） |
| 无 signal 加载中 `dispose()`，随后迟到成功 | `status = "error"`（终态被改写） | `status = "disposed"`，调用以 `BMAP_RESOURCE_DISPOSED` 拒绝 |
| 等待完成后 `signal.removeEventListener("abort", …)` | 不调用（监听器活到 abort） | 结算前调用 |

## 决策 1：共享任务归 context 所有，`signal` 只取消「自己的等待」

`startSharedLoad()` 启动的共享任务**不接受任何调用者的 signal**，也不对它转发取消；
每次 `load(signal)` 只是 caller-owned 的等待（`waitShared`）。契约变成对称的两句话：

- 共享任务的存在、成功与失败只由 context 决定；
- 一次 `load(signal)` 的 abort 只让它自己以 `BMAP_PROVIDER_ABORTED` 拒绝，
  **不**影响同任务上的其它消费者，也不影响共享任务本身。

这条契约不是新发明的，它与下一层的 `SharedLoadTask` / `SdkRegistry.subscribe`
（「每个消费者持有自己的 AbortSignal，取消互不影响」）**完全同构**——本票只是把
Client Context 拉回同一口径，让它不再成为那条链上唯一破例的一层。

## 决策 2：传下去的是 **owner signal**——不是调用者的，也不是「什么都不传」

`createBMapClient(definition, owner.signal)`。这里的判据是**区分两个身份**：

- **调用者的 signal 永远不进底层任务**。共享任务没有「谁有权取消」的答案——A 与 B 都能
  随时消失，让先来的那个决定共享任务的生死正是 #186 的原始缺陷；
- **context 作为 registry consumer 需要自己的身份**。它不是一个「等待」，而是一份所有权：
  `SdkRegistryLoadRequest.cancellable` 这套既有分流就是为它准备的——
  `BaiduJsapiV4Provider` 声明 `cancellable: false`（官方 Loader 无公开取消接口），
  `CustomScriptV4Provider` 走默认 `cancellable: true`，其 signal 一路传到
  `SdkRegistry` → `ScriptLoader`，**最后一个消费者离开时**同步释放 entry / occupancy 并
  abort 底层 script。

早先的版本写了「底层任务不可取消」，并据此**彻底不传 signal**——判据错在把「调用者无权
取消共享任务」扩大成了「context 也无权释放自有资源」。后果是自托管 / 私有入口
（`customScriptV4Provider`）在 Provider 卸载后仍留下 script / timer / callback，直到自行
完成或超时，与 issue 目标「context 销毁时处理其自有等待与资源」相反。实测：

| 场景（`dispose()` 时底层仍未结算） | 不传 signal | 传 `owner.signal` |
| --- | --- | --- |
| `customScriptV4Provider`（`cancellable: true`）底层 loader 的 signal | **不 abort** | abort |
| 官方口径（`cancellable: false`）底层 loader 的 signal | 不 abort | **不 abort**（registry 保留任务） |

第二行同样是决策的一部分，它兑现的是「本库不宣称终止了不可取消的那条网络请求」：
owner signal 只是**消费者身份**，取消与否由 registry 按 `cancellable` 裁决，本层不越权。
`existingGlobalV4Provider` 路径（宿主已加载）更无从谈起取消，registry 同样保留任务。

因此：**等待一定结算**，而**底层任务是否继续由 `cancellable` 决定**（可取消的释放资源，
不可取消的照旧跑完）。两种情况下结果都落在 Client Context 上、由终态守卫丢弃——无人接收的
Client 不额外释放（本库没有公开的 Client 销毁入口，`BMapClient` 只有 driver / rawSdk 的读取面）。
「取消是**逻辑**取消」这条口径本身没变（调用者取消 ≠ 终止网络请求），变的是：context 的
**终态**有权释放它自己拥有的、且上游声明为可取消的那部分资源。这与 ADR
`2026-09-24-service-task-and-resource-scope-split` 里「`release` 不传 `signal`」不矛盾——
那里说的是**取消一次等待**不该被误读成释放实例，而这里是**销毁资源所有者**。

## 决策 3：不越过 Provider 直接接 `SharedLoadTask.consumerCount`

「最后一个消费者离开就取消底层」有一个更底层的接线面：`SharedLoadTask.consumerCount`
（`isSettled` / `status` 同）。**刻意不接**，判据是**取消策略的归属**：

- 取消与否由**上游的 `cancellable` 声明**裁决，不由本层数人头决定。越过 Provider 去数
  `SharedLoadTask` 的消费者，等于把「官方 Loader 不可取消」这条上游事实替换成本层的猜测；
- 决策 2 的做法（把 owner signal 交给 Provider → `SdkRegistry`）走的正是那条既有分流：
  `cancellable: false` 的任务在 registry 里**保留**，可取消的任务才释放。可见性
  （「版本不匹配就再也装不上」这类失败）由 registry 的 occupancy / fingerprint 记账守住，
  而不是由「context 有没有 dispose」决定。

`SharedLoadTask` 的既有单测覆盖了 `consumerCount` 本身；本票不扩大它的消费者集合，
也不让 Client Context 直接依赖它。

## 决策 4：`dispose()` 是终态，写入点逐个守卫

- `startSharedLoad` 的成功/失败写入前各判一次 `disposed`（终态不得被改写）；
- 迟到的成功以 `BMAP_RESOURCE_DISPOSED` 拒绝，且**不**写 `client`；
- 迟到的失败拒绝**原错误**，且**不**写 `status` / `error`；
- `dispose()` 同时清 `error`——一次已作废的加载不该在公开的 `error` ref 上留下读数。

### 启动前失败必须与生产失败走**同一处**状态写入（评审 P1）

拆分「共享任务」与「等待」时，缺 definition 这条**启动前**失败一度被写成了一条独立的
`Promise.reject`，绕过了共享任务的失败分支。后果是用户可见的：旧实现里 `doLoad()` 抛出的
`BMAP_PARENT_CONTEXT_MISSING` 会经 `load()` 的 catch 写成 `status = "error"` +
`ctx.error`，而 `<BMapProvider>` 的 `#error` 插槽判的正是 `context.status === "error"`
——于是**缺配置时错误插槽不再出现**，context 静默停在 `idle`（实测：新实现
`status = "idle"`、`error = null`；旧实现 `status = "error"`、
`error = BMAP_PARENT_CONTEXT_MISSING`）。

现在把「取生产源」（有 definition 走 `createBMapClient` 并置 `loading`，没有则在
**不置 `loading`** 的前提下产出一个已拒绝的 source——与旧路径一致）与「统一结算」分开：
两条来源汇进同一个 `source.then(onLoad, onFail)`，失败分支照旧写 `status` / `error`。
判据不写成「`if (!definition)` 就赋值」，而是让**所有**失败都只有一条写入路径。

### `dispose()` 必须结算**已经发出**的等待（评审 P1）

「底层任务不可取消」被错误地延伸成了「调用者的等待也可以不结算」。实测（`HEAD~2` 与
当前实现都先复现过，因此这不是本票引入的回归、而是 issue 验收项里一直没兑现的一条）：

| 场景（底层 Provider 永不结算） | 读数 |
| --- | --- |
| `const p = ctx.load(); ctx.dispose()` | `p` 永久 pending |
| 同上但带 signal（signal 未 abort） | `p` 永久 pending |

真实路径上 `<BMapProvider>` 的 `onMounted` → `ensureLoad()` → `context.load()` 正是
**无 signal** 的那一条，所以「Provider 卸载后这条 async 调用还挂着」不是假想。
`pendingAsync()` 只统计 timer / callback，抓不到悬挂的 Promise——用那个读数会得到假绿。

做法：context 自己持有一个 `AbortController`（`owner`），`dispose()` 时 `owner.abort()`
先结算所有在飞等待（`BMAP_RESOURCE_DISPOSED`），再置终态；底层是否继续由决策 2 的
`cancellable` 裁决，结果由终态守卫丢弃。**所有** `load()` 都走
`waitShared(task, owner.signal, signal?)`——不再有
「无 signal 就直接返回裸 task」那条分支，否则 dispose 这一路的取消来源又会被绕过。
两个中止来源（调用方 signal / context 终态）共用同一处登记与解绑，`AbortSignal` 让
「已 dispose」与「等待期间 dispose」由同一个 `aborted` 覆盖。

## 决策 5：失败的拒绝值改为**原错误**

`load()` 此前把失败包成新的 `BMapError("BMAP_SDK_LOAD_FAILED", "Map client load failed: …")`，
与另外两条同类路径（`MapRuntime.doMount`、`BMapProvider.ensureLoad`）**直接抛 `e`**
不一致，而且会把 `BMapError` 专有的 `code` / `unsupported` 折进新错误的字段里做成信息
损失（`toBMapError` 只对**非** `BMapError` 生成 `cause`）。现在与那两条对齐：拒绝原错误，
`ctx.error` 仍保留归一化后的 `BMapError`（诊断面不变）。

## 连带影响：`retry()` 的状态口径

`retry()` 曾在**每次**调用时把状态写成 `idle`（`status.value !== "loading"` 时）。
共享任务保留在飞时，调用 `retry()` 会把 `loading` 抹成 `idle`——进行中的加载从此在公开
状态里不可见。这只在 `retry()` 被并发/误用时才发生，但属于同一个「状态写入没有单一判据」
的问题，因此一并收窄为**只在 `error` 档复位**。公开 API 形状不变。

## 这条实现的已知边界

- **组件层抓不到终态回写**。本票按 issue 要求在真实调用路径上补了组件用例
  （加载中卸载**先加入的**消费者，另一个继续成功；整棵卸载后迟到结果不复活上下文），
  但要构造出「`dispose()` 之后才有迟到结算」的**组件**窗口，现有夹具能力不够——`<Map>`
  的容器清理发生在迟到成功之前，摘掉终态守卫读数不变（实测）。该用例因此如实标注为
  **非回归读数**，判据留在单测层（可稳定翻红），不假称它锁住了终态守卫。
- **等待者侧的 signal 只覆盖 `load()` / `retry()`**；`client` 已就绪时 `load()` 同步
  resolve，与 signal 是否已 abort 无关。
- 「卸载先加入的消费者」这条组件用例的**判别力有方向性**（评审 P1 修正后实测）：旧实现下
  它翻红（剩下的消费者拿到 0 张地图），因为旧实现把第一个等待者的 signal 当成了共享任务
  的 signal。它测的是 issue 要求的第一个分量（A 取消、B 仍成功）；「B 取消、A 仍成功」
  这个反向分量只有单测能构造——组件层没有「让后加入者的 signal 中途 abort 而先加入者留下」
  的入口。
- **「卸载时等待已结算」的组件读数需要一个可观测的等待句柄**。`ensureLoad()` 那条等待不冒泡
  成 error、也不进 `pendingAsync()`（只统计 timer / callback），所以组件用例改为观测
  `<BMapProvider>` 自己 expose 的 `load()`——它与 `ensureLoad()` 调的是同一个
  `context.load()`，而 `dispose()` 是 context 级终态，两者是同一读数。实测判别力：摘掉
  owner 结算，该用例翻红；而用「`#error` 插槽 / `error` 事件」当读数则两种实现下都通过
  （卸载时 `emit` 已在 `onUnmounted` 之后，模板不再渲染）——**旧版那种写法是假绿**。

## 非目标

不引入全局 Registry、请求身份推断或通用重试框架；不修改官方 Loader 的共享状态；
不删除 / 改写上游注入的 SDK `<script>`、回调全局或 namespace。
