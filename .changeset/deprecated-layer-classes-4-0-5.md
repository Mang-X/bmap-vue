---
"bmap-vue": patch
---

#165：适配官方 4.0.5 弃用的四个图层类（保留组件 + 如实告知）

官方 `@baidumap/jsapi-v4-types@4.0.5` 把四个原生图层类标了 `@deprecated`：

| 官方类 | 官方建议替代 | 本库组件 |
| --- | --- | --- |
| `BMap.FillLayer` | `visualization.PolygonLayer` | `<FillLayer>` |
| `BMap.LineLayer` | `visualization.PolylineLayer` | `<LineLayer>` |
| `BMap.PointIconLayer` | `visualization.PointLayer`（图标模式） | `<PointIconLayer>` |
| `BMap.PointShapeLayer` | `visualization.PointLayer`（形状模式） | **`<PointCollection>`** |

## 处置：**保留、不改名、不加兼容层**

- **不删组件**：`PolylineLayer` / `PolygonLayer` 本库**还没有**（见 #166）。删掉等于让线/面
  两类用户无路可走。
- **不改名、不加 deprecated 别名 / 迁移 shim**：#165 §3.6 明确禁止。「别名指向新名」正是那条
  要禁的东西——它会留下一套要维护的第二入口。
- **能力矩阵的 `status` 不动**：`native` / `extended` / `experimental` / `unsupported` 四个取值
  表达的是**能力从哪来**，没有一档表示「官方标了弃用」。为它新造一个状态会让 `supports()`、
  `require()` 与能力矩阵全线改语义。弃用只记在 `description` 与组件/文档里。

## 弃用怎么被看见

- **开发期告警一次**（不是每个实例一次）：同一页面挂五个 `<LineLayer>` 刷五条同样的话等于没提示。
  去重放在**模块作用域**——组件侧的调用点在 `setup` 里（组件**创建**时），不是模块 import 时，
  否则使用者的构建工具 / SSR 预渲染会在自己进程里看到「组件还没用就被警告」。
  **生产环境完全静默**（复用 `core/logger` 的 `devWarn` → `isDev()` 早退，不另造环境判定）。
- **类型层 `@deprecated`**：`LineLayerProps` / `FillLayerProps` / `PointIconLayerProps` /
  `PointCollectionProps` 上标注，编辑器会给使用者划掉。
- **文档**：`native-visual-layers.md` / `data.md` 各有告警框。

## 告警文案不承诺没有的东西

四条告警最初写「本库尚未提供（见 #166）」——那时替代组件确实还不存在。**现在四个替代品
全部已提供**（`<PolylineLayer>` / `<PolygonLayer>` / `<PointLayer>` 图标模式 /
`<PointLayer>` 形状模式），文案已同步改为「替代品已提供 + 迁移口径」。

⚠️ 但**迁移不是改个名字**：`LineLayer` / `FillLayer` 的样式字段族与替代品不同
（`patternUrl` / `borderWeight` 一族 vs `fillTextureUrl` / `strokeTextureUrl` 一族），
`<PointLayer>` 的样式字段是**扁平**的（`icon` / `shape` / `size` 直接是 prop，不是 `style` 袋），
而 **`visualization/` 家族没有 Feature State API** —— 依赖要素状态、或要
`zIndex`/`minZoom`/`maxZoom` 的用法**没有等价替代**，应继续用旧组件。
逐字段迁移表见 `docs/zh-CN/components/layer/deprecated-layers-migration.md`。

## 一处容易漏掉的地方

`BMap.PointShapeLayer` **没有同名组件**：它落在 `<PointCollection>` 上（`LAYER_KIND =
"point-shape"`）。照着「被弃用的类名」去找组件是找不到它的——本票因此在
`layer.point-shape` 的能力条目上登记了弃用，并给 `<PointCollection>` 加了类型标注与告警。

## 一处值得记下的实现约束

去重 `Set` **没有**放在组件的第二个 `<script>` 块里（那才是「只跑一次」的常规位置）：
实测 SFC 同时有 `<script>` 与 `<script setup>` 时，Volar 对 `LineLayer` / `FillLayer` 的
推断会从具名常量**内联展开** `DefineComponent<…>`，`etc/<出口>/bmap-vue.dts.md` 基线会漂
约 100 行。为了加一句告警而改动**公共类型基线**不划算——1.0 出口冻结正是防这个的。
改成模块级 `Set` 后，语义相同而公共类型面**一个字节都不动**（`pnpm check:api` 全绿可证）。
