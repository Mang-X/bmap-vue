# ADR 2026-09-18：BInfoWindow 的 detached host、ownership/reconcile 与每地图归属

- 状态：已接受（Accepted）
- 日期：2026-09-18
- 计划键：`M5-INFOWINDOW`（issue #32，追踪 #12，前置 #30 / #72）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)「非目标」里的
    「**不实现 Vue Teleport 与 InfoWindow 状态机**（issue 明确列为非目标）」：那是 #22 当时的
    范围声明，本 ADR 把这件事做掉。
  - [ADR 2026-09-13 私有面移除](./2026-09-13-private-sdk-surface-removal.md)「已知限制」里的
    「完整状态机（Teleport、InfoWindowManager、受控 / 不受控的边界、多气泡竞争）仍由 M5 **#32**
    收口」与「不做 #32 的产品级气泡状态机（Teleport、Manager、多气泡竞争、`maximize` / `restore`
    事件）」：本 ADR 交付这四项。
- 补充（**不取代**）：[ADR 2026-09-17 OverlaySpec 与 Marker](./2026-09-17-overlay-spec-and-marker.md)
  的已知限制 5 只列举了 `BContextMenu` 一类「挂到 target 而不是加进地图」的组件；本 ADR 新增
  第二类同样不走 `OverlaySpec` 的组件 —— **信息窗不是「加到地图上的覆盖物」**（打开 / 关闭是
  Map 级 API，`add` / `remove` 对它必须抛错）。两条限制指向同一个扩展点，按需在 #33 添加。
- 相关：`packages/baidu-map-gl-vue/src/components/overlays/BInfoWindow.vue`、
  `packages/baidu-map-gl-vue/src/core/overlays/InfoWindowManager.ts`、
  `packages/baidu-map-gl-vue/src/core/overlays/InfoWindowSpec.ts`、
  `packages/baidu-map-gl-vue/src/core/composables/useInfoWindow.ts`、
  `packages/baidu-map-gl-vue/src/core/runtime/MapRuntime.ts`（`infoWindows` 账本）
- 对照物：官方 React 组件库 `huiyan-fe/react-bmap@2.0.2`
  （`src/components/Overlay/InfoWindow.tsx` 的 v4 实现；v1 的 `src/components/Overlay/InfoWindow.tsx`
  里那套 `document.createElement('div')` + `ReactDOM.render(children, content)` 的 detached host 做法）
- 官方依据：`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/InfoWindow.d.ts`（`isOpen()` / `getOffset()`
  / `setWidth` / `setHeight` / `setTitle` / `setContent` / `redraw` / **没有** `setOffset`、
  也**没有** `position` 相关成员）、`overlay/InfoWindowOptions.d.ts`（各选项的官方默认值）、
  `overlay/OverlayEvent.d.ts` 的 `InfoWindowEventMap`（`open` / `close` / `clickclose` /
  `maximize` / `restore` / `resize` 六个）；官方 4.0 API 参考 `BMap.InfoWindow` /
  `Map#openInfoWindow / closeInfoWindow / getInfoWindow`；本仓库的真实 AK smoke 读数见
  [ADR 2026-09-11](./2026-09-11-jsapi-v4-overlay-facet.md) 的「smoke 顺带确认的运行时事实」

## 背景

`#72` 把 `<BInfoWindow>` 收回到公开可用面之后（不再把气泡当普通覆盖物、不再嗅探私有字段），
它能完成「打开 → 显示内容 → 关闭 → 卸载无残留」这条最小路径。动手前盘了现状，缺口有四层：

1. **内容节点是「Vue 渲染出来的 shell」**。组件把 `ref` 指向的 `<div>` 交给 `new BMap.InfoWindow(host)`,
   而 SDK 会把这个节点**搬进自己的容器**。于是「Vue 认为的父节点」与「实际父节点」分叉：
   组件里任何基于 shell 结构判断的逻辑都建立在过期的 DOM 关系上（官方 React 库 v1 的做法是
   `ReactDOM.render(children, host)` 之后**从不 unmount**——那会永久泄漏一棵渲染树）。
2. **没有状态机**。「打开状态」是两个变量：一个 `lastOpenState` 布尔 + 「上一次实际是否打开」。
   由此产生三类竞态（详见决策 2 / 3）：
   - 同一 tick 的 `open → close` 会让关闭命令被吞掉（真机实测：4.0 的打开是异步的，同一 tick
     `map.getInfoWindow()` 仍是 `null`，此时 `map.closeInfoWindow()` 是 no-op）；
   - 「关 → 立刻重开 → 迟到的 `close` 到达」会把已经重开的气泡在模型里关掉；
   - 「SDK 自己打开」（别处调了地图级 API）与「SDK 自己关闭」（点地图 / 点关闭按钮）没有统一的收敛点。
3. **没有归属**。官方语义是「一张地图同时只有一个气泡」，但**谁当前开着**没有读回入口
   （`map.getInfoWindow()` 异步生效），而且**被顶掉的一方不会收到任何通知**（官方没有承诺，
   本仓库的 Fake 也刻意不补发）。于是 `A.open` → `B.open` 之后，A 的受控模型仍停在
   `open=true`，而地图上显示的是 B。更危险的是 `closeInfoWindow()` 是**地图级、无参数**的入口：
   谁去关「自己」都可能关掉别人。
4. **尺寸观察用错了信号**。组件用 `MutationObserver`（`childList + subtree + characterData`）
   把「渲染树结构变了」当成「尺寸变了」：既漏掉「文本没变但字体 / 图片异步加载导致尺寸变化」，
   又对每一次 DOM 变更触发一次 `redraw()`，而且**没有任何合帧**。

## 决策

### 0. **ownership / reconcile 契约**（2026-09-19 方向纠正；取代 2 / 3 / 3b / 3c / 4b / 4c / 4d / 4f / 4g 的账本机制）

> 本节是**当前契约**。下面那些被取代的小节保留为**历史记录**（它们记录了「为什么不该走那条路」），
> 但**不再是实现**：`infoWindowMachine.ts` 已删除，`openOutstanding` / `closeOutstanding` /
> `commandFailed` / `explicitClosePair` 一并删除。

`<BInfoWindow>` **拥有**它创建的那个 InfoWindow：

| 概念 | 是什么 |
| --- | --- |
| **desired** | `open`（旧名 `show`）表达的唯一控制意图（`show` 是兼容别名，同一收口） |
| **observed** | 地图上**实际**开着的是不是这一个 —— 读官方公开的 `Map#getInfoWindow()` 再与 **handle 身份**比对（`driver.overlays.isCurrentInfoWindow()`） |
| **SDK 事件** | `open` / `close` / `clickclose` / `maximize` / `restore` **原样转发**；前三条同时是**收敛触发**，**不是**第二套业务意图 |
| **收敛** | 只有三种命令：`desired ∧ ¬observed ⇒ openInfoWindow`；`desired ∧ observed ∧ 位置变了 ⇒ 再开一次`（官方没有 `setPosition`）；`¬desired ∧ observed ⇒ closeInfoWindow`。其余什么都不做 |
| **缺位置** | 「想开但读不到位置」**不满足打开条件** ⇒ 期望状态是「关」，并按边沿报一次 `BMAP_INVALID_ARGUMENT` |
| **被同图另一个气泡顶掉** | Manager 通知 ⇒ 回写一次 `update:open(false)` + 进入「不抢回来」，直到父级把 `open` 置回 `false` 再置 `true` |
| **用户点关闭按钮（`clickclose`）** | 带明确来源的用户意图 ⇒ 回写一次 `update:open(false)`（回写幂等：同一状态只回写一次） |
| **命令失败** | 经 `resource:error` 上报，不假装成功；下一次触发（父级再改一次意图）自然重试 —— 不需要「冲销在飞账」 |

**为什么删除状态机**：SDK 对 `open` / `close` 回调**不提供 request identity**（载荷里没有位置、没有
请求 id，官方也不承诺多次请求之间的回调顺序）。要恢复「这条回包属于哪次命令」，只能在上层用计数 /
FIFO / 时序去猜 —— 十轮外部评审里这条轴被逐个方向打穿（旧 `close` 迟到 → 多条在飞 → 旧 `open` 迟到
→ 命令同步失败 → 事件形状 → 配对窗口与 task 边界），每补一个方向都会引出新的组合。这条教训在本仓库
已有先例：#38（LocalSearch 的 FIFO + 墓碑整段作废）、#71（默认 Loader 退回官方）、#72（删掉私有
`_rd` 恢复路径）、#99（实测后删除 `clearScope`）。**上游没有公开的因果信息，就不要在上层把它恢复成
一套稳定协议。**

**仍然保留的复杂度**（这些是 Vue 版真正比参考实现多出来的部分，且与回包归属无关）：
detached host + Teleport、slot 生命周期、`ResizeObserver` 合帧重绘、实例 generation（旧实例回调作废）、
Manager/Driver 的「不许误关别人的气泡」守卫、以及**本次新增的**对 `getInfoWindow()` 的读回收敛。

#### 行为变更（对调用方可见）

| 变更 | 之前 | 之后 | 为什么 |
| --- | --- | --- | --- |
| SDK 侧**未经请求**的 `close` | 回写 `update:open(false)` | **不回写**，只转发 `close`；若父级仍写 `open: true`，会按受控语义**重新把气泡打开**（要让它保持关闭就处理 `close` 或使用 `v-model`） | 「SDK 的观测不是第二套业务意图」；回写只留给**有明确来源**的用户动作（`clickclose`） |
| 外部（别处）打开**本组件拥有的**实例 | 回写 `update:open(true)` | 收敛回关（并如实转发 `open`） | 该实例由本组件拥有；外部控制不再被翻译成 v-model 意图 |
| 实例**重建** | 「对外原子」：不发 `open` | 新实例重新打开时**如实转发** `open` | 事件原样转发，不做归属推断 |
| `update:open` 的回写 | 每次模型变化各一次 | 只表达**状态变化**（同一状态只回写一次） | 同一次用户点击会来多条 `clickclose`（实测条数随实例被打开过几次累积） |
| `enableCloseOnClick`（点地图关闭） | 模型收敛并回写 | 同「未经请求的 close」：转发 `close`，父级不跟就重新断言 | 同上 |

### 1. detached host 由 SDK 持有，渲染子树由 Vue Teleport 拥有

创建期就 `document.createElement("div")` 作为 host，把它交给 `createInfoWindow(host, opts)`，
再让 `<Teleport :to="host">` 渲染 slot。三方归属写死：

| 谁 | 拥有什么 |
| --- | --- |
| `useInfoWindow` | host 的**创建与释放**（`remove()`），并经 `host` ref 交给 Teleport |
| SDK | host 在**打开期间**的挂载位置（它会把它搬进自己的容器） |
| Vue Teleport | host 内部的渲染子树（重建 / 卸载时随组件生命周期收起） |

**释放的归属要分清**：`host.remove()` 只发生在**卸载与实例重建**（那时实例不再复用）。**关闭**
气泡时本库不摘宿主 —— 实例要留着复用，而「关闭之后 SDK 自己的容器还在不在」是 SDK 的事，
官方没有对「关闭后内容节点归谁」作出承诺（`closeInfoWindow()` 的声明里没有任何返回或契约）。
文档、changeset 与 smoke 的读数都按这条口径写，不把 SDK 的行为算成本库的承诺。

由此有三个必须写进文档的外部后果：

- **开放的 DOM 契约**：host 带 `data-bmap-infowindow-content`。宿主页与**浏览器 smoke** 靠它定位
  内容节点 —— 组件根是 `<Teleport>`，`$el` 不再指向内容节点，这是「内容可见 / 无残留」唯一
  可外部观察的读数（`tests/browser/jsapi-v4/main.ts` 的 `contentHost()`）。
- `$attrs`（`class` / `style` / 自定义属性）落在 host **内部**的包装节点
  `div.b-info-window-content` 上。此前挂在 shell 上（shell 就是内容节点），现在 shell 变成
  我们的包装节点，观感与 scoped 样式的作用方式不变；
- **打开之前宿主根本不在文档里**（它由本库创建、交给 SDK，SDK 打开时才挂进自己的容器）。
  旧实现那套「`display:none` → 打开时交还可见性」的收敛因此**不需要**了 —— 它是为
  「Vue 渲染的 shell 一开始就在组件树里、可能在地图角落闪现」准备的对策。

