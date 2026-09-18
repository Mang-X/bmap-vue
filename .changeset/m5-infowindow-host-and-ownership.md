---
"baidu-map-gl-vue": minor
---

`<BInfoWindow>` 重构：detached host + Teleport、五相位状态机与每地图气泡归属（`M5-INFOWINDOW` / #32）。

**内容宿主的所有权变了**：组件创建一块独立的内容宿主节点交给 SDK（SDK 会在打开时把它搬进自己的
容器），Vue 的渲染子树由 `<Teleport>` 挂到它上面 —— SDK 搬动宿主时不再会动到 Vue 管理的节点树。
宿主带 `data-bmap-infowindow-content`（唯一的 DOM 契约，供宿主页定位气泡内容）；**卸载 / 重建**时
由本库摘掉宿主（关闭气泡时宿主留着复用，是否连带撤掉容器由 SDK 决定）。因此：

- **组件根是 `<Teleport>`**，实例的 `$el` 不再指向内容节点；
- `class` / `style` / 其它 `$attrs` 落在宿主**内部**的包装节点 `div.b-info-window-content` 上。

**状态模型**：`open`（`v-model:open`）是唯一主状态，由五相位状态机（`closed` / `opening` / `open` /
`closing` / `disposed`）驱动。`show` / `v-model:show` 保留为兼容别名，并**收进仓库的集中弃用层**
（`core/deprecations`）：稳定 code `BMAP_DEPRECATED_PROP_ALIAS`、同一实例只提示一次、production 不输出。
两个都传时以 `show` 为准（`open` 有运行期默认值，「父级没传」不可观测）。
`update:open` / `update:show` **只在 SDK 侧的变化时回写**（不再回声父级驱动的变化）；要感知
「气泡真的开了 / 关了」，用 `open` / `close` 事件。

**新增事件**：`clickclose`（点了气泡上的关闭按钮）、`maximize` / `restore`、`rebuild` / `destroy`
（载荷是实例代次，`rebuild` **首次创建不发**）。重建（`offset` 这类构造期属性变化）对外是原子的：
不会产生多余的 `close` / `open`。

**多气泡互斥**：同一张地图上后打开的气泡会顶掉前一个，被顶掉的那个收到 `update:open=false`，
且它的关闭 / 卸载**不会**关掉新的气泡。不同地图之间互不影响。

**尺寸重绘**：slot 内容的尺寸变化改用 `ResizeObserver` 观察**实际内容宿主**（替换无界的
`MutationObserver`），并经地图的合帧调度器每帧最多重绘一次；由重绘自身引起的尺寸变化会被吞掉，
不会形成反馈循环。

**迁移注意**：

- `offset` 是构造期属性（官方没有 `setOffset`），变化会重建实例 —— 重建后气泡会重新打开，
  但**不会**多发 `open` / `close` 事件（用 `rebuild` / `destroy` 观察）。
- `enableCloseOnClick` 的默认值保持本库既有的 `false`（官方声明默认是 `true`）；这一处差异登记在
  ADR 的已知限制里，本版本不改。
- `position` 仍然是打开的必需参数：`open=true` 但缺 `position` 时报一次
  `BMAP_INVALID_ARGUMENT`（经 `resource:error` 诊断通道交出），位置晚到会自动补开。
- SSR 期不渲染气泡内容（宿主在客户端挂载时创建）。
