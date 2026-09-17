---
"baidu-map-gl-vue": minor
---

新增声明式覆盖物生命周期 `OverlaySpec` / `useOverlaySpec`，并把 `BMarker` 迁移为它的样板。

**组件侧只剩声明**：创建 / 挂载 / 就地更新 / 重建 / 卸载、实例 child scope、覆盖物注册表记账、
子组件挂载目标（`TargetContext`）与 SDK 事件绑定，全部由 `useOverlaySpec` 按 `OverlaySpec` 驱动。
`BMarker` 因此删掉了 9 个手写 watcher 与全部生命周期代码；每个公开属性的更新策略（`position` /
`options` / `recreate` / `visibility`）在 `fields` 里声明一次，并由用例与 Driver 的属性描述符
**逐条交叉核对**（声明为 `options` 的必须在描述符里是 `mutable`，`recreate` 的必须是 `recreate`），
漏一个 prop 会在编译期失败。

- 新增公开导出 `useOverlaySpec`、`OverlaySpec`（含 `OverlayFieldUpdate` / `OverlayFieldMap` /
  `OverlayEventSpec`）。自定义覆盖物可以直接用它们声明生命周期，无需再写一套 watcher。
- `BMarker` 支持 `v-model:position`：SDK 侧拖拽结束（`dragend`）会回写模型并 emit
  `update:position`，且**两条方向都有回环抑制**——父级回写刚上报的位置不会重复下发 `setPosition`，
  SDK 重复派发同一位置也不会产生第二条 `update:position`。`dragend` 与别名 `drag-end` 照常触发。
- **修复**：`visible=false` 的初始 `BMarker` 此前切到 `true` 时会在**未挂载**的实例上调用 `show()`
  （等于永远不显示）；现在切到 `true` 时才真正 `addOverlay`。
- **修复**：内置图标名 `red1`~`red10` / `blue1`~`blue10` 此前会静默渲染成 `simple_red` 的雪碧图位置，
  现在全部 27 个内置名都解析到各自的格子（内置图标表收敛为单一事实源）。
- 新增**有界图标缓存**（每个地图一份，上限 200 条）：相同图标配置只构造一次 `BMap.Icon`，
  组件反复重建也不会重复构造；更新图标时始终重新 `setIcon`（官方指南：直接改 Icon 属性
  Marker 不会同步刷新）。
- 覆盖物实例现在会登记进该地图的覆盖物注册表（`MapContext.overlays`，类型由 `unknown` 收紧为
  `OverlayRegistry`），registration 与实例作用域绑定，重建 / 卸载时自动摘除。
- **破坏性变更（公开 API 收窄）**：`OverlayRegistry.register` / `unregister` 删除
  （此前无生产消费者；`registerResource` 是一等入口，返回自带 `dispose` 的 registration）。
- 行为细节：父级重复渲染传「内容相同的内联对象」（`icon` / `offset` 等）不再产生多余的 SDK 命令。

其余覆盖物组件本次不迁移（`useOverlayResource` 保持不变），决策与取舍见
`docs/adr/2026-09-17-overlay-spec-and-marker.md`。