### 2. 五相位状态机；`open` 是**唯一**主状态

> ⚠️ **已取代**（2026-09-19，见决策 0）：五相位状态机已删除（`open` 仍是唯一主状态，但以 desired/observed 收敛表达） 本节保留为历史记录。



`core/overlays/infoWindowMachine.ts` 是纯函数 reducer（无计时器、无 DOM、无 SDK）：

```
            intent(true)                 sdk-open（确认）
 closed ────────────────▶ opening ─────────────────────▶ open
   ▲                        │                             │
   │ sdk-close / superseded │ intent(false)               │ intent(false)
   └──────────────────── closing ◀───────────────────────┘
                            ▲  │ sdk-open（关闭命令被吞掉）
                            └──┘  再下发一次 close
```

- `opening` / `closing` 存在的唯一理由就是「命令已下发、结果未知」这段窗口。**在 `closing` 里观测到
  `sdk-open` ⇒ 再下发一次 `close`**：这正好修掉「同一 tick 的 open → close 被吞掉」。
- `superseded` 动作**不产生任何 effect**：被顶掉的一方绝不能调地图级关闭（那会关掉新气泡）。
- **`disposed` 的生产者是组件的 scope 释放**（`onScopeDispose` 里 `dispatch({ type: "dispose" })`，
  紧接着实例的释放路径）。刻意**不**在 `dispatch` 外面再挂一个并行的布尔门闩：终态语义只有一处，
  之后任何输入都经 `reduceInfoWindow` 的「终态」分支被丢弃。
- **`v-model:open` 是唯一主模型**。`show` / `v-model:show` 作为 v2 兼容别名保留：它只在
  `resolveInfoWindowOpenIntent()`（唯一收口）里被读取，且**只在显式给出时**覆盖 `open`
  （`undefined` = 不表态，靠 `withDefaults(..., { show: undefined })` 关掉 Vue 布尔 prop 的
  「缺省即 false」转换）。告警**收进仓库的集中弃用层**（`core/deprecations` 的别名表 +
  `warner`）：稳定 code `BMAP_DEPRECATED_PROP_ALIAS`、统一文案、同实例一次、production 不输出 ——
  组件不写自己的兼容代码（那是 #28 明令禁止、#31 收掉的形态），迁移文档的表格也从同一张表派生
  （`v3-overlay-events-doc.test.ts` 是它的镜像门禁）。
- **`update:*` 只在 SDK 侧变化时回写**（`change.source === "sdk"`）。父级驱动的变化不回声 ——
  否则「父级改 → 我们 emit → 父级确认」会多出一轮回环。

### 3. `close` 没有身份 ⇒ 用「在飞的关闭命令**计数**」归属（布尔不够）

> ⚠️ **已取代**（2026-09-19，见决策 0）：在飞计数机制已删除（不再推断回包归属） 本节保留为历史记录。



SDK 的 `close` 事件不带任何身份。处理错的后果是「明明还开着，模型却说关了」。

**第一版用一个布尔 `closePending`，被外部评审打穿（P1）**：`关 → 立刻重开` 之后两次回包的**到达顺序
不可预期**，而第一版在「观测到 `sdk-open`」时就把标记清成 `false` —— 于是
「重开的 `open` 先到、旧 `close` 后到」这条**合法**反序会把那条旧 `close` 当成**未经请求的关闭**，
把已经重开的模型关掉。当时的用例只覆盖了相反的顺序（旧 `close` 先到）。

现在记的是**计数**，且只统计**在「气泡确实开着」时下发的**关闭命令 ——
只有那种命令才会产生回调（气泡尚未被接管时 `closeInfoWindow()` 是 no-op，实测＋夹具都如此）：

| `closeOutstanding` | 模型 `open` | 处置 |
| --- | --- | --- |
| `0` | 任意 | **未经请求的关闭**（点地图 / 点关闭按钮 / 被顶掉）⇒ 相位回 `closed`、模型收敛、回写 `update:open` |
| `> 0` | `false` | 结算我们已下发的关闭命令 ⇒ 计数减一、相位回 `closed`，**不改模型** |
| `> 0` | `true` | **过期回包**（关之后又重开过）⇒ 计数减一，相位与模型都不动 |

`> 0` 且模型是 `true` 必然是过期回包：「模型是 `true`」只可能来自「重开之后」。
于是**两种到达顺序**都不会把已经重开的气泡关掉，而「点地图关闭」仍然是一次真实的模型收敛。

计数只在三个时机增长、且每个增长都对应一条**一定会到达**的 `close` 回调：`open` 相位下收到关闭意图、
`closing` 相位里观测到 `sdk-open`（命令被吞掉 ⇒ 补一条）、以及它们的重复下发。
**「被吞掉的命令不得计数」是这条设计的另一半**（否则计数永远还不清，之后一次真实的关闭会被
误判成「结算」而静默丢掉），两种反向变异各有一条用例盯着。

**顺序要求：先消费计数，再判「已经关着」的幂等**（外部评审第二轮 P1）。计数**允许大于 1** ——
`closing` 相位里观测到迟到的 `sdk-open` 就会补发一条 close，把计数推到 2。而
「相位已经回到 `closed`」**不等于**「计数已经还清」：第 2 条回包恰恰在那时到达。
若先按 `closed` 早退（第一版的顺序），残留计数就永远还不清，下一次重开后一条**真实**的关闭会被
当成过期回包吞掉 —— 模型停在「开」，也就是上面那句「误关 / 漏关」翻面里的漏关一侧。
可复现时序（纯 reducer，用例 `多条关闭命令在飞`）：

```
open(A) → sdk-open → position(B)（再下发一条 open）→ intent(false)（计数 1，相位 closing）
        → sdk-open（迟到；closing 分支补发 close ⇒ 计数 2）
        → sdk-close（结算，计数 1，相位 closed）
        → sdk-close（★ 必须在 closed 相位下仍被消费 ⇒ 计数 0）
        → 重开 → 真实的地图关闭 ⇒ 收敛为关
```

### 3b. `open` 事件同样要归属 —— 与上面**完全对称**的一张表（外部评审第三轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：open 侧归属账已删除 本节保留为历史记录。



`open` 事件的归属问题在前两轮被漏掉了：本组件在 `open` 相位下改变位置会**再下发一条 `open`**
（移动），而那条请求的回包可能晚到「关闭已经完成」之后。不加区分地把它当成「外部打开」，
模型会被一条**旧请求**的回包重新拉成开 —— 而父级刚刚明确关闭（实测组件级可复现：`deferInfoWindowOpen`
+ 位置变化 + 关闭 + `flushInfoWindowOpen()`）。同时不能简单地「`closed` 下所有 `sdk-open` 都忽略」，
因为既有契约明确支持「外部 SDK 未经请求打开 ⇒ `update:open true`」。

因此 `open` 侧也记账（`openOutstanding` = 已下发、尚未被 `sdk-open` 确认的打开请求）：

| 观测到 `sdk-open` | 期望状态 | 处置 |
| --- | --- | --- |
| 任意 | `open === true` | 确认：相位进 `open`（模型本来就是开 ⇒ 无回写、无事件） |
| `openOutstanding > 0` | `open === false` | **自己的迟到回包** ⇒ 重新收敛：补一条 close（`closeOutstanding + 1`，此刻 SDK 确认开着 ⇒ 必有回调）、相位进 `closing` |
| `openOutstanding === 0` | `open === false` | **外部未经请求的打开** ⇒ 如实回写 `update:open true`（既有契约，有用例守） |

两张账互为镜像，规则一句话：**谁下发的请求，谁负责收敛；没有在飞请求时才把事件当外部意图回写。**

### 3c. 异常路径上的守恒：失败要**冲销**，不能借事件收敛（外部评审第四轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：`command-failed` 已删除（失败只上报，不再需要冲销） 本节保留为历史记录。



两条归属账都有一个隐含前提：**命令发出去了 ⇒ 会有一条回包来还账**。命令**同步失败**时这个前提不成立，
而第一版把它当成「收到了一条 `sdk-close`」处理（组件在 `openInfoWindow()` 抛错后伪造一条 `sdk-close`）
—— 两处后果都不对：

1. **open 侧那笔账永远还不掉**（`sdk-close` 不消费 `openOutstanding`）⇒ 后续一次**外部**打开会被
   当成「本组件的迟到回包」而主动关掉，`update:open true` 这条既有契约失效；
2. **移动请求失败时模型被错误地关掉**：气泡其实还开着（只是移动没成功），却收敛成 `closed`。

因此失败是**独立动作** `command-failed`，effect 上带 `accounted`（这次命令是否记了一份账），
处置按「失败的是哪种命令」收敛：

| 失败的命令 | 冲销 | 收敛 |
| --- | --- | --- |
| `open`（`opening` 相位，即首次打开） | `openOutstanding - accounted` | 相位 → `closed` + 模型收敛为关（回写一次 `update:open false`） |
| `open`（`open` 相位，即**移动**） | 同上 | **什么都不改**（气泡仍然开着，失败不代表关闭意图） |
| `close` | `closeOutstanding - accounted` | 相位 → `closed` + 模型收敛为关（不停留在 `closing` 等一条不会来的回包） |

同一条守恒规则也覆盖**根本没把命令交给 SDK** 的情形：`runEffect` 里「没有可用位置」的提前返回
同样走冲销（而不是裸 `return`），否则账已记下、命令未下发，等于凭空造一笔幽灵请求。
按构造这条分支**不可达**（机器用同一个 `positionKeyOf` 算 `canOpen`，只在 `canOpen` 时下发 `open`），
因此**没有**为它写判别性用例 —— 保留它是为了让「账的每一笔增长都必须有人冲销」这条规则在代码里闭上，
而不是依赖调用点各自记得。


### 3d.「命令交给了 Driver」≠「命令发给了地图」：守卫的**判据顺序**也是账本守恒的一部分（外部评审第五轮 P1）

> ⚠️ **部分取代**（2026-09-19，见决策 0）：**判据顺序本身仍然有效并保留**（Driver 必须先读 `map.getInfoWindow()` 再决定要不要动地图）——失效的只是它服务的那本「在飞账」。

3c 处理的是「命令在调用点就失败了」。这一条是同一主题的另一面：命令**顺利交给了 Driver**，
却被 Driver 的守卫**静默丢弃**。状态机那边已经 `accounted: true` 地记了一份在飞账，而这条命令
从未到达 SDK ⇒ 不会有回包 ⇒ 账永远还不掉，气泡也留在图上。

**缺陷形态**（`driver/jsapi-v4/overlays.ts` 的 `closeInfoWindow`）。旧顺序是：

```
if (lastRequestedByMap.get(owner) !== raw) return;   // ← 先挡，而且直接 return
const current = callOptional(owner, "getInfoWindow");
if (current && current !== raw) return;
```

被 B 顶掉的 A 会**刻意保留** `openOutstanding`（见 `superseded` 分支），于是当 A 那条迟到的
打开请求真的接管了地图时，`sdk-open` 会被正确识别为「自己的迟到回包」，状态机也正确地下发一条
纠偏 close —— 但它的 `lastRequestedByMap` 早已指向 B，第一行就 `return` 了。**它甚至不会去读
`getInfoWindow()`**，因此「此刻地图上开着的其实正是 A」这个事实根本没被看到。

**这条 P1 的性质与前四轮不同**：前四轮都在状态机内部（账记没记、冲销没冲销）。这一条是
**跨层契约** —— 状态机的注释里写着「此刻 SDK 确认它是开着的 ⇒ 这条 close 一定会有回包」，
这句话在 SDK 层面成立，但**在我们自己这一层不成立**：Driver 也是我们写的，它有权把命令丢掉。
所以「账本守恒」的前提必须包括「Driver 不会静默吞掉一条已经记了账的命令」。

**修正：判据顺序**（读**事实**优先，兜底判据最后）：

