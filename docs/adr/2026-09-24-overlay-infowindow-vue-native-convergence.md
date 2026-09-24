# Overlay / InfoWindow 的 Vue-native 收口：reconcile、Teleport、post-flush 与 baseline restore（#138）

- 状态：Accepted
- 日期：2026-09-24
- 关联：issue **#138**（1.0-VUE 的 P1 · Stable 阻塞，前置 #135 公开 API 命名对齐、#124 scheduler 取证，均已完成）、
  ADR [`2026-09-24-scheduler-batching-hot-path`](./2026-09-24-scheduler-batching-hot-path.md)（本 ADR 的 `flush` 取证来源）、
  ADR [`2026-09-18-overlay-event-matrix`](./2026-09-18-overlay-event-matrix.md)（事件矩阵与无矩阵 kind 的已知限制）、
  ADR [`2026-09-18-infowindow-host-and-ownership`](./2026-09-18-infowindow-host-and-ownership.md)（每图 ownership 契约）、
  ADR [`2026-09-14-service-lifecycle-and-local-search`](./2026-09-14-service-lifecycle-and-local-search.md)（Ownership-first / Evidence-before-abstraction）
- 取代范围：**不取代任何 ADR**。`2026-09-18-infowindow-host-and-ownership` 的 ownership 状态机
  （`suppressed` / `echoedClosed` / `lastOpenPositionKey`）与过期实例守卫一条都不少，本 ADR 只改**何时**收敛、
  **怎么**合并更新。

## 背景

1.0-VUE 相对官方 React 参考要保留的价值是 Vue-native 的那一层：SFC、typed emits、`v-model`、
`<Teleport>`、每图 ownership。#138 不动这一层，它针对的是「本库在 Vue scheduler 之外**又自己实现了一遍
调度**」的三处，以及一处事实源漂移：

| 位置 | 自研的东西 | 与 Vue 重叠的部分 |
| --- | --- | --- |
| `useOverlaySpec` | `pendingApply` / `draining` / `requeueStaleBatch` 单飞队列 | Vue 的 watcher batching（一次提交内 N 个字段本该只跑一次回调） |
| `useOverlaySpec` | `new Proxy(rawProps, …)` 形式的 props 视图 | 运行时拦截一条静态可判定的读取路径 |
| `useInfoWindow` | 双 `nextTick` 收敛 + `pendingOptions` / `draining` 队列 | `nextTick` 的排队顺序本来就是 Vue 调度的一部分 |
| 16 个覆盖物 SFC | 各自手抄 `defineEmits` | 事件矩阵（`core/overlays/overlayEventCatalog.ts`）已是运行时单一事实源 |

另有一处**能力问题**被顺手暴露：属性从「有值」变回 `undefined`（撤回）时，内核没有 baseline 可恢复。
图层侧早就用「value → undefined 走重建」把这件事解决过（`v3-layer-suite.test.ts` 的同型用例），
覆盖物侧没有对应机制。

取证（**先量再改**，下面每条结论都对应一个可执行断言）：

- **`flush:'sync'` 在本库只剩一处**：`useOverlaySpec` 里 `versioned`（大数组 `path` / `controlPoints`）
  那个 watcher。ADR `2026-09-24-scheduler-batching-hot-path` §「多字段同更新」记录了 `pre` / `post` 会把
  「一次提交改 N 个字段 ⇒ N 次回调」合并成 1 次；`sync` 是 v3 既有语义（路径更新要与父级渲染同一次提交
  内落地），**本 ADR 不动它**。
- **重建确实能恢复 SDK 自己的默认值**：`driver/jsapi-v4/overlays.ts` 的构造期投影
  `projectOptions` 已有 `if (value === undefined) continue;`——不传的字段就是走 SDK 默认。因此
  「有值 → `undefined` ⇒ 重建」是一条**已有证据**的机制，不需要新造。
- **「经 getter 恢复 baseline」不成立**（见 §5，这是本 ADR 最重要的一条反直觉结论）。
- **Proxy 的覆盖面极小**：别名只有三组（`info-window.open` ← `show`、`ground-overlay.bounds` ←
  `startPoint` + `endPoint`、`context-menu.items` ← `menuItems`），`fieldValues` 投影只有一处
  （`GroundOverlay.url` 工厂）。显式读取表足够。
