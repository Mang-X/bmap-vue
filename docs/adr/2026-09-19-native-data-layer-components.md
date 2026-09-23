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
   `BMAP_CAPABILITY_UNSUPPORTED` 从那一处抛出来，两处各判一次必然分叉；
5. **身份没声明就不执行**（#106 评审的建议项）：组件没给可用的 `idKey` 时五个命令一律拒绝并告警
   一次。放它们过去等价于悄悄依赖 SDK 的默认 `idKey`，于是同一张图层上会出现两套身份语义——拾取
   如实给出 `id: null`，状态命令却装作知道身份。
6. **「已声明身份」的判定只有一处**（`core/data/identity.ts` 的 `normalizeIdField`）：**只要是字符串
   就算声明**（含 `""`——`PropertyKey` 的既有口径，见 `isUsableItemKey`），只有 `undefined` / 非字符串
   算未声明。三处用到它的地方（构造期选项要不要交给 SDK、要素状态的前置条件、拾取读取）共用这一个
   判据——两轮评审分别撞到过它的两种错法：写入侧当已声明、读取侧当未声明（`idKey: ""`），以及
   为了「统一」而**自行发明非空限制**（第三轮，见修正记录）。
7. **业务键与公开 id 是两个取值域**（第三轮评审的收敛方向）：
   - **业务键**（`readFeatureKey`）= `properties[idKey]` 的原始值，取值域与 `itemScan.isUsableItemKey`
     一致（有限数字 / 字符串 / symbol）。它是「找回业务项」的依据；
   - **公开 `id`**（`readFeatureId`）= 其中可公开、也可交给 Feature State 的那部分，取值域
     `string | number`（官方 `updateState(keys: string | number | …)` 的签名）。
   `resolveFeaturePick` 的 `itemOf` 收到的是**业务键**，因此 symbol 型身份不会让 `item-click` 丢掉；
   `id` 为 `null` 时 `item` 仍可能有值，这是刻意且写进文档的。

命令面通过组件 `ref` 暴露（`featureState`），**只给有该能力的 kind**：`BHeatmapLayer` /
`BTrackLineLayer` 不 expose（挂一个每次调用都会抛的方法只是假面）。

### 5. 拾取的字段各自表达一件事

`BMapPointPick` 增补 `id`（additive，不改既有字段语义），载荷语义写死：

| 字段 | 语义 |
| --- | --- |
| `hit` | 官方是否命中（`dataIndex !== -1`；官方**未命中也派发事件**） |
| `id` | **可以公开 / 交给 Feature State 的业务身份**（`properties[idKey]`，取值域 `string \| number`）；认不出或不在该域时**如实为 `null`**，不猜官方默认 `idKey`，也不把 symbol 转成字符串冒充身份 |
| `item` | 命中的业务项（线 / 面图层就是 `properties`）；未命中为 `null`。**与 `id` 解耦**：按完整业务键（`readFeatureKey` 的取值域 = `isUsableItemKey`）恢复，因此 `id` 为 `null` 时它仍可能有值 |
| `latLng` / `pixel` | 事件回包里的坐标（未命中时也有） |

`item` 与 `id` 解耦是有意的（第三轮评审的收敛方向，见修正记录）：`id` 的取值域被官方
`updateState(keys: string | number | …)` 的签名收窄，而**业务项的恢复不该跟着收窄**——
逐项数据组件（`BPointCollection`）的业务对象靠业务键索引，symbol 型 `itemKey` 就是
「`id` 为 `null`、`item` 有值」的情况（由 `resolveFeaturePick` 的 `itemOf` 钩子表达，
且 `itemOf` 一旦提供就是权威，不做回退）。

业务键的读取是**两阶段**的（第四轮评审）：先读事件回包 `value.dataItem.properties[idKey]`，
读不到可用 key 就按 `dataIndex` 回到**我们自己成功送出的那份数据**再取一次。两条依据都是公开输入
（不是猜 SDK 私有身份），且这条兜底与迁移前的 `BPointCollection` 行为等价。

