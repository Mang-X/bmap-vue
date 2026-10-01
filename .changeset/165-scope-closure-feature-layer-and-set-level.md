---
"@mangax/bmap-vue": patch
---

#165 收口：两条范围问题——`FeatureLayer` **不封装**、`<GeoJSONLayer>.setLevel` 改为**就地更新**

两条都不是「补一个漏掉的成员」，而是**先取 live 读数、再裁决**，并把裁决写进下一个读者
会撞到的地方（能力目录注释 + descriptor 注释 + 审计文档）。

## 1. `FeatureLayer`：参考实现有、官方类型零命中、运行时**不存在** ⇒ 不封装

三方读数（live AK / headless Chrome，`scripts/probe-165-feature-layer.mts`，
`BMap.version === "gl"`，SDK 4.0.5；补齐等待 `settled=true`、`settledAfterMs=0` 后取样）：

| 来源 | 分支 / 版本 | 说法 |
| --- | --- | --- |
| `@baidumap/jsapi-v4-types` | `5ba67f4`（4.0.5），207 个 `.d.ts` | **零命中** |
| 官方 React 参考 `react-bmap` | master `fde5bbd` | 有组件 + `createFeatureLayer` 工厂 |
| 官方 Vue 参考 `vue-bmap` | master `ffc6dad` | **没有** `FeatureLayer` 组件 |
| 运行时 | 4.0.5 | `typeof BMap.FeatureLayer === "undefined"`；`new` 抛 `is not a constructor` |

**与 `NormalLayer` 的关系：没有关系。** `BMap.NormalLayer` 是 `function`（原型 39 个成员），
`FeatureLayer === NormalLayer` 为 `false`，`NormalLayer.prototype` 上也没有 `FeatureLayer` 痕迹。
官方 React 参考组件文件头的「继承 NormalLayer」只是一句注释，运行时无从印证。

**为什么参考实现不可信**（这是本条真正的依据）：它**自己的** `capabilityMatrix.ts` 的
`V4_LAYER_CLASS` 里没有 `FeatureLayer`，而 `createLayerFactory` 首行就是
`if (!capabilities.has(cap)) return null` ⇒ `createFeatureLayer` 是**不可达的死代码**；
它的选项类型是这一段里唯一写成 `unknown` 的；官方 Vue 参考根本没有这个组件。

⇒ **不封装、不登记能力项**：登记一个恒为 false 的能力比没有更坏。裁决固定在
`src/driver/capability/catalog.ts` 的 `layer.geojson` 上方注释 + 审计文档 §8.1。

**顺带修正一条会被误用的口径**：`BMap.NormalLayer` 运行时**存在**，但官方类型包里也**没有**
`class NormalLayer` ⇒「类型包没有」**不等于**「运行时没有」，反向也不成立。两条裁决方向相反，
理由各自来自**运行时**读数，不是同一条规则。

## 2. `<GeoJSONLayer>.setLevel`：可观测地生效 ⇒ 从「构造期重建」改为「就地更新」

`setLevel` 在官方声明上（`layer/GeoJSONLayer.d.ts:136`），而本库 descriptor 的
`geojson.mutable` 此前是**空的**且**没有写理由**——按本票判据，这是缺席的签名，不是决策。

读数（`scripts/probe-165-level-effect.mts`，4.0.5，三个要素：两块面 + 一条线）：

| 调用 | `getLevel()` | 每个要素的 `zIndex` |
| --- | --- | --- |
| 构造 `{ level: -77 }` | `-77` | `-77` |
| 基线（不给 `level`） | `-99` | `-99` |
| `setLevel(-50)` | `-99 → -50` | `-99 → -50`（三个全部） |
| `setLevel(-99)` | `-50 → -99` | `-50 → -99` |
| `setLevel(0)` / `2000` / `1.5` | 各自取值 | 各自取值 |

⇒ **可观测地生效**：逐个透传给解析出的覆盖物的 `setZIndex`（与官方 skill
`references/data-layers.md` 逐字吻合），不是只改图层自己的内部字段。取值域**未观察到裁剪**，
官方注释的「负数越大层级越高」是语义描述而非取值约束 ⇒ 实现侧不做任何范围校验。

**变更**：`mutable: { level: "setLevel" }`。`level` prop 变化从此**不重建**图层——此前重建的
代价与 `data` 变化同量级（把所有已画好的要素拆掉重做），却换不来任何额外效果。

**对照**：`minZoom` / `maxZoom` **仍留在构造期**——运行时**没有** `setMinZoom` / `setMaxZoom`
（同一支探针读数），与 `level` 相反。

**其余被漏掉的 `GeoJSONLayer` 成员**（补齐后 12 个成员全部 `present`，无 `absent`）：
`resetStyle` / `setVisible` / `getVisible` / `pickOverlays` / `getData` / `getLevel` / `destroy`
**均不开面**，理由逐条写进审计文档 §8.2（受控 prop 已有同语义 / 显隐统一为挂载状态 / 无消费者的读回）。

## 影响

- **行为变更**：`<GeoJSONLayer>` 的 `level` prop 变化从「重建图层」变为「就地 `setLevel`」。
  依赖「改 `level` 会把已解析的要素全部重做」这一旧行为的用法需要复核（那本来也不是文档化的契约）。
- 新增三个探针脚本（取证器，不进 CI）：
  `probe-165-feature-layer.mts` / `probe-165-level-effect.mts` / `probe-165-map-render.mts`。
- 审计记录：`docs/zh-CN/contributing/166-visualization-alignment-audit.md` §8。