- **双 `nextTick` 为什么能工作**：`nextTick(cb)` 的回调进 `currentFlushPromise.then(...)`，
  而 `emit("update:open", false)` 触发的父级 `queueFlush()` **排在它后面**——于是顺序是
  `cb1 → flushJobs(父级重渲染) → cb2`。post-flush 队列（`flushPostFlushCbs`）在 `flushJobs` 末尾
  执行，**天然**拿到同样的时序：父级的受控回写已落地。
- **N 个 per-field watcher 不等于一次 reconcile**（§1）：同一轮 flush 里 Vue 按注册顺序跑回调，
  第一个回调的同步排空会**就地写到一个即将被丢弃的实例上**。这条是行为测试逼出来的，不是预见的。
- **`@vue/compiler-sfc` 解析不了 mapped type**（§6）：`core/events/eventCatalog.ts` 的 `MapEventEmits`
  上有完整实测表——`{ [K in keyof typeof CATALOG]: … }` 与含条件类型的值都报
  `Failed to resolve index type into finite keys`。**只有 import 进来的显式键 interface 能编过。**

## 决策

### 1. OverlaySpec 更新路径：自研单飞队列 → Vue batching + 一次 reconcile（保留最小尾随队列）

`useOverlaySpec` 删掉 `pendingApply` / `draining` / `requeueStaleBatch` / `drainAppliedUpdates`，
改为：

- **一个**数组源的 `watch(sources, cb, { flush: "post" })`（`cb` 按 `next[i] !== prev[i]` 归算出变更字段）。
  「一次提交改 N 个字段 ⇒ 一次回调 ⇒ 一次 reconcile」是 Vue batching 本身给的，不是我们合帧的。
  **必须是单个数组源而不是 N 个 per-field watcher**：同一轮里 per-field 回调按注册顺序执行，
  第一个就把批同步排空了，于是「构造期字段要重建」与「就地字段要写在**最终**实例上」这条验收口径
  被打破（`doomed.callLog` 里出现了 `setZIndex`）。这是 `v3-overlay-spec.test.ts` 里
  `expect(doomed.callLog).toEqual([])` 逼出来的。
- **保留** `applyBatch()` 的分区语义（按 `overlays.updatePolicy(handle, key) === "recreate"` 拆成
  `needsReplace` / `inPlace`），`await sdk.replace()` 之后**重新读** `sdk.resource.value` 再把
  `inPlace` 打到最终存活实例上。这是正确性关键，不动。
- **保留最小尾随队列**：`sdk.replace()` 是异步的，它在飞期间到达的更新不能发给一个即将被丢弃的实例。
  用一个只存活于 replace 窗口的 `trailing: Record<string, unknown> | null` 承担这件事，replace 结束后
  并入 `dirtyFields`。不在 replace 窗口内的更新直接进 reconcile，不排队。
- **死循环挡板**：`while (dirtyFields && sdk.resource.value)`。#138 开发期确实挂过一次 300s 无输出
  （旧的 `applyBatch` 会把批放回 `dirtyFields`，条件只看 `dirtyFields` 就原地取回再放回）。
- **随队列一起删除的还有 v3 的「放回」路径**（`requeueStaleBatch` 的两处展开）。取证结论：它们
  **已不可达**——排空条件保证 `applyBatch` 只在实例可见时被调用，而 `reconciling` 保证并发的
  `markDirty` 不会往 `dirtyFields` 里塞第二批（即使让 `create` 在 replace 中抛错也进不去）。
  按「没有消费者的判据退化成常量就删」的判据删除，而不是留一段永不执行、却要求读者推断展开顺序的
  代码。`applyBatch` 的入参不变式改为**显式抛错**：被打破时是内核 bug，静默吞掉一批更新最坏。