| 顺序 | 判据 | 处置 | 理由 |
| --- | --- | --- | --- |
| 1 | `map.getInfoWindow() === raw` | **允许关闭** | 「当前开着的就是我」是唯一能回答「这次关闭会不会碰到别人的气泡」的事实。此时即使 `lastRequested` 指向别人（迟到接管的典型形态）也必须照关 |
| 2 | `map.getInfoWindow()` 是**别人** | 不碰地图 | 那确实是别人的气泡 |
| 3 | `map.getInfoWindow()` 为空 | 用 `lastRequestedByMap` 兜底 | 这是**有歧义的**异步窗口：`openInfoWindow()` 之后同一 tick 里它仍是 `null`（实测 0ms 为 null、~100ms 变成该实例）。这一刻没有任何事实可依，只能退回本 Driver 唯一能自行保证的不变量，避免旧气泡的 close 取消掉一次新生效的打开（PR #61 评审的跨气泡风险） |

`lastRequestedByMap` 的定位因此**降级**了：它不再是「允许触碰地图的总闸」，而是**空窗口里的兜底**。
代码里的声明注释与 `closeInfoWindow` 的注释都写明了这个顺序是契约的一部分、以及「不要把它提回去」。

**必须防住的过度放宽**（反证的另一个方向）：判据 2 不能丢。丢掉它就会去关别人的气泡 ——
既有用例里有四条会立刻变红（含官方 UI Kit 的 widget 与「被顶掉的 A 卸载时不得关掉 B」）。

### 4. 每张地图一份 `InfoWindowManager`：先换当前项，再通知被顶掉的那个

`MapRuntime` 持有（`MapContext.infoWindows`，可选，与 `layers` 同口径），账本只有两项：
**注册表**（这张地图上还活着几个气泡）+ **当前项**（**实际**在地图上打开的那一个，来源见 4b）。

- `activate(handle)` 在**打开成功之后**调用（过早声明会在打开失败时白白顶掉别人）；
- **先写「当前是谁」，再通知被顶掉的那个**：被顶掉者在通知里会收敛自己的状态并交还归属，
  顺序反了那次调用会把新主人误清掉（`InfoWindowManager.test.ts` 有一条用例专门锁它）；
- 被顶掉的组件**不得**调 `closeInfoWindow()`（契约写在 `register({ onSuperseded })` 上，
  由 `superseded` 动作不产生 effect 保证；Driver 侧另有守卫兜底，其判据顺序见 3d ——
  **以 `map.getInfoWindow()` 为准，只有那个「空窗口」才退回「最后请求者」**）；
- 未登记的实例不能抢走归属（创建失败被释放的实例不该顶掉别人）。

### 4b. 账本的 `current` 必须跟随 **SDK 的事实**，而不只跟随我们下发的命令（外部评审第六轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：结论仍然成立（Manager 跟随观测），但推进方式改为「收敛时读回 `getInfoWindow()`」 本节保留为历史记录。



决策 4 的账本原先只被两处推进：**打开命令成功后** `activate()`、**关闭效果收尾时** `deactivate()`。
两者都是「我们下发过什么」，不是「地图上实际是什么」。第六轮评审打穿了这个缺口，有两个可观察的后果：

1. **被迟到请求真正顶掉的那个气泡收不到任何通知**：A 的请求挂起 → B 同步打开（账本 current=B，
   A 收到 `superseded`）→ A 的旧请求才真正接管地图（SDK 侧把 B 顶掉了）。状态机正确地给 A 下发了
   纠偏 close（3d），但**账本从没被告知这件事** ⇒ B 一直以为自己是 current、模型停在 `open=true`，
   而地图上已经什么都没有了。B 的 prop 没变 ⇒ watch 不会再触发 ⇒ 它不会自愈。
2. **外部 SDK 自己开 / 关时账本与地图分叉**：`map.openInfoWindow()`（别处调的）让气泡真的开了，
   账本却仍是 `null`；点地图关闭（`enableCloseOnClick`）之后地图已经空了，账本仍指向那个旧实例。
   后续任何互斥通知都会**基于陈旧的归属**做决定。

**修正**：把真实的 `open` / `close` / `clickclose` 事件也当成账本的事实源 ——

| SDK 事件 | 顺序 | 账本 |
| --- | --- | --- |
| `open` | **先**账本、后状态机 | `manager.activate(自己)` ⇒ 然后喂 `sdk-open` |
| `close` | **先**状态机、后账本 | 喂 `sdk-close`（**无身份**，按在飞账判结算/过期）⇒ **按状态机的结论**决定是否 `deactivate` |
| `clickclose` | 同 `close` | 喂 `sdk-clickclose`（**带来源**的真实关闭，见 4d）⇒ 同上 + 转发事件 |

**`open` 的顺序是硬要求**：迟到接管那条路径上，状态机收到 `sdk-open` 后会**立刻**下发一条纠偏 close，
而那条 close 的收尾会 `deactivate(自己)`。如果账本那一刻还指着别人，这次 `deactivate` 是 no-op，
于是 `activate` 之后再也没人清账 —— 恰恰就是**幽灵 current** 本身。反证 M4（把两行对调）单独红了这一条。

**`close` 的顺序恰好相反**，理由见 4c。

**注意 `deactivate` 的方向性**：它只清「当前项**就是自己**」的情形（决策 4 的既有语义），
所以被顶掉的一方收到迟到的 `close` 不会误清新主人的归属。

### 4c. 关闭类事件的账本退场，要等**状态机的结论**（外部评审第七轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：该顺序要求随状态机一并删除 本节保留为历史记录。



4b 把「SDK 事件」接进了账本，但第一版把 `close` / `clickclose` 也做成「**先** `deactivate`、**再**喂状态机」——
与 `open` 同一个方向。这就与本 ADR 决策 3 早就确立的语义撞车了：`sdk-close` 里有一类是**过期回包**
（`closeOutstanding > 0` 且模型仍是「开」，即「重开确认先到、旧 close 后到」，第一轮 P1 修复的核心），
状态机对它的处置是**只减账、`open` 与相位都不动**。

于是组件层会出现三处分叉：状态机仍 `open=true`、地图上可能仍开着这个气泡，而 `manager.current()`
已经被清成 `null`。后续另一个气泡打开时，就不会通知这个**实际还开着**的实例 `superseded` —— 又回到
决策 4b 要解决的那个「账本与地图分叉」，只是这次是从反面引入的。

**修正**：`close` / `clickclose` 改成「**先喂状态机、再按转换后的机器状态**决定账本退场」：

| 这条关闭类事件是什么 | 状态机 | 账本 |
| --- | --- | --- |
| `sdk-close`：我们下发的关闭的结算 / 未经请求的真实关闭 | 落到关闭侧（`open === false`） | `deactivate(自己)` |
| `sdk-close`：**过期回包**（`closeOutstanding > 0` 且模型是开） | 仍 `open === true` | **不动** |
| `sdk-close`：相位已经 `closed` 的幂等重复 | `open === false` | `deactivate`（本已是 no-op） |
| `sdk-clickclose`：用户点了关闭按钮 | **一律**落到关闭侧 | `deactivate(自己)`（见 4d） |

判据读的是 `machine`（`dispatch` 全部收敛之后的状态）而不是单次 transition：`dispatch` 期间可能发生
同步 SDK 回调触发的重入，`machine` 才是真正要的口径。

**一句话总结这条轴**：账本镜像的是**状态机对「当前是否开着」的判断**，而不是「收到过哪些事件」。
把事件直接当事实源是 4b 的进步，但**事件的语义要经过状态机的归属判定**才算数 ——
否则「乱序回包」这条被状态机妥善处理掉的东西，会在账本这一层重新变成分叉。

### 4d. **带来源**的事件不参与「无身份归属表」（外部评审第八轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：结论仍成立（`clickclose` 仍走独立处置：转写 + 回写），但不再需要「归属表」这个对立面 本节保留为历史记录。



决策 3 的归属表是为 `close` **没有身份**而设计的：载荷里没有位置、没有请求 id，官方对多次请求之间的
回调顺序也没有承诺，因此只能靠「在飞的关闭命令计数」消歧。但这条表**只适用于没有身份的事件** ——
把它用在本身带来源的事件上，就会把一次明确的意图误判成「旧命令的回包」。

`clickclose` 就是这种事件。本仓自己的契约（`overlayEventCatalog` / `events.md` /
组件文档三处同源）把它定义为「**点击信息窗口的关闭按钮时触发**」：来源是明确的，
**用户刚刚主动关掉了这个气泡**。而第一版让它走 `sdk-close`，于是：

```
open → sdk-open → intent(false)（closeOutstanding = 1，回包还没到）
     → intent(true) → sdk-open（重开已确认）
     → 用户点关闭按钮 ⇒ clickclose
```

`reduceSdkClose` 认到 `closeOutstanding > 0 && open === true` ⇒ 判成**过期回包** ⇒ 只减账、
模型保持「开」⇒ **用户明明点了关闭，模型却还是开**；账本也仍然指着它。
在飞账可以有多条，所以即使 SDK 之后补一条普通 `close`，两条事件也可能都被旧账吸收。

**修正**：`clickclose` 走独立动作 `sdk-clickclose`，语义是**一次真实的关闭**：
模型收敛为关、相位落到 `closed`、账本按结论退场（同 4c）；
但**保留** `closeOutstanding` —— 我们下发的关闭命令仍然欠一条回包，它迟到时必须继续被认成
「结算」而不是「未经请求的关闭」。**那条回包不该由用户的一次点击来冲销。**

**这条的通用形态**：给一个「无身份的事件」设计的归属机制，**不能顺手复用到有身份的事件上**。
判断依据是事件本身能不能回答问题「这是谁的」—— 能，就不要让它去跟别人的账对消。
归属表越长，越容易把「明确的意图」也塞进去。

### 4e. 夹具要延迟**哪一个**对象：副作用还是事件？（外部评审第八轮 P1-2）

> ℹ️ **仍然有效**（2026-09-19）：这条是关于**夹具建模**的教训，与状态机是否健在无关。

这条不是实现缺陷，而是**测试建模**缺陷，但它的后果同样是「绿灯包住了缺陷」，所以记在这里。

要构造「乱序回包」，需要把一条 `close` 拆成两半：**副作用**（地图状态变了）与**事件**（`close` 送达）。
第一版延迟的是副作用（`flushInfoWindowClose()` 才真正把地图关掉），于是 flush 之后地图是空的。
而真正要复现的时序是「关闭**已经生效**，只是那条事件晚到」—— 那时 flush 之后地图上应当**仍然开着**
重开后的气泡。

两者的区别在组件层是可观测的：地图空 vs 地图上新气泡。**判别线就是断言地图状态**；
第一版恰好没断言它，所以在「地图空 / 模型开 / 账本仍 current」的三方分叉下依然绿。

现在的语义是**副作用立即发生、只有事件被暂存**，并且：
`deferInfoWindowCloseEvent` / `flushInfoWindowCloseEvent()` 只对**当时被关掉的那个实例**派发 `close`，
不再触碰地图状态。

**通用提醒**：夹具的名字会暗示建模 —— 旧名 `deferInfoWindowClose` 逐字读就是「延迟关闭」，
而这个暗示本身就是错的。给夹具命名时要写清延迟的是**哪一半**（副作用 / 事件 / 回调），
并且**每条用到它的用例都要断言那一半**，否则夹具建错了也看不出来。

### 4f. 「用户点关闭按钮」是一**组**事件，不是一个（外部评审第九轮 P1 · **真实 AK 实测**）

> ⚠️ **已取代**（2026-09-19，见决策 0）：**实测结论保留**（事件形状、条数、时序），但对账机制已删除 本节保留为历史记录。



前几轮把 `clickclose` 当成「一条事件」来讨论。第九轮评审提出：百度历史实现是
「先 `dispatchEvent("onclickclose")`、随后关闭并 `dispatchEvent("onclose")`」，
所以一次点击可能**同时**产生 `clickclose` 与 `close`；若那条伴随的 `close` 去消费我们下发的
关闭命令的账，真正迟到的回包就会在下次重开后被误判成「未经请求的关闭」。
评审要求**先用真实 v4 记录事件序列**，再决定处置。实测结论如下（真实 AK · headless Chromium）：

