# 原生批量可视化图层的组件面与要素状态命令面（M6 / #36）

- 状态：Accepted
- 日期：2026-09-19
- 关联：issue #36（`M6-ADVANCED-LAYERS`）、#34（批量点，本 ADR 的迁移对象）、#23（Native Layer Facet）、
  #40 / #98（图层统一内核与 live 探针）、#104（存量同类机制审计）、#43（TrackAnimation 迁移）
- 取代范围：**不取代**任何既有 ADR。对 `2026-09-12-jsapi-v4-service-panorama-native-layers.md`
  的决策 7（八个 kind 的操作表）**只做增补**：新增两个状态操作（`replaceState` / `getState`），
  原有 12 个操作的登记与「不支持显式失败」的口径不变。

## 背景

#23 落了 `NativeLayerDriver`（八个原生数据 kind 的底层接口），#34 在其上落了第一个 Vue 组件
`BPointCollection`。本票要在同一底层之上补齐四个可视化图层（`BLineLayer` / `BFillLayer` /
`BHeatmapLayer` / `BTrackLineLayer`）、统一它们的基础语义、提供**按业务 id** 的要素状态命令面，
并把拾取的「未命中 / 身份未知」语义写死。

三件事实决定了这份 ADR 的形状：

1. **八个 kind 的官方方法面并不一致**：`LineLayer` / `FillLayer` / `PointIconLayer` /
   `PointShapeLayer` 有完整声明（字段级 setter、要素状态、拾取事件），而 `Heatmap` /
   `TrackLine` / `PointLayer` / `ClusterLayer` 属扩展 API——`@baidumap/jsapi-v4-types@4.0.4`
   **没有类声明**，官方明确「首次加载时可视化实现是异步注入的」。硬套一套接口必然产生「调了但没反应」。
2. **#34 的 600 行实现里绝大部分是共有的**：实例创建 / 重建记账、字段指纹、样式逐字段撤回检测、
   拾取解析、账本释放。再复制四份必然分叉，而分叉的表现是「同一个 prop 在不同图层上行为不同」。
3. **2026-09-19 的范围纠正**把 TrackLine 的边界写死了：播放控制与页面可见性联动**先有真实运行时
   证据**再实现，不建镜像 SDK 播放状态的内部状态机。

## 决策

### 1. 抽共享内核，五个消费者共用一份实现

新增三个模块，`BPointCollection` 一并迁过去（不存在「新旧两套」）：

| 模块 | 职责 |
| --- | --- |
| `core/composables/useNativeLayerResource.ts` | 实例创建 / 挂载 / 就地更新 / 重建 / 释放 + 要素状态接线 |
| `core/layers/nativeLayerPick.ts` | 拾取事件的**结构化读取**与领域载荷组装（框架无关） |
| `core/layers/nativeLayerStyle.ts` | 样式投影（函数型字段走 `forwardCallback`） |

判据来自 issue 自己的「抽象顺序」约束：**确认两个以上真实消费者后再提取**——这里是 5 个。

### 2. `visible` 按 kind 的能力面二选一落地

- 有 `setVisible` 的 kind（四类专页图层）：写 setter。**隐藏 ≠ 释放数据**（issue 的非目标明确写了这条）。
- 没有 `setVisible` 的 kind（`Heatmap` / `TrackLine`）：**挂上 / 摘掉**，并且**重新可见时换实例**。

换实例的依据是 #98 的 live 实测（`removeLayer` 之后的实例再也渲染不了，补 `setData` 也救不回来），
与 `2026-09-17-layer-spec-and-registry.md` 的决策同源。代价写在文档里：这两个图层的
「隐藏 → 显示」会重新下发数据。

分流判据是 Driver 的 `supports(kind, "setVisible")`（单一事实源），内核**不自建 kind 表**。

### 3. 重建指纹从**构造期选项袋**派生

