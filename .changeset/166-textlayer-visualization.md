---
"@mangax/bmap-vue": patch
---

issue #166 第二刀：`<TextLayer>` 落地（官方 4.0.5 `visualization/TextLayer`）

- **新增组件** `<TextLayer>`：批量文字标注图层，几何支持 `Point` / `MultiPoint`；共用
  `NativeLayerDriver` + `useNativeLayerResource` 同一份生命周期内核（**没有**第二套图层登记 /
  生命周期），装配沿用 `useVisualLayer` 的 `pickOptionSet: "visualization"` 分流。
- **新增** `text` 原生图层 kind 与 `layer.text` 能力槽位（`status: "experimental"`、
  `runtimeOnly: false` —— live 探针读到 `BMap.TextLayer` 在 `BMap.Map` 刚就绪时**已经是
  `function`** ⇒ 随主包注入，**不进** `RUNTIME_INJECTED_LAYER_CTORS`）。
- **登记面比 `PolygonLayer` / `PolylineLayer` 宽两条**，因为这一族的声明与运行时**完全对齐**
  （逐条 live 读数见 `scripts/probe-runtime-members.mts` case 3e / 3f，2026-09-27）：
  官方**声明**了 `setOpacity`（`TextLayer.d.ts:296`，运行时也在）⇒ 按声明登记，本组件因此
  **有** `opacity` prop；而 `hitTest` 声明与运行时**都在** ⇒ 登记。
- **新增归一化操作 `hitTestText`（与既有 `hitTest` 分成两条）**：官方 `TextLayer.hitTest` 返回
  `TextLayerItem`（有 `text` / `width` / `height` / 显式 `point`，**没有** `dataIndex`），
  与 `hitTest` 那条归一化的 `{ dataIndex, dataItem }` **形状不同**。归到同一条会逼本库编造一个
  下标——那是「回包形状错」这类最难排查的 bug。
- **`<TextLayer>` 是本族第一个 `defineExpose` 的组件**（`hitTest`）：它既不是任何受控 prop 的
  写入面，声明与运行时又都在。`PolygonLayer` / `PolylineLayer` 不 expose 是因为每一条候选都已被
  prop 表达或已关闭——留一个每条命令都会拒绝的空壳比不留更糟。
- **刻意不开的面**（逐条依据见 `docs/zh-CN/components/layer/text-layer.md`）：`setRenderStage` /
  `setRefCenter` 与七条 `getX`（有声明、有运行时、**无消费者**）、`mouseover` / `mouseout`
  （成对进入 / 离开语义，与本库领域事件面不同构）、要素状态 API（官方声明里没有）、
  `static TextLayer.Anchor`（运行时在位，但 `style.anchor` 的字符串更贴近 `setOptions` 实际用法）。
- **官方 4.0.5 声明、但这份产物运行时没发的三个类**（`BarLayer` / `FlyLineLayer` /
  `GeoJSONSource`）**不建能力槽位**：live 探针 8s 与再 25s 两次复读都是 `undefined`，扫遍 `BMap`
  全部 294 个自有属性也无别名 ⇒ 登记进去只会让 `supports()` 对一个永远不会来的能力说真话。
  文档已按这一读数更正（此前写的是「本库尚无对应数据模型」）。
- `scripts/probe-runtime-members.mts` 新增 case 3e / 3f / 3g / 15 / 16（**只加 case**，不改既有
  读数的判定逻辑）。
