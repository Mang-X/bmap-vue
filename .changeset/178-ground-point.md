---
"@mangax/bmap-vue": minor
---

#178 新增 `<GroundPoint>` 贴地点覆盖物；`Symbol` / `IconSequence` 经核对**不是缺口**

官方 React 文档站列了 `GroundPoint` / `Symbol` / `IconSequence` 三个组件，本票逐个对着
`@baidumap/jsapi-v4-types@4.0.5` 的声明核对后，结论是**只有 `GroundPoint` 是真实能力缺口**：

| 官方组件 | 结论 | 依据 |
| --- | --- | --- |
| `GroundPoint` | **已实现** | `overlay/GroundPoint.d.ts:5` `class GroundPoint extends GroundOverlay`，完整类声明 + 构造选项 |
| `Symbol` | **不是覆盖物，且本库尚未暴露该能力** | `overlay/Symbol.d.ts:13` 的 `class Symbol` **不继承** `BMap.Overlay`——是矢量图标**值对象**（官方注明「可用作 Marker 的 icon 参数」），没有 `addOverlay` 入口，做成组件挂不上去。其 9 个成员（`setPath` / `setFillColor` / …）在本库**没有任何落地路径**；需要时只能经 `./advanced` 的 `unwrapRaw()` 自行创建 |
| `IconSequence` | **官方已废弃** | `overlay/IconSequence.d.ts:4` 的类声明标了 `@deprecated 4.0 已废弃，请使用 PolylineOptions#strokeTexture 代替`（该类只有构造函数、无实例方法） |

`IconSequence` 已在 `<Polyline :icons>` 上如实透传（收下就静默忽略比不收更难排查），
新代码请用 `strokeTexture`；`Symbol` 的能力**本票不提供**——它需要一个接收矢量图标的
prop（如 `<Marker :icon>` 支持 `BMap.Symbol`），那是独立于本票的接口面变更。

## `<GroundPoint>` 的选项分类（逐条对官方实例方法表）

| 分类 | 选项 | 依据（`overlay/GroundPoint.d.ts` / `overlay/GroundOverlay.d.ts`） |
| --- | --- | --- |
| `mutable` | `point` | `GroundPoint.d.ts:29` **`setPoint`**（不是 `setPosition`） |
| `mutable` | `scale` / `size` / `rotation` / `anchor` / `offset` | `GroundPoint.d.ts:39/49/59/69/79` |
| `mutable` | `url` / `opacity` / `displayOnMinLevel` / `displayOnMaxLevel` / `zIndex` | 继承：`setImage` / `setOpacity` / `setDisplayOnMinLevel` / `setDisplayOnMaxLevel` / `setZIndex` |
| `mutable` | `enableMassClear` | 成对开关 `enableMassClear` / `disableMassClear` |
| `recreate` | `level` | 6 个 setter 里**没有** `setLevel`（与有 setter 的 `displayOnMin/MaxLevel` 语义不同，不能顶替） |
| `recreate` | `enableClicking` | 无 `setEnableClicking`，也无成对开关 |
| `recreate` | `top` | 有 `setZIndex` 但**无 `setTop`**（层叠顺序**值** ≠ 布尔开关） |

## 顺带的两处基础设施修正

- **新增 `size-shape` 归一化档**：`GroundPoint` 的 `size` / `anchor` / `offset` 在官方
  `GroundPointOptions` 里声明为 `Size`。若沿用既有的 `size` 档（组件侧是 `Pixel` `{x,y}`），
  watch 键会读 `x` / `y` ⇒ `{width, height}` 恒被判成「没变」⇒ 更新被静默吞掉。
  新档的键是 `sz:`，与 `px:` 不同前缀（防形态撞键）。
- **`POSITION_KEY` 新增 `ground-point → point`**：位置入口是 `setPoint`，默认的
  `position` 会落到官方不存在的 `setPosition` 上。