### 6. Driver 增补两个状态操作；**删除**无依据的 `clearData`

`NativeLayerOperation` 加 `replaceState` / `getState`，`DECLARED_LAYER_OPERATIONS` 相应加
`replaceAllState` / `getAllState`（官方四类专页图层的声明成员）。扩展 API 四种 kind 仍然回答
「不支持」并显式失败。`getState` 与 `hitTest` 同类（有返回值，单独实现），并对回包形状做校验
（不是对象时抛 `BMAP_SDK_CALL_FAILED`，而不是当成空状态）。

同时**从四类专页图层的操作表里删掉 `clearData`**：上游声明只有 `setData`/`getData`，仓库内官方
参考也只把清理写成 `removeLayer`（见「修正记录」）。

### 7. 「这种 capability 凭什么算数」由**机器核对**兜住

`native-layers.test.ts` 新增「操作面与官方声明一致」用例：它解析
`@baidumap/jsapi-v4-types` 的类体成员，把 `supports(kind, operation)` 为真的每个操作映射到官方成员
（`setStyle → setStyleOptions` / `setEnablePicked → setBaseOptions` / `setZoomRange → setMinZoom +
setMaxZoom` …），任何一个映射不到就红。配套的 **Fake 侧不变量**：`FakeV4NativeLayerBase` 删掉
`clearData`——**替身不得比真实契约宽容**，否则「登记了一条不存在的 capability」会被 CI 测绿
（这正是本轮 P1 的成因）。

### 9. 「没有数据」由**实例生命周期**表达，不猜清空入口

`data` 的三个取值承担三件事（与 `LayerSpec` 的口径一致）：

| 取值 | 语义 | 落地 |
| --- | --- | --- |
| 对象 | 有数据 | `setData()`（**不重建**） |
| `null` | 明确「没有数据」 | **换一个没有数据的实例**（这一族没有公开的清空入口） |
| `undefined` | 不表态 | 不产生任何 SDK 调用，已画出来的数据保持不变；**换实例时把上一代成功送出的数据补齐到新实例**（否则与 `data` 无关的构造期项变化会让数据凭空消失，且 `sentData()` 会与真实实例分叉） |

「`null` ⇒ 重建」对**所有** kind 统一（包括扩展 API 里登记了 `clearData` 的 `Heatmap`）：同一个 prop
在不同 kind 上换语义，是使用者最难预期的一类差异，而 `null` 是离散动作、重建代价可控。这条同时
解决了 `BTrackLineLayer` 的「`data → null` 画面不变」（旧实现在不支持 `clearData` 时只 warn 就返回，
既不收敛、又会反复尝试同步）。

### 8. 逐 kind 的能力面：不声明不支持的 prop

| 组件 | prop 面 |
| --- | --- |
| `BLineLayer` / `BFillLayer` | `data` + 统一槽位（visible/opacity/zIndex/minZoom/maxZoom）+ 强类型 `style` + 拾取 / 选中构造项 + 四个拾取事件 + `featureState` |
| `BHeatmapLayer` | `data` / `style`（原样键值袋）/ `visible` |
| `BTrackLineLayer` | `data` / `visible` / **`pauseOnHidden`**（#110） + expose 播放命令面（`playback`）与事件观察（`observed` / `@progress` / `@statuschange`） |

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
   拾取的业务身份只认 `properties[idKey]`：`idKey` 没表态、或那里的值不是有限数字 / 字符串
   （`NaN` / symbol）时，**公开 `id` 为 `null`、Feature State 也不能用它**——但**业务项与
   `item-click` 不受影响**（`item` 走业务键恢复；`BPointCollection` 的 symbol 型 `itemKey`
   就是这种情况，有回归用例）。
5. **`BPointCollection` 的 `toBaseOptions` 一类构造期项仍要换实例**：官方只有整袋
   `setBaseOptions` 且不自动重绘。
6. **「不回退默认值」是刻意的**：字段由有值变为未表态时**重建实例**（并告警一次），因为官方没有
   unset 入口，静默保留旧值会让声明与画面分叉。
