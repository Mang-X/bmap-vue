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

**diff 基线是「逐键值快照」而不是选项对象**（`optionSnapshot()`，见 `optionKey.ts`）：`offset` / `size` /
`mapTypes` 这些键的值是父级传入的**同一个引用**，把选项对象当基线会让父级的原地修改
（`offset.x = 21`）把基线一起改掉——watch 源**能**感知（`optionKey` 递归跟踪到 `x` / `y`），但 diff
两边序列化完全相同 ⇒ 判成「没变化」⇒ 更新被静默吃掉（#95 评审第 2 轮 P1）。快照在建立的那一刻
把值固定下来，与后续引用变化彻底解耦；它与 watch 源共用同一套取值口径，因此不会出现
「watcher 说变了、diff 说没变」的分歧。适配器与 `BPanorama` 的构造期基线都用这一手法。

### 2. 「就地更新」还是「重建」由 Driver 的 `planOptions()` 说了算，组件不维护第二张表

`ControlDriver` 新增：

```ts
planOptions(control: ControlHandle, keys: readonly string[]): Record<string, ControlOptionStatus>;
// ControlOptionStatus = "live" | "recreate" | "unsupported"
```

三态而不是二态：「本引擎没有入口」与「有入口但只能构造期生效」对调用方是两件不同的事——
前者重建也没用（值会被静默丢弃），后者重建就能生效。合并它们会让 adapter 对着一堆无用重建反复创建控件。

**三态的判据在评审第 3 轮收紧过一次**（这一点容易写错，写在这里）：`unsupported` 的唯一依据是
**「连构造期也到不了」**，而不是「没有就地 setter」。4.0 的构造选项是**原样透传**的（`projectOptions`
只归一化 anchor / offset / `value: "size"`），所以「未命中分类表 + 实例上没有 `set<Key>`」的键依然
可能在构造期生效 ⇒ 属于 `recreate`。v4 上真正 `unsupported` 的只有两类：`custom`（`createCustomControl`
只接收 `anchor` / `offset` / `render`）与裸 `"control"` 句柄（认不出种类就不授权重建）。把两者混为一谈
会让调用方二选一地犯错：丢掉本可生效的键，或对没有入口的键做无效重建。

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
- **两个例外**（都是「就地改」表达不了的东西）：
  - `copyright.anchor` 是**构造期项**——版权控件的实例按停靠位置**共享**，就地 `setAnchor()` 会让实例与
    它服务的 anchor 脱钩（后续同 anchor 的组件找不到它、另建一个，同一位置出现两个控件）。变化时重建，
    由 `BCopyright` 的 create/mount/unmount 完成「离开旧共享组 → 加入目标共享组」的迁移；
  - **任何选项从有值变回 `undefined`** 也走重建（语义是「回到 SDK 默认值」，而默认值只存在于构造期）——
    就地写的话 `setOptions` 会按「没有值」跳过，既不生效、又因为 `applied` 已前移而**永不重试**。

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

1. **（已在评审第 1 轮修掉，留档）** `BCopyright` 的共享缓存曾有两个身份缺陷，现在是「按
   **Client + 创建时 anchor** 分桶 + anchor 变化走重建迁移」：

   - 键最早**只有 anchor**（不含 Client）：同一页面两个 `<BMap>` 会复用同一个句柄，而句柄所有权绑定创建
     它的 Client，跨 Client 使用被注册表判成 `BMAP_HANDLE_FOREIGN` ⇒ 第二个 Client 下的 `<BCopyright>`
     直接建不出控件。**这是「把 `BCopyright` 并入统一 spec 门禁」这条改动抓出来的**（用例之间换 Client
     即复现），修法是 `WeakMap<客户端, Map<anchor, handle>>`。
   - 接着**允许 `anchor` 就地 `setAnchor()`** 又制造了第二个缺陷：实例被挪位后仍挂在旧桶上，卸载时按
     「当前 anchor」删桶会删掉**目标** anchor 上别人的条目，于是同一位置出现两个控件（#95 评审 P1）。
     修法是三条一起：Driver 把 `copyright.anchor` 判成构造期项（变化即重建，重建路径天然完成共享组
     迁移）、组件卸载按**创建时**的 anchor 退出共享组、缓存删除加「桶里的确实是本实例」的身份校验。

   残余（不在本 issue 范围）：共享缓存是**模块级**的，因此它按 Client 分桶但仍然跨组件实例共享；
   这不影响正确性（同一 Client 内共享是本意），只是提示「两个独立打包的库副本」不会共享缓存
   ——那属于同一类的进程级共享状态问题，与 #42 对插件作用域的处理同源。
