# ADR 2026-09-17：控件统一 spec 与全景基线

- 状态：已接受（Accepted）
- 日期：2026-09-17
- 计划键：`M7-CONTROL-PANORAMA`（issue #41，追踪 #12）
- 取代：无（在 [2026-09-11 v4 Control / Layer Facet](./2026-09-11-jsapi-v4-control-layer-facets.md) §5 与「已知限制」上
  **点名取代两条**：① 「组件目前不调 `controls.setOptions`，所以没有 `updatePolicy()` 之类的查询入口」；
  ② 「控件不在 Capability Catalog 内 …… 如需控件级能力探测，应在 M7（#41）与 ControlSpec 一起设计」。
  正文留在本文件，旧文件只加指针）
- 相关：[`2026-09-11-jsapi-v4-control-layer-facets`](./2026-09-11-jsapi-v4-control-layer-facets.md)、
  [`2026-09-12-jsapi-v4-service-panorama-native-layers`](./2026-09-12-jsapi-v4-service-panorama-native-layers.md)、
  [`2026-09-14-map-handle-container-and-visibility`](./2026-09-14-map-handle-container-and-visibility.md)

## 背景

M3A.2（#22）把十个内置控件收进了 Driver 的能力面并冻结了「option 更新分类」；当时明确**不做组件面**
（`BNavigation` / `BMapType` / `BOverview` 与声明式 `ControlSpec` 留给 M7）。于是 M7 开工时仓库里的实际状态是：

- 八个控件组件（`BZoom` / `BScale` / `BCityList` / `BLocation` / `BNavigation3d` / `BPanoramaControl` /
  `BCopyright` / `BControl`）**各写了一份** `addToMap` / `createWatchers` / `remove`，逐字重复；
- 这份重复里**没有任何一个接上 `anchor` / `offset` 的更新路径**——改 props 不产生任何效果，
  而 issue 的测试要求明确写着「位置、offset、visible 动态更新」；
- `visible` 用 `addControl` / `removeControl` 表达，于是「藏起来」会顺带触发内置控件的 `initialize()`
  重跑，而 `location` 控件的 `remove` 会调用 `stopLocationTrace()`——「隐藏」变成了「关掉」；
- Driver 的 `show()` / `hide()` / `setOptions()` 在组件路径上**没有任何消费者**（`setOptions` 只在测试里被调）；
- `CONTROL_OPTION_SPECS` 的分类（`mutable` / `recreate`）是冻结的单一事实源，但组件侧拿不到它：
  没有查询入口，谁想「按分类决定重建」就只能抄一张自己的表；
- 全景只有 `PanoramaViewerDriver` 的 skeleton（#23 交付），**没有** `PanoramaContext` / 组件 /
  检索 composable；`panorama.label` 在能力矩阵里标着 `experimental` 而没有任何消费者。

## 决策

### 1. 控件层收进 `ControlSpec` + 一个 adapter，组件只声明「是什么」

新增 `src/core/controls/`：

| 文件 | 职责 |
| --- | --- |
| `spec.ts` | `ControlSpec<Props>`：`kind` / `options(props)` / `render` / `create` / `mount` / `unmount` / `events` / `setVisible` |
| `useControlResource.ts` | 执行 spec 的**统一 adapter**（从 `useSdkResource` 派生） |
| `optionKey.ts` | 选项的**变化键**与逐键 diff（`changedOptionKeys`） |

`options(props)` 是**唯一**的选项来源，同时服务构造与运行期更新——组件不再手写「构造时传什么、更新时传什么」
两套（那两套迟早分叉）。钩子全是「覆盖默认」而不是「必须实现」：`BCopyright` 覆盖
`create` / `mount` / `unmount` / `setVisible`（它的实例按 anchor **共享**，见 §4），`BControl` 用
`kind: "custom"` + `render`。

`useSdkResource` 仍然负责实例的创建 / 竞态 / 释放；控件特有的四件事（visible、anchor/offset、options、事件）
留在 adapter。八条 `addToMap` / `createWatchers` / `remove` 的重复随之删除。

### 2. 「就地更新」还是「重建」由 Driver 的 `planOptions()` 说了算，组件不维护第二张表

`ControlDriver` 新增：