- `useSdkResource` 的 `bind()`（就绪窗口）从「排一次自研 drain」改成「排一次 reconcile」，语义不变。
- **两个调用方共用同一个数组源 watcher**（`core/utils/keyedSources.ts` 的 `watchKeyedSources`）：
  `useOverlaySpec` 的字段更新与 `useInfoWindow` 的 options 更新是同一种机制的两份拷贝
  （按下标对齐的源数组 + `next[i] !== prev[i]` 归算变更键 + 固定 `flush: "post"`），
  收成一个带单测的函数，避免两份实现各自漂移。**如实说明门禁边界**：`flush` 改成 `pre`
  时现有行为测试仍全绿——「post」是与意图 watcher 对齐的设计选择，不是会红的门禁。

### 2. 删掉运行时 Proxy，改显式读取表

`propsView = new Proxy(rawProps, …)` 换成 `readProp(name)`：别名解析优先、`fieldValues` 投影随后
（顺序与原实现一致，有注释依据），`readRawProp(name)` 保留给按引用比较的 watch 源。

`useSdkResource` 原本收到 `props: propsView as Props`（动态 Proxy，每次读取都现求值）；现在
`needsView` 为假时直接传 `rawProps`（零拷贝），为真时**按代物化**一份普通对象：每一代实例
（首次创建或 `replace()` 重建）开头把 `spec.fields` 的键各取一次。

**必须按代而不是在 setup 时一次性物化**（外部评审 P1，取证见 `useOverlaySpec` 的
`materializeLifecycleProps`）：`useSdkResource` 在 setup 时把 `props` 解构成闭包常量，之后每次
`createOnce`（重建）传的都是**同一个对象**。一次性物化会让 `GroundOverlay` 这类「有别名/投影
且有构造期字段」的覆盖物**重建后仍读到旧值**——`type: "image" → "canvas"` 触发重建，新实例却按
`options.type === "image"` 建出来。用例在 `v3-ground-overlay.test.ts`。

**按代物化仍保住「惰性投影一代只求值一次」**（`GroundOverlay.url` 的工厂每求值一次就新建一份
canvas，PR #103 评审 2 的契约）：物化结果存在 `generationProps`，**同一代的 `create` 与 `mount`
共用这一份**（`createOnce` 里两者先后调用、不跨代），因此下一代才重新求值——这条也有专门用例
钉住（并经变异验证：让 `mount` 重新物化会让「一代一次」变红）。

**不保留 Proxy**。若将来出现别名/投影形态的增加，判据是「读路径是否回到每帧」，而不是「要不要留个
Proxy 兜着」。

### 3. 固定形状用标量键；大数组仍走引用 + 版本

`core/utils/equality.ts` 新增 `pointKey` / `pixelKey` / `sizeKey` / `boundsKey`（与 `centerKey` 同形，
带 `p:` / `px:` / `sz:` / `b:` 前缀防形态撞键）。`useOverlaySpec` 的 watch 源按字段实际形状选源：
描述符 `value` 档是 `point` / `size` / `bounds` 的字段走标量键，其余（`style` / `icon` / `properties` /
url 工厂）保持 `stableKeyOf` 不变。

一个必须记的坑：描述符的 `size` 档在**组件侧的对外形态是 Pixel**（`MarkerProps.offset` /
`LabelProps.offset` 公开的都是 `{x, y}`），不是 Size（`{width, height}`）——尽管它按上游
`MarkerOptions.offset` 登记成 `value: "size"`。因此 `size` 档必须用 `pixelKey`；用 `sizeKey` 会让
`{x:2,y:2}` 与 `{width:2,height:2}` 判成同一个键（`setOffset` 用例一度因此空跑）。

`reference` 与 `versioned` 两种既有策略**原样不动**——`stableStringify` 大数组是 O(n) 的，
`versioned` 的 `flush:'sync'` 是 v3 语义（§背景）。红线：大数组不退回内容指纹。

### 4. InfoWindow：双 `nextTick` → 单一 post-flush 入口

- `scheduleConverge()` 改成 `convergeTick.value += 1` + 一个 `watchPostEffect` 里调 `reconcile()`。
  语义等价性论证见 §背景（`nextTick` 的排队顺序 = post-flush 的执行位置）。