7. **`data = null` 的代价是一次重建**（见决策 9）：这一族没有公开的清空入口，「没有数据」只能用
   换实例表达。要「临时不显示」请用 `visible`，不要用 `data = null`。
8. **没有声明 `idKey` 时要素状态命令会被拒绝**（告警一次）：理由是拒绝「悄悄依赖 SDK 默认身份」，
   而不是这个能力不存在。`BPointCollection` 不受影响（它的 `itemKey` 恒能推出身份字段）。

回滚：本 ADR 的改动集中在新增文件与 `BPointCollection` 的迁移上。回滚方式是「保留 Driver 的两个
状态操作、移除四个组件与内核」——`BPointCollection` 若要回到自持实现，需要恢复它自己的
`InstanceState`（本 ADR 提交前的版本即参考）。Driver 层的 `replaceState` / `getState` **不建议回滚**：
它们是官方声明成员的直译，且 `supports()` 表是单一事实源。

## 修正记录（#106 评审，2026-09-19）

评审对同一 commit（`1cfa245`）提出两个阻塞项与一个建议项，全部**成立**，处置如下：

| 评审项 | 事实核对 | 处置 |
| --- | --- | --- |
| **P1：四类专页图层的 `clearData` 没有依据**，而 Fake 让它测绿；`data: object → null` 会打进一个不存在的入口，卸载也稳定产生一次失败告警 | **成立**（两条一手来源）：上游 `layer/{PointIconLayer,PointShapeLayer,LineLayer,FillLayer}.d.ts` 只有 `setData`/`getData`；仓库内官方参考 `visualization-layers.md` 的数据面是 `setData/getData`、清理是 `removeLayer`。错误的来源是 #23 ADR 决策 3 把「共享同一套方法面」写宽了（该处已一并更正） | ① 从 `DECLARED_LAYER_OPERATIONS` 删除 `clearData`（扩展 API 的三种 kind **保留**——官方扩展参考明确列出了它）；② Fake 的基线类删掉 `clearData`（**替身不得比真实契约宽容**）；③ 卸载路径去掉「先清数据」（官方参考的清理清单只有「解绑事件 → `removeLayer`」）；④ 新增机器核对用例（决策 7）；⑤ 更正 #23 ADR 与本文档 |
| **P1：`BTrackLineLayer` 的 `data → null/undefined` 不会清掉旧轨迹**，同一个 `null` 还会反复尝试同步 | **成立**：旧内核在 `value === null` 且 kind 不支持 `clearData` 时只 warn 就返回，不重建、不摘除、也不更新成功指纹 | 决策 9：`null` ⇒ 换一个没有数据的实例（所有 kind 统一）；`undefined` ⇒ 不表态。补 `object → null → object` 在四个组件（含 `BTrackLineLayer`）上的行为用例 |
| **建议项：未声明 `idKey` 时仍 expose 完整的 `featureState`**，与拾取的「身份未知」口径形成两套身份语义 | **成立** | 决策 4 第 5 条：身份未声明时五个命令拒绝执行并告警一次；组件文档与用例同步 |

### 第二轮（2026-09-19 晚，基线 `e7e0203`）

| 评审项 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1] `data: undefined` 的「不表态」在**换实例**后会丢数据，`sentData()` 变成陈旧账本**（`A → undefined → 改 enablePicked/idKey` 或扩展图层的 `A → undefined → 隐藏 → 显示`） | **成立**：`applyData` 的 `absent` 分支直接 `return`；创建路径（`force`）同样如此，而 `sent` 是模块级的、不随重建重置 ⇒ 新实例没有数据、账本却还留着 A | 创建路径上把 `sent`（上一代**成功送出**的那份数据）补齐到新实例；补两条回归：`A → undefined → 改 enablePicked 触发重建`（断言新实例仍有 A、且再给新引用仍会下发）与热力图的 `A → undefined → 隐藏 → 显示` |
| **[P2] `idKey = ""` 仍有两套身份口径**：写入侧用 `!== undefined`（把 `""` 当已声明并交给 SDK），读取侧用 falsy 判断（把 `""` 当未声明） | **成立** | 新增唯一判定点 `core/data/identity.ts#normalizeIdField`（非空字符串才算声明），构造期选项 / 要素状态前置 / 拾取读取三处共用；空字符串不再交给 SDK，命令拒绝，拾取给 `id: null`，并告警点名 |
| 文档同步：PR 描述仍是旧契约（`解绑 → clearData → removeLayer`、卸载新增 `clearData()`） | **成立** | 同步 PR 描述的生命周期 / 迁移影响 / 验收对照 |