| 读数 | 结果 |
| --- | --- |
| 一次点击的**组成** | `close` **恰好 1 条** + `clickclose` **1 条或多条** |
| 两者间隔 | 约 0.1ms，**同一个 task**（点击后立刻排的微任务里两条都已经到齐） |
| **顺序** | **不固定**：全新实例 5 轮里 4 次 `close` 在前、1 次 `clickclose` 在前 |
| `clickclose` 的**条数** | 随「同一个实例被打开过几次」累积：打开 1/2/3 次 ⇒ 1/2/3 条（`close` 始终 1 条） |
| 点击之后 | `map.getInfoWindow()` 变成 `null`（气泡确实关了） |
| 对照组：`map.closeInfoWindow()` | 只有 `close` 1 条（没有 `clickclose`） |

「`clickclose` 随打开次数累积」说明 SDK **每次打开/重绘都会重新绑定关闭按钮的处理器**
（实测规律就是「条数 = 打开次数」）—— 这是一条**上游性质**，不是本库造成的。

**处置：这一组事件不带我们命令的身份 ⇒ 两半都不得消费 `closeOutstanding`。**
难点在于一条 `close` 到达时无法预知后面会不会跟着 `clickclose`，所以只能**回溯性对账**，
`InfoWindowSnapshot.explicitClosePair` 就是这个标记（四种取值见其注释）：

| 收到的顺序 | 前半做了什么 | 后半怎么补 |
| --- | --- | --- |
| `close` → `clickclose` | `close` 可能已消费一份账（记为 `close-consumed`） | `clickclose` **还回去**（`closeOutstanding + 1`） |
| `clickclose` → `close` | `clickclose` 打上 `clickclose-just-seen` | 那条 `close` **不消费**，标记清掉 |
| `close` … `close` | 正常逐条消费（标记被下一次覆盖） | —— |
| 末尾多余的第 N 条 `clickclose` | 模型已经是「关」⇒ 什么都没关掉 | **不留标记**（否则它会挂到下一次关闭，让一条真实回包被跳过结算） |
| **task 结束**（本组事件已收全） | —— | 残留标记一律作废（见 4g：组件排微任务派发 `explicit-close-pair-expired`） |

最后一行是实测逼出来的：`clickclose` 会有**多条**，末尾那几条落在「模型已经关」的时刻；
只有「这次点击确实关掉了东西」才留标记，标记就不会滞留。

**没做的一件事（留给维护者定）**：我们目前把 SDK 的 `clickclose` **1:1 转发**给调用方，
所以同一个实例被打开多次之后，一次点击会让调用方收到**多条** `clickclose`。
这与文档里「用户点了气泡上的关闭按钮」的措辞有落差，但**去重会改变公开的 emit 契约**
（是「一次点击一次事件」还是「原样转发上游」），属于产品决策而不是缺陷修复 ——
因此本轮只把它登记为已知限制 13 并保持原样转发。

### 4g. 配对窗口**以 task 为界**：组件排微任务，状态机仍然是纯函数（外部评审第十轮 P1）

> ⚠️ **已取代**（2026-09-19，见决策 0）：配对窗口机制已删除；「同一 task 的一组事件」这条实测结论改用于**收敛合并**（见决策 0 与实现） 本节保留为历史记录。



4f 的配对是「**action 邻接**」式的：标记只在出现下一条关闭类 action 时被覆盖/清理。这漏了一个维度 ——
**时间过去本身不会产生 action**。于是一条真正迟到的旧回包留下的 `close-consumed` 可以挂很久：

```
open → sdk-open → intent(false) → intent(true) → sdk-open     （closeOutstanding = 1，模型开）
→ 真正那条旧命令的回包 sdk-close                                （账 1→0，模型仍开，留下 close-consumed）
→ ★ 之后没有任何 action，过了任意多个 task
→ 用户点 X（实测形状 clickclose → close → clickclose）
   ⇒ 第一条 clickclose 把这条**陈旧**标记当成「本次点击的伴随 close」，把账 0→1 还回去
   ⇒ 中间的 close 又 1→0，末尾重复的 clickclose 再还一次 ⇒ 最终 closeOutstanding = 1
→ 父级重开后，下一次真实关闭被这份**幽灵账**当成旧命令结算而吞掉
```

这正是「用 action 邻接猜分组」的固有缺陷：邻接是**结构性**的，而分组其实是**时间性**的。

**修正：把实测到的边界编码进去。** 真实 4.0 实测「同一次点击产生的 `close` + `clickclose`×N
在**同一个 task 内**全部到齐（点击后立刻排的微任务里已经完整）」⇒ 配对窗口就是**一个 task**：

- 组件在本 task 收到第一条关闭类事件时 `queueMicrotask` 一次（每个 task 只排一个，带守卫）；
- 微任务必然在「本 task 的同步派发全部结束」之后、下一个 task 之前运行 ⇒ 同 task 的伴随事件
  已经配对完成，残留标记作废；
- 派发的是**纯动作** `explicit-close-pair-expired`，因此状态机不认识时间、也不必认识时间 ——
  「过期」由调用方喂进来，这条规则照样能在 reducer 上直接测（用例显式调 `expireClosePair()`）。

**为什么两边都要排微任务**：实测里 `close` 在前与 `clickclose` 在前都出现过，所以两个分支都要触发
「本 task 有分组」这个信号；只在 `clickclose` 分支排会让 «`close` 在前的形状» 失去边界
（反证 M2 专打这一点）。

**没选的那条路**：把同一 task 的一整组事件 buffer 起来、微任务里一次性喂给状态机。它更彻底，
但会让关闭类事件的模型更新**延迟一个微任务**（现状是同步收敛，`dispatch` 之后立刻可见），
属于行为变更而不是修缺口；本轮取「保留同步收敛 + 给标记加边界」。

### 5. 尺寸：观察**实际内容 host**、合帧重绘、不自激

1. **触发源**：`useResizeObserver(host)`（VueUse）。观察的就是 SDK 实际展示内容的那块 host，
   不是占位 shell；host 换新时 VueUse 自己 `disconnect()` 旧目标再 observe 新目标 ⇒
   「重建时解绑旧目标」是结构上的事实，重建多次也只有一份观察者；
2. **读数**：`readElementSize()`（项目统一的布局盒口径，见 `core/runtime/elementSize.ts`），
   并且观察器显式传 `box: "border-box"` —— 与读数**同语义**是硬要求（#29 四轮复审的结论：
   `scale(0) → scale(1)` 这类只看 transform 的变化不触发 `ResizeObserver`，语义不一致就会
   「值变了但没人通知」）；
3. **合帧**：地图的 `FrameScheduler`，key 是**每实例一个 symbol** ⇒ 一帧内多次尺寸通知只重绘一次，
   重建时 `cancel(redrawKey)` 丢掉旧实例排队的重绘；
4. **不自激**：重绘完成后记录**重绘之后**的尺寸；由重绘自身引起的那次变化与记录相等而被吞掉。
   `setOptions`（`width` / `height` / `title`）之后的显式重绘走同一条记账，两者不会互相激发。

### 6. 卸载顺序：先停异步，再解绑、关闭、释放 host 与 scope

`registration.dispose()`（由 `useSdkResource` 在释放实例 scope **之前**调用）里严格四步：

1. `alive = false`（所有实例回调立刻失效）+ `scheduler.cancel(redrawKey)`；
2. 逐个调用 SDK 事件解绑器（此后不再有任何 SDK → 模型的写入）；
3. `driver.overlays.closeInfoWindow(handle)`（地图级专用入口，不回退通用 `removeOverlay`）+
   `manager.deactivate`；
4. `host.value = null`（Teleport 换目标 / 观察器解绑）→ `host.remove()`（不残留 DOM）→
   实例 scope 由 `useSdkResource` 收尾。

第 3 步**无条件**执行：地图级关闭本身幂等（没有气泡时是 no-op），被顶掉的一方由 Driver 的守卫
挡住；而「按模型跳过」会留下真实泄漏 —— SDK 侧已关、模型已收敛（例如 `close` 事件先到）时，
卸载就再也没人去关它了。这一步也**不**回喂状态机：这条路径服务的是「实例」而不是「模型」，
重建要在对外表现上原子（只有 `destroy` / `rebuild`），回喂一条 `sdk-close` 会让父级收到假 `close`。

刻意**不**调任何「销毁 InfoWindow」的方法：官方 4.0 的 `InfoWindow` 没有公开的 destroy
（`Overlay#dispose()` 只在基类声明里），猜一个成员名属于 `AGENTS.md` 禁止的私有面嗅探。

### 6b. 重建**单飞**，且每代实例按自己的 handle 索引（外部评审 P1）

`useSdkResource.replace()` 的释放路径会在「token 已过期的那一代」上补调一次
`spec.mount({ resource })` 再立刻 `dispose()`。这条路径要求的是**按传进来的 handle 取实例**：

- `instancesByHandle: Map<InfoWindowHandle, ActiveInstance>`（创建时登记、释放时按身份摘除），
  `mount` / `bind` 都从它取 —— 不再用全局的 `activeInstance` 去代表「传进来的那个 resource」。
  用全局变量的后果是「旧 resource 配新实例」：stale 释放会把**新实例**关掉/摘掉，旧实例反而没人释放；
- 另外把重建做成**单飞 + 合并一次尾随重建**：任何时刻只有一次 `replace()` 在飞，
  新请求合并成「结束后再来一次」（`create` 每次都读当前 props，所以尾随那次一定是最新值）。
  这让「两条 `replace()` 重叠」**从结构上不可能**，而不只是「配对正确」。

**为什么两者都做**：评审给的正是这两条路（「按 handle/generation 保存每代实例」或「把 rebuild
串行/coalesce」）。身份索引让过期清理精确处置**它自己那一代**（而不是跳过它 —— 见验证表里
「被放弃的那一代必须被收干净」那条用例与它的反证）；单飞则把重叠本身消掉。

| 组件事件 | 来源 | 语义 |
| --- | --- | --- |
| `open` / `close` | 状态机的模型变化 | 气泡被打开 / 关闭（**任何**来源，包括 prop 驱动） |
| `clickclose` | SDK `clickclose` | 用户点了气泡上的关闭按钮（与 `close` 同一套归属判定，另外点名来源） |
| `maximize` / `restore` | SDK 同名事件 | 界面状态（需 `enableMaximize`），**不**参与「打开」这一维 |
| `update:open` / `update:show` | `source === "sdk"` 的模型变化 | 受控状态回写 |
| `rebuild` / `destroy` | 实例生命周期 | 载荷是新 / 旧的**实例代次**；`rebuild` **首次创建不发**（那时没有「重建」可言，父级本来就知道实例要建） |

每次重建 `generation + 1`；每条来自实例的回调都同时带**实例身份**（闭包捕获）与**代次**两道守卫
（「刚释放、下一代还没建好」的窗口里两者结论不同）。**不转发 `resize`**：SDK 的 `resize` 是它自己
气泡尺寸变化的通知，而本库的尺寸观察已经覆盖了「内容变了要重绘」这条需求；转发一个调用方不知道
该做什么的事件只会多一个噪声钩子（与 `OverlaySpec` 不加无消费者扩展点同口径）。

### 8. 与官方 UI Kit 的分工：不接管 widget 内部资源

`#32` 实施步骤 6 要求「与官方 UI Kit 自带的详情 / 搜索气泡分开」。本层**只**管理
`<BInfoWindow>` 自己创建的那一个 host：不去查 `@baidumap/jsapi-ui-kit` 渲染出来的 DOM，
不登记 UI Kit 内部的气泡，也不借 UI Kit 的事件做状态同步。两者的资源归属因此完全独立 ——
卸载 `<BInfoWindow>` 不会动 UI Kit 的 widget（`v3-ui-kit-*` 的用例各自独立通过）。

### 9. 与官方参考实现 `huiyan-fe/react-bmap@2.0.2` 的对照

