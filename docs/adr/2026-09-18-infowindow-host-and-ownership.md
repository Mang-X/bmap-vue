# ADR 2026-09-18：BInfoWindow 的 detached host、五相位状态机与每地图归属

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
  `packages/baidu-map-gl-vue/src/core/overlays/infoWindowMachine.ts`、
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

### 4. 每张地图一份 `InfoWindowManager`：先换当前项，再通知被顶掉的那个

`MapRuntime` 持有（`MapContext.infoWindows`，可选，与 `layers` 同口径），账本只有两项：
**注册表**（这张地图上还活着几个气泡）+ **当前项**（哪一个被请求打开）。

- `activate(handle)` 在**打开成功之后**调用（过早声明会在打开失败时白白顶掉别人）；
- **先写「当前是谁」，再通知被顶掉的那个**：被顶掉者在通知里会收敛自己的状态并交还归属，
  顺序反了那次调用会把新主人误清掉（`InfoWindowManager.test.ts` 有一条用例专门锁它）；
- 被顶掉的组件**不得**调 `closeInfoWindow()`（契约写在 `register({ onSuperseded })` 上，
  由 `superseded` 动作不产生 effect 保证，Driver 侧另有「只关本 Driver 最后请求打开的那个」守卫兜底）；
- 未登记的实例不能抢走归属（创建失败被释放的实例不该顶掉别人）。

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
| 生命周期 | 一个 `useEffect`：按构造期 props 指纹重建、按 `open` 调 `map.openInfoWindow()`，`close` 只在卸载时调一次 | 五相位状态机 + 每实例一份 scope | **本库更严**：参考实现的 `open` 变 `false` **不会关闭**已经打开的气泡 |
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
   - 计数法以「**每条在飞命令恰好产生一条 `close` 回调**」为前提。若某个 SDK 版本在气泡确实
     开着时**吞掉**一条关闭命令（少发一条回调），残留计数会吸收掉随后**一次**真实关闭
     （模型停在该次关闭前的值），之后自愈 —— 这条只能靠 live smoke 观察，不要为它预先加猜测性兜底；
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

## 验证

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