2. **`Panorama#destroy()` 在未加载场景时失败**：组件只告警不抛错，本库资源照常释放。
   官方没有「无场景也能安全销毁」的入口，不为此发明一套补偿。
3. **`optionKey` 对函数值按「存在性」比较**（换一个回调不算变化）：与官方参考实现
   `huiyan-fe/react-bmap` 的 `stableStringify` 同口径（同样 `typeof value === 'function' → 'fn'`），
   理由是不这么做的话「父级在模板里传内联箭头函数」会让 `recreate` 类回调选项**每次渲染都重建控件**。
   代价是**回调选项更新不会被下发**，因此 `ControlSpec.options()` 不应承载需要在运行期更新的回调
   （要新闭包请走 `spec.events`，或由组件自己维护稳定代理）。当前没有任何控件把函数值放进 `options()`
   （`BControl` 的 DOM 工厂走 `spec.render`），契约写进 `optionKey` 的文件头并用用例钉住；
   将来真要让某个组件暴露回调选项，需要先补一层稳定代理（或对该键改用身份比较）。
   （顺带自查修掉：`undefined` 与 `null` 原先合并成同一个键——参考实现明确区分两者，而本 Driver 对
   「没传这个键」与「显式传 null」也确实走不同路径，合并会把后者当成没变化而吃掉。）
4. **全景的 `options` 是整体写回**：`setOptions()` 是官方唯一的整体入口，键的变化粒度只到「有没有变」
   （`albumsControlOptions` 用 JSON 比较），不做深 diff。
5. **`BCopyright` 文档里的默认 anchor 与实际不一致**：文档写 `BMAP_ANCHOR_BOTTOM_LEFT`，代码里
   `withDefaults` 给的是 `BMAP_ANCHOR_BOTTOM_RIGHT`。这是**改动前就存在**的文档缺陷，本 issue 顺手把代码里的
   死分支（`p.anchor ?? "BMAP_ANCHOR_BOTTOM_LEFT"`，永远走不到）收敛到与 `withDefaults` 一致，
   但**不动文档**——修正默认值文档属于独立的、面向使用者的变更。
6. **控件真实运行时的一条限制未在真机复验**：`show()` / `hide()` 在真实 4.0 的各控件上都存在（#22 的 smoke 只
   核对了 `zoom` / `scale`），`PanoramaControl` 继承自 `Control`（类型包声明如此，Driver 仍按结构性调用处理）。
   本 issue 的浏览器 smoke 只覆盖 Fake 档的同名语义。

## 外部评审轮次记录（PR #95，基线 `e54d6fe`）

评审给的是 **2 个 P1 + 2 个 P2**。四条都先在仓库里写成**会红**的用例（同一次运行 4 条红）再修：