| 维度 | 参考实现（v4 `InfoWindow.tsx`） | 本库 | 结论 |
| --- | --- | --- | --- |
| 生命周期 | 一个 `useEffect`：按构造期 props 指纹重建、按 `open` 调 `map.openInfoWindow()`，`close` 只在卸载时调一次 | 每实例一份 scope：按构造期 props 指纹重建，每个触发点跑到一次 desired/observed 收敛（官方没有 `setPosition`，位置变了就重开） | **本库更严**：参考实现的 `open` 变 `false` **不会关闭**已经打开的气泡 |
| 双向同步 | 没有任何 SDK → props 的回写 | `update:open` + `open` / `close` 事件 + 回环抑制 | **本库更严** |
| 归属 / 多气泡 | 无（同页两个气泡互相不知道） | 每地图 `InfoWindowManager` + `superseded` 通知 | **本库更严** |
| 内容宿主 | v4 用 `content: string \| HTMLElement`，**不**渲染 `children`；v1 用 `document.createElement` + `ReactDOM.render(children, host)` 且**从不 unmount** | detached host + Vue Teleport（拥有渲染子树、卸载即收起） | 同源（v1 的思路）+ 修掉 v1 的泄漏 |
| 尺寸与重绘 | 无观察器、无合帧 | `ResizeObserver(host)` + `FrameScheduler` 合帧 + 防自激 + 重绘后记账 | **本库更严** |
| `open` / `show` | 只有 `visible`（且在 v4 里是**被忽略的** prop） | `open` 主模型 + `show` 兼容别名（集中告警） | 本库更显式（参考实现的 `visible` 是「假支持」的典型） |
| 加载路径 | 依赖 `@baidumap/jsapi-loader@^1.0.0` | 精确锁定 `1.0.0` | 同源 |

参考实现是「该有的接口面」的证据，但**不是照抄对象**：它的 `visible` 静默失效、`open=false`
不关闭、`close` 只在卸载时调用，这三条都是「看起来支持、实际不生效」的形态。

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 组件根从 `<div>` 变成 `<Teleport>` | `$el` 不再指向内容节点；`$attrs` 落到 host 内部的 `div.b-info-window-content` | 文档写明；新增 `[data-bmap-infowindow-content]` DOM 契约供定位 |
| `update:open` / `update:show` 不再回声 prop 驱动的变化 | **受控语义更正确**：父级设置 `open=false` 时组件不再回写一次 `false`。只听 `update:*` 做副作用的用法需改用 `open` / `close` 事件 | changeset（minor）+ 文档的受控语义一节 |
| 新增 `clickclose` / `maximize` / `restore` / `rebuild` / `destroy` emits | 纯新增 | changeset（minor） |
| 使用 `show` / `v-model:show` 时新增一次 `devWarn` | 仅开发期提示，每组件一次 | 文档标注 deprecated |
| `BInfoWindowProps` 的声明点从 `types/components.ts` 移到 `core/overlays/InfoWindowSpec.ts` | 公开类型名与字段**完全不变**（`types/components.ts` 仍导出同名接口） | 无运行时影响 |
| `MapContext.infoWindows` 新增（可选） | 自定义 Context 不提供时退化为组件自持账本（同页多气泡不再互相察觉） | 与 `layers` 同口径 |
| 卸载 / 关闭后 host 会被 `remove()` | 之前内容节点留在原地（`display:none`），现在从文档摘掉 | 依赖「关闭后仍能查 DOM」的用法需改用 `open` / `close` 事件 |
| 测试基建：`FakeMap` 现在建模「SDK 把内容节点搬进自己的容器」（`data-fake-bubble-host`） | Fake 更接近真实；此前的用例若假设「内容节点一直在原处」需要更新 | 本次一并修正 |

**无破坏性变更**：`position` / `title` / `width` / `height` / `offset` / `open` / `show` /
`enableMaximize` / `enableAutoPan` / `enableCloseOnClick` 的字段名、类型与默认值全部保持；
`v-model:open` 与 `v-model:show` 的用法不变。

### 回滚

1. `BInfoWindow.vue` 切回 #72 的实现（`ResourceScope` + `useRequiredMapContext` 的手写 watcher）；
2. `useInfoWindow.ts` / `infoWindowMachine.ts` / `InfoWindowManager.ts` / `InfoWindowSpec.ts`
   一并删除，`MapRuntime` / `MapContext` 的 `infoWindows` 字段移除；
3. `types/components.ts` 的 `BInfoWindowProps` 改回自持声明（字段照抄 `InfoWindowSpec.ts`）。

Fake 的 `bubbleHost` 建模与 `[data-bmap-infowindow-content]` 契约可以单独保留或单独回滚 ——
它们不依赖状态机。

## 已知限制（显式接受，带归属）

> ⚠️ **2026-09-19 起**：与「在飞账 / 回包归属 / 配对窗口」相关的条目（5、以及提到 outstanding 的段落）
> 记录的是**历史**实现的前提，已不再适用；保留它们是为了说明那些前提当初为什么被显式接受。
> 与 ownership 契约仍然相关的限制见决策 0 的「预期外的代价」与本节其余条目。


1. **没有「销毁 InfoWindow 实例」的入口**：官方 4.0 的 `InfoWindow` 没有公开 destroy，
   实例本身在关闭后交给 GC。本库保证的是 host、Observer、业务 listener、排队中的重绘无残留
   （逐项有读数），**不**保证实例对象被显式销毁。
2. **`enableCloseOnClick` 的默认值与本库既有默认保持一致（`false`），官方声明的默认是 `true`**。
   本票是生命周期重构，不在同一票里改第二处对外行为；这一处差异**登记在此**而不是隐式保留
   （要改就在单独的 changeset 里改，并同时更新文档表格）。
3. **`resize` 事件不转发**（决策 7）。
4. **SSR 不输出气泡内容**：host 在客户端挂载时才创建，因此服务端渲染的 HTML 里没有
   `[data-bmap-infowindow-content]`。气泡本身依赖地图（`<BMap>` 也是客户端能力），
   这不是退化，但需要在文档里说清（`.vue` 的 slot 内容在 SSR 期不渲染）。
5. **SDK 事件与命令之间没有身份**：本库用「在飞的关闭命令计数」消歧（决策 3），覆盖了已知的
   真实时序（同 tick 吞命令、关后重开、反序回包、多条在飞）。两个被显式接受的前提：
   - 两条归属账（`closeOutstanding` / `openOutstanding`）都以「**每条在飞命令恰好产生一条回调**」
     为前提（**本库自己这一侧不留这个缺口**：命令同步失败由 `command-failed` 精确冲销，见 3c；
     命令被 Driver 守卫丢弃由判据顺序消掉，见 3d。剩下的风险只在**上游 SDK** 一侧）。若某个 SDK 版本在气泡确实开着时**吞掉**一条关闭命令（少发一条 `close`），残留计数会
     吸收掉随后**一次**真实关闭（模型停在该次关闭前的值）；同理**吞掉**一条打开请求会让随后
     一次**外部**打开被当成自己的迟到回包（`update:open true` 少发一次，我们反而去关它）。
     两者都只影响**一次**、之后自愈 —— 这条只能靠 live smoke 观察，不要为它预先加猜测性兜底；
     也正因为如此，本库**不**把「已下发请求条数」当成「SDK 一定会回几条」的保证，而是当**归属线索**；
   - 若某个 SDK 版本在**没有任何命令**的情况下重复派发 `open` / `close`，模型仍会以
     「最后一次观测」为准。
6. **信息窗不走 `OverlaySpec`**：它不是「加到地图上的覆盖物」（`add` / `remove` 对它必须抛错），
   与 `BContextMenu` 同属一类，扩展点按需在 #33 添加（见头部的「补充」一条）。
   **更新队列的语义与 `useOverlaySpec` 逐条对齐**（同键合并 / 单飞 / 排空期间新值并入 / 后到者胜 /
   没有落点时留在待办里），只有两处刻意差异（本层不做重建分类；「有没有落点」的判据是实例身份而不是
   `sdk.resource.value`）。两处的**异常策略**也不同（那边 setOptions 之外的异常向上抛、这边全部就地
   告警），因此不抽共享原语 —— 与 ADR 2026-09-17 已知限制 2 的取舍一致。
   **改其中一处时必须同时改另一处**，收口在 #31 / #33。
7. **同页多气泡的「被顶掉」通知只在同一张地图内成立**：跨地图不共享账本（这是刻意的 ——
   不同地图的气泡本来互不影响）。
8. **组件层的「实例身份 / 代次」守卫是防御性的**（见验证表那一行）：它们不是任何验收项的唯一依据
   —— 真正保证「迟到回调不改变状态」的是状态机的代次过滤与释放路径的解绑顺序。
9. **关闭气泡时宿主由谁摘，不是本库的承诺**：本库只在**卸载 / 重建**时 `remove()`。关闭之后
   SDK 是否会撤掉自己的容器（连带把宿主从文档里带下去）没有公开承诺 —— 用例与 smoke 里
   「关闭后内容节点不再连在文档里」这条读数在**夹具与真实 4.0 上都成立**，但它读的是整条栈的行为
   （夹具按「SDK 拆掉自己的容器、不回收我们给的节点」建模）。要的是「看不见」这个结果，
   而实现这一结果的责任方是 SDK。
10. **「两条 `replace()` 重叠」在当前触发集下不可达 —— 因此没有针对它的判别性用例。** 理由与证据：
    唯一的构造期触发是 `offset` 那一个 watcher（Vue 按 flush 去重），而本层的 `spec.create` 是
    **同步**的，`createOnce` 里 `await spec.create()` 的窗口只有**一个微任务**；后续 flush 一定排在
    那个微任务之后，所以进不去窗口。实测探针（在 `mount` 里比对「拿到的 resource」与当前实例）在
    5 种时序、23 次实例创建（含 10 次微任务粒度的连续变化）下 **0 次不配对**。
    这带来两个后果：① 决策 6b 的身份索引与单飞是**结构性加固**（对将来的第二个触发源、异步
    `create` 或公开的重建入口），不是对当下可复现缺陷的修复；② **「不重叠」这条性质本身在这个
    表面上没有读数**（去掉单飞后全部用例仍绿）—— 单飞那部分的可测部分是「尾随重建不得丢值」
    （去掉尾随重建会红），其余只能靠代码审阅。若评审知道别的触发路径，请给出前置，我补判别性用例。
11. **`show` 的读取规则与集中弃用层的「正典优先」有一处刻意差异**（决策 2）：集中层的
    `resolveAliasValue()` 是「正典有值 ⇒ 旧名完全不参与」，前提是正典（`bounds`）**必填** ⇒
    「缺失」可观测。本组件的正典 `open` 带运行期默认值（`withDefaults` 里的 `false`，为的是
    `<BInfoWindow open />` 这种裸布尔属性仍按 Vue 惯例生效），于是「没传 `open`」与
    「传了 `open: false`」在 props 上**不可区分**；照搬正典优先会让默认值把 `show` 彻底压死
    （`v-model:show` 静默失效）。因此本组件取**可观测**的规则：显式给出的 `show` 生效。
    代价：两个都传时以 `show` 为准（写进了组件文档与迁移文档的弃用表）。
    要严格对齐就得去掉 `open` 的默认值，代价是裸布尔属性失效 —— 一侧留作后续取舍。
12. **`props` 的默认值有第三处**：组件（`withDefaults`）、`INFO_WINDOW_FIELDS` 的声明面、
    文档的 props 表格各写了一份，当前一致但没有会红的检查（与 `BInfoWindowProps` 的键集不同 ——
    键集由编译期映射类型强制覆盖）。改默认值时三处要一起改；做成门禁（解析文档表格 + 读运行期
    props 定义）属于发布面校验，留给后续票。

13. **`clickclose` 会随「同一个实例被打开过几次」重复派发**（真实 AK 实测：打开 1/2/3 次 ⇒
    `clickclose` 1/2/3 条，`close` 始终 1 条；SDK 每次打开/重绘都重新绑定关闭按钮的处理器）。
    本库**原样转发**，因此调用方在一次点击里可能收到多条 `clickclose` 事件。
    状态机对这一组事件是幂等的（第 2 条起不改变任何状态，也不会消费命令账，见 4f）。
    是否在转发层去重属于公开 emit 契约的取舍，**留给维护者决定**：去重会让「一次点击 = 一次事件」
    成立，代价是与上游事件流不再 1:1。

## 验证

> ⚠️ **2026-09-19 起：本节的账本类判据已随状态机一并删除**（那些行验证的是「本库能不能推断回包归属」，
> 而本库现在**不再承诺**这件事）。仍然保留并逐条有用的是：宿主/Teleport、slot 生命周期、尺寸合帧、
> 实例重建与单飞、槽位与释放、互斥与多地图隔离、代次丢弃、声明面与描述符一致性 —— 它们验证的是
> **最终地图状态 / 资源释放 / 公开事件**，与 ownership 契约同向。