```ts
planOptions(control: ControlHandle, keys: readonly string[]): Record<string, ControlOptionStatus>;
// ControlOptionStatus = "live" | "recreate" | "unsupported"
```

三态而不是二态：「本引擎没有入口」与「有入口但只能构造期生效」对调用方是两件不同的事——
前者重建也没用（值会被静默丢弃），后者重建就能生效。合并它们会让 adapter 对着一堆无用重建反复创建控件。

**`planOptions` 与 `setOptions` 共用同一处分类**（`classifyOption()` 返回的动作同时决定两者：`apply` 存在即就地写、
`apply` 缺席但 `live` 即 options 袋、`recreate` / `unsupported` 只告警）。分类表、options 袋与 `set<Key>`
逃生口因此只有一份，不存在会漂移的第二张表。

adapter 的判据因此是一句话：**任一变化键是 `recreate` ⇒ 整只重建**（把新选项交给构造期）；
其余（`live`）⇒ 只把变了的键写下去；`unsupported` ⇒ 不写也不重建。

### 3. `anchor` / `offset` 与 kind 专属选项走**同一条 diff**，并且按 `anchor → offset` 的顺序下发

`anchor` / `offset` 是全部控件的公共可更新项（基类 `setAnchor` / `setOffset`），进同一份变化键。
三个细节：

- **按 `anchor → offset` 的顺序**：真实 4.0 的 `setAnchor()` 会把偏移重置回控件默认值（官方参考实现的
  控件工厂特意跳过首次 `setAnchor`，注释写的就是这条）。两个方向都只有 SDK 才看得见：只写 `anchor`
  会静默吃掉用户给的 `offset`；同一个 patch 里先 `offset` 后 `anchor`，同一次调用里 `offset` 又被重置。
  因此判据是「**先** anchor、**后** offset」，而不是「都带上就行」。只改 `offset` 时**不**顺带写 anchor。
- **这条不变量是靠把 Fake 修准才拿到证据的**：`FakeV4Control#setAnchor` 原先不建模「重置偏移」，
  于是「成对写」在测试里**近乎空转**——去掉成对写只有 1 条用例偶然变红（因为它读的是另一样东西）。
  把约束建进 Fake 之后，去掉成对写会让 10 个 Stable 控件一起变红；这个过程顺带**抓出了实现里的一个真
  bug**：offset 单独变化时 `setOffset` 与 `setAnchor` 的键顺序反了，`offset` 会被重置掉。
- **缺省不补第二份默认表**：`withDefaults` 已经给出 anchor / offset（#22 ADR §4 的口径），Driver 侧仍不补。

### 4. `visible` 定型为 SDK 的 `show()` / `hide()`；`BCopyright` 是唯一的例外

`Control#show/hide/isVisible` 就是官方为「控件可见性」提供的入口。用挂载表达显隐有两个副作用：

1. 内置控件的 `initialize()` 会重跑（DOM 重新创建、内部交互状态丢失）；
2. `location` 控件的 `remove` 会**顺带停掉持续定位跟踪**（`stopLocationTrace`，见 #22 ADR §5 的评审记录）
   ——「把它藏起来」变成「把它关掉」。

**`BCopyright` 覆盖 `setVisible`**：同 anchor 的控件是**共享**的（文档承诺「多个相同位置版权控件会自动排列，
避免重叠」），隐藏整个控件会连带隐藏兄弟组件的内容。因此它的「可见」落在**版权项**的登记 / 摘除上
（`addCopyright` / `removeCopyright`），这条语义**不变**。

### 5. 补齐 `BNavigation` / `BMapType` / `BOverview`，并修一个「假支持」

三个 kind 在 #22 已进 Driver 能力面，本 issue 开放组件面。写这三个组件时发现一处 `map-type` 的真缺口：

官方 4.0.4 的 `MapTypeControl` **唯一**的字段级 setter 是 `showStreetLayer(isShow)`，成员名不是 `set<Key>` 形状
——它落在「未知键 + 结构逃生口」里会被判成没有入口而**静默丢弃**。因此把它显式登记进分类表。