| 发现 | 复现结果 | 处置 |
| --- | --- | --- |
| P1-1 动态改 `anchor` 污染版权控件的共享缓存 | **确认**：A 从 `TOP_LEFT` 移到 `BOTTOM_RIGHT` 后与 B **不共享**（同一位置两个控件）；此时卸载 A 还会按「当前 anchor」删掉 B 的桶 → 第三个实例再建一个 | §3 的两个例外之一：Driver 把 `copyright.anchor` 判成构造期项（变化即重建，重建路径天然完成共享组迁移）；`BCopyright` 卸载改用**创建时**的 anchor 退出共享组；缓存删除加身份校验（`bucket.get(anchor) === control`）。补 2 条回归用例（移动后共享 + 移动后第三实例仍复用） |
| P1-2 live option 从有值变回 `undefined` 时 SDK 状态不恢复 | **确认**：`BNavigation.type` 设过 `SMALL` 后再传 `undefined`，既没有下发、也没有重建（`applied` 已前移 ⇒ 永不重试） | `applyOptions` 的重建判据从「任一键是 `recreate`」扩成「任一键是 `recreate` **或值变回 `undefined`**」——后者即「回到 SDK 默认值」，用重建交给构造期，不需要维护第二份默认值表。补回归用例 |
| P2-3 `optionKey` 折叠函数会吃掉 callback 更新 | **确认语义属实，但不改判据**：函数按存在性比较是**刻意的**，与官方参考实现 `huiyan-fe/react-bmap` 的 `stableStringify` 同口径——若按身份比较，模板里的内联箭头会让 `recreate` 类回调选项每次渲染都重建控件 | 保留折叠，把契约写进 `optionKey` 文件头与 `ControlSpec.options()`、用一条 pin 用例钉住、登记进「已知限制」第 3 条（并写明「将来暴露回调选项前必须先补稳定代理」）。**没有**改成身份比较，理由与代价都在正文 |
| P2-4 `BPanorama.options` 在 viewer 异步 ready 前变化会永久丢失 | **确认**：延迟 Provider 下在等待窗口里改 `options`，ready 后 `viewer.options` 仍是 `{}`（构造期那份） | `BPanorama` 记住**传给构造期的那份** `options`，在 ready 收敛时按同一份变化键比对、变了就补一次 `setOptions`。补回归用例（延迟 Provider 覆盖该窗口） |

同轮**自查新增**（不在评审清单里，读参考实现时发现）：

| 发现 | 处置 |
| --- | --- |
| `optionKey` 把 `undefined` 与 `null` 合并成同一个键，而参考实现明确区分两者、本 Driver 也确实对「没传这个键」与「显式传 null」走不同路径（`projectOptions` / `setOptions` 跳过 `undefined`、把 `null` 交给结构逃生口） | 分开标记，并改掉原来那条断言「两者得到同一个键」的用例（它编码的是错的契约） |
| `BPanorama` 的 `options` 变化键是内联在 watcher 里的一份字面量数组，收敛判断需要复用它 | 抽成 `optionsKeyOf()`，watcher 与就绪收敛共用一份判据 |

同轮的反证（改坏 → 必须红）：把 `copyright.anchor` 的分类改回 `live` → 2 条共享组用例红；把「值变回 `undefined` ⇒ 重建」从判据里去掉 → `undefined` 回归用例红；在 `BPanorama` 里去掉落 ready 收敛 → 延迟 Provider 那条红。

## 外部评审轮次记录（PR #95 第 2 轮，基线 `67b5a31`）

上一轮 4 条**逐项复核通过**；本轮发现 1 个新的 P1（同样先写成会红的用例：3 条）。

| 发现 | 复现结果 | 处置 |
| --- | --- | --- |
| P1 `applied` 不是值快照，嵌套 option 的**原地修改**会被 watcher 检测到、又被 diff 静默吃掉 | **确认**（3 条）：`offset.x = 21` / `size.x = 200` / `mapTypes.push(3)` 三种原地修改都不下发。另用一条单测证明 watch 源**确实**跟踪嵌套字段（`optionKey` 递归读到 `x`/`y`），因此问题在 diff 而不在 watcher | 按评审建议把基线换成**逐键值快照**（`OptionSnapshot`：`键 → 该键取值的变化键`），与 watch 源共用同一套口径；`changedOptionKeys` 的首个入参类型收窄为快照（挡住「误传选项对象」这种写法）。顺带把重建判据写成**无缺口**的总括形式「只有 Driver 说 `live` 且值有定义才就地写，其余一律重建」——原判据漏了 `unsupported` 一类（既没写、又推进了基线 = 第三种静默丢更新），补了 1 条用例 |

同轮的连带修正（都是「同一族的键语义一起扫」扫出来的）：

