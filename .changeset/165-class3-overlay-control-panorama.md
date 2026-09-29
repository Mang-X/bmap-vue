---
"bmap-vue": major
---

# #165 Class 3：Overlay / Control / Panorama 模块的官方能力补齐

**规则**：本库缺失的官方能力，按模块补齐。已经做了「刻意设计的 Vue 适配」的保留不动。

本票覆盖覆盖物 / 控件 / 全景三族。`zIndex`（TASK 0/1）是一个家族级修复——分类层早就准备好了，
组件面没有出口。

## TASK 0 + 1：`zIndex`（9 个官方类有 `setZIndex`，只有 1 个组件暴露过）

`types/components.ts` 的 `PathStrokeProps` / `PathFillProps` / `PathShapeProps` /
`PathEditableProps` 四个共享底座**都没有 `zIndex`**，而 `driver/types/overlays.ts` 早就把它
分类成 `mutateBy("setZIndex")`——于是整族覆盖物的层级更新一次都没被走到过。

- `zIndex` 加到 **`PathShapeProps`**（图形六件套全部 extends 它），`PrismProps` /
  `GroundOverlayProps` 内联同名键（它们不 extends 那一组）。
- 落在 `PathShapeProps` 而不是 `PathStrokeProps` / `PathFillProps`：层级**既不是描边也不是
  填充**，它与 `enableMassClear` / `visible` 同属「覆盖物自身的一档属性」。
- **`<CustomOverlay>` 保持 `recreate`**：官方 `CustomOverlay.d.ts` 上**没有** `setZIndex`，
  它的 `zIndex` 真是构造期属性。「分类表里有这个键」与「实例上有这个 setter」是两件事。
- `<Marker>` / `<Label>` 本来就有 `zIndex`，本票不动。

撤回（有值 → `undefined`）一律**重建**：8 个官方覆盖物类上有 `setZIndex`、**0 个**有
`getZIndex`（只有 `layer/*` 有），因此没有 baseline 可恢复。

## TASK 2：命令面（`defineExpose`）

`grep -n defineExpose src/components/{overlays,controls}/*.vue` 在本票之前返回 **0 命中**——
27 个组件一个命令面都没有。按 #165 §5-C，「能改 prop」**不算**实现同名方法，因此只补两类：
**没有对应 prop 的动作** 与 **读回**。

| 组件 | 新增（官方声明） |
| --- | --- |
| `<Marker>` | `getRank` / `setRank` / `setRotationOrigin` / `getTitle` / `getOffset` / `getRotation` / `getPosition` / `closePlaceDetail` |
| `<Polyline>` / `<Polygon>` | `setPositionAt(index, point, deep?)` + 描边 / 范围 / 填充读回 |
| `<Circle>` / `<Rectangle>` / `<Polygon>` | `getBounds` / `getStrokeColor` / `getStrokeOpacity` / `getStrokeWeight` / `getStrokeStyle`（+ 圆心半径 / 填充两件套） |
| `<InfoWindow>` | `getTitle` / `getContent` / `isOpen` / `getOffset` / `maximize` / `restore` |
| `<ContextMenu>` | `getItem` / `removeItem` / `removeSeparator` / `getDom` / `show` / `hide` + `setItemText` / `setItemEnabled` |
| `<PanoramaLabel>` | `show` / `hide` |
| `<Panorama>` | `getLinks()`（见 TASK 5） |

**`<MenuItem>.enable()` 此前永久不可达**：`<MenuItem disabled>` 走的是「`disabled: false` ⇒ 整菜单
重建」，而重建按 **props** 建——没有任何路径能**不重建**地把一条项解禁。`setItemEnabled(index, true)`
补上那条路（经菜单 + 序号下发，官方 `ContextMenu` **没有**「拿到第 i 条再改」的入口）。

**`<ScaleControl>.unit` 是 prop 不是 expose**：Driver 的 `CONTROL_OPTION_SPECS.scale.unit` 早就
登记成 `mutable` + `setUnit`，缺的只是组件出口。改动不重建控件。

### 三条实现口径

1. **释放后显式失败**：未就绪 / 重建窗口 / 已释放时抛 `BMAP_RESOURCE_DISPOSED`，**绝不**静默
   no-op——静默会让调用方把「资源已释放」误判成「SDK 说没有」。每条命令现取会话，因此重建后
   旧闭包不会打进已死的实例。
2. **不交出 raw SDK 对象**：官方 `ContextMenu#getItem(): MenuItem` 返回 raw 实例、
   `#removeItem(item)` 收 raw 实例。本库改按**序号**（`getItem(index)` 返回本库条目模型，
   `removeItem(index)` 收序号）——除了 AGENTS.md 的 raw SDK 边界，官方 `MenuItem` 上
   **没有任何 getter**，交出去对调用方是全盲的。读回 / 出入的几何同样全部经 Driver 投影
   （`getBounds()` 给领域 `Bounds`、`getOffset()` 给领域 `Pixel`）。
3. **不镜像成组件状态**：官方这些 getter 返回的是**当前值**而不是 SDK 默认值，`props` 才是主模型；
   写进 ref 就等于把 SDK 当前值升级成第二主模型。

