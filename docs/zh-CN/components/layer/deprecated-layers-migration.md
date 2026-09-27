# 弃用图层的迁移指引 <Badge type="tip" text="^1.0.0" />

官方 JSAPI **4.0.5** 一次性给四个原生批量图层标了 `@deprecated`，并**指名**了替代品。本页是这四条
弃用（`LineLayer` / `FillLayer` / `PointIconLayer` / `PointCollection`）的**单一迁移入口**：每个类
的官方原文、本库替代品的就绪状态、逐字段对照表，以及**机械改名会静默出错**的地方。

| 弃用的官方类 | 官方指定的替代 | 本库组件（替代） | 本库组件（弃用） |
| --- | --- | --- | --- |
| `BMap.LineLayer` | `visualization.PolylineLayer` | [`<PolylineLayer>`](./visualization-layers) | [`<LineLayer>`](./native-visual-layers) |
| `BMap.FillLayer` | `visualization.PolygonLayer` | [`<PolygonLayer>`](./visualization-layers) | [`<FillLayer>`](./native-visual-layers) |
| `BMap.PointIconLayer` | `visualization.PointLayer`（图标模式） | [`<PointLayer>`](../data#pointlayerexperimental扩展-api) | [`<PointIconLayer>`](../data#pointiconlayer) |
| `BMap.PointShapeLayer` | `visualization.PointLayer`（形状模式） | [`<PointLayer>`](../data#pointlayerexperimental扩展-api) | `<PointCollection>`（见 [`data.md`](../data)） |

::: tip 四个组件**继续可用、行为不变**
官方**只标了弃用，没有删除类**（live 实测四个构造器在 `BMap.Map` 就绪时都已是 `function`）。本库
**保留组件与行为**，开发期告警一次、props 类型上带 `@deprecated`，并**不提供**指向新名字的别名垫片
——两个名字行为并不相同，别名只会让人更难判断自己拿到的是哪一套语义。
:::

## 一句话结论

**弃用替代不是字段改名。** 四个替代品本库**都已提供**，但迁移的代价不在改名，而在三处：

1. **样式字段族整体不同**（面 / 线两族），必须**重写**而非重命名；
2. **`visualization/` 家族没有 Feature State（要素状态）API** —— 依赖要素状态的用法**迁移即丢能力**，
   这种情况应该**继续用**旧组件；
3. **七个拾取 / 构造选项在新家族没有对应**，照字段表机械改名会**静默不生效**。

## 每条弃用的官方原文

以下四行是 `@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`）里的**逐字原文**：

| 官方类 | 声明位置 | `@deprecated` 原文 |
| --- | --- | --- |
| `BMap.LineLayer` | `layer/LineLayer.d.ts:189` | `已废弃，建议使用 {@link PolylineLayer} 替代` |
| `BMap.FillLayer` | `layer/FillLayer.d.ts:213` | `已废弃，建议使用 {@link PolygonLayer} 替代` |
| `BMap.PointIconLayer` | `layer/PointIconLayer.d.ts:132` | `已废弃，建议使用 {@link PointLayer}（图标模式）替代` |
| `BMap.PointShapeLayer` | `layer/PointShapeLayer.d.ts:152` | `已废弃，建议使用 {@link PointLayer}（形状模式）替代` |

## 替代品的就绪状态

四个替代品**都已提供**，但**都是 `experimental`**——判据是「4.0.5 才第一次出现在类型包里、接口面
可能变」，**不是**因为官方标了弃用。能力矩阵上 `layer.polyline` / `layer.polygon` / `layer.point` 的
`status` 都仍是 `experimental`。

| 组件 | 能力矩阵 id | `status` | `runtimeOnly` |
| --- | --- | --- | --- |
| `<PolylineLayer>` | `layer.polyline` | `experimental` | `false`（随主包注入） |
| `<PolygonLayer>` | `layer.polygon` | `experimental` | `false`（随主包注入） |
| `<PointLayer>` | `layer.point` | `experimental` | `true`（可视化实现按需异步注入） |

::: warning 窄接口面是**刻意的取舍**，不是能力缺失
本库不开「官方声明里有、但没有组件消费者」的面。因此替代品**没有**：`hitTest`、
`setRenderStage` / `setRefCenter`、七条 `getX` 读回、`mouseover` / `mouseout` 事件，
以及旧组件的 `data` 之外的整套 Feature State 命令面。要这些能力，**继续用旧组件**。
:::

## 迁移对照：`<LineLayer>` → `<PolylineLayer>`

**样式必须重写**：旧的是 `LineLayerStyle`（`borderWeight` / `borderCovered` / `borderMask` 一族），
新的是 `PolylineLayerStyle`（`strokeTextureUrl` / `strokeTextureSpaced` 一族）。**两族没有同名字段
可以照搬**——官方 `LineStyle` 里**没有** `patternUrl` / `patternScale`（那是 `FillLayerStyle` 的字段）。

| 旧 prop | 新 prop | 处置 |
| --- | --- | --- |
| `style.strokeColor` | `style.strokeColor` | 同名 |
| `style.strokeWeight` | `style.strokeWeight` | 同名（⚠️ 官方默认 `2` → `4`） |
| `style.strokeOpacity` | `style.strokeOpacity` | 同名 |
| `style.strokeLineJoin` | `style.strokeLineJoin` | 同名（类型收窄成字面量联合） |
| `style.strokeLineCap` | `style.strokeLineCap` | 同名（类型收窄成字面量联合） |
| `style.strokeStyle` | `style.strokeStyle` | 同名（类型收窄成字面量联合） |
| `style.dashArray` | `style.dashArray` | 同名 |
| `style.strokeTextureUrl` | `style.strokeTextureUrl` | 同名 |
| `style.strokeTextureWidth` | `style.strokeTextureWidth` | 同名 |
| `style.strokeTextureHeight` | `style.strokeTextureHeight` | 同名 |
| `style.sequence` / `marginLength` | — | **无对应**（间隔填充纹理） |
| `style.borderWeight` / `borderColor` | `style.strokeWeight` / `strokeColor` | **重写**：描边项与线项在新家族合并成同两个键，语义按「线的样式」解释 |
| `style.borderCovered` / `borderMask` | — | **无对应**（描边覆盖 / 掩膜在新家族没有开关） |
| `style.linksLine` / `strokeColorControl` | — | **无对应**（`MultiLineString` 逐段上色） |
| `style.traceDisappear` / `traceStart` / `traceControl` / `traceColor` | — | **无对应**（痕迹 / 尾迹效果） |
| `style.height` | — | **无对应**（线图层高度） |
| — | `style.strokeTextureSpaced` / `strokeTextureGap` / `strokeTextureColor` | **新增**：平铺 / 间隔 / 叠加色 |
| `data` | `data` | 同名（两族都是 GeoJSON） |
| `visible` / `zIndex` | `visible` / `zIndex` | 同名 |
| `opacity` | `style.strokeOpacity` | **重写**：`<PolylineLayer>` 官方**声明了**图层级 `opacity`（`PolylineLayerOptions.opacity` @default 1，`setOptions` 注释也写明转发给对应 setter）且**实测生效**，但本组件**未暴露**该 prop ⇒ 只能经 `style` 袋经 `setOptions` 整袋下发，或用 `style.strokeOpacity`。`<PolygonLayer>` 另见下行 |
| `minZoom` / `maxZoom` | `minZoom` / `maxZoom` | 同名（都是**构造选项**，变化换实例） |
| `idKey` / `enablePicked` | `idKey` / `enablePicked` | 同名（⚠️ 默认值都被本库改成 `true`） |
| `crs` | — | **无对应**（新家族没有坐标系选项） |
| `pickWidth` / `pickHeight` | `pickTolerance` | **重写**：像素宽高 → 命中容差（css px），**不是等价**（一个框 vs 一个半径） |
| `popEvent` | — | **无对应**：新家族没有「事件是否冒泡」 |
| `autoSelect` | `mouseStyleChange` | **重写**：允许悬浮事件 → 命中后换光标，**不是等价** |
| `selectedIndex` / `selectedColor` | — | **无对应**：新家族没有「选中项」概念 |
| — | `pickThrough` | **新增**：命中后是否继续向下层派发 |
| （ref 上的 `featureState` 命令面） | — | **无对应**：见下节 |

## 迁移对照：`<FillLayer>` → `<PolygonLayer>`

**样式必须重写**：`FillLayerStyle`（`pattern` / `patternUrl` / `patternMapping` / `patternScale` /
`border*` 一族）与 `PolygonLayerStyle`（`fillTextureUrl` / `fillTextureSize` /
`fillTextureAlphaOnly` / `stroke*` 一族）**字段不重叠**。

| 旧 prop | 新 prop | 处置 |
| --- | --- | --- |
| `style.fillColor` | `style.fillColor` | 同名（⚠️ 官方默认 `#142655` → `rgba(25, 25, 250, 0.6)`） |
| `style.fillOpacity` | `style.fillOpacity` | 同名 |
| `style.strokeColor` / `strokeWeight` / `strokeOpacity` / `strokeStyle` / `dashArray` | `style.strokeColor` / `strokeWeight` / `strokeOpacity` | 同名（⚠️ `strokeStyle` / `dashArray` 在 `PolygonLayerStyle` 里**没有**，新家族描边只有纯色实线） |
| `border`（构造选项，默认 `true`） | `style.strokeWeight`（默认 `0`） | **重写**：`border` 是开关，新家族用宽度表达；⚠️ **默认相反**——不显式给 `strokeWeight > 0`，新组件**不描边**而旧组件描边 |
| `style.pattern` / `patternMask` / `patternUrl` / `patternMapping` / `patternScale` / `patternOffset` | `style.fillTextureUrl` / `fillTextureSize` / `fillTextureAlphaOnly` | **重写**：雪碧图裁剪（`patternMapping`）与 UV 偏移（`patternOffset`）在新家族**没有对应**；整体纹理按**原图平铺** |
| `style.borderWeight` / `borderColor` / `borderCovered` / `borderMask` | `style.strokeWeight` / `strokeColor` | **重写**（同上并入 `stroke*`）；`borderCovered` / `borderMask` **无对应** |
| `style.sequence` / `marginLength` | — | **无对应** |
| `style.strokeTextureUrl` / `Width` / `Height` | — | **无对应**（新家族的填充纹理是 `fillTexture*`） |
| `style.strokeLineJoin` / `strokeLineCap` | — | **无对应** |
| `style.height` | — | **无对应** |
| `data` / `visible` / `zIndex` / `minZoom` / `maxZoom` | 同名 | 同名（`minZoom` / `maxZoom` 都是构造选项） |
| `opacity` | — | **无对应**：`PolygonLayerOptions` 根本没有 `opacity` 这一项 |
| `idKey` / `enablePicked` | `idKey` / `enablePicked` | 同名 |
| `crs` / `popEvent` / `autoSelect` / `selectedIndex` / `selectedColor` | — | **无对应** |
| `pickWidth` / `pickHeight` | `pickTolerance` | **重写**（同上） |
| — | `pickThrough` / `mouseStyleChange` | **新增** |
| （ref 上的 `featureState` 命令面） | — | **无对应** |

## 迁移对照：`<PointIconLayer>` → `<PointLayer>`（图标模式）

`<PointLayer>` 是**扩展 API**（可视化实现按需异步注入，`runtimeOnly: true`）。**样式字段是扁平的**
——`icon` / `size` / `fillColor` 直接是 prop，**没有** `style` 袋。⚠️ 官方 `PointLayer` **没有**
`setOpacity` 的**声明**，因此本库**不**暴露图层级 `opacity`（未声明成员不当契约）。

| 旧 prop | 新 prop | 处置 |
| --- | --- | --- |
| `icon` | `icon` | 同名 |
| `iconObj` | — | **无对应**：新家族的图标源是 `icon`（url / canvas / `{canvas,id}`），没有「按要素算图标」的回调 |
| `width` / `height` | `iconSize` | **重写**：两个标量 → `[w, h]` 或 number |
| `sizes` | `iconSize` | **重写**：同上 |
| `userSizes` | — | **无对应**：新家族没有「用 sizes 还是用 width/height」的选择 |
| `anchors`（`[-1,1]` 向量） | `anchor` | **重写**：`[-1,1]` 向量 → 字符串枚举（`'center'` / `'topLeft'` / …） |
| `offset` | `offset` | 同名（`[x, y]` 像素） |
| `scale` / `rotation` | `scale` / `rotation` | 同名 |
| `visibility` | `visible` | **重写**：逐要素的样式可见性 → 图层级显隐，**不是等价**（旧的是逐要素，新的是整层） |
| `featureOpacity` | `fillOpacity` | **重写**：逐要素 `PointIconStyle.opacity` → `fillOpacity` |
| `isFlat` | `isFlat` | 同名（构造期），⚠️ **官方默认相反**：旧 `true`（贴地图标）→ 新 `false`（屏幕固定像素） |
| `isFixed` | — | **无对应**（新家族没有「跟随缩放保持尺寸」这一项） |
| `data` / `properties` / `itemKey` / `getPosition` / `dataVersion` | 同名 | 同名（三个点组件共用同一套数据面） |
| `visible` | `visible` | 同名 |
| `zIndex` / `minZoom` / `maxZoom` | — | **无对应**：本库**不**在 `<PointLayer>` 上开这三个（`zIndex` 官方声明了 `setZIndex` 但无组件消费者；`opacity` 官方未声明） |
| `opacity` | — | **无对应**（官方 `PointLayer` 声明里没有 `setOpacity`） |
| `enablePicked` | `enablePicked` | 同名 |
| `pickWidth` / `pickHeight` | `pickTolerance` | **重写**：本库 #165 已从 `<PointLayer>` **删除** `pickWidth` / `pickHeight` |
| — | `pickThrough` / `mouseStyleChange` / `iconSize` | **新增** |
| （ref 上的 `featureState` 命令面） | — | **无对应** |

## 迁移对照：`<PointCollection>` → `<PointLayer>`（形状模式）

`<PointCollection>` 落在官方 `BMap.PointShapeLayer` 上（组件名是**业务语义**，不是那个 v3 的
`BMap.PointCollection` 类，见 [`data.md`](../data)）。⚠️ `shapeType` 的取值是**数字枚举**，
新家族的 `shape` 是**字符串枚举**——这是最容易静默出错的一处。

| 旧 prop | 新 prop | 处置 |
| --- | --- | --- |
| `shapeType`（数字枚举） | `shape` | **重写**：`0` 圆形 → `'circle'`、`1` → `'square'`、`2` → `'triangle'`、`3` → `'diamond'`、`4` → `'cross'`、`5` → `'arrow'`、`6` → `'arrowTail'`、`7` → `'star'`、`9` → `'waterdrop'`（数字**一一对应**，但类型从 `number` 变成字面量联合） |
| `color` | `fillColor` | **重写**（⚠️ 官方默认 `#eaf1ff` → `rgba(50, 50, 255, 1)`） |
| `size` | `size` | 同名（⚠️ 官方默认 `32` → `20`） |
| `strokeColor` / `strokeWeight` | `strokeColor` / `strokeWeight` | 同名（⚠️ 官方默认描边宽 `0`，新家族默认也是 `0`） |
| （无 prop） | `anchor` | **新增**：字符串枚举 |
| （无 prop） | `scale` / `rotation` / `offset` | **新增**（旧家族有这三个样式字段，本库**未**暴露） |
| `opacity` | `fillOpacity` | **重写**：图层级 `opacity` → 逐点 `fillOpacity`（官方未声明 `PointLayer#setOpacity`） |
| `isFlat` | `isFlat` | 同名（构造期），⚠️ **官方默认相反**（见上） |
| `data` / `properties` / `itemKey` / `getPosition` / `dataVersion` / `visible` | 同名 | 同名 |
| `zIndex` / `minZoom` / `maxZoom` | — | **无对应**（同上一节） |
| `enablePicked` | `enablePicked` | 同名 |
| `pickWidth` / `pickHeight` | `pickTolerance` | **重写** |
| — | `pickThrough` / `mouseStyleChange` | **新增** |
| （ref 上的 `featureState` 命令面） | — | **无对应** |

## 三处会让机械改名静默出错的地方

### 1. Feature State：新家族**完全没有**（`stay` 的主要理由）

`layer/` 家族四个类**都**有全套要素状态命令面（live 实测 `updateState` / `removeState` /
`clearState` / `replaceAllState` / `getAllState` **五个全部在位**）；`visualization/` 家族的**每一个
类都没有**——声明里 0 命中，运行时也实测缺席。

| 旧命令（`layer/` 家族，实测在位） | `visualization/` 家族 |
| --- | --- |
| `updateState(keys, params, ifAppend)` | **无** |
| `removeState(keys)` | **无** |
| `clearState()` | **无** |
| `replaceAllState(inputs)` | **无** |
| `getAllState()` | **无** |

这直接决定了取舍：**依赖要素状态的用法迁移即丢能力**，这种情况**继续用** `<LineLayer>` /
`<FillLayer>` / `<PointIconLayer>` / `<PointCollection>`。相应地，`<PolylineLayer>` /
`<PolygonLayer>` / `<PointLayer>` **不** `defineExpose` `featureState`（留一个每条命令都会拒绝的空壳
比不留更糟）。

### 2. 样式字段族不同 + 更新入口不同

`layer/` 家族走 `setStyleOptions()`（**逐字段 merge**）并需要显式 `doOnceDraw()` 才重绘；
`visualization/` 家族走 `setOptions()`，**没有** `doOnceDraw`（live 实测三个替代类上
`doOnceDraw` / `setStyleOptions` / `setBaseOptions` 全部缺席）。

`setOptions` 的官方注释（`PolygonLayer.d.ts:176-180`）逐字是：「**仅更新已声明的样式键**；
`visible` / `zIndex` / `renderStage` / `referCenter` / `enablePicked` 转发到对应 setter，
**其余未知键忽略并告警一次**」。

::: warning 「没写的键会不会回到默认值」——官方注释**没有**明确说
「仅更新已声明的样式键」这句在字面上是**按你写到的键更新**，因此**没写到的键保持原值**；
但它**没有**明说未提供的键是否被重置。两种读法对「只写一个键时其余键怎么办」给出的答案不同，
而官方没有可判定的运行时候选页或类型面能定这件事。⇒ **无法判定**：本库
`<PolygonLayer>` / `<PolylineLayer>` 的源码注释按「整袋替换、没写的键回到官方默认值」记录，
本页不推翻它，也不替它背书。**实际影响**：不要依赖「只改一个键、其余自动回默认」——
显式写全你要的键，两种读法下行为都正确。
:::

### 3. 七个旧选项在新家族无对应

`crs` / `popEvent` / `selectedIndex` / `selectedColor` / `autoSelect` 在 `visualization/` 的声明里
**0 命中**（live 实测同样没有）。`pickWidth` / `pickHeight` 在新家族是 `pickTolerance`
（**命中容差**，不是像素框）——语义近似但**不是等价**。照字段表机械改名，这七项会**静默不生效**。

## 该留下还是该迁走

| 你的情况 | 建议 |
| --- | --- |
| 用了 `featureState` 命令面 | **留下**。新家族没有等价能力，迁移会丢功能。 |
| 依赖 `crs`（非 BD09LL 坐标系） | **留下**。新家族没有坐标系选项。 |
| 依赖 `selectedIndex` / `selectedColor`（选中态） | **留下**。新家族没有选中态概念。 |
| 依赖 `popEvent`（控制谁先吃掉一次点击） | **留下**，或改用 `pickThrough` 重设计（两者语义不同：`popEvent` 向上、`pickThrough` 向下）。 |
| 依赖 `autoSelect`（悬浮事件） | **留下**。新家族的 `mouseStyleChange` 只是换光标，不是悬浮事件。 |
| 依赖 `LineLayer` 的痕迹 / 尾迹 / 逐段上色 / 间隔填充 | **留下**。这些样式字段在新家族**没有对应**。 |
| 依赖 `FillLayer` 的雪碧图裁剪（`patternMapping`）/ UV 偏移 | **留下**。新家族按原图平铺。 |
| 只是画线 / 画面，且用的是同名样式键 | 可以迁。样式与拾取需按上表逐条改。 |
| 想要**更窄、更少坑**的接口面 | 可以迁。新家族不开「无消费者」的扩展开面。 |

## 取证说明

本页的每条结论都来自可复核的来源：

- **声明**：`@baidumap/jsapi-v4-types@4.0.5`（git `5ba67f4`）的 `layer/*.d.ts` 与
  `visualization/*.d.ts`，逐行读出；
- **运行时**：live 探针（真实 AK + headless Chrome，2026-09-27）逐类读 `prototype` 与**实例**两处
  成员，并对四个旧类做 **settle 等待**（`absent` 只在成员面补齐后才允许出现）——读数显示四个旧类
  与三个替代类在 `BMap.Map` 就绪时**成员面已齐**（settle `0ms`）。

::: warning 官方 `isFlat` 的默认值自相矛盾
`visualization/PointLayer.d.ts:121` 标 `@default false`，而 `layer/PointIconLayer.d.ts:15` /
`layer/PointShapeLayer.d.ts:15` 标 `@default true`。**语义方向一致**（旧注释「是否是贴地图标」/
「是否贴地渲染」；新注释「`true` 贴地（大小随缩放变化）；`false` 屏幕固定像素大小」），
但**默认值相反**。本库因此**刻意不给** `isFlat` 默认值、也不在文档里替官方选一个——「没传 =
不表态 = SDK 自己的默认」。迁移时**显式传值**，不要依赖默认。
:::