### 第三轮（2026-09-19 晚，基线 `7834d89`）

| 评审项 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1] `normalizeIdField` 把「图层 `idKey` 字段名」与 `BPointCollection.itemKey` 的既有 `PropertyKey` 契约混成一套，导致第五个消费者行为回退**：① `itemKey=""` 时 `ctorOptions` 仍把 `idKey: ""` 交给 SDK，而命令前置/拾取把它判成「未声明」⇒ 同一个组件内部又是两套语义，且相对迁移前是回退（旧实现会用 `properties[""]` 找回业务项）；② 函数式 `itemKey` 返回 symbol 时，`itemOf` 依赖被收窄的 `id` ⇒ `item-click` 从可用变成失效 | **成立**：`isUsableItemKey` 对空字符串与 symbol 照收；迁移前的 `readPick` 明确接受 `string \| number \| symbol` 并用它查 `ItemIndex<PropertyKey>`；PR 声称「行为等价」而公共 `itemKey` 类型仍是 `PropertyKey` ⇒ 属「实现收窄了、公共契约没收窄」 | ① `normalizeIdField` 只做**类型归一化**（非字符串 → 未声明），不再收窄取值（`""` 是合法字段名）；② 拆出**业务键** `readFeatureKey`（域 = `isUsableItemKey`）与**公开 id** `readFeatureId`（域 = `string \| number`，Feature State 的域）；③ `resolveFeaturePick` 的 `itemOf` 改收**业务键**，业务项恢复不再依赖公开 id；④ 补两条回归：`itemKey=""`（构造 / 命令 / 拾取三侧一致）与函数式 `itemKey` 返回 symbol（`id` 为 null 但 `item` / `item-click` 必须还在） |
| 非阻塞文档项：PR 描述门禁表里的 `test:unit` 例数过期 | 成立 | 随本轮一并同步 |

反证（改坏 ⇒ 用例必须红，改回 ⇒ 绿）：

| 改坏 | 结果 |
| --- | --- |
| 去掉 `sent !== null && dataIsEmpty()` 判据（退回「warn 后什么都不做」） | 3 条红：`「没有数据」由换实例表达: expected 1 to be 2`、`轨道清空: expected 1 to be 2`、`旧实例连同它的数据一起被丢弃: expected true to be false` |
| 把 `clearData` 重新登记回四类专页图层 | 7 条红，含机器核对那条：`point-icon(PointIconLayer).clearData 落在 clearData() 上，而官方声明里没有它`，以及 facet 契约的 `SDK 实例缺少方法 clearData()`（Fake 不再宽容地接住） |
| 去掉「不表态 + 换实例 ⇒ 继承上一代数据」 | 2 条红：`新实例必须继承上一代成功送出的数据: expected null to deeply equal …`、`新实例继承数据: expected null to deeply equal …` |
| 让 `normalizeIdField` 接受空字符串（第二轮的口径） | 2 条红：`空字符串字段名照收，值是业务键: expected null to be 'a'`、`空字符串字段名照交给 SDK: expected { enablePicked: true, … } to match object { idKey: '' }` |
| 让 `itemOf` 收到收窄后的公开 `id`（而不是业务键） | 1 条红：`业务项必须仍然能找回: expected null to be { Object (id, lng, ...) }` |

## 非目标与欠账

**非目标**（本票刻意不做）：

