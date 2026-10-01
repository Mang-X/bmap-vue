---
"@mangax/bmap-vue": major
---

# #165 Class 2（第一段 A–I）：Map 命令面 / composable 的「同名不同形」核查

**规则**：名字已经与官方一致、但**行为 / 形态**不同的条目，逐条核查后决定改或不改。
本段的交付物主要是**裁决 + 依据**，代码只在证据单向时才改。

逐条裁决见 `docs/zh-CN/contributing/165-audit-B-C-D-F.md` 的「Class 2 逐条裁决」；
live 读数见 `docs/zh-CN/contributing/165-runtime-verification.md` 的「Class 2 的追加读数」。

## 改了的两条

### E：`setCenter` 命令面放宽到官方的两个分支

`MapCommands.setCenter` 此前是 `setCenter(center: Point)`，而 `<Map center>` **prop** 接受
`{lng,lat} | string`。同一个组件上两张脸不一致，且收窄只发生在命令面最上面一层——
底下的 `MapDriver.setCenter(map, Point | string)` 与 `toRawCenter` **本来就**处理字符串，
官方 `setCenter(center: Point | string, options?)` 也是这么声明的。

现改为 `setCenter(center: Point | string)`。⚠️ 字符串中心**无法**与受控状态做等值比较
（官方 React 参考据此在 prop 上直接拒收 string）；本库在 prop 侧为 v2 兼容保留它，
因此受控 `center` 用字符串时只能当初值——用户交互后回写的是具体坐标。

### H：`mapStyleJson` 形状 + 两个 prop 互斥

两处更正，都是「静默失效」而非风格问题：

1. **形状**：官方 `MapStyleConfig.styleJson?: object[]` 是**数组**，本库声明成 `Record`（单数），
   且**整份**原样当作 `setMapStyle(config)` 的整个 config 下发——于是 `styleId` 那一支
   在这条路上**永远走不到**。现在包进官方那个键：`{ styleJson }`。
2. **静默丢弃**：`mapStyleId` 与 `mapStyleJson` 同时给时旧代码走 `if / else if`，
   静默吃掉其中一个（AGENTS.md：「接收后忽略属于假支持」）。live 实测两种先后顺序的
   胜者都**不受调用方控制**（SDK 内部合并顺序），因此不能猜赢家——现在**显式抛错**。

官方第三个成员 `merge` 仍然**不暴露**：它的适用前提是「已经有一份样式在生效」，
而本库这层没有可观察的「当前样式」状态，留待有可验证语义时再补。

## 没改的五条（逐条有据）

- **A**（`useMap` / `useMapReady` / `useMapStatus` 的返回形态）：形态差异是**有意的 Vue 适配**。
  但 `docs/zh-CN/contributing/official-api-alignment.md` 把三个都记成「名称对齐 ✓」，
  而那张表**只比名字**——从参考实现按名字移植会写错。已在生成器里加一节「同名但不同形」
  逐条点名，并加**双向门禁**：表里的每个名字必须真的是交集里的一条（否则这一节就在撒谎）。
- **B**（`get*` 的可空性）：官方非空是**声明**、不是「什么情况下都给得出值」的承诺。
  收窄成非空会把「读不到」变成一个编出来的值。官方 React 参考自己也全转 `| null`。
- **C**（`panBy(pixel: Pixel)` vs 官方 `panBy(x, y)`）：Driver 已拆成两个数字下发，
  官方能力没有缺口；对象形态是本库全域统一的 `Point` / `Pixel` / `Size` 记法。
- **D**（`resetView()` vs 官方 `reset()`）：live 实测官方 `reset()` **不动** heading / tilt，
  与本库的差异只在「本库额外归位这两个字段」，而那是「回到首次快照」语义的一部分，
  与受控状态机成套。`reset` 这个名字也不与 `useControllableState.reset()` 冲突
  （后者不在 expose 面上，且作用对象完全不同）。
- **G**（`panTo` 动画默认）：live 逐帧实测 `distinctSampleCount = 1`——直接跳变到位，
  没有 prop / 命令两侧不一致可修。
- **I**（`<Panorama>` 的 `capture` / `clearOverlays`）：上一轮「探针全 false」是**原型读法**
  对这类成员无效；换成实例读法后 `callable: true`，且 `capture()` 真返回 1,639 字节字符串。
  成员确实可达，但落地要动 `driver/**`（见下）。

## 需要 Driver 改动的三条（**超出本段范围，已停手上报**）

1. **F** —— `setCenter` / `setZoom` / `setHeading` / `setTilt` / `panTo` 五条命令丢掉官方的
   options 对象：`noAnimation` / `callback` / `setZoom` 的 `zoomCenter` 三者都不可达。
   没有回调就**没有「这条命令做完了」这个可观察事实**。live 实测证明五条的 callback
   **确实会交付**（`noAnimation: true` 下 0–1ms 各一次，动画档也各一次），所以这是**类型面**缺口。
   落地要改 `driver/types/map.ts` 的五条签名 + `driver/jsapi-v4/map.ts` 的实现。
   注：`MapProps.noAnimation` 已在 Class 5 删除，而官方的 `noAnimation` 本就**只**是逐调用选项、
   没有 `MapOptions.noAnimation`——因此补齐它**不该**以 prop 的形式回来。
2. **I** —— `PanoramaViewerDriver` 补 `capture` / `clearOverlays`，`<Panorama>` 给出口。
3. **A（可选）** —— 若要让 `useMap` 向官方靠，应**新增** `useMapSnapshot()`，
   **不能**改 `useMapStatus` 的返回类型（破坏性变更）。

## 门禁与文档

- `tests/behavior/map-style-props.test.ts`（新，3 例）：H 的三条契约（`styleId` 单给 /
  `styleJson` 数组形状 / 两者同给不静默丢弃）。
- `packages/bmap-vue/src/core/runtime/mapCommands.test.ts` +2 例：E 的字符串中心透传。
- `official-api-alignment.md` 由 `pnpm generate:api-diff` 生成，新增「同名但不同形」一节
  + 表头的「只比名字」警告；生成器对该节加了名字必须落在交集里的**过期门禁**。
- `scripts/probe-runtime-members.mts` 扩 7–13 号（Class 2 的 live 取证，只读、不改生产代码）。