| 发现 | 处置 |
| --- | --- |
| `BPanorama` 的构造期基线也持有对象引用（与 P1 同一手法） | 基线改成**序列化键** `createdOptionsKey`。诚实说明：这个变体在当前生命周线下**不可观测**（`context.mount()` 直到构造完成才 resolve，而构造读的是活对象，晚一点的改动本来就会被构造期看到），因此**没有回归用例**——写死成键只是不把正确性寄托在「那个窗口恰好是同一条同步续体」上 |
| 改这条基线时我引入了新缺陷：watcher 在查看器还不存在时也推进了基线 ⇒ ready 收敛以为「已经生效」而跳过（P2-4 的用例立刻变红） | 把 `onViewer()` 改成返回**是否真的执行**，只在真的下发成功时推进基线 |
| Fake 的 `FakeV4Panorama` 直接持有调用方传入的 options 引用（真实 4.0 是构造期读入） | 改为构造期拷一份。这让「组件到底有没有把新值重新下发」可观察——第 2 轮那个原地修改变体正是被这条「夹具比真实宽容」藏住的。补 1 条 Fake 保真用例（去掉拷贝即红） |

同轮的反证（改坏 → 必须红，**用退出码判定**）：把两个源文件退回 `67b5a31` → 3 条红（原地修改的三条）；重建判据退回旧形式 → 1 条红（`unsupported`）；去掉 Fake 的构造期拷贝 → 1 条红（Fake 保真）。

## 外部评审轮次记录（PR #95 第 3 轮，基线 `494eceb`）

上一轮的 P1 **复核通过**（`OptionSnapshot` / 原地 mutation / Panorama 基线与 Fake 保真都认可）；
本轮提 1 个**合并前收口**的 P2：`ControlOptionStatus.unsupported` 的公开语义与统一 adapter 的实现相反。

| 发现 | 复现/核对 | 处置 |
| --- | --- | --- |
| P2 公共契约自相矛盾：`driver/types/controls.ts` 定义 `unsupported` = 「本引擎没有该 option 的入口，**重建同样不会生效**」，而 adapter 上一轮的判据 `!appliesInPlace(key) ⇒ replace()` 让 `unsupported` **必然重建**；同一文件上方还留着「`unsupported` ⇒ 不写也不重建」的注释。第三方 Driver 若按公开契约返回 `unsupported`，会被迫在每次该 option 变化时销毁重建控件 | **两处都确认**：`useControlResource.ts:227` 与 `:256` 确实相反；另核对 `projectOptions()` 对未知构造选项**原样透传**，因此「实例没有 `setNope` 但构造器会收到」在语义上就是 `recreate`，不是 `unsupported` | 采纳评审的**方案 1**（改 Driver 的分类，而不是重定义 `unsupported`）：v4 的分类器只在**构造期也到不了**时报 `unsupported`（`custom` / 裸 `control` 句柄），其余未命中分类表的键报 `recreate` 并给出理由串；adapter 判据回到「`recreate` 或值变回 `undefined` 才重建」，并为 `unsupported` 的键**告警一次**（每个键一次），消掉「静默 no-op」。`driver/types/controls.ts` 与 `useControlResource.ts` 的注释同步改写，并写明「把『没有就地 setter』一律报成 `unsupported` 是错的」 |

同轮的测试调整（旧用例编码的是错契约，**改而不是删**）：

- `setOptions` 那条「未知键 ⇒ 告警 `没有 "x" 的字段级 setter`」改为断言新的 `recreate` 文案，
  并补一条 `planOptions` 断言；
- 新增驱动层用例：`custom` 控件上未知键 ⇒ `unsupported`；同时反向断言全部 kind 的 `anchor` / `offset`
  仍是 `live`；
- 行为层把「`unsupported` ⇒ 重建」改成「未命中分类表但构造期会收到 ⇒ `recreate` ⇒ 重建」，
  并**新增**「Driver 报 `unsupported` ⇒ 不重建 + 告警一次」（用自定义 spec 驱动这条公共抽象路径）。

反证（改坏 → 必须红，退出码判定）：分类器退回「未命中即 `unsupported`」→ **3 条红**；
adapter 判据退回「非 live 即重建」→ **1 条红**（`custom` 那条）。

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