三个布尔选项的默认值也显式写出（`BMapType.showStreetLayer: true`、`BNavigation.showZoomInfo: true` /
`enableGeolocation: false`、`BOverview.isOpen: false`、`BPanoramaLabel.displayDistance: true`）：
Vue 对布尔 prop 有「缺省即 `false`」的转换（`resolvePropValue` 的 `isAbsent && !hasDefault`），
不给默认值会让「用户显式传 `false`」与「用户没传」变成同一个值——前者本该真的关掉路网层 / 距离显示，
却因为与默认值相同而**永远不下发**。

**关于「补齐 Geolocation」（issue 实施步骤 2 的措辞）**：核对后确认它**在开工时已经存在**
（`BLocation` 与 Driver 侧的 `GeolocationControl` 都是 #22 与既有实现的交付物，`git show HEAD:.../BLocation.vue`
有内容）。本 issue 对它是**迁移**（接进统一 spec）而不是补齐，真正的净新增是三个组件；
PR 正文里按此如实标注，不把已存在的交付项算成本轮成果。

**关于「将非 Stable 项标注 experimental」（实施步骤 6）——有意偏离**：本 issue 做的是**相反方向**的
一件事：`panorama.label` 的能力状态由 `experimental` 提升为 `native`。理由有两条：

1. Capability Catalog 的 `status` 描述的是**能力本身**（SDK 成员是否存在、本库如何映射），不是「组件 API
   稳不稳定」——它自本 issue 起有了真实消费者（组件经 `createLabel` / `addLabel` / `removeLabel` 映射官方成员），
   再标 `experimental` 等于说「这个槽位只登记、没落地」。
2. issue 的验收标准要的是「**文档明确 Stable 与 experimental 范围**」——对使用者可操作的那份范围是
   **发布范围**（Stable / post-stable），它写在 `docs/zh-CN/components/panorama/index.md` 的范围表里，
   与 Stable 控件分成两条互不阻塞的节奏（实施步骤的意图）。把这个意图落在 catalog 的 `status` 上会把
   「能力是否原生」与「组件是否 Stable」两件事混成一个字段。

### 6. 全景：`PanoramaContext` 独立于 `MapContext`，组件只管受控写入

新增 `src/core/panorama/`（Context + 可检查的收窄点 `jsapiV4PanoramaOf`）、`BPanorama` / `BPanoramaLabel`、
`usePanoramaService`。三条口径：

- **不复用 `MapContext`**（issue 的非目标：「不把 Panorama 内部 Map 当成普通 MapContext」）。查看器有独立的
  容器与生命周期（`Panorama#destroy`），既不挂在 Map 上也不受地图的暂停/重试策略管辖；合成一个 context 会让
  「在 `<BMap>` 子树里放一个 `<BPanorama>`」这种合法组合出现两个互相矛盾的 `whenReady()`。
  `<BPanoramaLabel>` 由此只认 `PanoramaContext`，脱离 `<BPanorama>` 明确失败。
- **命令面与 `<BMap>` 的受控写入同源**：`point` / `id` / `pov` / `zoom` / `visible` 变化即下发；
  `options` 构造期给一次、之后经 `setOptions()` 写回。官方的 `*_changed` 事件**不带载荷**，
  载荷由组件回读 getter 补齐（这也是读取面存在的真实理由，不只是「给调用方看」）。
- **全景事件走 Facet 自己的原样订阅**（`PanoramaViewerDriver.on`），不复用共享的 `EventDriver.on()`：
  后者按 **Map 事件**形状归一化（`normalizeDriverEvent` 重建 `{type, point, pixel, size, zoom, mapType…}`），
  会把 `dataload.data` / `pano_error` 这类载荷**丢掉**；而按事件名放行特例等于在共享契约里塞分支。
  `destroy()` 会兜底释放这条路径上的订阅。

### 7. 销毁顺序与「未加载场景的 destroy 抛错」

`<BPanorama>` 在 **`onUnmounted`**（而不是 `onBeforeUnmount`）里销毁查看器：父的 `onUnmounted` 晚于子树，
因此 `<BPanoramaLabel>` 先把自己从查看器上摘掉，再由父销毁——反过来会让子组件对已销毁的查看器调用
`removeOverlay`（与 #29 的 KeepAlive/dispose 顺序同源）。

官方 4.0 的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（#23 的真实 AK smoke 记录）。
组件路径的处置是：先尽力 `destroy()`，失败**只告警不抛错**（卸载流程里抛异常没有任何人能接），
本库自己的资源照常释放。