- **收敛只有这一个入口**。开发期曾让 `onIntentChanged` 既直接 `reconcile()` 又 `scheduleConverge()`，
  结果一次 `closeInfoWindow` 发了两次——直接打破「close 失败时事实不变、下次触发才重试」这条不变式。
  **门禁是 `v3-infowindow.test.ts` 的「关闭命令抛错」用例**（实测：把 post effect 改成连跑两次
  `reconcile()` 会让该用例与「命令抛错」那条一起变红）。新加的「一次事件驱动的收敛不多发命令」
  只锁「不多发」，**不是**单入口的门禁——该场景下多跑一次收敛也观察不到差别，测试注释里如实写明了这条边界。
- 意图 watcher 改 `{ flush: "post" }`，让「prop 驱动的收敛」与「事件驱动的收敛」走同一个 post-flush 入口。
- options 队列同样并入 Vue batching：标脏 + 一次 post-flush 排空（`bind()` 里保留「就绪窗口补一次」的语义）。
- **一个都不少**：`createInfoWindowManager` 的每图 ownership、`onSuperseded` / `echoClosed` 的两条回写、
  `if (!instance.alive || activeInstance !== instance) return;` 的过期守卫、`suppressed` /
  `echoedClosed` / `lastOpenPositionKey`。明确**不**引入 ACK / FIFO / 计数 / 时间推断
  （`2026-09-14-service-lifecycle-and-local-search` 的 Ownership-first 结论对覆盖物同样成立）。

### 5. Baseline restore：只有「重建」一条路

`driver/types/overlays.ts` 给出**逐字段**依据表 `OVERLAY_REVERT_RATIONALE`，并经
`overlayPropertyRevert()` 暴露落点查询（当前唯一取值 `"rebuild"`）。`useOverlaySpec` 的批里出现
`value === undefined` 且该键**可能已写入**（`possiblyApplied` 记账）⇒ 记为一次 `needsReplace`。
落点与 `policy` **正交**：`zIndex` 仍是 `mutable`（值变化 5 → 7 就地写），只有「值消失」才重建。

**关于 `revert` 这个声明位**：`OverlayPropertySpec` 上确实加了 `revert?`，但**没有任何描述符
真的写它**——所有字段都走缺省 `"rebuild"`。它是「落点正交于 `policy`」这一判据的**占位**
（照 `valueArgs` / `toggle` 同族：先让 `spec.revert` 在判别联合上可读、调用点不必写断言），
而不是一个已有第二种取值的扩展面。**逐字段真正承载信息的是依据表**，测试逐字段核对的是表。
若将来出现第二条有证据的落点（例如某个字段的 baseline 可由上游快照取得），这张表与该声明位
一起长出来；在此之前**不**为它预留第二种取值。

**为什么不能经 getter 恢复 baseline**（逐条反证，这是本 ADR 最容易被重新讨论的一点）：

| 候选做法 | 为什么不行 |
| --- | --- |
| `getXxx()` 读回当前值再 `setXxx(那个值)` | getter 给的是**当前值**，不是 SDK 默认值。恢复之后 prop 仍然是 `undefined`，语义已经变了（这是「假恢复」，比重建更坏：调用方看不出区别，但组件的 props 与实例状态已经分叉） |
| 构造时快照一份当 baseline | 本库的 `create*` 总是**在构造期把有值的 prop 传进去**，快照到的就是调用方的值，不是默认值。除非「不传值」也构造一次——那是对每个字段多一次构造 + 一次读回，成本与失败面都不可接受 |
| `setXxx(undefined)` | 上游的 setter 不接受「恢复默认」的语义（4.0.4 的声明里 `setZIndex(zIndex: number)`，传 `undefined` 是把类型系统之外的值塞进去；真机上多为静默忽略或抛错，两种都不可依赖） |
| 猜一个 SDK 默认值写进去 | 猜测。上游默认值会随版本变，猜错就是**静默的行为回归**，且没有任何门禁能发现 |

逐字段核对 `@baidumap/jsapi-v4-types@4.0.4` 的结果：

- **无公开读回**：`zIndex`（8 个覆盖物类都有 `setZIndex`、**0 个**有 `getZIndex`——只有 `layer/*` 有）、
  全部 `enable*` / `disable*` 成对开关（无 getter）。
