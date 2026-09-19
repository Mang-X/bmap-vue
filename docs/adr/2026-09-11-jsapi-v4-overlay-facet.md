# ADR 2026-09-11：v4 Overlay Facet（覆盖物构造 / mutable-recreate 分类 / InfoWindow 与 Target）

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A2-OVERLAYS`（issue #21，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-map-facet`](./2026-09-11-jsapi-v4-map-facet.md)、[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

`#19` 交付 v4 Driver 底座，`#20` 交付 Map Facet；`createJsapiV4Driver` 仍是「明确失败」的空壳。
第二个业务 Facet 是 Overlay：组件层（`BMarker` / `BLabel` / `BInfoWindow` / 矢量图形 / 高级覆盖物 /
`BContextMenu`）已经全部经 `driver.overlays.*` 走领域接口，但 v4 侧没有实现。

在写实现之前必须冻结四件容易写歪的事：

1. **「属性更新」在组件层是散落的形状探测**：`BMarker` 曾自己读 `raw.setIcon` 判断「能不能就地更新、
   否则重建」，同类判断在别的组件里还会重复出现——组件不该知道 SDK 构造器/实例成员形状；
2. **构造选项面很宽**：项目 option 接口带索引签名（逃生口），其中既有与 v4 同名的键、也有
   仅在构造期生效的键（`MarkerOptions.enableClicking`）、还有 v4 根本没有的语义
   （`Polyline` 无填充、`InfoWindow` 无 `setOffset`）；必须有统一的分类与处置口径；
3. **InfoWindow 不是普通 Overlay**：v4 由 Map 管理气泡（`map.openInfoWindow(infoWnd, point)` /
   `map.closeInfoWindow()`），不能 `map.addOverlay`；状态查询只能走公开的 `isOpen()` /
   `map.getInfoWindow()`，不能读私有字段；
4. **Target 与「本引擎没有运行时入口」的成员**：v4 只能把覆盖物挂到 Map；
   `Marker3D` / `MapMask` 在 4.0.4 类型包与官方参考里都没有声明。

## 决策

### 1. 交付 Facet，不提前装配（与 #20 一致）

- Overlay Facet 落在 `src/driver/jsapi-v4/overlays.ts`，导出 `createJsapiV4OverlayDriver(input)`
  （input：`rawSdk` / `geometry` / `capabilities` / `registry`）。
- **`createJsapiV4Driver` 继续抛 `BMAP_CAPABILITY_UNSUPPORTED`**：装配需要 Control / Layer / Service /
  Panorama（#22~#23），默认 cutover 是 M3A.3（#25）。
- 行为验证分两层：`src/driver/jsapi-v4/overlays.test.ts`（单元）与
  `tests/behavior/v3-jsapi-v4-overlays.test.ts`（共享契约 + 生命周期），后者手工组合 Facet。

### 2. 属性分类是**公共元数据**，不是各组件各写一遍

`src/driver/types/overlays.ts` 新增 `OVERLAY_DESCRIPTORS`（`Record<OverlayKind, OverlayDescriptor>`，
`as const satisfies`）：逐键声明 v4 构造 options 的键名、值归一化方式、字段级 setter 或成对开关，
以及更新策略：

| 策略 | 含义 | 依据 |
| --- | --- | --- |
| `mutable` | 实例上有值型 setter 或成对 `enable*`/`disable*`，就地更新 | 官方 4.0 方法表 + 4.0.4 `overlay/*.d.ts` |
| `recreate` | 只有构造选项，或实例上的 setter **不可安全使用**，必须重建实例才生效 | 例：`MarkerOptions.enableClicking`、`InfoWindowOptions.offset`、`CustomOverlayOptions.zIndex`；`MarkerOptions.anchor` 是「有 `setAnchor` 但要等异步标注模块加载」 |
| `unsupported` | 本引擎连构造选项都没有（或语义不在覆盖物上），必须换 API | 例：`Polyline` 无填充、`InfoWindow` 无 `setPosition`、`ContextMenu` 无宽度 |

分类的**类型约束**（不是文档约定）：`OverlayPropertySpec` 是判别联合——
`mutable` 必须带 `setter` **或** `toggle`（二选一），`recreate` / `unsupported` 必须带 `reason`；
`OVERLAY_DESCRIPTORS` 又用 `satisfies Record<OverlayKind, OverlayDescriptor>` 保证**穷举**：
新增一个 `OverlayKind` 而忘记分类会直接编译失败。

**同一个更新的两条入口必须共用一份参数计划**：`mutable` 的 `setter` 支持可选的 `valueArgs`
（值型 setter 的常量尾随参数，例：`CustomOverlay#setPoint(point, true)` 的 `true`）。
专用入口（`setPosition` / `setPath`）与通用入口（`setOptions`）都调用同一个
`applyFieldUpdate`，参数一律从描述符取——否则「同一次位置更新」会在两条路径上语义不同
（评审 P2-2 正是通用入口漏传 `true`，导致业务 DOM 被悄悄替换）。

`ctor`（官方构造器名）刻意写成**字面量**而不是从 Capability Catalog 派生：字面量让
`(typeof OVERLAY_DESCRIPTORS)[kind]["ctor"] extends keyof typeof BMap` 这条官方类型一致性断言成立
（见 §7）。两处的一致性由 `src/driver/jsapi-v4/overlays.test.ts` 的同源断言守住——
`descriptor.ctor` 必须等于 `CAPABILITY_CATALOG[capability].rawMembers[0]`，漂移会让测试失败。

`OverlayDriver` 因此新增一个查询入口：

```ts
updatePolicy(overlay: OverlayHandle, key: string): OverlayPropertyPolicy | undefined
```

它是组件判断「`setOptions` 还是重建」的**唯一入口**，取代 `if (typeof raw.setIcon === "function")`
这类形状探测（`BMarker` 已据此改写，见 §5）。

### 3. 构造选项投影：同名改写 + 位置参数剔除 + 逃生口透传 + 不支持要告警

`projectOptions(descriptor, options)` 的口径：

- 描述符里**有 `ctorKey`** 的键 → 改写成 v4 键名并按 `value`（`point` / `points` / `bounds` /
  `size` / `icon` / 原始值）归一化。`recreate` 键同样投影——「recreate」说的是**不能就地改**，
  不是「不能构造」。
- 描述符里 `ctorKey === null` 的键（`path` / `altitude` / `bounds` / `center` / `radius` /
  `content` / `position`）→ 是**位置参数**，已在各 `create*` 里显式传入，这里剔除，
  避免同一个值既走位置参数又进 options。
- 描述符**没有**的键 → 原样透传。项目 option 接口的索引签名本就是「v4 自身构造选项」的逃生口
  （`GroundOverlayOptions.type`、`PrismOptions.autoCenter`），删掉它会立刻打断现有组件。
- `unsupported` 的键 → **显式告警一次**并忽略，不透传也不静默（沿用 Map Facet §8 的「不静默降级」）。

`setOptions` 走同一份描述符：`mutable` → setter / 成对开关；`recreate` → 告警一次并**不就地改**
（把重建决定交给调用方）；`unsupported` → 告警一次；描述符里没有的键 → `set<Key>` 结构调用
（保留 webgl-v1 时代的逃生口），成员不存在时告警一次。

**声明层与运行时的偏差要能被看见**：`mutable` 是按官方类型给出的**声明**，若实例上没有该方法，
`setOptions` 会告警一次而不是静默 no-op——否则组件会以为「更新成功了」。

### 4. InfoWindow 用专用 API，状态只看公开入口

- `openInfoWindow(map, infoWindow, position)` → `map.openInfoWindow(infoWnd, point)`；
  **不给位置时**先尝试实例级 `InfoWindow#openInfoWindow()`（4.0.4 未声明，属运行时能力）并告警一次，
  都没有则抛 `BMAP_INVALID_ARGUMENT` 说明「4.0 要求给出打开位置」。
  真实 AK smoke 实测：**该方法在 4.0 运行时并不存在**（`InfoWindow.prototype.openInfoWindow` 为
  `undefined`），所以「不给位置」在真实环境里必然走到显式失败；保留结构性判断只是为了防运行时差异。
- `closeInfoWindow(infoWindow)` → `map.closeInfoWindow()`（官方**无参数**，关的是「这张地图当前
  打开的气泡」）。Driver 只维护「这个气泡是被哪张地图打开的」这一条**归属记账**（WeakMap），
  关闭前用公开的 `map.getInfoWindow()` 确认**不是别的**气泡，
  **不使用任何 SDK 私有字段判断打开状态**。
- **`current` 为空 ≠ 没打开**（真实 AK smoke 发现并修掉的一个真 bug）：4.0 的打开是**异步**的，
  `openInfoWindow()` 之后同一 tick 里 `map.getInfoWindow()` 仍是 `null`（实测 0ms 为 null、
  ~100ms 变成该实例）。修复前「open 后立刻 close」（组件里 `:open` 快速切回 `false`）会因为
  「当前气泡不是我们」而直接 return，气泡随后照样弹出。现在的判据是
  **「只有别的气泡正开着才不动手」**：`current && current !== raw` 才 return，
  `current` 为空时照常调用 `map.closeInfoWindow()`（没有气泡时它是 no-op，实测重复 close 不抛错）。
  `smoke v4` 的 `quickCase` 断言这条路径：open → 同 tick close → 800ms 后 `isOpen() === false`
  且 `map.getInfoWindow() === null`。
- `redrawInfoWindow` → `redraw()`（未打开时官方语义就是直接返回）。
- `add` / `remove` 收到 `info-window` 句柄时抛 `BMAP_INVALID_ARGUMENT`，点名「气泡由地图级 API 管理」，
  而不是把它当普通覆盖物 `addOverlay`。

### 5. 重建一次由 `useOverlayResource.applyOptions` 承接

`useOverlayResource` 新增 `applyOptions(options)`：按 `updatePolicy` 拆分——
`mutable` 与未知键合并成一次 `setOptions`，命中 `recreate` 则调用**一次** `rebuild()`。
`BMarker` 的 `icon`（mutable）与 `enableClicking`（recreate）两个 watcher 改为走它，
组件层不再出现 raw SDK 成员探测。

**为什么不是 `useSdkResource.ts`**（issue 的「预计变更区域」里提到它）：`useSdkResource` 目前
**没有任何消费者**（组件全部经 `useOverlayResource` / `useControlResource` / `useLayerResource`），
而它的 `replace()` 已经为每个实例 fork 独立的 child scope（「旧实例 scope 归零」这条不变式本就成立）。
在没有真实消费者时给统一底座加「分类驱动的更新」接口属于投机 API，因此把更新入口落在真实路径上，
`useSdkResource` 留到 #23 统一底座收敛时再评估。

### 6. Target：v4 只挂 Map，其它目标显式失败

`add` / `remove` / `attachContextMenu` / `detachContextMenu` 只接受 `target.kind === "map"`：
- `add`/`remove` → `map.addOverlay` / `map.removeOverlay`；
- 右键菜单 → `map.addContextMenu` / `map.removeContextMenu`（4.0 没有 Marker 级 `addContextMenu`）。

其余 target 抛 `BMAP_CAPABILITY_UNSUPPORTED` 并**告警一次**。刻意选「失败 + 告警」而不是
「回落到所属 Map」：`<BContextMenu>` 挂在 `<BMarker>` 下时回落到整图会让右键菜单在**地图任意位置**
弹出，是比「不生效」更难排查的行为变化；同时 `BContextMenu` 会 catch 挂载异常，因此必须靠 warn
保证可观测（见「迁移影响」与「已知限制」）。

### 7. 「类型包没有声明」的成员：结构性探测 + 缺失才失败

`Marker3D` / `MapMask` 在 `@baidumap/jsapi-v4-types@4.0.4` 里都没有**类声明**，官方参考
`references/*` 也没有对应章节（`Marker3D` 只出现在 `const/Marker3DShapeType.d.ts` 的文档注释里，
那条注释描述了 `new BMap.Marker3D(point, 100, { shape })` 的用法，但类型包里没有类本身）。

**真实 AK smoke 实测（见「真实 AK smoke 记录」）**：这两个构造器在 4.0 运行时**都存在**，
用本 Facet 能正常创建、挂载、摘除。因此处置是：

- `requireRuntimeCtor(kind, hint)` 按**结构**读命名空间：有就按结构创建（真实 SDK 会走这条），
  没有就告警一次并抛 `BMAP_CAPABILITY_UNSUPPORTED`，错误信息点名缺的是哪个构造器；
- 不新增 augmentation、不臆造类型声明、也不用 `callOptional` 把缺失吞成 no-op
  （沿用 Map Facet §4 对 `tilt-gestures` 的口径）；
- `driver/jsapi-v4/overlays.ts` 末尾的类型层断言把这两个 kind **显式排除**在「官方声明一致性」之外：
  `(typeof OVERLAY_DESCRIPTORS)[OfficialOverlayKind]["ctor"] extends keyof typeof BMap`。
  上游一旦补齐声明，断言失败，提醒把结构性查找收回 `namespaceCtor`；
- 失败分支的测试依据来自 **Fake v4 故意不提供这两个构造器**（那是唯一能覆盖该分支的手段）。

### 8. Rectangle / CustomOverlay 进入公共接口；CustomOverlay 的位置是必填参数

- `OverlayDriver` 新增 `createRectangle(bounds, options)` 与
  `createCustomOverlay(position, render, options)`（issue #21 的目标与范围要求这两类）。
  webgl-v1 同步实现（构造器按结构查找，BMapGL 缺成员时同样是结构化失败）。
- `createCustomOverlay` 把位置提为**必填位置参数**：v4 在 options 里读 `point` 且缺 point 直接拒绝，
  放进可选的 options 只会把这个错误留到运行时。
- `setPosition` 对 `CustomOverlay` 固定 `setPoint(point, true)`（只位移、不重建 DOM）：
  官方默认 `noReCreate = false` 会重建 DOM，从而丢掉业务 DOM 上的 listener / timer / observer。

### 9. 契约拆成两层（复用 Map 的做法）

- `runOverlayFacetContract`（新）：只需要 `overlays` + 一个 Map 句柄，因此 **v4 与 webgl-v1 都能跑**
  （webgl-v1 经 `runMapDriverContract` 调用）。覆盖每种基础覆盖物的 create/mount/update/remove、
  InfoWindow 专用 API、属性分类查询、非 Map 目标必须抛错。
- v4 独有的策略（扩展覆盖物往返、`destroyedWithOverlays` 释放顺序、覆盖物事件归一化、错误码）
  留在引擎自己的测试。

### 10. 编辑能力经分类元数据提供，不新增专用方法

实施步骤里的「补齐…编辑能力接口」由**属性分类 + `setOptions`** 承接：四类矢量图形与
`Rectangle` / `Circle` 的 `enableEditing` / `disableEditing` 在描述符里是 `mutable` 成对开关，
`setOptions(overlay, { enableEditing: true })` 即可开关，`updatePolicy` 可预判。
不新增 `enableEditing()` 之类的一比一方法：`OverlayDriver` 的非目标之一就是「不把官方覆盖物
方法一比一公开」，为 6 个 kind 各加一对方法只会把公共接口撑大而不增加表达力。官方参考里
「先 `addOverlay` 再 `enableEditing`」的时序要求因此由调用方负责（组件在 `addToMap` 之后才发更新）。

## 后果

- 正面：v4 有了可组装、行为可断言的 Overlay Facet；「属性分类」成为公共元数据，
  组件不再探测 SDK 形状；错误码把「InfoWindow 当普通覆盖物」「非 Map 目标」「本引擎没有该成员」
  三类典型误用变成可在边界断言的失败。
- 负面 / 成本：公共 `OverlayDriver` 新增 3 个成员（`createRectangle` / `createCustomOverlay` /
  `updatePolicy`），外部自定义实现需要补齐（beta 内允许直接变更）；`Fake v4` 增加 8 个构造器与
  Map 侧子资源容器（含 `destroyedWithOverlays` 诊断字段）；`useOverlayResource` 增加一个方法；
  `BMarker` 两处 watcher 改为策略驱动；图标雪碧图表在 v1/v4 各一份（刻意重复）。
- 回滚：删除 `overlays.ts` / Fake 增量与三处公共成员即可——Facet 未挂进 `createJsapiV4Driver`，
  回滚不影响默认 Client / 组件 / 发布产物（`dist` 不含 `driver/jsapi-v4/**`，由 `check:public-dts` 断言）。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `OverlayDriver` 新增 3 个成员 | 公共接口新增：自定义实现需补齐 | 两个内置引擎已实现（v1 的 `updatePolicy` 直接转发共享描述符） |
| `<BContextMenu>` 作为 `<BMarker>` 子组件 | v4 下菜单**不会**挂到 Marker（只能挂 Map），会告警一次并抛 `BMAP_CAPABILITY_UNSUPPORTED`，组件侧 catch 后菜单不弹出 | 需要 Marker 级菜单时用 4.0 的 `new ContextMenu({ marker })` 构造期绑定（需组件改传构造选项，属后续议题）；<br>#25 真实 smoke 后定夺 |
| `<BMapMarker3d>` / `<BMapMask>` | 真实 4.0 运行时**提供**这两个构造器（类型包无类声明），本 Facet 按结构创建 → 可正常挂载/摘除；只有运行时缺成员的 SDK 才会抛 `BMAP_CAPABILITY_UNSUPPORTED` | 无需改动；两者未进公共声明，消费者侧类型仍按 `OverlayHandle` |
| `<BInfoWindow>` 未传 `position` | v4 抛 `BMAP_INVALID_ARGUMENT`（实测运行时**没有** `InfoWindow#openInfoWindow`，没有可回退的路径） | 显式传 `position` |
| `<BInfoWindow>` 快速 `open → close`（同一 tick） | 4.0 的打开是异步的；修复后同 tick 的 `closeInfoWindow` 也能真正关掉（smoke `quickCase` 已验证） | 无需改动 |
| `Polyline` 的 `fillColor` / `fillOpacity` 在 v4 | 显式告警并忽略（Polyline 没有填充语义） | 改用 `Polygon` / `Rectangle` |
| `InfoWindow` 的 `offset` 运行期变更 | 归入 `recreate`：`setOptions` 不生效并告警 | 用 `applyOptions`（会自动重建一次），或在构造期给定 |
| `MarkerIconInput.printImageUrl` | v4 `IconOptions` 无对应项，构造时丢弃并告警 | 需要打印图时改用自定义 icon 的 `imageUrl` |
| `enableClicking` / `anchor` 等构造期属性变化 | 归入 `recreate`，经 `applyOptions` 重建一次；直接调 `setOptions` 只会告警 | 组件用 `applyOptions`；业务侧可先用 `updatePolicy()` 预判 |
| 非 Map 挂载目标 | 显式抛错（v4 `BMAP_CAPABILITY_UNSUPPORTED` / v1 `BMAP_SDK_CALL_FAILED`） | 组件只传 `{ kind: "map", handle }` |
| `CustomOverlay` 的 `setPosition` | 固定 `noReCreate = true`（只位移，不重建 DOM） | 需要重放 DOM 时业务自己重建覆盖物 |
| `destroy` 前必须先摘子资源 | 组件卸载路径（`plugins → controls → layers → overlays → map.destroy`）本就满足；直接使用 Facet 的调用方必须照做 | Fake 用 `destroyedWithOverlays` 把这条不变式变成可断言 |

## 非目标

- 不装配 Driver、不改默认 Client / Provider / 组件默认路径（#23/#25）。
- 不实现 Control / Layer / Service / Panorama Facet（#22~#23）。
- **不实现 Vue Teleport 与 InfoWindow 状态机**（issue 明确列为非目标）。
  > 已被 [ADR 2026-09-18](./2026-09-18-infowindow-host-and-ownership.md) 取代：detached host + Teleport、
  > ownership/reconcile 模型与每地图归属由 issue #32 交付。本 ADR 关于 `InfoWindow` **Driver 侧**的决策
  > （专用 API、`recreate` / `unsupported` 分类、归属账本）**仍然有效**，是被取代那条的边界。
- **不靠 deep watch / `stableStringify` 更新属性**：更新一律走字段级 setter 或显式重建。
- 不覆盖全部官方覆盖物：`GroundPoint` / `Symbol` / `PlaceDetail` / `PointCollection` 不在本 issue
  （issue 的「不承诺所有官方 Overlay 一次性覆盖」）。
- 不把官方覆盖物方法一比一公开（`setPositionAt`、`getBounds`、编辑事件表等按需再补）。
- 不为 `Marker3D` / `MapMask` 新增 augmentation，也不改 `driver/jsapi-v4/**` 的声明边界规则。
- 不改 `useSdkResource`（无消费者，见 §5）。

## 真实 AK smoke 记录（2026-09-11）

用 docs 站点示例里的 AK（`docs/examples/layer/panoramaCoverage.vue`）在真实 JSAPI 4.0 上跑通了
Facet：headless Chromium（WebGL，SwiftShader）+ 临时 Vite 页面直接 `import` Facet 源码，逐项断言
（临时 harness 未入库，跑完即删；AK 只经 URL 查询参数传入，不落盘）。

| 检查 | 结果 |
| --- | --- |
| 14 个 kind 的构造器是否存在（`BMap.<ctor>`） | **全部存在**，含类型包未声明的 `Marker3D` / `MapMask` |
| 描述符里声明为 `mutable` 的 setter / 成对开关在真实实例上是否存在 | **14/14 kind 零缺失**（逐个 spec 比对） |
| 12 类覆盖物 `add` → `remove` 的 `map.getOverlays()` 记账 | 每次 `+1 / -1`，**全部精确**（含 Marker3D / MapMask） |
| 字段级更新读回 | `marker.getTitle/getRotation/getOffset`、`polyline.getPath/getStrokeColor`、`polygon.getFillColor/getFillOpacity`、`circle.getRadius/getCenter`、`rectangle.getBounds`、`label.getContent`、`ground.getOpacity`、`prism.getAltitude`、`bezier.getControlPoints` 全部与写入一致 |
| `buildIcon`（对象形式 / 内置名称） | 产出真实 `BMap.Icon`，`imageUrl` / `imageOffset` / `imageSize` 键名与领域映射一致 |
| `CustomOverlay.setPosition` 是否重建 DOM | DOM 工厂调用次数：create 0 → add 1 → setPosition **1**（只位移，符合设计） |
| `InfoWindow` 专用 API | `openInfoWindow(iw, point)` → ~100ms 后 `isOpen() === true` 且 `map.getInfoWindow() === iw`；`closeInfoWindow(iw)` → `false` / `null` |
| `InfoWindow.prototype.openInfoWindow` | **不存在**（`undefined`）→ 「不给位置」必然抛 `BMAP_INVALID_ARGUMENT`（实测确认） |
| `closeInfoWindow` 幂等（未打开 / 重复 / 别人的气泡） | 未打开与重复调用不抛错；别人的气泡打开时不去关它 |
| 几何值对象双向互操作 | `Size{width,height}` / `Point{lng,lat}` / `Pixel{x,y}` / `Bounds{sw,ne}` 形状与 Fake 一致；`fromRawSize(map.getSize())`、`fromRawBounds(map.getBounds())` 正确 |

smoke 顺带确认的运行时事实（已回写到上文的决策里）：

- `BMap.Icons`（26 个语义图标 + `createIcon`）、`Symbol`、`GroundPoint`、`PointCollection`
  在 4.0 运行时**都存在**——内置图标表可以后续从 canvas 雪碧图切到官方 `Icons`（本次不改，属后续议题）。
- `BMap.VERSION` 在真实 v4 SDK 上是 `"gl"`（不是 `"4.0"`）：**不要**用它做 v4 版本判定。
- `map.getOverlays()` 会把**打开过的 InfoWindow** 计入，且 `closeInfoWindow()` 之后它仍留在列表里：
  真实 SDK 上不能用 `getOverlays().length` 判断「子资源是否摘干净」（那是 `Fake` 的
  `destroyedWithOverlays` 诊断字段要表达的事，两者不要混为一谈）。
- `CustomOverlay#setPoint(point, true)` 与 `setPoint(point)` 的差别是**真实**的：后者会重新调用一次
  业务 DOM 工厂（实测计数 1 → 2），前者不会。因此「只位移」必须显式传 `true`。
- `InfoWindow` 的连续打开请求：同一 tick 内 `open A` + `open B` 的结果是**后一个胜出**（B 打开、A 不打开），
  且此时调用 `map.closeInfoWindow()` 不会取消 B 的打开（3 轮 × 2 组实测一致）。

## 外部评审轮次记录（PR #61，基线 `7b51bc6`）

评审提出 4 个 P2 + 1 个待验证风险。逐条在仓库内先写**会红**的用例再修，其中一条的机制与评审假设不同：

| 发现 | 复现结果 | 处置 |
| --- | --- | --- |
| P2-1 重建期间的更新被 `applyOptions` 丢弃 | **确认**（`useOverlayResource.test.ts`：可控 Promise 卡住 create，窗口内的更新既没排队也没淘汰旧版本；3 条用例红） | 新增 `pendingApply`：实例未挂载时**合并**待应用更新，挂载后 `flushPendingApply()` 补跑一次；recreate 键补跑时会再触发一次重建 |
| P2-2 `setOptions({ position })` 与 `setPosition` 参数不一致（漏传 `true`） | **确认**（`domCreateCalls` 由 0 变 1） | 描述符新增 `valueArgs`（常量尾随参数），专用入口与通用入口统一走 `applyFieldUpdate`；真实 SDK 验证：修复后 DOM 工厂调用数 1 → 1 |
| P2-3 `marker3d` 描述符为空 → `setPosition` 报错 | **确认，但机制不同**：真实运行时**有**位置入口，只是 **`setPoint`** 而不是 `setPosition`（实测 `setPosition(point)` 把 116.42/39.93 写成 -43.87/84.65，`setPosition(lng, lat)` 直接抛 TypeError） | 描述符补 `position → setPoint`（**不是**评审建议的 `setPosition`）；真实 SDK 验证回读 116.42/39.93、116.43/39.94 |
| P2-4 `custom-overlay` 的 `offset`/`anchor`/`minZoom`/`maxZoom` 没有分类 | **确认**（`updatePolicy()` 返回 `undefined`） | 四项补为 `recreate`（构造期属性），并加分类断言与「告警一次」断言 |
| 风险：关 A 可能取消尚未打开完成的 B | **真实 SDK 未能复现**（同一 tick 开 A+B 后关 A，3 轮 × 2 组一致：B 正常打开、A 不打开；`map.closeInfoWindow()` 不取消挂起的打开） | 仍按建议加固：新增 `lastRequestedByMap`，只有「本 Driver 最后请求打开的气泡」才允许触碰地图；合成用例（Fake 的同步模型能表达该交错）留作不变式断言，单气泡快速开关不回归 |

同一轮还顺手修掉：`setPath` 与 `setPosition` 共用同一份参数计划（避免再次出现「两条入口参数不同」），
`map-mask` 这类没有 `path` 语义的 kind 调 `setPath` 现在显式抛 `BMAP_CAPABILITY_UNSUPPORTED`
而不是把 SDK 的缺方法错误冒出来。

### 第二轮（基线 `afed306`）

评审确认上一轮 4 个 P2 全部修好（含纠正「不能仅因 `Marker3D.setPosition` 存在就当它是正确入口」），
并把问题收敛到 `useOverlayResource` 的**更新补偿顺序**上。两条都在仓库内先复现：

| 发现 | 复现（红） | 处置 |
| --- | --- | --- |
| 复审 P2-1 挂载回调里产生的新更新被旧队列回放覆盖 | ✅ 确认（`lastAppliedOn(实例 #2)` 得到 `older-pending`，而 props 已是 `newest-from-attach`） | 队列改成**单飞 + while 排空**：`applyOptions` 只把值并入待办（同键后写覆盖先写），排空过程中新到的更新由**同一轮循环**继续消费 → 新值恒最后生效；首建路径同样处理（另有一条「首建期间排队 + 挂载回调推新值」的用例） |
| 复审 P2-2 同一批混合 mutable 与 recreate 时，mutable 只写进马上被移除的中间实例 | ✅ 确认（最终存活实例 #3 上没有任何 `title`） | `applyBatch` 改为「**先重建、再把 mutable 落到最终存活的实例**」；没有存活实例时整批保留待办，等下一次挂载重试 |
| （自审补充）`applyOptions` 的 await 语义 | 实测：若「在飞时也 await 那一轮」，5 个用例会挂成 5s 超时——被一次无关的异步创建卡住 | 语义显式化：**发起**排空的调用方 await 它跑完；已有排空在进行时立即返回（值已并入，会被那一轮消费） |

两轮之后 `useOverlayResource` 的更新语义可归纳为三条不变式：

1. **不丢**：实例未挂载时到达的更新合并待办，挂载后落；
2. **新值优先**：待办按键合并，且排空期间的新更新由同一轮继续消费，旧批永不覆盖新值；
3. **落到存活实例**：同一批含 recreate 时先重建，mutable 只写最终存活的那个实例。

### 第三轮（基线 `3b45f27`）

复审确认上一轮两条都已修好，只剩一处**合并方向**的漏洞：`applyBatch` 里「旧批次重新入队」的两处
表达式写成了 `{ ...(pendingApply ?? {}), ...batch }`，让**更早取出**的旧批次盖住等待期间到达的新值。

- 复现（红）：`applyOptions({ enableClicking: false, title: "older-from-batch" })` 触发重建（#2 在飞）
  → 期间 `applyOptions({ title: "newer-pending" })` 入队 → 显式 `rebuild()` 取代 #2（#3 在飞）
  → 先完成过期的 #2 → 旧批次重新入队并翻上新值 → 最终实例的 `title` 是 `older-from-batch`。
- 处置：抽出唯一的 `requeueStaleBatch(batch)`，展开顺序固定为「**已有队列在后**」
  （`{ ...batch, ...(pendingApply ?? {}) }`），两处调用点共用；并在注释里点明它与
  `applyOptions()` 的入队方向**相反**（那里 `options` 才是新到的更新）。补了对应回归用例。

## 已知限制（显式接受）

- **真实 AK smoke 覆盖面**：上面的 smoke 用 headless Chromium（SwiftShader）在单个 AK 上跑通，
  覆盖了构造/更新/加摘/InfoWindow/几何互操作；**没有**覆盖真实交互（拖拽、编辑顶点、右键菜单弹出位置）、
  多分辨率/多浏览器、以及 `Icons` / `Symbol` / `PlaceDetail` 这些不在本 issue 范围的成员。
  这些留在 M3A.3（#25）的浏览器验证里。
- **图标雪碧图重复**：`jsapi-v4/overlays.ts` 复制了 `webgl-v1/overlays.ts` 的内置图标表
  （同名同图同偏移），因为它们绑定了同一个 canvas 雪碧图资源；跨引擎抽取会让 #26 待删除的实现
  阻塞 v4 底座，故刻意保留两份，`#26` 删除 v1 时自然收敛。
- **`updatePolicy` 不校验句柄所有权**：它是纯元数据查询（读句柄品牌），跨 Client 的句柄在这里会得到
  同样的答案；真正的操作路径仍然抛 `BMAP_HANDLE_FOREIGN`。这样设计是为了让「查询分类」不需要
  先 resolve 一个可能已销毁的资源。
- **描述符是「声明层」分类**：官方类型给出「应该有 setter」而运行时没有时，`setOptions` 只能
  告警一次而不是换策略；真正的引擎差异需要在 #25 的 smoke 里发现并回写描述符。
- **webgl-v1 的 `setOptions` 不追平**：v1 仍是自己的 `switch` 实现（`#26` 待删除），
  只把 `updatePolicy` 转发到同一份描述符；因此「分类」在 v1 上只是元数据，v1 的就地更新路径
  仍可能静默 no-op。这条差异与「执行顺序」一起登记在这里，不由本次改动掩盖。
- **`<BContextMenu>` 的 Marker 目标在 v4 下不生效**：见「迁移影响」；组件侧的 `catch` 会吞掉异常，
  因此 Driver 额外 `warn` 一次保证可观测。
- **`setOptions` 对 `recreate` 键是「告警 + 不动」**：它没有返回值，调用方无法从调用本身知道
  「需要重建」——所以组件必须先问 `updatePolicy()`（或直接用 `applyOptions`）。这是刻意的：
  不改既有方法签名的前提下，「分类」只能在调用前查询。
- **「Target 切换先从旧目标移除再挂新目标」在 v4 组件路径上还没法验证**：这条不变式属调用方
  （`BContextMenu.attachTo` 先 detach 旧目标再 attach 新目标），而 v4 的组件装配是 M3A.3（#25）。
  本次在 webgl-v1 的组件路径上把它变成断言（`tests/behavior/v3-overlay-update-policy.test.ts`），
  v4 侧只断言 `add` / `remove` 的原子性（重复 add 不重复挂载、remove 后可重挂、非 Map 目标不产生
  半挂载）。#25 接通 v4 组件路径后应把同一条组件级断言在 v4 上重跑。
- **Fake 覆盖物写在 `packages/test-utils/fake-bmap-v4/objects.ts`**（issue 的「预计变更区域」写的是
  `FakeOverlay*.ts`）：该文件从 #19 起就是 v4 覆盖物替身的落点（文件头明确写了「覆盖物 Facet（#21）」），
  再拆文件只会让 `index.ts` 的导出与互相引用变复杂；`FakeMap`（视野/交互/投影/释放）已经单独成文件，
  「Map 是被测 facet」这一点没有被覆盖物埋掉。

## 参考

- issue #21 `[M3A2] 实现 JSAPI 4.0 OverlayDriver 与 mutable/recreate 描述`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 提交前的双轴自审（Standards / Spec 各一个子代理）逐条复现后修正：
  `Marker3D` 的来源表述收紧（类型包只有文档注释、没有类声明）、`recreate` 变体允许 `value`
  （原先 `value?: never` 与 `InfoWindowOptions.offset` 冲突，被 `as` 断言掩盖）、`setPosition` /
  `setPath` 的 setter 名改为从描述符派生、`closeInfoWindow` 不再删除归属记账、字符串路径
  （`isBoundary`）在 `setPath` 与 `setOptions({path})` 上口径统一、`useOverlayResource` 不再静默
  吞错、Fake 去掉未被调用的 getter 家族并让 `Circle` / `Rectangle` 不再继承 `path`。
- 真实 AK smoke 又发现并修掉一个**真 bug**：`openInfoWindow` 之后同一 tick 的 `closeInfoWindow`
  会因为 `map.getInfoWindow()` 仍为空而变成 no-op（4.0 打开是异步的）→ 判据改为「只有别的气泡
  正开着才不动手」；回归用例进 `src/driver/jsapi-v4/overlays.test.ts`，真实环境由 smoke `quickCase` 覆盖。
- 官方 4.0 API 参考：`BMap.Overlay` / `Marker` / `Label` / `InfoWindow` / `Polyline` / `Polygon` /
  `Rectangle` / `Circle` / `GroundOverlay` / `Prism` / `BezierCurve` / `CustomOverlay` / `ContextMenu` /
  `MenuItem` / `Icon` 与 `Map#addOverlay/openInfoWindow/closeInfoWindow/getInfoWindow/addContextMenu`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`overlay/*.d.ts`、`context-menu/*.d.ts`、`core/Map.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/marker.md`、`label-and-info-window.md`、
  `vector-overlays.md`、`advanced-overlays.md`、`controls-and-context-menu.md`
- 代码：`src/driver/jsapi-v4/overlays.ts`、`src/driver/types/overlays.ts`、
  `src/driver/webgl-v1/overlays.ts`、`src/core/composables/useOverlayResource.ts`、
  `src/components/overlays/BMarker.vue`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/{FakeMap,objects,index}.ts`、
  `packages/test-utils/driver-contract.ts`