`rebuildKey = kind + stableLayerValue(ctorOptions(props))`，不再手写字段清单。手写清单时新增一个
构造期 prop 而忘了加进去，表现是「改了没反应」而不是报错——这类静默分叉正是要消除的。
代价：构造期选项里不能有函数（会被折叠成 `fn`）；这四个图层的构造选项全是原始值。

### 4. 要素状态是**命令面**，身份只有业务 id

新增 `core/data/featureState.ts`（框架无关），命令与官方入口一一对应：

| 命令 | 官方入口 |
| --- | --- |
| `update(keys, state, { append })` | `updateState(keys, params, ifAppend)` |
| `remove(keys)` / `clear()` | `removeState` / `clearState` |
| `replace(inputs)` | `replaceAllState(inputs)` |
| `get(keys?)` | `getAllState()`（**公开读回**，不是本地账本） |

四条口径写死：

1. **身份只有业务 id**（`idKey` 字段的值）。不用 `dataIndex`、不按调用 / 事件顺序配对、不缓存
   「我们以为 SDK 现在是什么状态」；
2. **参数校验前置**：非法 id（`NaN` / 非对象状态）在任何 SDK 调用之前抛 `BMAP_INVALID_ARGUMENT`，
   不用 `try/catch` 把参数错误伪装成 SDK 失败；空 keys / 空映射是合法输入（不产生 SDK 调用）；
3. **未就绪不排队**：不抛、不攒着，告警一次并跳过（与 `<BMap>` expose 的命令面同一条口径）；
4. **「不支持」不在这一层判**：某一类图层有没有该入口是 Driver 的事实，让
   `BMAP_CAPABILITY_UNSUPPORTED` 从那一处抛出来，两处各判一次必然分叉。

命令面通过组件 `ref` 暴露（`featureState`），**只给有该能力的 kind**：`BHeatmapLayer` /
`BTrackLineLayer` 不 expose（挂一个每次调用都会抛的方法只是假面）。

### 5. 拾取的三个字段各自表达一件事

`BMapPointPick` 增补 `id`（additive，不改既有字段语义），载荷语义写死：

| 字段 | 语义 |
| --- | --- |
| `hit` | 官方是否命中（`dataIndex !== -1`；官方**未命中也派发事件**） |
| `id` | 业务身份（`properties[idKey]`）；认不出**如实为 `null`**，不猜官方默认 `idKey` |
| `item` | 命中的业务项（线 / 面图层就是 `properties`）；未命中为 `null` |

`item` 与 `id` 解耦是有意的：`properties` 是官方回包直接给出的，不依赖 `idKey`；而逐项数据组件
（`BPointCollection`）的业务对象靠身份索引，因此那一类在 `id` 为 `null` 时 `item` 也是 `null`
（由 `resolveFeaturePick` 的 `itemOf` 钩子表达，且 `itemOf` 一旦提供就是权威，不做回退）。

### 6. Driver 增补两个状态操作

`NativeLayerOperation` 加 `replaceState` / `getState`，`DECLARED_LAYER_OPERATIONS` 相应加
`replaceAllState` / `getAllState`（官方四类专页图层的声明成员）。扩展 API 四种 kind 仍然回答
「不支持」并显式失败。`getState` 与 `hitTest` 同类（有返回值，单独实现），并对回包形状做校验
（不是对象时抛 `BMAP_SDK_CALL_FAILED`，而不是当成空状态）。

### 7. 逐 kind 的能力面：不声明不支持的 prop

| 组件 | prop 面 |
| --- | --- |
| `BLineLayer` / `BFillLayer` | `data` + 统一槽位（visible/opacity/zIndex/minZoom/maxZoom）+ 强类型 `style` + 拾取 / 选中构造项 + 四个拾取事件 + `featureState` |
| `BHeatmapLayer` | `data` / `style`（原样键值袋）/ `visible` |
| `BTrackLineLayer` | `data` / `visible`（**基线**） |