- **有读回但基线无从取得**：`offset` / `rotation` / `title` / `icon` / `style` / `opacity` / `anchor`
  与各图形族的描边填充字段——它们的 getter 同样只给当前值。
- **构造期必填**：`position` / `content` / `points` / `path` / `bounds` / `center` / `radius` /
  `altitude` / `controlPoints`——本来就走重建。
- **组件侧语义里没有「值消失」**：`autoCenter` / `visible`。
- **非属性**：`redraw`（方法）。
- **开放形态**：`url` / `properties` / `topFillColor` / `topFillOpacity` / `sideFillColor` /
  `sideFillOpacity`。

结论：`value → undefined` **一律**走重建；`zIndex` **保持 `mutable`**（值变化仍就地写，不引入每次
变值都重建的性能回退），只有「变回 `undefined`」才升级为一次重建。

**记账用「可能已写入」而不是「成功写入过」**：Driver 的 `setOptions` 按插入顺序逐个调 setter，
一次部分成功（第一个 setter 生效、第二个抛）是可能的；若只记成功项，那个已生效的字段会永远不再重建。
`possiblyApplied` 在**构造前**就用**原始 prop** 播种（`readRawProp`，不是 `readProp`——后者会对
`GroundOverlay.url` 的惰性工厂求值，破坏「一次创建只求值一次」的契约）。

**Driver 不变**：`driver/jsapi-v4/overlays.ts` 的 `setOptions` 保留 `if (value === undefined) continue;`。
重建由上层决定；Driver 仍然不猜默认值、不调 `setter(undefined)`。

### 6. 静态 emit 契约：生成显式键 interface

`scripts/generate-overlay-emits.mts` 从四处事实源 join 出
`core/overlays/overlayEventEmits.generated.ts`（每个 kind 一个**显式键 interface**）：

1. `OVERLAY_EVENT_MATRIX`（SDK 事件 + 载荷档）；
2. `OVERLAY_EVENT_ALIASES`（历史事件名，载荷与正典名相同）；
3. `NON_SDK_EVENTS`（本库事件，**附派发点**）：生成器回源码核对每个名字真的有人 `emit` 且带上了
   声明的载荷——「声明了却没人发」是 Vue 与 vue-tsc **都不报错**的一类漂移；
4. `EXCLUDED_EVENTS`（矩阵里有、但本库无派发点的键）。

SFC 一律 `defineEmits<MarkerEmits>()`。**为什么不能改成 mapped type**：见 §背景——`@vue/compiler-sfc`
要把类型实参解析成有限个键，只有 import 进来的显式键 interface 能编过。这是「键名只写死一次」的唯一形式。

**载荷覆写是 per-(kind, name)**：`open` / `close` 同时存在于 `context-menu`（走矩阵绑定，载荷确实是
`OverlayPartialPointerEvent`）与 `info-window`（`FORWARDED_SDK_EVENTS` 原样转发上游回调参数、**不**经
归一化：`open` / `close` 上游不给事件对象 ⇒ `[]`；`clickclose` / `maximize` / `restore` 转发的是
上游内部结构 ⇒ `unknown`）。按事件名单判会把 ContextMenu 误判成覆写。

`resize` 的排除从「注释里的一句话」变成**会红的一条**：生成脚本的 `--forbid=<name>` 模式，CI 跑
`--forbid=resize`；测试侧还反向断言 `--forbid=dragend` **必须失败**（否则这条门禁是空转的）。

**如实说明的门禁边界**：类型层看不到 SFC 的 `defineEmits` 泛型实参，「SFC 真的用了生成类型」只能查
文本（生成脚本的 `assertSfcUsesGenerated` + 测试里同款断言）。这是文本检查，不是类型检查。

`v3-overlay-suite.test.ts` 里基于正则刮 SFC 源码的 `readEmits()` 随之删除（SFC 改用泛型实参后它会解析到
0 个条目并被自己的解析守卫拦下），换成「读**磁盘上的生成物**」——重新推导一遍等于证明
`PAYLOAD_TYPE_BY_KIND` 自己等于自己，没有门禁价值。

