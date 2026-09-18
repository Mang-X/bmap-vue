---
"baidu-map-gl-vue": minor
---

新增 `BRectangle`，把 Label / Polyline / Polygon / Circle / BezierCurve / Prism / GroundOverlay 迁移到与
`BMarker` 相同的声明式覆盖物内核，并建立**覆盖物事件矩阵**与**集中弃用层**。

**组件侧只剩声明**：八个组件的 `create` / 挂载 / 就地更新 / 重建 / 卸载、实例 child scope、注册表记账、
SDK 事件绑定全部由 `useOverlaySpec` 按 `*Spec.ts` 驱动；这次删除的是这七个文件里的 **56 处手写 watcher**。

- **新增 `BRectangle`**：v4 的矩形覆盖物，`bounds`（西南 / 东北）定义几何，与 Circle / Polygon / Polyline
  共用描边 / 填充 / 编辑开关的更新语义。已在真实 v4 smoke 上验证（`overlay-rectangle`：不仅计数增长，
  还会用 `getBounds()` 回读几何与传入的 `bounds` 逐点比对）。
- **事件面由矩阵派生**：`core/overlays/overlayEventCatalog.ts` 按覆盖物种类声明事件面、载荷档与
  「需要哪个能力开关」，组件只声明自己是什么 kind。于是三类覆盖物的事件面**变宽且一致**：
  Polyline / Polygon / Rectangle / Circle 各 17 个（含 6 个编辑事件），Label 8 个，
  Prism / BezierCurve / GroundOverlay 各 11 个，Marker 11 个。事件名与上游
  `OverlayEvent.d.ts` 逐条双向比对，SFC 的 `defineEmits` 也由门禁锁定。
- **载荷分三档**：指针类（`point` 必填，raw 缺坐标时补 `(0,0)`）、**坐标可缺**（图形族 `mouseout` 与
  GroundOverlay 家族——上游声明可缺，本库不再补 `(0,0)`，因此「没有坐标」与「在原点」可以区分）、
  仅底座字段。三种载荷类型从根入口导出。
- **大数组按根引用 + 版本 prop 更新**：`path` / `controlPoints` 不再做内容指纹（O(n) 序列化），
  原地修改数组时递增 `pathVersion` / `controlPointsVersion` 触发一次更新；`OverlaySpec.watchSources`
  把这条口径变成声明的一部分。
- **`BGroundOverlay` 用 `bounds` 取代 `startPoint` + `endPoint`**：与上游
  `createGroundOverlay(bounds, options)` 同形。旧名**仍可用**（弃用别名，控制台提示一次，
  且 `bounds` 有值时旧名完全不参与）；`type` 变化现在会重建实例（此前「改了没反应」）。
- **集中弃用层**（`core/deprecations`）：旧 prop / 旧事件名的身份（稳定 code + 替代 API）与
  「同实例只警告一次、production 不输出」的告警器；`BMarker` 的历史事件名 `drag-end` 从组件里的
  硬编码收进这张表（组件不再出现旧名字）。
- **`OverlaySpec` 扩展**：新增 `kind`（事件矩阵与弃用表的查询键）、`watchSources`（字段 watch 源）、
  `fieldValues`（惰性值投影，`BGroundOverlay.url` 的工厂在这里求值）、`afterMount`（创建完成后的
  组件侧副作用，`autoCenter` 用它）；字段策略新增 `version` 与 `alias` 两个**组件侧**取值。
- **修复**：图形族的 `mouseout` 在 raw 缺坐标时不再被补成 `(0,0)`（与上游 `GraphMouseOutEvent` 一致）；
  卸载过程中 SDK 派发的 `remove` 等事件不再回放给调用方。
- 文档：新增「覆盖物事件矩阵」页（由用例逐条校验为矩阵的镜像）与 `BRectangle` 文档；
  `BInfoWindow` / `BContextMenu` / `BMapMask` / `BMarker3d` 本次**不迁移**，
  各自的归属见 ADR `2026-09-18-overlay-event-matrix.md` 的已知限制。

**props 与 emits 层面无破坏性变更**：八个组件的 props 名与默认值未变（只新增 `bounds`），emits 只增不减。

两处**行为语义**变化（都在 breaking-changes 的表里有对应行）：

- `visible=false` 从 `removeOverlay` 改为 `hide()`：实例留在图上、只是不可见（与 `BMarker`、控件
  从 #30 / #41 起的统一口径一致）。需要真正摘除请用 `v-if`；
- `remove` 事件只在**外部**摘除（`map.removeOverlay()` / `clearOverlays()`）时到达组件：组件自身的
  卸载 / 重建 / 隐藏不再回放它（此前 `<BBezierCurve>` / `<BMarker>` 在这些路径上会发）。

两处类型 / 元数据层的附带变化：`LabelStyle` 由 `Record<string, any>` 收紧为
`Record<string, unknown>`（`<BLabel style>` 的取值需自行收窄）；九个覆盖物组件统一补上
`defineOptions({ name })`（只影响 devtools 显示名）。