「统一语义」指的是**同一批 prop 名与同一套「变化走哪条路」的判据**，而不是「所有 kind 都有这些
prop」——后者会让「声明了却静默忽略」变成常态（issue 的非目标第一条）。

issue 的「统一 setData / style / base options / visible / opacity / zoom / zIndex」在 base options
这一项上的落地方式是：**构造期项（`idKey` / `crs` / `enablePicked` / 拾取矩形 / `autoSelect` /
`selectedColor` / `FillLayer.border`）一律「变化 ⇒ 换实例」**，不提供「就地改 base options」的通道。
理由：官方只有整袋 `setBaseOptions`（且明确「不会自动触发重绘」），就地改它会出现「设置生效了但
画面没变」这一类最难排查的问题；而换实例的代价是可控的（这些项在运行期几乎不变）。

## 后果

正面：

- 五个组件共用一份生命周期实现；新增一个原生数据图层只需声明「构造期选项 / 样式 / 数据 / 事件」四件事；
- 要素状态有了稳定口径与公开读回，`get` 不会与 SDK 分叉；
- 「未命中」「身份未知」在载荷里可区分，UI 不会把「点空白」渲染成「选中了某个要素」。

代价与已知限制（逐条给出处）：

1. **`visible` 的两条语义不同**：`Heatmap` / `TrackLine` 的「隐藏 → 显示」会换实例并重新下发数据。
   文档已写明（`docs/zh-CN/components/layer/native-visual-layers.md`）。
2. **`opacity` / `zIndex` / 缩放范围在扩展 API 图层上不存在**：官方不公开对应 setter，本库不声明
   这些 prop（不假支持）；需要这些能力的用有四类专页声明的图层。
3. **样式里的函数换实现后，只在 SDK 下一次求值时生效**：交给 SDK 的是 `forwardCallback` 包装，
   已经画出来的要素不会回溯变化；要立刻换样式请换 `data` 的引用触发重新解析。
4. **原地修改同一份 `data` 不会被感知**：数据按引用比较（与 M7 图层内核同一条口径）。
   拾取的业务身份只认 `properties[idKey]`（`string | number`）：`idKey` 没表态、或那个字段是
   `NaN` / symbol 时，`id` 与 Feature State 都不工作（`item` 仍然可用，因为属性袋来自官方回包）。
5. **`BPointCollection` 的 `toBaseOptions` 一类构造期项仍要换实例**：官方只有整袋
   `setBaseOptions` 且不自动重绘。
6. **「不回退默认值」是刻意的**：字段由有值变为未表态时**重建实例**（并告警一次），因为官方没有
   unset 入口，静默保留旧值会让声明与画面分叉。

回滚：本 ADR 的改动集中在新增文件与 `BPointCollection` 的迁移上。回滚方式是「保留 Driver 的两个
状态操作、移除四个组件与内核」——`BPointCollection` 若要回到自持实现，需要恢复它自己的
`InstanceState`（本 ADR 提交前的版本即参考）。Driver 层的 `replaceState` / `getState` **不建议回滚**：
它们是官方声明成员的直译，且 `supports()` 表是单一事实源。

## 非目标与欠账

**非目标**（本票刻意不做）：

- 不让所有 kind 共用一套构造参数模型；
- 不把 `setVisible(false)` 当作释放数据的方式；
- 不猜测未验证的扩展 API 清理方式（`Heatmap` / `TrackLine` 的清理只用「摘图层 + 清数据」这条已证路径）。

**欠账**（逐条写明去处）：