| 检查 | 命令 / 落点 |
| --- | --- |
| 状态机的竞态与归属表（16 条：无重复命令、同 tick 吞命令、关后重开、过期回包、代次丢弃、缺位置只报一次、失败收敛、终态） | `packages/baidu-map-gl-vue/src/core/overlays/infoWindowMachine.test.ts` |
| 账本的顶替顺序、未登记不抢归属、通知抛错不打断、释放语义（7 条） | `packages/baidu-map-gl-vue/src/core/overlays/InfoWindowManager.test.ts` |
| detached host 被 SDK 搬走、内容随 slot 更新、关闭 / 卸载后宿主摘除 | `tests/behavior/v3-binfowindow.test.ts`（`内容宿主` 一组） |
| 无回环（受控闭环只回写一次）、快速 open/close、SDK 自己打开、`clickclose`、`maximize` / `restore`、缺位置报错一次 | 同上（`竞态与回环` 一组） |
| **同一 tick 的 open → close 被 SDK 吞掉**：观测到 `open` 之后必须再关一次（端到端，用夹具的 `deferInfoWindowOpen` 复现真机时序） | 同上（`同一 tick 的 open → close 被 SDK 吞掉`） |
| **反序回包**：关 → 立刻重开 →「重开的 `open` 先到、旧 `close` 后到」不得关掉已重开的模型；随后一次真实关闭仍须收敛（评审 P1-1 的复现） | `infoWindowMachine.test.ts`（`重开确认先到、旧 close 后到`） |
| **被放弃的那一代必须被它自己的释放路径收干净**（重建窗口内卸载 → `useSdkResource` 的 stale 分支） | `v3-binfowindow.test.ts`（`重建窗口内卸载`） |
| **单飞的尾随重建不得丢值**：连续构造期变化后，最终存活那一代必须按**最后一次**的 prop 构建（反证：去掉尾随重建 ⇒ `expected 9 to be 10`） | 同上（`重建是单飞的`） |
| **配对窗口以 task 为界**：一条更早的旧回包留下的 `close-consumed` 不得与**很多个 task 之后**的一次用户点击配对 —— 否则凭空多出幽灵 `closeOutstanding`，后一次真实关闭会被它吞掉（反证：过期动作变 no-op / 只在 `clickclose` 分支排微任务 / **反方向**每个 action 后都清标记 ⇒ 各红） | `infoWindowMachine.test.ts`（`配对窗口随 task 结束关闭`）+ `v3-binfowindow.test.ts`（`跨 task 之后的一次用户点击，不得与更早那条旧回包配对`，六步复现） |
| **点关闭按钮是一组事件，不得吞掉命令账**：`close`（恰 1 条）+ `clickclose`（1..N 条，顺序不定）落在「有一笔关闭命令在飞 + 已重开」之上时，账必须仍然保留到真正迟到的回包（反证：不还原伴随 close 消费的账 / 让伴随 close 照常消费 / 标记不清理 / **无条件**还原 ⇒ 各红） | `infoWindowMachine.test.ts`（`clickclose 伴随的那条普通 close 不得吞掉命令账`，4 种形状）+ `v3-binfowindow.test.ts`（同名端到端，3 种形状）+ live smoke `infowindow-close-button-pair`（把实测形状本身变成门禁） |
| **过期回包不得清空账本**：重开确认先到、旧 `close` 后到时状态机仍 `open` ⇒ `current()` 必须保持该实例，**且地图上仍然开着重开后的气泡**（反证：退回「无条件 `deactivate`」⇒ 红；**永不退场** ⇒ 正常关闭路径的用例红；**夹具退回「延迟副作用」** ⇒ 地图断言红） | `v3-binfowindow.test.ts`（`重开确认先到、旧 close 后到`） |
| **`clickclose` 带来源，不参与无身份的归属表**：有在飞关闭账时用户点关闭按钮仍必须真的关上（模型回写一次 `false`、账本退场），但那笔账**不得**被这次点击冲销（反证：状态机退回 `reduceSdkClose` / 组件退回 `sdk-close` / 顺手把账清零 ⇒ 各红） | `infoWindowMachine.test.ts`（`clickclose 带明确来源`）+ `v3-binfowindow.test.ts`（`用户点关闭按钮（clickclose）不得被在飞的旧关闭账吞掉`） |
| **账本跟随 SDK 事实**：被迟到接管真正顶掉的 B 必须收到 `superseded`（模型不能停在图上已不存在的气泡上）；外部 SDK 开 / 关后 `infoWindows.current()` 必须同步（反证：删掉 `open` 的 `activate` / 删掉 `close` 的 `deactivate` / 删掉 `clickclose` 的 `deactivate` / **把两行顺序调反** ⇒ 各红） | `v3-binfowindow.test.ts`（`双窗口乱序`、`外部 SDK 的 open / close 都要同步账本`、`点地图关闭`、`clickclose`） |
| **被顶掉的 A 的迟到 open 接管地图后必须被真正关掉**（双窗口乱序）：地图上不得留下 A，也不得把 A 回写成打开（反证：把 Driver 的判据顺序退回「先看最后请求者」⇒ Driver 与端到端用例都红；松开「当前是别人就不碰」或去掉空窗口兜底 ⇒ 既有收紧用例红） | `overlays.test.ts`（`[迟到接管] 当前气泡确实是我…` + 反向 `当前气泡是别人时仍然不碰地图`）+ `v3-binfowindow.test.ts`（`双窗口乱序`，端到端，用 `deferInfoWindowOpen` + `flushInfoWindowOpen()`） |
| **命令同步失败必须冲销在飞账**：open 失败后「外部打开仍回写 / 父级重试仍成功」，close 失败后「真实关闭仍收敛」；移动失败**不得**把还开着的气泡收敛成关（反证四条：组件仍伪造 `sdk-close` / open 失败不冲销 / close 失败不冲销 / 移动失败也收敛 ⇒ 都红，逐条读数见文末第四轮小节） | `infoWindowMachine.test.ts`（三条）+ `v3-binfowindow.test.ts`（`open 命令同步失败`，端到端，用夹具的 `failNextOpenInfoWindow`） |
| **迟到的内部 `open` 必须重新收敛**（移动请求的回包在关闭完成后才到）：模型不得被拉开；反证：去掉 open 侧在飞账或移动不记账 ⇒ 红 | `infoWindowMachine.test.ts`（`迟到的**内部** open`）+ `v3-binfowindow.test.ts`（`移动请求的迟到 open`，端到端） |
| **外部未经请求的 `open` 仍须回写**（与上一条互为反向）：反证：把它也当成要收敛 ⇒ 红 | `infoWindowMachine.test.ts`（`外部未经请求的 open`） |
| **多条关闭命令在飞时必须全部清账**：`outstanding=2 → 两次 sdk-close`（其中一次在相位已 `closed` 时到达）⇒ 重开后一次真实关闭仍能收敛（评审第二轮 P1 的复现；反证：把 `closed` 早退挪回计数之前 ⇒ 红） | `infoWindowMachine.test.ts`（`多条关闭命令在飞`） |
| **点地图关闭**（`enableCloseOnClick`）：SDK 自己关 ⇒ 模型收敛 + 回写，且不因为回写而重开 | 同上（`点地图关闭`） |
| 多窗口互斥、被顶掉者卸载不影响新气泡、多地图隔离、迟到 callback | 同上（`互斥与隔离` 一组） |
| 一帧一次重绘、不自激、未打开不重绘、选项变化补一次重绘 | 同上（`尺寸与合帧重绘` 一组） |
| **排队中的重绘在卸载 / 重建时被丢弃**（旧实例不再重绘） | 同上（`排队中的 redraw 在卸载 / 重建时被丢弃`） |
| 重建的 `destroy` / `rebuild` 代次、对外原子、观察者不堆积、20 轮账目守恒 | 同上（`重复挂载与实例重建` 一组） |
| `show` 兼容别名与集中告警、`resolveInfoWindowOpenIntent` 的取值表、SSR 不创建 host | 同上（`唯一主模型与兼容别名` 一组） |
| 属性面覆盖 `BInfoWindowProps` 且与 Driver 描述符一致 | 同上（`属性面` 一组） |
| 代次丢弃（状态机层） | `infoWindowMachine.test.ts` 的「迟到回调按代次丢弃」一组 |
| 五个相位均可达（`disposed` 由组件 scope 释放推进） | 状态机的「dispose 之后一切输入都不产生命令与回写」+ 组件级的卸载 / 重建用例 |
| 组件层的实例身份 / 代次守卫 | **防御性，无独立用例**：释放路径已经先解绑事件，过期回调在当前实现里构造不出来（单点反证确认去掉任一道都不会变红）。保留它们的理由是让回调归属不依赖释放顺序，见 `bindSdkEvents` 的注释 |
| 真实 v4 的 detached host / 可见性 / 关闭无残留 | `pnpm smoke:v4:fixture` 的 `infowindow-visible`；真实 AK 档 `pnpm smoke:v4` |
| 边界与发布产物 | `check:raw-sdk`（两条）/ `check:public-dts` / `check:no-bmapgl` / `typecheck:v3` / `build:v3` / `test:unit` / `verify:package` |
| 既有气泡行为不回归 | `v4-components-lifecycle`（两张地图隔离、20 轮挂载/卸载、position 声明式同步） |

## 外部评审修正（2026-09-18，PR #101 第一轮）

评审在 `f08f903` 上给了 2 条 P1，**两条都复现属实**（本条按时间顺序记录，正文其余部分已按修正后的
口径写）。

| 评审 | 复现 / 结论 | 修正 |
| --- | --- | --- |
| **P1-1**：`sdk-open` 会清掉「未结算的关闭命令」标记 ⇒ 反序回包（重开的 `open` 先到、旧 `close` 后到）会把已经重开的模型关掉 | **确认**。红用例 `重开确认先到、旧 close 后到` 修复前报 `模型必须仍然是打开…: expected false to be true` | 决策 3 改成**计数** + 「只统计气泡确实开着时下发的关闭命令」；并补上「被吞掉的命令不得计数」的另一半（否则计数永不还清） |
| **P1-2**：`offset` 重建未串行化，而 `mount()` 用全局 `activeInstance` 取实例 ⇒ 两个 `replace()` 重叠时 stale 清理可能清掉新 generation、留下旧 host/handle | **重叠在当前触发集下不可达**（探针 5 种时序 / 23 次创建 / 0 次不配对；`create` 同步 ⇒ 窗口只有一个微任务，后续 flush 排在它之后）。但「`mount` 用全局变量代表传进来的 resource」这个耦合**是真的**，评审给的两条修法都采纳了 | 决策 6b：`instancesByHandle`（按 handle 取实例）+ 重建单飞并合并一次尾随重建。新增两条用例：「重建窗口内卸载时被放弃的那一代必须被收干净」（这条**可达**，且能挡住「只加身份 guard 不释放」的半修）、「单飞的尾随重建不得丢值」 |
| 评审附带要求「补一条两个重建重叠的回归用例」 | **做不到**：重叠不可达 ⇒ 没有可红的用例。已在已知限制 10 里写明探针证据与方法论，并请评审给出前置 | — |

### 第二轮（`8bcb6bd` → 本轮）

评审确认上轮 2 个 P1 已修，但在新的计数模型里发现 1 个新 P1：**`closeOutstanding` 允许 `> 1`，
而 `reduceSdkClose` 在 `phase === "closed"` 时先返回** ⇒ 第二条回包无法继续结账，残留计数会在
下一次重开后把一次真实的 SDK 关闭误判成旧回包（模型停在「开」）。

- **复现属实**：红用例 `多条关闭命令在飞` 修复前报 `残留计数不得把真实关闭吞掉: expected true to be false`。
- **修正**：把「已经关着」的幂等判断挪到**消费计数之后**（顺序写进代码注释、模块注释与决策 3）。
- **反证两个方向**：① 把早退挪回计数之前 ⇒ 红；② 结算时忘记减计数（只改相位）⇒ 红。
- 这条 P1 打中的正是本 ADR 自己反复强调的那句「误关 / 漏关会互相翻面」——**计数法的账必须在每条
  回包上都清干净，与相位无关**。