### 8. `visible` 的语义变化与控件「重复挂载」都进 `breaking-changes`

`visible` 从「摘挂载」改为「显隐」是**行为变更**（现有测试断言的就是摘挂载），因此写进
`docs/zh-CN/guide/breaking-changes.md`，并保留 `BCopyright` 的原有语义作为对照。

### 9. 能力矩阵：`panorama.label` 由 `experimental` 提升为 `native`

它自本 issue 起有真实消费者（组件经 `createLabel` / `addLabel` / `removeLabel` 映射官方成员），不再是
「只登记、没落地」的槽位。**组件 API 的稳定级别是另一件事**：Panorama 属 **post-stable**，范围表写在
`docs/zh-CN/components/panorama/index.md`，与 Stable 控件分开。

## 后果

- 正面：八份重复的控件生命周期收敛成一份 spec；`anchor` / `offset` / visible / 选项更新四条路径都有统一口径
  与统一断言（行为门禁在 10 个 Stable 控件上各跑一遍）；`controls.setOptions` / `show` / `hide` 从死代码
  变成被消费的入口；全景有了可用的 Context / 组件 / 检索层，且与地图的边界可断言。
- 负面 / 成本：控件的 `visible` 行为变更（迁移表已写）；`useControlResource`（`./core` 子入口）签名从
  `(props, adapter)` 变为 `(props, spec)`，`buildControlOptions` / `bindControlEvents` 两个无消费者的帮手删除
  ——自建控件的调用方需要按 `ControlSpec` 重写（beta 内允许直接变更）；Fake v4 新增 `MapTypeControl` 的
  `showStreetLayer` 观测点、全景读取面 / 标注替身与 `panoramaLabels` 泄漏计数；`scripts/generate-manifest-artifacts.mts`
  的 `toPath` 从手写表改为从 manifest 的 `source` 派生（见「已知限制」）。
- 回滚：删除 `src/core/controls/**`、`src/core/panorama/**`、`src/components/panorama/**`、
  `usePanoramaService.ts` 与三个新控件组件即可；`ControlDriver.planOptions` 与
  `CONTROL_OPTION_SPECS.map-type.showStreetLayer` 是纯增量，`dist` 不含 `driver/**` 与 `core/**` 之外的
  私有实现，回滚不影响发布产物形状（`check:public-dts` 会断言）。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 控件 `visible: false` | 由「摘挂载」改为 `hide()`：控件仍挂载、只是不可见 | 见 `breaking-changes`；需要「不挂载」用 `v-if` |
| 控件 `anchor` / `offset` 变化 | 由「无效果」改为即时下发（成对写） | 无需改动；见各组件文档 |
| `BCopyright.visible` | **不变**（版权项级） | 无需改动 |
| `ControlDriver.planOptions` | 公共接口新增成员 | 自定义实现需补一个方法（beta 内） |
| `ControlOptionStatus` | 新增公共类型 | 新增导出 |
| `map-type.showStreetLayer` | 由「静默丢弃」改为就地 `showStreetLayer(isShow)` | 修复 |
| `useControlResource`（`./core`） | `(props, adapter)` → `(props, spec)`；两个帮手删除 | 自建控件按 `ControlSpec` 重写 |
| 控件组件的 props | **一个都没变**（既有 8 个组件的 props 表与 d.ts 不变） | 无需改动 |
| `BPanorama` / `BPanoramaLabel` / `usePanoramaService` | 新增（post-stable） | 需要时使用 |
| `PanoramaViewerDriver` | 大幅扩面（读取 / 写入 / 标注 / 原样订阅）；`create` 的 options 由 `Record<string, unknown>` 收窄为 `PanoramaOptions` | 直接调 Driver 的高级用法按新签名调整 |
| `panorama.label` 能力状态 | `experimental` → `native` | 能力矩阵与 docs catalog 已重生成 |

## 非目标

- 不实现控件级的 Capability 探测（#22 ADR §11 的「控件不进 Catalog」保持不变）。本 issue 交付的是
  **option 级**的更新口径查询（`planOptions`），与 family 划分无关。
