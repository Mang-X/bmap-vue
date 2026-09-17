---
"baidu-map-gl-vue": minor
---

建立声明式 `ControlSpec` / `useControlResource`，把全部控件收进统一生命周期；补齐三个 Stable 控件组件
并建立 Panorama 基线（含独立的 `PanoramaContext`、`<BPanorama>` 与 `usePanoramaService`）。

**控件侧**：8 个既有控件（`BZoom` / `BScale` / `BCityList` / `BLocation` / `BNavigation3d` /
`BPanoramaControl` / `BCopyright` / `BControl`）各自手写的 `addToMap` / `createWatchers` / `remove`
收敛为一份 `ControlSpec` + 一个从 `useSdkResource` 派生的统一 adapter；组件只声明「这个控件是什么」，
创建 / 挂载 / 就地更新 / 重建 / 卸载 / 事件绑定统一由 adapter 执行。**既有组件的 props 表一个都没变**。

- 新增公开导出 `ControlSpec` / `useControlResource` / `ControlBaseProps` / `ControlOptionStatus`
  （`./core` 子入口）与 `optionKey` / `optionSnapshot` / `changedOptionKeys`。
- `ControlDriver` 新增 `planOptions(control, keys)`：逐键报告「构造之后改这个 option 会怎样」
  （`mutable` / `recreate` / `unsupported`，与 `OverlayPropertyPolicy` 同一套词汇），与 `setOptions`
  **共用同一处分类**——组件侧不再维护第二张「哪些键要重建」的表。
  `unsupported` 的判据收窄为**「连构造期也到不了」**（`custom` 上未知的键、认不出种类的裸句柄）。
  处置按固定顺序分三段：`unsupported` 的键**不重建但告警一次**（不是静默 no-op），只有在 `recreate`
  或「`mutable` 的选项从有值变回 `undefined`」时才重建控件——`unsupported` 不落进这条重建分支。
- **`anchor` / `offset` 从「只在构造期生效」变为运行期即时下发**（按 `anchor → offset` 的顺序成对写：
  真实 4.0 的 `setAnchor()` 会把偏移重置回控件默认值）。选项从有值改回 `undefined` 时**重建**控件，
  让构造期重新采用 SDK 默认值。
- **修复**：`map-type.showStreetLayer` 此前被静默丢弃（成员名不是 `set<Key>` 形状，落在结构逃生口的
  「没有入口」分支里）；现在注销就地更新。
- **行为变更**：控件的 `visible` 由「摘挂载」改为 SDK 基类的 `show()` / `hide()`（控件始终挂载，
  只切换可见性）——`BLocation` 不再因隐藏而顺带停掉持续定位跟踪。`BCopyright` 保持版权项级显隐，
  且它的 `anchor` 是构造期项（实例按停靠位置共享，变化即重建并完成共享组迁移）。
- **修复**：`BCopyright` 的共享控件缓存由「模块级 + 仅按 anchor」改为「按 Client + anchor 分桶」，
  修掉同一页面两个 `<BMap>` 复用同一句柄导致的 `BMAP_HANDLE_FOREIGN`。
- 新增组件：`BNavigation`（平移缩放）、`BMapType`（地图类型）、`BOverview`（鹰眼）。
- `./core` 的 `useControlResource` 签名由 `(props, adapter)` 变为 `(props, spec)`；
  无消费者的 `buildControlOptions` / `buildControlEvents` 删除。自建控件请按 `ControlSpec` 重写。

**Panorama 侧（post-stable）**：`PanoramaContext` 独立于 `MapContext`（`<BPanorama>` 只需要 Client，
不把全景内部容器当成地图）；新增 `<BPanorama>` / `<BPanoramaLabel>` 与 `usePanoramaService`；
`PanoramaViewerDriver` 补齐读取面、场景切换、配置写回、滚轮缩放、标注与原样事件订阅
（共享 `EventDriver` 按 Map 事件形状归一化，会把 `dataload.data` 这类载荷丢掉）。

迁移步骤、SDK 依据与全部取舍见 `docs/adr/2026-09-17-control-spec-and-panorama.md` 与
`docs/zh-CN/guide/breaking-changes.md`（新增一节）。