## 后果（含回滚）

- **少了一整套自研调度**：`useOverlaySpec` 与 `useInfoWindow` 的单飞队列都退成「标脏 + 排一次」。
  验收口径（`v3-overlay-spec.test.ts`）：同 tick 多 prop 更新 ⇒ **恰好**一次必要 recreate，
  mutable patch 只落在**最终**实例上（`doomed.callLog` 为空、`survivor.callLog` 含 `setZIndex`），
  replace 在飞期间到达的更新并入尾随队列（不额外重建、不丢值）。
- **baseline 撤回从「无机制」变成「一次重建」**，逐字段有依据（`OVERLAY_REVERT_RATIONALE`）。
  「全部非 `unsupported` 属性都在表里」这条覆盖口径由 `v3-overlay-baseline-restore.test.ts`
  **运行时**逐字段遍历描述符断言（新增字段忘了登记理由会红）；**不是**编译期断言——
  描述符是运行时数据表，映射类型无法枚举它（与 §6 的 `compiler-sfc` 限制同源）。
  用例在该文件（含真实 SFC 的 `zIndex`、部分成功的 `setOptions` 之后仍要重建、重复 give/withdraw
  ⇒ 两次重建）。
- **emit 声明漂移从「事后刮源码发现」变成「改事实源时就会红」**。
- **回滚**：三条独立路径，可各自回退——① 队列（`useOverlaySpec` / `useInfoWindow` 的调度改动）不影响任何
  公开行为，回退即恢复自研队列；② baseline 撤回（`revert` 元数据 + `possiblyApplied`）回退后
  「有值 → `undefined`」退回 v3 行为（不重建、保持旧值）；③ 生成 emit（把 SFC 的
  `defineEmits<XEmits>()` 换回内联字面量、删生成物与脚本）不影响运行时（运行时仍按矩阵绑定），
  只有类型面回退到手抄。

## 非目标

- **不引入 getter-restore 路径**（§5 逐条反证）。这正是 issue 写的「没有 getter/unset → 重建」这一档。
- **不改** `versioned` 大数组 watcher 的 `flush:'sync'`，**不**退回 `stableStringify`（ADR
  `2026-09-24-scheduler-batching-hot-path`）。
- **不**把 `InfoWindow` / `ContextMenu` / `MapMask` / `Marker3D` 迁到 `useOverlaySpec`
  （`MapMask` / `Marker3D` 仍走 `useOverlayResource`，理由见 ADR `2026-09-18-overlay-event-matrix`）。
- **不**恢复 InfoWindow 的 ACK / FIFO / 业务状态机（Ownership-first，见 §4）。
- **不**动服务层（`useServiceTask` / `core/services`）与 #104 的结论。
- **不留** `sizeKey`：`Size`（`{width, height}`）形态在本库没有对外字段——描述符的 `size` 档
  对外是 Pixel（§3）。按「判据退化成常量、没有消费者的一律删除」删掉它，而不是「以后可能有用」。

## 参考

- `packages/bmap-vue/src/core/composables/useOverlaySpec.ts`（文件头两节：
  「更新路径为什么不再自研调度」「props 视图不再用运行时 Proxy」）
- `packages/bmap-vue/src/core/composables/useInfoWindow.ts`（`FORWARDED_SDK_EVENTS` 与 `resize` 的已知限制）
- `packages/bmap-vue/src/driver/types/overlays.ts`（`OverlayPropertyRevert` / `OVERLAY_REVERT_RATIONALE`）
- `packages/bmap-vue/src/core/utils/equality.ts`（定形几何的标量键，含 `size` 档的现实形态说明）
- `packages/bmap-vue/src/core/utils/keyedSources.ts`（`useOverlaySpec` 与 `useInfoWindow` 共用的数组源 watcher）
- `scripts/generate-overlay-emits.mts` / `scripts/load-source-module.mts`
- `tests/behavior/v3-overlay-baseline-restore.test.ts`、`v3-overlay-emits-generated.test.ts`、
  `v3-overlay-spec.test.ts`、`v3-infowindow.test.ts`
