---
"baidu-map-gl-vue": minor
---

`<BInfoWindow>` 重构：detached host + Teleport，并改为 **ownership / reconcile** 状态模型（`M5-INFOWINDOW` / #32）。

**内容宿主的所有权变了**：组件创建一块独立的内容宿主节点交给 SDK（SDK 会在打开时把它搬进自己的
容器），Vue 的渲染子树由 `<Teleport>` 挂到它上面 —— SDK 搬动宿主时不再会动到 Vue 管理的节点树。
宿主带 `data-bmap-infowindow-content`（唯一的 DOM 契约，供宿主页定位气泡内容）；**卸载 / 重建**时
由本库摘掉宿主（关闭气泡时宿主留着复用，是否连带撤掉容器由 SDK 决定）。因此：

- **组件根是 `<Teleport>`**，实例的 `$el` 不再指向内容节点；
- `class` / `style` / 其它 `$attrs` 落在宿主**内部**的包装节点 `div.b-info-window-content` 上。

**状态模型：`open` 是唯一控制意图，SDK 事件是观测**。本库**拥有**它创建的那个 `InfoWindow`：

- **desired** = `open`（`v-model:open`）；`show` / `v-model:show` 保留为兼容别名，并收进仓库的集中
  弃用层（`core/deprecations`：稳定 code `BMAP_DEPRECATED_PROP_ALIAS`、同实例只提示一次、production 不输出）。
- **observed** = 地图上实际开着的是不是这一个，读官方公开的 `Map#getInfoWindow()` 并与句柄身份比对。
- **收敛**只做三件事：期望开而地图上没开 ⇒ 打开；期望开、地图上开着但 `position` 变了 ⇒ **再打开一次**
  （官方没有 `setPosition`）；期望关而地图上开着 ⇒ 关闭。
- 因此本库**不再推断**「这条 `open` / `close` 回调属于哪一次命令的回包」——官方没有给出请求身份，
  上层无法可靠恢复（这条轴在评审里被逐个方向打穿，最终改为不承诺）。

**行为变更（对调用方可见）**

| 变更 | 之前 | 之后 |
| --- | --- | --- |
| SDK 侧**未经请求**的 `close`（含点地图关闭） | 回写 `update:open(false)` | **不回写**，只转发 `close`；若父级仍写 `open: true`，会按受控语义把气泡**重新打开** |
| 外部（别处调 SDK）打开**本组件拥有的**实例 | 回写 `update:open(true)` | 收敛回关（并如实转发 `open`） |
| `update:open` / `update:show` 的回写时机 | SDK 侧每次变化各一次 | 只表达**状态变化**（用户点关闭按钮 / 被同图另一个气泡顶掉各回写一次） |
| 实例**重建**（`offset` 这类构造期属性变化） | 对外原子：只发 `rebuild` / `destroy` | 重建后按当前意图重新打开，那次打开**如实转发**一次 `open` |

**想让用户也能关掉**：用 `v-model:open`（或监听 `close` 事件把 `open` 置 `false`）。用户关掉之后
你的意图跟着变成「关」，本库就不会再把气泡拉回来；始终写死 `open: true` 时本库会按受控语义重新打开。

**新增事件**：`clickclose`（点了气泡上的关闭按钮 —— 带明确来源，除转发外还会**回写一次**
`update:open(false)`）、`maximize` / `restore`、`rebuild` / `destroy`（载荷是实例代次，
`rebuild` **首次创建不发**）。

**多气泡互斥**：同一张地图上后打开的气泡会顶掉前一个，被顶掉的那个收到 `update:open=false`
并进入「不再抢回来」，直到父级把 `open` 置回 `false` 再置 `true`；它的关闭 / 卸载**不会**关掉新的气泡。
不同地图之间互不影响。

**尺寸重绘**：slot 内容的尺寸变化用 `ResizeObserver` 观察**实际内容宿主**（替换无界的
`MutationObserver`），并经地图的合帧调度器每帧最多重绘一次；由重绘自身引起的尺寸变化会被吞掉，
不会形成反馈循环。

**迁移注意**：

- `enableCloseOnClick` 的默认值保持本库既有的 `false`（官方声明默认是 `true`）；这一处差异登记在
  ADR 的已知限制里，本版本不改。
- `position` 是打开的必需参数：`open=true` 但缺 `position`（或读不到有效坐标）时**不打开**
  （已经开着就关掉），并按边沿报一次 `BMAP_INVALID_ARGUMENT`（经 `resource:error` 诊断通道交出）；
  位置晚到会自动补开。
- 打开 / 关闭的 SDK 调用**同步抛错**时交给 `resource:error`，**不假装成功**；父级下一次改变意图时
  会自然重试。
- `clickclose` **原样转发**：实测一次点击可能派发多条（条数随同一个气泡被打开过几次累积），
  需要「一次点击一次」的代码请自行去抖。
- SSR 期不渲染气泡内容（宿主在客户端挂载时创建）。

决策与被删除的中间方案见 `docs/adr/2026-09-18-infowindow-host-and-ownership.md`（决策 0 是当前契约）。