### 第三轮（`a0937d0` → 本轮）

评审确认上轮计数残留的 P1 已修，但指出**同一个归属问题在 `open` 侧还没做**：移动请求的迟到回包会在
`closed` 下把模型重新拉成开（组件级可复现，且不能用「`closed` 下一律忽略 `sdk-open`」来修，
因为那会破坏「外部未经请求打开 ⇒ 回写」的既有契约）。

- **复现属实**：红用例 `迟到的**内部** open` 修复前报
  `父级刚明确关闭，模型不得被旧请求的回包拉开: expected true to be false`。
- **修正**：新增 `openOutstanding`（open 侧的对称账），`sdk-open` 按「期望状态 × 有无在飞请求」三分支处置
  （见 3b 的表）；两条账的规则合并成一句「谁下发的请求，谁负责收敛」。
- **反证三个方向**：去掉 open 侧在飞账 / 移动那条 open 不记账 / 把外部打开也当成要收敛 ⇒ 都红
  （最后一个证明既有契约没被破坏）。
- 端到端用例按评审给的步骤写：`deferInfoWindowOpen` + 位置变化 + 关闭 + `flushInfoWindowOpen()`，
  断言**不回写 `update:open true`** 且**地图上不留气泡**（重新收敛真的把气泡关掉了，而不是只改模型）。

四轮下来这条轴的形态很固定：**同一份「命令 ↔ 回调」归属问题会被逐个方向打穿**
（旧 close 迟到 → 多条 close 在飞 → 旧 open 迟到 → 命令同步失败）。每修完一个方向，就主动把
**对称方向**（open 侧的账、失败路径的账）也写成用例。

### 第四轮（`ca26fb6` → 本轮）

评审确认上轮 open 侧归属账已修，但指出**异常路径没有跟着升级**：`openInfoWindow()` / `closeInfoWindow()`
同步抛错时不会有回包还账，而组件当时用「伪造一条 `sdk-close`」表示失败 —— 既冲不掉 `openOutstanding`，
也会把**还开着**的气泡（移动失败）在模型里关掉。

- **修正**：失败成为独立动作 `command-failed`（effect 带 `accounted`），按 3c 的表精确冲销 + 收敛；
  组件不再伪造事件。
- **用例**：reducer 三条（open 失败 → 后续外部打开/重试照常；移动失败 → 模型保持开；close 失败 → 后续真实关闭仍收敛）
  + 端到端一条（夹具新增 `failNextOpenInfoWindow` 注入）。
- **反证四条变异都红**（每条只动一处，实测读数：`脚本 /tmp/pr32/rev4.py`，逐条打印对应用例的断言原文）：

  | 变异 | 对应用例的读数 |
  | --- | --- |
  | M1 组件退回「伪造一条 `sdk-close` 表示失败」（评审原报的形态） | 红 —— 端到端 `open 命令同步失败` 报 `expected [ [ false ] ] to deeply equal [ [ false ], [ true ] ]`（那次**外部**打开没能回写） |
  | M2 open 失败不冲销 `openOutstanding` | 红 —— `幽灵请求必须被冲销: expected 1 to be +0` |
  | M3 close 失败不冲销 `closeOutstanding` | 红 —— `失败的关闭命令必须被冲销: expected 1 to be +0` |
  | M4 移动失败也把模型收敛成关（去掉 `open` 相位的豁免） | 红 —— `移动失败不代表关闭意图: expected false to be true` |

- 这条 P1 的价值在于把「账本守恒」从**正常路径**推到了**异常路径** —— 前三轮都在修正常路径的归属，
  而「命令根本没成功发出去」是同一份守恒规则的另一半：**每一笔记账都必须有人冲销，冲销者要么是回包，
  要么是失败本身**。

### 第五轮（`731121e` → 本轮）

评审确认上轮失败路径的 P1 已修，但指出它引出了一个新的**跨层**冲突：状态机给「被顶掉的 A 的迟到
`open`」下发的纠偏 close 会被 Driver 的 `lastRequestedByMap` 守卫**静默吞掉**（那条守卫排在
`getInfoWindow()` 之前就直接 `return`），于是地图停在 A、`closeOutstanding` 永久残留。

- **复现属实**：Driver 层红 —— `地图上开着的就是 A ⇒ 这条 close 必须真的发出去: expected +0 to be 1`；
  端到端红（按评审给的 5 步：A 挂起 → B 同步打开顶掉 A → `flushInfoWindowOpen()`）——
  `迟到的旧气泡必须被真正关掉: expected InfoWindowClass{…} to be null`。
- **修正**：Driver 的判据改成「**先读事实、兜底判据最后**」（见 3d 的表）；
  `lastRequestedByMap` 从「总闸」降级为「`getInfoWindow()` 为空时的兜底」，
  声明注释与调用点注释都写明这个顺序是契约的一部分。
- **反证三条变异**（各打新顺序的一个分支，全部变红）：
  ① 退回旧顺序 ⇒ 新增的两条用例红；
  ② 松开「当前气泡是别人就不碰」⇒ **四条既有收紧用例**红（含官方 UI Kit widget 那条）；
  ③ 去掉空窗口兜底 ⇒ PR #61 的回归用例红。
  ② 这一条是刻意的：它证明这次改的是**判据顺序**，不是「一律放行」。
- 这条 P1 的价值在于指出**账本守恒的前提不止在状态机内部**：「命令交给了我们自己的 Driver」
  不等于「命令发给了 SDK」，而只有后者才会产生回包。

### 第六轮（`5b95ed9` → 本轮）

评审确认上轮 Driver 判据顺序的 P1 已修，但指出刚补的那条双窗口乱序用例**只验证了「迟到 A 被真正关掉」**，
漏了下一层：A 的迟到 `sdk-open` 在 SDK 侧真的顶掉了 B，而 `bindSdkEvents` 的 `open` / `close` 分支
只驱动状态机、**不更新 `InfoWindowManager`**。于是纠偏关掉 A 之后地图已经空了，账本仍认为 B 是 current、
B 的模型也仍是 `open=true`（prop 没变 ⇒ 不会自愈）；外部 SDK 自己开 / 关时账本同样与地图分叉。

- **复现属实**（三条断言各自先红）：`点地图关闭` —— `账本不得再指向这个旧实例: expected { raw: InfoWindowClass{…} } to be null`；
  `SDK 自己打开` —— `账本必须认这个 current: expected null not to be null`；
  `双窗口乱序` —— `真正被 A 顶掉的 B 必须收到 superseded 通知: expected [] to deeply equal [ [ false ] ]`。
- **修正**：`open` / `close` / `clickclose` 三个分支各自先 `activate` / `deactivate` 再喂状态机（见 4b 的表）。
- **反证四条变异全红**：删掉 `open` 的 `activate` / 删掉 `close` 的 `deactivate` /
  删掉 `clickclose` 的 `deactivate` / **把 `activate` 与 `dispatch` 两行顺序对调**。
  最后一条是刻意的：它证明顺序**本身**是承重的，不是「有这行就行」。
- 这条 P1 的形态与前几轮又不同：前五轮都在问「命令有没有到位」，这一轮问的是
  「我们内部记的账，有没有跟着**外部事实**走」—— 账本的事实源不能只有「我们自己发过的命令」。

### 第七轮（`97b675b` → 本轮）

评审确认上轮幽灵 current 的**主路径**已修，但指出 4b 给 `close` / `clickclose` 选的顺序**与决策 3
早就确立的语义撞车**：`sdk-close` 里有一类是过期回包（`closeOutstanding > 0` 且模型仍是开），
状态机对它只减账、保持 `open`；而组件层会先把 `manager.deactivate()` 执行掉 ⇒
「状态机说开着、地图上可能还开着、账本却已清空」。

- **复现属实**：组件级反序用例 —— `状态机仍认为它开着 ⇒ 账本不得被过期回包清空: expected null not to be null`。
- **修正**：`close` / `clickclose` 改成「先喂状态机、再按 `machine.open` 决定退场」（见 4c 的表）。
  `open` 的方向**保持不变**（它必须抢先，理由见 4b）。
- **反证三条变异全红**：① 退回「无条件 `deactivate`」⇒ 两条通道的用例红；
  ② **反向**「永不退场」⇒ 正常关闭路径的三处账本读数是红（证明改的是判据，不是干脆不退场）；
  ③ **只**把 `clickclose` 退回旧顺序 ⇒ 只有该通道的用例红（证明它为这条分支提供了独立判别力）。
- **夹具**：新增延迟 `close` 事件的能力（与 `deferInfoWindowOpen` 同族），用来构造
  「关闭已生效、但它的事件还没到」这个窗口。**如实标注**：它是对「乱序回包」这条
  **本库声明支持**的时序的注入，不是对真实 4.0 关闭时序的测量复刻（真实关闭时序未单独测过）。
  有了它，整条反序路径可以**全程走真实命令**构造，不必手工 `emit` 事件、也不必改替身内部字段。
  ⚠️ **这个夹具的第一版建模错了**（延迟的是**副作用**而不是**事件**），第八轮评审指出并已改正；
  详见 4e 的引子与第八轮小节。
- 这条 P1 的形态是**前后两轮互为镜像**：第六轮把「事件」引进来是对的，第七轮补的是
  「事件要先经过归属判定才算数」——**同一处代码的相邻两轮，一轮加、一轮校准**。

### 第八轮（`5babdfa` → 本轮）

评审确认上轮的代码修复方向正确，但给出**两个阻塞项** —— 一个是被修的语义，一个是**我自己的测试**。

**P1-1：`clickclose` 不能被当成无身份的 `close` 回包。** 仓库自己的事件契约把它定义为
「点击信息窗口的关闭按钮时触发」，来源明确；走同一套归属表时，只要 `closeOutstanding > 0`，
一次真实的用户关闭就会被判成过期回包、只减账不动模型。

- **复现属实**：组件级 —— `用户主动关闭必须生效（回写一次 false）: expected [] to deeply equal [ [ false ] ]`；
  reducer 级 —— `用户主动关闭必须生效: expected true to be false`。
- **修正**：新增独立动作 `sdk-clickclose`（见 4d）。

**P1-2：夹具延迟错了对象，导致第七轮那条回归是「假绿」。** 我把它建模成「关闭**命令**晚执行」
（`flush` 时才真正关掉地图），而真正要验证的是「关闭**已经生效**，只是那条 `close` **事件**晚到」。
两者可观测地不同：前者 flush 之后地图是空的，而测试只断言了模型与账本，**没有断言地图** ——
于是三方分叉（地图空 / 模型开 / 账本仍 current）也被判成通过。

- **复现属实**：给旧夹具补上那两条地图断言后立刻红 ——
  `旧回包晚到不得把地图上的气泡弄没: expected null to be InfoWindowClass{…}`。
- **修正**：夹具改名并改语义为「**副作用立即、只有事件延迟**」：
  `deferInfoWindowCloseEvent` / `flushInfoWindowCloseEvent()` / `hasPendingInfoWindowCloseEvent()`
  （旧名 `deferInfoWindowClose` 逐字读就是「延迟关闭」，正是错的那个建模）；
  回归用例补两条硬断言：flush 之后 `map.infoWindow === raw` 且 `raw.isOpen() === true`。
- **顺带退役一条用例**：第七轮那条 `过期回包走 clickclose 通道时` 断言的正是「`clickclose` 只减账、
  账本不动」—— 它的名字编码了本轮判定为错的处置，因此**替换**成
  `用户点关闭按钮（clickclose）不得被在飞的旧关闭账吞掉`，而不是新旧并存。

**反证四条变异全红**：① 状态机退回 `reduceSdkClose`；② 组件退回 `dispatch(sdk-close)`；
③ **反方向**：`clickclose` 顺手把那笔在飞账清零；④ **夹具**退回「延迟副作用」的建模。

**这一轮的自我批评值得记下来**：P1-2 说明「**新增断言之前先问这条用例到底在验证哪个模型**」。
我上一轮把「旧命令晚执行」当成了「旧事件晚到」——两者的差别恰好落在**地图状态**上，
而我恰恰没断言它。夹具的名字（`deferInfoWindowClose`）当时还逐字给了我错误的暗示。