- 不为控件加 pointer / 交互类能力（`getCityName`、`changeView`、`showStreetLayer` 之外的成员按需再补）。
- 不给全景加 pointer 事件（`click` / `dblclick` / `link_click`）：它们的官方载荷是 `MouseEvent | TouchEvent`，
  需要与 `<BMap>` 的 `MapPointerEvent` 同一套归一化设计，属后续票。
- 不暴露 `Panorama#capture()` / `clearOverlays()`：官方成员，但当前没有消费者（「声明了但没人读」与
  「假支持」是同一类问题）。
- 不重做 `BCopyright` 的共享模型（按 anchor 复用的模块级缓存保持不变）。

## 已知限制（显式接受）

1. **`BCopyright` 的共享缓存在 `anchor` 移动后不会重新入桶**：`anchor` 变化时会经 `setAnchor()` 把共享
   实例挪位，而桶的键是**创建时**的 anchor。触发条件是「同一 anchor 的组件改 anchor，而之后又有新组件
   挂到旧 anchor」——与新组件的内容会显示在被挪走的那个控件上。改动前这条路径**完全没有效果**
   （anchor 不动态更新），因此本 issue 是净改善；彻底修好需要重做共享模型（非目标）。

   顺带修掉的另一处（不在已知限制里）：缓存原先的键**只有 anchor**，于是同一页面上的两个 `<BMap>`
   （两个 Client）会复用同一个句柄——而句柄所有权绑定创建它的 Client，跨 Client 使用会被注册表判成
   `BMAP_HANDLE_FOREIGN`，第二个 Client 下的 `<BCopyright>` 直接建不出控件。**这是新增的
   「`BCopyright` 并入统一 spec 门禁」用例抓出来的**：门禁把它列进 `STABLE_CONTROLS` 之后，
   用例之间换 Client 就复现了。现在缓存改成按 Client 分桶的 `WeakMap`。
2. **`Panorama#destroy()` 在未加载场景时失败**：组件只告警不抛错，本库资源照常释放。
   官方没有「无场景也能安全销毁」的入口，不为此发明一套补偿。
3. **全景的 `options` 是整体写回**：`setOptions()` 是官方唯一的整体入口，键的变化粒度只到「有没有变」
   （`albumsControlOptions` 用 JSON 比较），不做深 diff。
4. **`BCopyright` 文档里的默认 anchor 与实际不一致**：文档写 `BMAP_ANCHOR_BOTTOM_LEFT`，代码里
   `withDefaults` 给的是 `BMAP_ANCHOR_BOTTOM_RIGHT`。这是**改动前就存在**的文档缺陷，本 issue 顺手把代码里的
   死分支（`p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT"`，永远走不到）收敛到与 `withDefaults` 一致，
   但**不动文档**——修正默认值文档属于独立的、面向使用者的变更。
5. **控件真实运行时的一条限制未在真机复验**：`show()` / `hide()` 在真实 4.0 的各控件上都存在（#22 的 smoke 只
   核对了 `zoom` / `scale`），`PanoramaControl` 继承自 `Control`（类型包声明如此，Driver 仍按结构性调用处理）。
   本 issue 的浏览器 smoke 只覆盖 Fake 档的同名语义。

## 参考

- issue #41 `[M7] 建立 ControlSpec、常用控件与 Panorama 基线`、追踪 #12
- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4`：`control/*.d.ts`、`panorama/*.d.ts`、`const/Anchor.d.ts`
- 官方参考实现 `huiyan-fe/react-bmap`（其 `createControlComponent` 的 `optionProps` / `ctorOnlyProps`
  与本库 Driver 的 `mutable` / `recreate` 是同一件事，逐项对照写在 §2 / §4 / §5）
- 代码：`src/core/controls/**`、`src/core/panorama/**`、`src/components/controls/**`、
  `src/components/panorama/**`、`src/composables/usePanoramaService.ts`、
  `src/driver/jsapi-v4/{controls,panorama}.ts`、`src/driver/types/{controls,panorama}.ts`
- Fake 与测试：`packages/test-utils/fake-bmap-v4/{controls-layers,panorama,diagnostics}.ts`、
  `tests/behavior/{v3-controls,v3-panorama}.test.ts`、`packages/baidu-map-gl-vue/src/core/composables/useResourceTeardown.test.ts`