### 刻意不暴露的（逐条有依据，不是遗漏）

- **`<Marker>.openPlaceDetail(placeDetail)`**：官方入参是 raw `BMap.PlaceDetail`，而本库**没有**
  这个 Driver 资源（它只在 `./ui-kit` 子入口，那一族受 ADR 约束不能进根模块图）。给一个 `any`
  形参等于「收下但没人读」的**假支持**。走 `<UiKitPlaceDetailWidget>` 或 `./advanced` 的
  `unwrapRaw()`。它的兄弟 `closePlaceDetail()` 无参、无障碍，因此**在**命令面里。
- **`<Marker>.setLabel` / `getLabel`**：出入参都是 raw `BMap.Label`。本库的 `<Label>` 是**独立
  组件**（自带归属与释放路径），把外部 `BMap.Label` 塞进来会绕开那套归属。
- **`<Rectangle>.setPositionAt`**：官方 `Rectangle` 没有这个方法（几何是 `setBounds`），而
  `getBounds()` 的四个角点顺序官方没有承诺——造「四顶点逐个改」是自研语义。
- **`<Polyline>.getFillColor` / `getFillOpacity`**：官方 `Polyline.d.ts` 只声明描边 getter。调用
  时抛 `BMAP_CAPABILITY_UNSUPPORTED`（不是 `undefined`）。
- **`<PanoramaLabel>.isVisible()`**：官方 `PanoramaLabel` 没有这个成员。造一个恒 `false` 的
  「读回」等于给调用方一个编出来的答案。
- **`<BezierCurve>` / `<Prism>` / `<GroundOverlay>` / `<Label>` 的读回族**：官方 4.0.4 没有为它们
  声明对应 getter。`GroundOverlay` 有 `getBounds` / `getOpacity` / `getImageURL`，但那是**地面
  叠加**的独立一族，本票未铺开。

## TASK 3：InfoWindow 的 8 个缺失构造选项

官方 `InfoWindowOptions` 有 15 个键，本库此前只收了 7 个。补齐 `maxWidth`（**就地** `setMaxWidth`）、
`maxContent`（**就地** `setMaxContent`）与 `margin` / `collisions` / `onClosing` /
`enableSearchTool` / `headerContent` / `enableContentScroll`（后六项**构造期**——官方 `InfoWindow`
上既没有对应 setter 也没有读回，逐条依据写在 `OVERLAY_REVERT_RATIONALE`）。

`headerContent` 与 `title` 同时给时谁优先，官方**没有说明**——本库**不表态**，两个都原样传下去。

## TASK 5：`Panorama.links`（一个自相矛盾的缺口，已决定并实现）

Driver 的旧注释写「`links` / `tiles` 是渲染细节，没有消费者所以不透出」。但事实是：
`<Panorama>` **早就**声明并派发了 `linksChange`，官方 `getLinks(): PanoramaLink[]` 存在，
官方 React 参考实现也暴露它——**消费者是存在的，缺的只是数据路径**。

- `linksChange` 现在带 `PanoramaLink[]`（此前是**空载荷**），`defineExpose` 给出 `getLinks()`。
- 新增 `PanoramaLink` 投影（八个成员**逐字段按类型收窄**）。官方八个成员**全是可选的**，因此
  **不补默认值**——`heading ?? 0` 会把「上游没给方位」与「正北」混成同一个数。
- `tiles` **仍不透出**：官方 `PanoramaTileData` 是瓦片贴图，属渲染内部。注释里两者处置的理由
  被拆开重写。

## 门禁

- `tests/behavior/overlay-zindex.test.ts`（新，29 例）：九个组件的 `zIndex` 就地更新 / 撤回重建，
  外加「`CustomOverlay` 不得被误改成 `mutable`」的反向守卫。
- `tests/behavior/overlay-expose.test.ts`（新，12 例）与 `overlay-expose-2.test.ts`（新，12 例）：
  命令的**可观察效果** + **已释放行为** + **不交出 raw**。
- `tests/behavior/panorama-links.test.ts`（新，4 例）。
- `tests/type-contracts/overlay-zindex.type-test.ts`（新）：`zIndex` 存在的**类型面**契约
  （`@ts-expect-error` 在 `*.test.ts` 里是恒真的，判别力必须落在本目录）。
- Fake v4 补齐：`FakeV4Shape` 的构造选项落库 + 描边/填充 getter、`FakeV4Polyline#setPositionAt`
  （参数按实参数记录，`deep` 有没有被传一眼可见）、`FakeV4Circle#getCenter/getRadius/getBounds`、
  `FakeV4Marker` 的 rank / rotationOrigin / 读回 / `closePlaceDetail`、`FakeV4InfoWindow` 的
  四个读回 + `maximize` / `restore`、`FakeV4MenuItem#setText/enable`、`FakeV4ContextMenu` 的
  `getItem` / `removeItem` / `removeSeparator` / `getDom` / `setCursor`、
  `FakeV4Panorama#getLinks`。