### 第九轮（`b0f2f77` → 本轮）

评审指出 `clickclose` 与随后的普通 `close` 可能同属一次用户点击，那条伴随 `close` 会去消费
在飞命令账，导致真正迟到的回包被误判。评审明确要求**先用真实 v4 把事件序列录出来**再决定处置 ——
于是这轮先做实测（真实 AK · headless Chromium，`.smoke/` 临时 harness，跑完移出仓库）：

- **全新实例、打开 1 次**：`close` ×1 + `clickclose` ×1，**顺序不固定**（5 轮：4 次 `close` 在前）。
- **同一实例打开 N 次**：`close` 始终 ×1，`clickclose` ×N（实测三轮 1+1 / 2+1 / 3+1）⇒
  SDK 每次打开/重绘都重新绑定关闭按钮的处理器。
- 两者间隔约 0.1ms（同一 task）；点击后 `getInfoWindow()` 为 `null`；对照组 `closeInfoWindow()` 只有 `close`。

⇒ 评审的担心**成立**（伴随的 `close` 确实存在、且会消费账），但**形状比预期复杂**：
不是「一对」，而是「1 条 `close` + 1..N 条 `clickclose`」。

- **修正**：`explicitClosePair` 标记 + 双向回溯对账（见 4f 的表）；末尾多余的 `clickclose`
  只在「确实关掉了东西」时才留标记。
- **反证四条变异全红**：① 不还原伴随 `close` 消费的账；② 伴随 `close` 照常消费（只处理另一种顺序）；
  ③ 标记不清理；④ **反方向**无条件还原。
- **把实测变成门禁**：live smoke 新增 `infowindow-close-button-pair` —— 断言
  「`close` 恰 1 条 + `clickclose` ≥ 1 条」**并**断言本库模型收敛为关；`clickclose` 的条数
  作为**读数**带回报告（它与打开次数相关，不适合当判据）。
- 第一次接这条检查时它红了，读数 `counts={"close":1,"clickclose":2}` 与 `.smoke` 里的 1+1 不一致 ——
  顺着这个差异才量出「随打开次数累积」这条规律。**两个环境的读数不一致本身就是线索**。

### 第十轮（`4cbdaef` → 本轮）

评审确认第九轮的实测与修复方向，并补了一个**结构性缺口**：4f 的配对是「action 邻接」式的，
而**时间过去不会产生 action** ⇒ 一条真正迟到的旧回包留下的 `close-consumed` 会挂到很多个 task 之后，
被那时的一次用户点击误认成它的伴随 close，把账还回去 ⇒ 凭空多出一份幽灵 `closeOutstanding`。

- **复现属实**：组件级六步复现 —— 第 5 步那次**真实**关闭只回写了一次 `false`
  （`expected [ [ false ] ] to deeply equal [ [ false ], [ false ] ]`），也就是被幽灵账当成旧回包吞掉了。
- **修正**：把第九轮实测到的边界编码进去 ——「整组事件在同一 task 内到齐」⇒ 配对窗口 = 一个 task。
  组件在本 task 第一条关闭类事件后排一个微任务派发**纯动作** `explicit-close-pair-expired`（见 4g）。
- **反证三条变异全红**：① 过期动作变 no-op；② 只在 `clickclose` 分支排微任务（漏掉 `close` 分支）；
  ③ **反方向**：每个关闭类 action 后都清标记（等于取消配对）⇒ 第九轮那些形状用例红。
- **评审同时替我们核对了一件事**：`huiyan-fe/react-bmap` 对 `close` / `clickclose` **没有任何去重或归属**，
  只是逐个注册 listener 原样透传，而且它不用 SDK 事件反向维护受控状态 ⇒ 它没有我们的
  outstanding/乱序问题，**不能照搬它的处理方式**。这条也说明「参考实现只作对照、不作移植对象」。

### 第十一轮（`bada46b` → 本轮）：**方向纠正 —— 删除状态机，改为 ownership / reconcile**

评审在第十轮之后给出了与之前十轮不同的意见：**不要再提高「回包归属推断」的精度，纠正设计方向**。

- 评审指出根因：`openOutstanding` / `closeOutstanding` / `accounted` / `sdk-clickclose` /
  `explicitClosePair` / task 边界 —— 这一串状态都是为「在 SDK 不给 request identity 的前提下恢复
  归属」而生的，继续补下去仍会有新的组合；仓库历史里已有同型先例（#38 / #71 / #72 / #99）。
- 评审给的契约：`open` 是 desired、SDK 事件是 observation / reconcile trigger、
  `clickclose` 可回写、外部控制不再翻译成意图、desired 与 observed 不一致时只做最终状态收敛；
  并明确要求**删除** `infoWindowMachine.ts` 与那些账本状态，**不要**保留一个「简化版 reducer」继续演化。
- **本轮改动**：
  - 新增 `driver.overlays.isCurrentInfoWindow(map, overlay)`：用公开的 `Map#getInfoWindow()` + handle
    身份回答「现在是不是我」；
  - `useInfoWindow` 重写为 desired/observed 收敛（三种命令 + 缺位置语义 + 两个所有权例外）；
  - **删除** `infoWindowMachine.ts` / `infoWindowMachine.test.ts`（连同五相位、在飞账、配对窗口）；
  - `tests/behavior/v3-binfowindow.test.ts`：42 条里**删掉/改写**所有验证「ACK 归属」的用例，
    换成验证**最终地图状态 / 资源释放 / 公开事件**（38 条）；
  - 替身：补 `InfoWindow#close()` 的实例级语义（真实运行时存在）与 `enclosingMap`，
    否则「别处打开了我们拥有的实例、本库再收敛掉」这条路径无法复现。
- **实现过程中被既有用例逼出来的两个真问题**（都是这次重写引入的，已修并留下断言）：
  1. **移动**：官方没有 `setPosition`，「desired 与 observed 一致就什么都不做」会把位置变化整个丢掉
     ⇒ 补「实际开着但位置指纹变了 ⇒ 再开一次」；
  2. **收敛与父级渲染的顺序**：观测驱动的收敛若只排一个微任务，会在父级（`v-model`）的渲染 flush
     **之前**跑，读到陈旧的 `open` ⇒ 把用户刚关掉的气泡又打开一次（多出一次 open + close）。
     ⇒ 收敛排**两跳** `nextTick`，落在 flush 之后；并把 `update:open` 回写改成**状态幂等**
     （同一状态只回写一次，因为一次用户点击可能来多条 `clickclose`）。
- 另外修掉一处替身缺陷：`FakeV4InfoWindow` 里有**两个** `close()`（类里后定义的那个生效），
  导致实例级关闭没有把地图的「当前气泡」摘掉 ⇒ 收敛自激到 OOM。这是夹具 bug，但正是它让
  「实例级 close 必须真的摘掉当前气泡」这条语义被写清楚。

### 本轮修正引入的自我检查

修 P1-1 时第一次的计数写法是**无条件 +1**（把 `opening` 相位下那条会被吞掉的关闭命令也计进去）。
它当时**通过了**那条「同 tick 的 open → close」用例 —— 直到单点反证把计数写回无条件才发现它只覆盖了
前半段。补上「被吞掉的命令不得计数 ⇒ 之后再来的真实关闭仍须收敛」后才真正有判别力。
这条与仓库的既有纪律一致：**门禁要按「改坏 ⇒ 该条红」逐条验，不能按「读起来覆盖了」放过。**

### 合并 main（#31 落地）后的对齐

本 PR 期间 `main` 合入了 #31（覆盖物事件矩阵 / 统一内核 / **集中弃用层**）。合并后做了两件事：

1. **回归**：`types/components.ts` 被两侧同时修改（#31 把八个矢量覆盖物的 props 拆成
   `Path*Props` 共享接口，本 PR 把 `BInfoWindowProps` 的字段搬到 `core/overlays/InfoWindowSpec.ts`）。
   自动合并结果正确，但**本 PR 写成单行的 `interface BInfoWindowProps extends InfoWindowProps {}`
   打穿了 #31 的声明面门禁**：`v3-overlay-suite.test.ts` 的 `readPropsKeys()` 用
   `([\s\S]*?)\n\}` 切接口正文（为了不误切行内对象类型），单行 `{}` 会让这个非贪婪匹配继续往后吞，
   把紧随其后的 `Path*Props` 并进同一次匹配 ⇒ 那几个接口从解析表里消失、5 条用例误报。
   修法是把它写成**多行**接口体（并在注释里写明这个约束），`#31` 的 122 条用例随即全绿。
   这类「各自绿、合起来红」只有**在合并后的树上跑全量门禁**才发现得到。
2. **对齐**：把 `show` 的兼容处置从本组件手写的 `devWarn` 换成集中弃用层（决策 2）。这条对齐牵出三处
   必须一起改的地方（都**由门禁**逼出来，不是顺手改的）：
   - **别名表**：`OVERLAY_PROP_ALIASES` 新增 `info-window` 的 `show → open`；
   - **迁移文档的弃用表**：`v3-overlay-events-doc.test.ts` 逐条比对「表里每条别名都在文档里」
     （code / 正典名 / 旧名），少一行就红；
   - **描述符**：`v3-overlay-suite.test.ts` 要求「别名表里的**正典**名必须能在描述符里查到」。
     `open` 不是 SDK 属性，所以按 `position` 的既有先例把它登记为
     `open: unsupported("气泡的打开状态由地图级 openInfoWindow / closeInfoWindow 表达…")` ——
     「为什么不走实例属性」因此只有一处事实源，而不是靠「不写」来表达。
   > 取舍说清楚：也可以**不**进别名表（保留组件自持的一条告警），代价是与 #31 的
   > 「组件不写自己的兼容代码」直接冲突。选择进表；`open` 那行 `unsupported` 是这次对齐的
   > 必要代价，而不是为了过门禁的旁路 —— 它与 `position` 逐字同构。

## 非目标

- **不保留 `show` / `open` 两套主状态**（issue 明文）：`show` 只作为兼容别名的读取入口存在。
- **不访问 `_visible` 等私有字段**；不猜测 SDK 未提供的销毁方法。
- **不用无界 MutationObserver**：尺寸变化一律走 `ResizeObserver` + 合帧。
- 不改 `enableCloseOnClick` 的默认值（见已知限制 2）。
- 不接管官方 UI Kit 的 widget 内部资源（决策 8）。
- 不做「气泡挂到 Marker 的目标级打开」：那是 `#31` 的路径（`openInfoWindow` 的 `position`
  仍是本票的必需参数）。
- 不把其余覆盖物迁到 `OverlaySpec`（属 #31 / #33）。

## 参考

- issue #32（`M5-INFOWINDOW`，含 VueUse 使用建议的评论）、追踪 issue #12「M5 / Overlay」泳道
- [ADR 2026-09-11 v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)（`InfoWindow` 专用 API 与
  `recreate` / `unsupported` 分类；真实 AK smoke 读数）
- [ADR 2026-09-13 私有面移除](./2026-09-13-private-sdk-surface-removal.md)（#72 的最小可用路径与
  「气泡只走地图级专用入口」）
- [ADR 2026-09-17 OverlaySpec 与 Marker](./2026-09-17-overlay-spec-and-marker.md)（声明式 spec 的边界；
  本 ADR 补充其已知限制 5）
- [ADR 2026-09-14 Map 视野受控模型](./2026-09-14-map-controlled-state.md)（回环抑制与受控语义的口径）
- [ADR 2026-09-14 容器门禁与可见性暂停](./2026-09-14-map-handle-container-and-visibility.md)
  （「读数走标准读数、观察器只作触发源」的口径）
- 官方：JSAPI 4.0 API 参考 `BMap.InfoWindow` / `Map#openInfoWindow` / `Map#closeInfoWindow` /
  `Map#getInfoWindow`；`@baidumap/jsapi-v4-types@4.0.4` 的 `overlay/InfoWindow.d.ts`、
  `overlay/InfoWindowOptions.d.ts`、`overlay/OverlayEvent.d.ts`
- VueUse：`useResizeObserver`（[文档](https://vueuse.org/core/useResizeObserver/)）
- 对照：`huiyan-fe/react-bmap@2.0.2` 的 `src/components/Overlay/InfoWindow.tsx`（v4 与 v1 两版）