- 不让所有 kind 共用一套构造参数模型；
- 不把 `setVisible(false)` 当作释放数据的方式；
- 不猜测未验证的扩展 API 清理方式（`Heatmap` / `TrackLine` 的清理只用「摘图层 + 清数据」这条已证路径）。

**欠账**（逐条写明去处）：

| 欠账 | 依据／为什么现在不做 | 去处 |
| --- | --- | --- |
| TrackLine 播放控制（`start` / `pause` / `resume` / `stop`） | 官方类型包**没有** `TrackLine` 类声明，方法名必须先由真实运行时探针取证；2026-09-19 的范围纠正要求「所有新增 capability/清理判据先有真实 SDK 证据」 | **#110 已收口**：live 探针（`scripts/probe-track-line.mts`，2026-09-23，exit 0）取证方法名与事件载荷；薄命令面经 `core/layers/trackLinePlayback.ts` 暴露（`playback.start/pause/resume/stop/setSpeed/setProcess`），参数在 SDK 调用前校验，未就绪不排队 |
| 页面可见性联动（hidden/offscreen 自动暂停） | 自动 pause/resume 若会改变用户可观察状态，必须是**显式 opt-in** 而不是基础默认；官方语义未验证 | **#110 已收口**：live 探针实测「SDK 不会自行暂停」⇒ 默认只停本库观察；`pauseOnHidden` prop 是 opt-in，且只对**已送达 start/resume 且 handle 匹配**的实例 pause/resume（not-ready/抛错不留意图；stop/idle/跨代不被反向启动；prop 变化按 `visibilityState` 收敛；**已在 hidden 时新送达的 play 也会立刻再跑一遍策略**；`observed` 快照按 handle 分代、新一代第一条事件从空快照重建，#132 评审）；visibility 暂停记账**绑到被 pause 的 handle** |
| `BMVTLayer` 基线 | 官方 React 组件库的经验（`PixelLayer` / `MVTLayer` / `BaiduVectorLayer` 是包在真 TileLayer 外面的壳、需要先拆壳才 `addLayer`，见该仓库 `src/drivers/v4Driver.ts` 的 `unwrapTileWrapper`）尚未由本库在真实运行时验证。**注**：`layer/MVTLayer.d.ts` 本身有完整的类声明（含 `updateState` / `clearState` / `setStyle`），所以缺口不在「有没有声明」，而在「怎么把它挂到地图上」这条机制 | 后续票（属本票「目标与范围」里被切出去的部分，用户已确认） |
| `BGeoJSONLayer` 基线 | **不属于本票**：它由 #40 落地（`BGeoJSONLayer.vue`，走 `LayerDriver` 的 `geojson` kind，官方 `BMap.GeoJSONLayer`）。它是「覆盖物组合图层」而不是原生批量数据图层，没有要素状态 / 拾取面 | 无需动作（票面的这一项已在 #40 完成） |
| 各种 geometry 的 GeoJSON 校验 | 本票的图层组件把它交给 SDK（官方 `setData(geojson: object)` 只声明了 `object`）；M6 的数据适配层（`core/data/*`）目前只覆盖 Point 几何 | 后续票（若需要线 / 面几何的前置校验） |
| 大数据量用例 | 夹具与用例目前都是 1~2 个要素；「就地更新不重建、卸载不残留」已由 §1 / §4 覆盖，但**没有量级维度** | **#37 已收口**：`tests/performance` 已落地 100/1k/10k/50k 基准（含 `BPointCollection` 的挂载 / 替换 / 卸载与 100 次替换的保留内存趋势），见 [`2026-09-21-performance-baseline-and-worker-decision.md`](./2026-09-21-performance-baseline-and-worker-decision.md) |
| symbol 型业务键在**公开 `id` / Feature State** 上不可用 | 公开 `id` 的取值域是官方 `updateState(keys: string \| number \| …)` 的签名；symbol 不参与 Feature State 的键（也不转字符串冒充） | 已写进 `readFeatureId` / `readFeatureKey` 的 JSDoc 与组件文档；拾取侧 `item`/`item-click` **不受影响**（有回归用例） |
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