| 欠账 | 依据／为什么现在不做 | 去处 |
| --- | --- | --- |
| TrackLine 播放控制（`start` / `pause` / `resume` / `stop`） | 官方类型包**没有** `TrackLine` 类声明，方法名必须先由真实运行时探针取证；2026-09-19 的范围纠正要求「所有新增 capability/清理判据先有真实 SDK 证据」 | 后续票（先落 `scripts/probe-*.mts` 的探针，再决定薄命令面） |
| 页面可见性联动（hidden/offscreen 自动暂停） | 自动 pause/resume 若会改变用户可观察状态，必须是**显式 opt-in** 而不是基础默认；官方语义未验证 | 同上 |
| `BMVTLayer` 基线 | 官方 React 组件库的经验（`PixelLayer` / `MVTLayer` / `BaiduVectorLayer` 是包在真 TileLayer 外面的壳、需要先拆壳才 `addLayer`，见该仓库 `src/drivers/v4Driver.ts` 的 `unwrapTileWrapper`）尚未由本库在真实运行时验证。**注**：`layer/MVTLayer.d.ts` 本身有完整的类声明（含 `updateState` / `clearState` / `setStyle`），所以缺口不在「有没有声明」，而在「怎么把它挂到地图上」这条机制 | 后续票（属本票「目标与范围」里被切出去的部分，用户已确认） |
| `BGeoJSONLayer` 基线 | **不属于本票**：它由 #40 落地（`BGeoJSONLayer.vue`，走 `LayerDriver` 的 `geojson` kind，官方 `BMap.GeoJSONLayer`）。它是「覆盖物组合图层」而不是原生批量数据图层，没有要素状态 / 拾取面 | 无需动作（票面的这一项已在 #40 完成） |
| 各种 geometry 的 GeoJSON 校验 | 本票的图层组件把它交给 SDK（官方 `setData(geojson: object)` 只声明了 `object`）；M6 的数据适配层（`core/data/*`）目前只覆盖 Point 几何 | 后续票（若需要线 / 面几何的前置校验） |
| 大数据量用例 | 夹具与用例目前都是 1~2 个要素；「就地更新不重建、卸载不残留」已由 §1 / §4 覆盖，但**没有量级维度** | 后续票（`tests/performance` 已有基础设施） |
| symbol 型字符串以外的业务身份 | 拾取与要素状态的身份口径是官方取值域 `string \| number`；数据组件的 `itemKey` 允许 symbol，那种 key 会走「身份认不出」这条路（`id: null`）而不是被猜出来 | 已写进 `readFeatureId` 的 JSDoc；若确有需求再评估 |
| 样式字段与上游声明的**类型层锁** | 组件 props 目前只能靠「逐字段核对 + 用例」守（与 #34 的 `BPointCollectionProps` 同一条既有口径）；`src/types/**` 属 raw SDK 禁区，`BMap.LineStyle` 只能在 driver 侧或测试里引用 | 若评审要求，可放进消费方 fixture 或 driver 侧的断言文件 |
| 探针的 live 档覆盖新操作 | fixture 档已进 PR 门禁（`smoke:v4:fixture`）；live 档在 nightly 跑同一份操作表 | nightly（无需额外动作） |

## 参考

- 官方声明：`@baidumap/jsapi-v4-types@4.0.4` 的 `layer/NormalLayer.d.ts`、`layer/LineLayer.d.ts`、
  `layer/FillLayer.d.ts`（`NormalLayerEventMap` / `LineStyle` / `FillLayerStyle` / 字段级 setter 族）
- 官方参考实现：`huiyan-fe/react-bmap`（描述即「官方 React 组件库」）的
  `src/components/Layer/LineLayer.tsx` / `FillLayer.tsx` —— 本库与它同源的地方（ctor 期项变化才重建、
  style 走 `setStyleOptions + doOnceDraw`、受控字段走 setter），比它更严的地方（Feature State 是一等
  命令面而不是 `onReady(raw)`；拾取载荷区分未命中与身份未知）
- 相关 ADR：[`2026-09-12-jsapi-v4-service-panorama-native-layers.md`](./2026-09-12-jsapi-v4-service-panorama-native-layers.md)、
  [`2026-09-17-layer-spec-and-registry.md`](./2026-09-17-layer-spec-and-registry.md)、
  [`2026-09-18-data-layer-manager-and-point-collection.md`](./2026-09-18-data-layer-manager-and-point-collection.md)
