---
"bmap-vue": patch
---

修掉评审 #174 的两条 P1 运行时缺陷，并更正一条被误读的官方语义

**P1-1 · `opacity` prop 与 `style` 袋争同一个 SDK 状态（`<TextLayer>`）**

- 官方 `visualization/` 的样式入口 `setOptions` 会把袋里的 `opacity` **转发到 `setOpacity`**
  （`TextLayer.d.ts:265-268` / `PolylineLayer.d.ts:209-212` / `PointLayer.d.ts:297-300` 三处
  逐字相同），而顶层 `opacity` prop 走的正是那个 `setOpacity` ⇒ 两个入口写同一份状态，
  **最终值取决于谁最后被改**。取「一个关切一个入口」：`opacity` prop 是唯一入口，样式袋里
  的 `opacity` 被忽略并**告警一次**（稳定 key，不静默接收后丢弃）。
  `TextLayerStyle.opacity` 标 `@deprecated`（它**是**官方选项表里的一项，只是不生效）。
- **逐 kind 表**（`core/layers/nativeLayerStyleOwnership.ts`），不是「按字段名一律拦」：
  `polyline` / `cluster` / `heatmap` / `track-line` 的组件**刻意没有** `opacity` prop，样式袋
  是它们**唯一**的透明度入口，一律拦会把「一个入口」变成「零个入口」。
  `layer/` 家族的 `PointIconStyle.opacity` / `PointShapeStyle.opacity` 是**逐要素**字段
  （与图层级 `opacity` 相乘），不是争用。
- **更正一条被误读的官方语义**：仓库原注释把 `setOptions` 记成「整袋替换 … 没写的键回到官方
  默认值」，而它引用的官方原文是「**仅更新已声明的样式键**」——即 **merge**，与 `layer/` 家族的
  `setStyleOptions` 同一种。live 读数（新增 `scripts/probe-style-opacity.mts`）逐 kind 证实
  两个家族都是 merge。**但更正没有取消缺陷**：争的是同一份状态，与 merge 还是替换无关。
- 替身（`FakeV4RuntimeLayer.setOptions`）补上官方那条「转发」语义。此前它把袋里的 `opacity`
  与 `setOpacity` 建模成两份独立状态，于是这条缺陷在替身上**永远绿**。

**P1-2 · `<Panorama>.clearOverlays()` 绕过 `<PanoramaLabel>` 的归属**

- 此前 `clearOverlays()` 把全部覆盖物清掉，而 `<PanoramaLabel>` 仍**认为**自己挂着 ⇒ 后续
  prop 变化全部打进一个不在画面上的句柄（「声明存在、画面不存在」）。
- 官方 `Panorama` 的覆盖物面**只有** `addOverlay` / `removeOverlay` / `clearOverlays`
  （**没有枚举接口**），所以「只清本库管不到的」在官方面上写不出来 ⇒ 选**协调**：`<Panorama>`
  维护标注名册，清完之后把**同一个句柄**重新挂回去。
- **对外语义**（已写进 `docs/zh-CN/components/panorama/index.md`）：业务自己挂上去的覆盖物被
  清掉，`<PanoramaLabel>` 管理的标注保留且是当前的；要连它们一起清，正确做法是卸载那些组件。
  重新挂回失败时抛 `BMAP_SDK_CALL_FAILED` 并说清「有几个没挂回去」。

**测试**：新增 `tests/behavior/layer-opacity-single-entry.test.ts`（初始挂载 + 两种改动顺序 +
告警一次 + 反向门禁）与 `tests/behavior/panorama-clear-overlays-labels.test.ts`（清空后标注
**在画面上且是当前的**，含外来覆盖物被清、连续两次不叠加、卸载后不复活）。
更新 `panorama-capture-clear.test.ts` 里编码了旧行为的断言。
