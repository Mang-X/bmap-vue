# ADR 2026-09-11：v4 Control / Layer Facet（停靠常量表 / option 更新分类 / 统一 addLayer 与 Target）

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A2-CONTROLS-LAYERS`（issue #22，追踪 #12）
- 取代：无
- 相关：[`2026-09-11-jsapi-v4-map-facet`](./2026-09-11-jsapi-v4-map-facet.md)、[`2026-09-11-jsapi-v4-overlay-facet`](./2026-09-11-jsapi-v4-overlay-facet.md)、[`2026-09-11-jsapi-v4-driver-foundation`](./2026-09-11-jsapi-v4-driver-foundation.md)、[`2026-09-10-bmap-raw-sdk-boundary`](./2026-09-10-bmap-raw-sdk-boundary.md)

## 背景

`#19` 交付 v4 Driver 底座、`#20` 交付 Map Facet、`#21` 交付 Overlay Facet；`createJsapiV4Driver`
仍是「明确失败」的空壳。第三个交付面是**控件与基础图层**：`BZoom` / `BScale` / `BCityList` /
`BLocation` / `BNavigation3d` / `BPanoramaControl` / `BCopyright` / `BControl` 与
`BDistrictLayer` / `BPanoramaCoverageLayer` 已经全部经 `driver.controls.*` / `driver.layers.*`
走领域接口，但 v4 侧没有实现。

在写实现之前必须冻结六件容易写歪的事：

1. **停靠位置在项目里是常量名，在 SDK 里是数值**：组件 props 传的是
   `"BMAP_ANCHOR_BOTTOM_RIGHT"`（webgl-v1 时代从 `window` 上取值），4.0 的 `Control#setAnchor`
   要的是官方 `0..8` 常量；而**控件只接受四角**，其它常量会被 SDK 静默回落到默认落点。
2. **kind 是能力面，句柄品牌原先不带 kind**：`ControlHandle` 只是 `SdkHandle<"control">`，
   于是 `setOptions` 无法区分「`overview.size` 有 `setSize`」与「`map-type.type` 只有构造期
   生效」——而 Overlay / Layer 句柄从 `#19` 起就带 `:<kind>`。
3. **kind 专属 setter 有时序**：真实 4.0 的 `NavigationControl#setType()` 在
   `addControl()` 之前调用会抛 `TypeError`（见「真实 AK smoke 记录」），不能假定
   「create 之后随时可以改」。
4. **图层的挂载入口在 4.0 变了**：4.0 用统一 `map.addLayer/removeLayer`（按原型家族标志位
   `isDistrictLayer` / `isTileLayer` 分发），`addDistrictLayer` / `addTileLayer` 已 `@deprecated`；
   而 webgl-v1 只有后者。
5. **`DistrictLayer` 的自动取景选项名字变了**：项目侧按 BMapGL 写 `viewport`，官方 4.0 声明是
   `autoViewport`；4.0 运行时**目前也接受** `viewport`（未声明的别名），所以这里既不能断言
   「历史名字会失效」，也不能把别名当契约。
6. **`PanoramaCoverageLayer` 与 `layer.panorama-coverage` 能力**：前者在 4.0 运行时公开、
   但在 `@baidumap/jsapi-v4-types@4.0.4` 里没有类声明；后者是 `LayerKind` 已有成员，
   却**不在 Capability Catalog 里**（`layer.district` 还被标成 `V4_ONLY`，而 webgl-v1 一直在实现它）。

## 决策

### 1. 交付两个 Facet，不提前装配（与 #20 / #21 一致）

- Control Facet 落在 `src/driver/jsapi-v4/controls.ts`，导出 `createJsapiV4ControlDriver(input)`
  （input：`rawSdk` / `geometry` / `registry`——控件不在 Capability Catalog 的六个 family 内，
  因此**不注入 capabilities**，见 §11）。
- Layer Facet 落在 `src/driver/jsapi-v4/layers.ts`，导出 `createJsapiV4LayerDriver(input)`
  （input：`rawSdk` / `capabilities` / `registry`）。
- **`createJsapiV4Driver` 继续抛 `BMAP_CAPABILITY_UNSUPPORTED`**：装配还需要 Service / Panorama
  （#23），默认 cutover 是 M3A.3（#25）。
- 行为验证分两层：`src/driver/jsapi-v4/{controls,layers}.test.ts`（单元）与
  `tests/behavior/v3-jsapi-v4-controls-layers.test.ts`（共享契约 + 生命周期），后者手工组合 Facet。

### 2. `ControlKind` 补齐 issue 列出的十个内置控件（组件面不在本 issue）

`ControlKind` 增加 `navigation` / `map-type` / `overview`（原有 `zoom` / `scale` /
`city-list` / `location` / `navigation-3d` / `panorama` / `copyright` / `custom` 不变），即
issue #22「目标与范围」逐条列出的控件集合：

| 领域 kind | 4.0 构造器 | webgl-v1 构造器 |
| --- | --- | --- |
| `zoom` | `ZoomControl` | `ZoomControl` |
| `scale` | `ScaleControl` | `ScaleControl` |
| `navigation` | `NavigationControl` | `NavigationControl` |
| `navigation-3d` | `NavigationControl3D` | `NavigationControl3D` |
| `city-list` | `CityListControl` | `CityListControl` |
| `location` | **`GeolocationControl`** | `LocationControl` |
| `map-type` | `MapTypeControl` | `MapTypeControl` |
| `overview` | `OverviewMapControl` | `OverviewMapControl` |
| `panorama` | `PanoramaControl` | `PanoramaControl` |
| `copyright` | `CopyrightControl` | `CopyrightControl` |

两点口径：

- **`location` 保持不变**：4.0 上统一写 `GeolocationControl`（官方 Skill：「新代码统一写后者」，
  运行时仍保留同实现的 `LocationControl`），但领域名是组件契约的一部分（`BLocation` 用的是
  `location`），本 issue 不为了对齐 SDK 拼写去改组件。
- **不新增 Vue 组件**：新增 kind 是**驱动能力面**；`BNavigation` / `BMapType` / `BOverview`
  以及声明式 `ControlSpec` 属 M7（#41）。这样既补齐了 issue 的范围，又不越界改组件公共 API
  （issue 的非目标之一）。webgl-v1 侧同步补齐（`CONTROL_CTORS` 是 `Record<…>` 类型，
  漏一个 kind 会直接编译失败）。

  > ✅ **已由 2026-09-17 / #41 承接**：三个组件与 `ControlSpec` 都已交付，且既有 8 个控件的
  > **props 表一个都没变**（只换了底层的生命周期实现）。见
  > [2026-09-17 控件统一 spec 与全景基线](./2026-09-17-control-spec-and-panorama.md) §1 / §5。

### 3. 控件句柄品牌补成 `control:<kind>`

`ControlHandle` 从 `SdkHandle<"control">` 放宽为**品牌带种类**的形式（`SdkHandle<"control" |
"control:<kind>">`），裸 `"control"` 仍合法（webgl-v1 与手工登记句柄用它），v4 与 webgl-v1 的
`create` / `createCustomControl` 都写 `control:<kind>` / `control:custom`——与 `OverlayHandle` /
`LayerHandle` 从 `#19` 起的做法同形。

品牌是 `setOptions` 给出正确更新口径的**唯一依据**（§5）：没有它就只能退回 webgl-v1 时代的
「按键猜 `set<Key>`」，把「构造期项」误当「可就地更新」。品牌为裸 `"control"` 时 Driver 只走
结构性逃生口（拿到不认识的句柄时不猜种类、不抛错）。

### 4. 停靠常量：Driver 内部字面量常量表，类型层钉在官方声明上

`anchor` 在项目里是**常量名**字符串。v4 Driver 用一张内部表换算成官方数值：

```ts
const ANCHOR_VALUES: Readonly<Record<string, OfficialCornerAnchor | OfficialCenterAnchor>> = {
  BMAP_ANCHOR_TOP_LEFT: 0, …, BMAP_ANCHOR_BOTTOM_CENTER: 8,
};
```

- **不读全局变量**（webgl-v1 的 `window[value]` 是迁移期做法）：Driver 边界只认 `rawSdk` 传入的
  命名空间，不读未经 Provider 校验的全局值（同 Map Facet §9 对 `MapTypeId` 的口径）。
- 表的**类型标注直接引用官方 `const/Anchor.d.ts` 的声明值**（`typeof BMAP_ANCHOR_*`），
  上游改值即编译失败；真实 AK smoke 另有一组「窗口全局实际数值 vs 本表」的逐项核对。
- 三种落点分开处理，避免把 SDK 的静默回落当成成功：
  - **四角**：正常换算；
  - **已知但非四角**（`TOP_CENTER` 等 5 个）：换算并**告警一次**（SDK 会回落到控件默认落点，
    官方「常见错误」列过这条）；
  - **完全不认识的名字**：无法换算 → 告警一次且**不透传**，控件沿用自身默认落点。
- **缺省不补默认值**：组件层 `withDefaults` 已经显式给出 `anchor`/`offset`（`BZoom` 的
  `BOTTOM_RIGHT` 等），Driver 再维护一份「每个控件的 SDK 默认落点」只会产生第二份真相
  （issue 风险条目「库应显式传递默认值，避免依赖 SDK 隐式配置」由组件层满足）。

### 5. option 更新分类是 kind 专属元数据，且 kind 专属 setter 有挂载前置条件

`CONTROL_OPTION_SPECS`（`Record<ControlKind, …>`，漏写一个 kind 会编译失败）逐键给出更新口径：

| 口径 | 含义 | 例 |
| --- | --- | --- |
| `mutable` + `setter` | 值型 setter | `scale.unit → setUnit`、`navigation.type → setType`、`overview.size → setSize`（`value: "size"`：项目 Pixel → 4.0 `Size`） |
| `mutable` + `choice` | 只有成对动作、没有幂等 setter | `city-list.expand → [open, close]` |
| `recreate` | 只有构造期生效 | `map-type.type` / `mapTypes`、`overview.isOpen`（4.0 只有 `changeView()` 的**切换**语义）、`city-list.trigger` 与各回调 |

- `anchor` / `offset` 是**公共**动态项（基类 `setAnchor`/`setOffset`），在 `setOptions` 里单独处理。
- `location`（`GeolocationControl`）的 option 是「**options 袋**」：4.0 只给整体
  `setOptions(options)`，没有一对一 setter，因此未命中分类表的键**整袋一次写回**（而不是按键
  逐次结构调用）。
- 未命中分类表、且该 kind 没有袋装入口的键 → 走 webgl-v1 时代的 `set<Key>` 结构性逃生口；
  成员不存在时**告警一次**（不静默）。
- 声明为 `mutable` 但实例上没有该方法时同样告警一次——「分类是声明层」这条偏差要可见
  （同 Overlay Facet §3）。
- **`recreate` 只告警、不动实例**，把「重建」的决定交给调用方（组件目前不调
  `controls.setOptions`，所以没有 `updatePolicy()` 之类的查询入口——不引入没有被消费的 API）。

  > ⚠️ **已被取代（2026-09-17 / #41）**：组件路径现在**会**调 `controls.setOptions`（统一
  > Control adapter 的 `live` 档），并且需要一个「哪些键只能构造期生效」的查询入口来决定是否重建。
  > 查询入口已按本文档留的线索补上（`ControlDriver.planOptions()`，与 `setOptions` **共用同一处分类**）。
  > 决定与全部依据见 [2026-09-17 控件统一 spec 与全景基线](./2026-09-17-control-spec-and-panorama.md) §2。
- **kind 专属 setter 要求控件已挂载**：真实 smoke 实测 `NavigationControl#setType()` 在
  `addControl()` 之前抛 `TypeError`。调用顺序因此是 `create → add → setOptions`（与覆盖物
  「先挂载再 `enableEditing`」同源）；Driver 不替调用方猜挂载状态，失败经 `sdkCall` 归一成
  `BMAP_SDK_CALL_FAILED`，不吞错。
- 该方法**结构调用的公共入口**同时承担 `show`/`hide`：`PanoramaControl` 由全景模块提供、
  不保证 `Control` 基类成员，缺成员时告警一次而不是让组件以为「调用成功了」。

### 6. add / remove 的记账与释放顺序

SDK **不保证** `addControl` / `addLayer` 去重（官方「常见错误」把「同一控件实例重复添加」列为
误用），因此 v4 的 Control / Layer Driver 共用 `createMountTracker()`
（`internal.ts` 的 `WeakMap<rawMap, WeakSet<rawChild>>`）：

- `add` 的 `claim()` 返回 false 时**不调用 SDK** → 「重复 add 只挂一次」；
- `remove` **不做**「是否挂过」的前置拒绝（SDK 对未挂载资源的移除是 no-op），只 `release()` 清记账
  ——按记录拒绝会让记账一旦漂移就永久挂不上；
- 重复 `remove` 因此天然幂等（共享契约对两个引擎都断言「重复 remove 不抛错、计数归零」）。

**释放顺序（issue 实施步骤 4）**：`useControlResource` / `useLayerResource` 的 `onUnmounted`
改成**先解绑业务事件、再由 Map 移除 SDK 资源**：

```ts
scope.dispose();                                   // 监听器 / watch / timer（业务事件都在 scope 里）
if (current && readyCtx) adapter.remove(current, readyCtx);
```

反过来的话，SDK 在 `removeControl` / `removeLayer` 期间同步派发的事件会打到已经开始拆解的业务
回调上（`BLocation` 的 locationSuccess/locationError、`BDistrictLayer` 的 click/mouseover/mouseout
都是经 `scope.add(...)` 注册的）。提前 `dispose` 是安全的：`adapter.remove(resource, context)`
只吃资源与 context，不读 scope。这条顺序无法从组件的外部行为观察，因此用
`src/core/composables/useResourceTeardown.test.ts` 的最小 MapContext 替身 + 记账适配器把它变成
可断言的事实（先跑红：旧顺序得到 `[add-to-map, sdk-remove, unbind]`）。

三个 Facet 的内部基元也随之收敛到 `internal.ts`（Overlay / Control / Layer 共用）：
`requireRuntimeCtor`（运行时扩展构造器的结构探测）、`createWarnOnce`、`createMountTracker`、
`createMapTargetResolver`。

### 7. 图层走 4.0 的统一入口；`viewport` → `autoViewport` 显式改名

- `add` / `remove` → **`map.addLayer` / `map.removeLayer`**（不是 deprecated 的
  `addDistrictLayer` / `addTileLayer`）；webgl-v1 仍走 BMapGL 的专用入口，差异由各引擎吸收。
- **`viewport` → `autoViewport`**：官方 4.0 只声明 `autoViewport`。真实 smoke 实测（含负对照）：
  不给该选项或给 `autoViewport: false` 时视野不变，给 `true` 时视野切到北京——**语义真实存在**；
  而 4.0 运行时**同时接受** `viewport`（未声明的别名）。因此这里不是「修静默失效」，
  而是不把未声明的别名当契约（别名一旦在升级中消失，表现会是「view 静默不取景」）。
  两键同时出现时以显式写下的 v4 键为准。
- 其余键原样透传（项目 option 接口是 `Record<string, unknown>`，索引签名就是 4.0 自身构造选项的
  逃生口：`adcode` / `onComplete` / `tileUrlTemplate`）。
- **每种图层一条描述符**（`LAYER_DESCRIPTORS`：`ctor` / `declared` / `mutable` / `aliases`），
  而不是「构造器表 + 声明集合 + 分类表」三张并列的表：`declared` 同时决定「能否用
  `namespaceCtor`」与「未命中键是构造期告警还是结构逃生口」，写在一条记录里就不会互相漂移，
  文件末尾的类型断言也直接从它派生（`declared: true` 的 kind 的 `ctor` 必须 ∈ `keyof typeof BMap`）。
  `DistrictLayer` 的 option 全是构造期项 → `setOptions` 告警一次并把重建决定交给调用方；
  `TileLayer` 只有 `zIndex → setZIndex` 可就地更新；`panorama-coverage`（`declared: false`）的
  未命中键走结构逃生口。
- **`PanoramaCoverageLayer` 按结构探测**：`internal.requireRuntimeCtor` 有就创建、没有就告警一次
  并抛 `BMAP_CAPABILITY_UNSUPPORTED`（不臆造 augmentation、不静默降级，与 Overlay 对
  `Marker3D` / `MapMask` 同源）。
- **能力守卫先于构造**：`capabilities.require(...)` 在 `new Ctor(...)` 之前调用，因此
  `unsupported: "throw"` 策略下不会产生「创建好但没人用」的实例；`warn` / `silent` 策略下
  **按设计继续构造**（策略是调用方的选择，不是本 Facet 的静默吞错），三种策略都有测试。

### 8. 版权控件：传对象字面量，并回读 `bounds`

- `addCopyright` 传 `{ id, content, bounds? }` 对象字面量——官方 `CopyrightControl` 的 `@example`
  就是这么用的（类型包把参数写成结构等价的 `Copyright`，两者不冲突；`new Copyright(id, bounds, content)`
  反而要求 `bounds` 位置参数，会把「无 bounds」的版权项逼成「臆造一个空 Bounds」）。
  真实 smoke 已验证对象字面量可回读。
- `listCopyrights` **回读 `bounds`**：`BCopyright` 的更新路径会带着旧 bounds 重新 `addCopyright`，
  丢掉它就是「内容变了但适用范围变回全局」。webgl-v1 的 `listCopyrights` 只回读 `id` / `content`
  （差异登记在「迁移影响」里，随 #26 消失）。

### 9. 两个引擎的 target 语义在本次统一

issue 的实施要求包含「统一 add/remove、options、visible、target 语义」。webgl-v1 侧的控件 /
图层原先对非 Map target **静默 no-op**（`callOptional` 吞掉），本 issue 改成显式拒绝：

| 引擎 | 错误码 | 说明 |
| --- | --- | --- |
| jsapi-v4 | `BMAP_CAPABILITY_UNSUPPORTED` | 「该 target 在 4.0 没有运行时入口」 |
| webgl-v1 | `BMAP_SDK_CALL_FAILED` | 迁移期差异，契约只断言 `toThrow()` |

同时修掉 webgl-v1 的一个真 bug：`LayerKind` 为 `tile` 时落到 `map.addLayer`——BMapGL **没有**
这个方法，`callOptional` 让它变成静默 no-op。现在 `tile` / `panorama-coverage` 都走
`addTileLayer`（BMapGL 里 `PanoramaCoverageLayer` 就是 `TileLayer` 子类），`district` 走
`addDistrictLayer`。

### 10. 契约拆成两层，并新增**挂载计数**harness

- `runControlFacetContract` / `runLayerFacetContract`（新）：只需要对应 facet、一个 Map 句柄与
  `attachedCount()`，因此 **v4 与 webgl-v1 都能跑**。覆盖：十个 kind 的 `create → add →（重复 add）
  → show/hide / setOptions → remove →（重挂）`、自定义控件、非 Map 目标必须失败。
- **挂载计数放在 harness 一侧**（各引擎用自己 Fake 的记账实现：v4 读 `rawMap.controls` /
  `rawMap.layers`，webgl-v1 读 `fakeMap.controls` / `fakeMap.overlays`）。契约因此能断言
  「重复 add 只挂一次」「remove 之后计数归零」这类**语义**，而不是只断言「不抛错」。
- v4 独有的策略（anchor 换算与告警、option 分类、版权 `bounds`、能力守卫顺序）留在引擎自己的测试。
- Fake v4 为跑通契约补齐控件 / 图层替身（`fake-bmap-v4/controls-layers.ts`）与 Map 侧的
  `controls` / `layers` 容器 + `destroyedWithControls` / `destroyedWithLayers` 诊断字段
  （「先摘子资源、再销毁 Map」在控件 / 图层上同样可断言）；`fake-bmapgl` 补
  `NavigationControl` / `MapTypeControl` / `OverviewMapControl` / `TileLayer`。

### 11. Capability Catalog 与实际支持对齐

issue 的验收标准里有「Capability Catalog 与实际 Driver 支持一致」，具体落成三件事：

- **新增 `layer.panorama-coverage`**（`WEBGL_V4`、`native`、`runtimeOnly: true`）：`LayerKind`
  一直有这个成员，Catalog 却漏了它；`runtimeOnly` 与
  `overlay.point-collection` / `overlay.marker-3d` 的处理口径一致（官方文档有、类型包没有类声明）。
- **`layer.district` 的 engines 由 `V4_ONLY` 放宽为 `WEBGL_V4`**：webgl-v1 的驱动本就把
  `district` 映射到 `BMapGL.DistrictLayer`（组件测试一直在跑），共享契约也要求两个引擎都能创建它；
  Catalog 说它只属 v4 属于事实错误（同 `#20` 对 `map.pixel-conversion` 的处理）。
- **控件不进 Catalog**：`CAPABILITY_FAMILIES` 是 `Map / Overlay / Layer / Service / Panorama /
  Runtime` 六个 family（`#15` 冻结），控件没有对应 family；因此 Control Facet **不注入
  capabilities**，控件侧的「一致」体现为：不为任何 Catalog 标记 unsupported 的能力提供入口。
  这条是刻意的不改动，不是遗漏。

能力矩阵由脚本重生成（`pnpm generate:capability-matrix`，61 条能力），`--check` 无漂移。

### 12. 路况（`TrafficLayer`）刻意不承接，登记欠账

Map Facet §8 把「v4 路况」交给 Layer Facet（本 issue）。核对后决定**不在本 issue 加 `traffic`
kind**：

- Catalog 的 `layer.traffic` 描述的是「SDK 有 `TrafficLayer`」这一**语义能力**，不是「Facet 必须
  暴露 `create("traffic")`」；本 issue 的 Layer 范围是 issue 正文写的「DistrictLayer、
  PanoramaCoverageLayer 和当前仓库已公开能力」。
- `TrafficLayer` 是**页面级单实例**（官方 Skill：原型本身就是已构造实例，`map` / 缓存 / 刷新
  timer 在所有 `new TrafficLayer()` 之间共享），把它做成 per-instance `kind` 会邀请误用；
  而 `MapDriver` 在 Facet 模型里拿不到 `LayerDriver`，`enableTraffic` prop 的接线是跨 Facet 决定。
- 复现与规避：`MapDriver.setTraffic` 在 v4 下仍然告警一次并 no-op（`map.test.ts` 有断言），
  `enableTraffic` 在 v4 无效果；需要路况时用 raw SDK 逃生口或等 #23/#25 定夺接线位置。

## 后果

- 正面：v4 有了可组装、行为可断言的 Control / Layer Facet；「停靠常量换算」与「option 更新分类」
  不再散落在组件或调用方；两个引擎的 add/remove/target 语义在共享契约下统一；Catalog 补齐了
  一个真实缺口并修掉一条错误声明。
- 负面 / 成本：公共 `ControlHandle` 类型放宽为带 kind 的联合（外部自定义实现若比较
  `handle[HANDLE_BRAND] === "control"` 需改为前缀判断，beta 内允许直接变更）；`ControlKind`
  新增 3 个成员（自定义实现按 `Record` 写会编译失败，属期望的显式失败）；Fake v4 新增控件 /
  图层替身与两个诊断字段，Fake BMapGL 新增 4 个构造器替身；**`useControlResource` /
  `useLayerResource` 的卸载顺序改变**（先解绑业务事件再移除 SDK 资源，见 §6），两个 Facet 的
  `internal.ts` 基元被抽成 Overlay/Control/Layer 共用；webgl-v1 的 controls / layers 驱动
  各改一处行为（非 Map 目标显式失败、`tile` 改走 `addTileLayer`）；`internal.ts` 新增
  `requireRuntimeCtor` 并让 `overlays.ts` 改用它；catalog 两条 + 能力矩阵产物随之更新。
- 回滚：删除 `controls.ts` / `layers.ts` / Fake 增量与 catalog 两条即可——两个 Facet 未挂进
  `createJsapiV4Driver`，回滚不影响默认 Client / 组件 / 发布产物（`dist` 不含
  `driver/jsapi-v4/**`，由 `check:public-dts` 断言）；`useControlResource` / `useLayerResource`
  的顺序改动是独立的，回滚只需把 `scope.dispose()` 移回 `adapter.remove` 之后
  （`useResourceTeardown.test.ts` 会立刻变红）。

## 迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `ControlKind` 新增 `navigation` / `map-type` / `overview` | 驱动能力面新增三个 kind，暂无对应 Vue 组件 | 直接可用；声明式控件（`ControlSpec`）属 M7（#41） |
| `ControlHandle` 品牌带 kind（`control:<kind>`） | 公共类型放宽；比较 `HANDLE_BRAND === "control"` 的消费方需改前缀判断 | beta 内直接变更；裸 `"control"` 仍被接受 |
| `anchor` 传非四角常量（如 `BMAP_ANCHOR_TOP_CENTER`） | 换算成数值并**告警一次**，SDK 仍会回落到该控件默认落点 | 用四角常量；告警保证可见 |
| `anchor` 传不认识的名字 | 告警一次且不透传（控件沿用默认落点） | 用官方 `BMAP_ANCHOR_*` 常量名 |
| 控件缺 `anchor`/`offset` | Driver 不补默认值，由 SDK 默认值决定 | 组件层本就显式传（`withDefaults`）；直接用 Driver 时请显式给 |
| `controls.setOptions` 命中构造期项（`map-type.type`、`overview.isOpen`、`city-list.trigger`/回调） | 告警一次且不动实例；需要生效请重建控件 | 构造期给定，或重建 |
| `controls.setOptions` 传 kind 专属项但控件未挂载 | 抛 `BMAP_SDK_CALL_FAILED`（真实 4.0 的 `setType` 依赖 `initialize()` 建出的内部 DOM） | 先 `add` 再 `setOptions` |
| `location` 的 option | 整袋一次 `setOptions(options)` 写回 | 无改动（组件只传 anchor/offset） |
| 非 Map 目标（控件 / 图层） | v4 抛 `BMAP_CAPABILITY_UNSUPPORTED`；webgl-v1 由**静默 no-op** 改为抛 `BMAP_SDK_CALL_FAILED` | 组件一律传 `{ kind: "map", handle }` |
| `<BDistrictLayer viewport>` | 显式改名为 4.0 的 `autoViewport`；真实 4.0 运行时今天也接受 `viewport`，但不依赖未声明别名 | 无需改动组件 |
| `<BDistrictLayer>` 运行期改样式（`fillColor` 等） | 4.0 的 `DistrictLayer` 没有字段级 setter → 告警一次，需要重建图层 | 目前组件不这么做；需要时重建 |
| webgl-v1 的 `LayerKind = "tile"` | 原先落到不存在的 `map.addLayer` → 静默 no-op；现在走 `addTileLayer` | 修复（随 #26 一起删除） |
| `listCopyrights` 的 `bounds` | v4 回读 `bounds`（webgl-v1 只回读 `id`/`content`） | v4 更完整；`BCopyright` 更新路径不再丢适用范围 |
| `layer.district` 能力 engines | `V4_ONLY` → `WEBGL_V4`（webgl-v1 一直在实现它） | 能力矩阵已重生成；`supports("layer.district")` 在 v1 下由 false 变 true |
| `layer.panorama-coverage` 能力 | 新增（`WEBGL_V4`、runtimeOnly） | 能力矩阵与 docs 的 catalog JSON 已重生成 |
| `enableTraffic` 在 v4 | 仍然无效果（warn 一次）；本次**不**承接 `TrafficLayer` | 见 §12；需要路况走 raw SDK 或等 #23/#25 |
| `useControlResource` / `useLayerResource` 的卸载顺序 | 组件卸载时**先解绑业务事件**（scope 里的 SDK 监听 / watch / timer）再由 Map 移除资源 | 组件侧无需改动；`scope` 提前 dispose 不影响 `adapter.remove`（它不读 scope） |
| 移除定位控件（v4） | 现在会先 `stopLocationTrace()` 再 `removeControl()`（官方 Skill：控件的 `remove()` 不会清除 `watchPosition`） | 无需调用方改动。一次性 `getCurrentPosition` 仍**没有**取消入口（官方也没有），本库不声称取消它；**webgl-v1 的 `LocationControl` 在本地类型存根里没有该成员**，故 v1 下移除定位控件不会停止跟踪（迁移期差异，随 #26 消失） |
| 挂载失败后重试（控件 / 图层） | 失败会回滚记账并抛出原错误，同一句柄可重试；若 SDK 其实已部分挂载，`remove` 仍能清理（它不读记账） | 无需调用方改动 |
| 图层可见性 | v4 的图层没有 `show`/`hide`：**可见 = 已挂载**，切换走 add/remove（`BDistrictLayer` 的 `visible` watcher 就是这样） | 组件侧无需改动；契约用挂载计数断言，v1 的组件级 visible 切换由既有 `v3-bdistrict-layer` / `v3-bpanorama-coverage` / `v3-controls` 覆盖 |

## 非目标

- 不装配 Driver、不改默认 Client / Provider / 组件默认路径（#23 / #25）。
- 不实现 Service / Panorama Facet（#23）。
- **不新增 Vue 控件 / 图层组件**，不重构组件公共 API（issue 明确列为非目标）；
  声明式 `ControlSpec` 属 M7（#41）。
- 不把官方控件方法一比一公开（`getCityName`、`changeView`、`showStreetLayer` 等按需再补；
  编辑/开关类能力走 `setOptions` 分类）。
- 不实现 WMS / WMTS / MVT 等扩展图层（issue 非目标）。
- **不做 `enableTraffic` → `TrafficLayer` 的跨 Facet 接线**（§12）。
- 不改 Capability Catalog 的 family 划分（控件不进 Catalog，刻意）。
- 不为 `PanoramaCoverageLayer` 新增 augmentation，也不改 `driver/jsapi-v4/**` 的声明边界规则。

## 真实 AK smoke 记录（2026-09-11）

用 docs 站点示例里的 AK（`docs/examples/layer/panoramaCoverage.vue`）在真实 JSAPI 4.0 上跑通两个
Facet：headless Chromium（WebGL，SwiftShader）+ 临时 Vite 页面直接 `import` Facet 源码，
24 项检查全部通过（临时 harness 未入库，跑完即删；AK 只经 URL 查询参数传入，不落盘）。

| 检查 | 结果 |
| --- | --- |
| 15 个控件 / 图层构造器（`ZoomControl`…`CopyrightControl`、`Control`、`DistrictLayer`、`TileLayer`、`PanoramaCoverageLayer`、`LocationControl`） | **全部存在**（含类型包未声明的 `PanoramaCoverageLayer`；`LocationControl` 也确实仍是运行时名称） |
| 窗口全局 `BMAP_ANCHOR_*`（9 个）的实际数值 vs Driver 常量表 | **逐项一致**（0…8；表本身另有官方 `.d.ts` 的类型层钉死） |
| 10 个 kind 的 `create → add → remove` 的 DOM 记账 | 每次 `add` 后容器内 DOM 计数上升（如 21→29）、`remove` 后**回到基线**（21），十个 kind 全通过 |
| `show` / `hide` / `isVisible` 往返（zoom / scale） | 通过（`hide` 后 `isVisible()===false`，`show` 后 `true`） |
| `setOptions({ anchor, offset })` | `getAnchor()` 由默认值变为 `0`（`TOP_LEFT`）、`getOffset()` 为新 `Size` |
| kind 专属 setter / options 袋（**挂载之后**） | `navigation.setType` → `getType()===1`；`overview.setSize({x:120,y:130})` → `getSize()==={width:120,height:130}`（证明 Pixel→Size 归一化正确）；`scale.setUnit(BMAP_UNIT_IMPERIAL)` → `getUnit()==='us'`；`location.setOptions({...})` 可调用 |
| `CopyrightControl.addCopyright({ id, content })`（对象字面量） | 可写入并回读（`getCopyrightCollection()` 含该条），`removeCopyright` 生效 |
| `DistrictLayer` 的挂载入口 | `map.addLayer` / `removeLayer` 存在（`addDistrictLayer` / `addTileLayer` 也仍在，属 deprecated）；`isDistrictLayer` 家族标志位为 `true` |
| `TileLayer.setZIndex` | 挂载后可用 |
| `PanoramaCoverageLayer` | 真实运行时存在，可 `addLayer` / `removeLayer` |
| `viewport` → `autoViewport` 的语义（**含负对照**） | 不给该选项 / `autoViewport: false`：视野**不动**（上海 121.47/31.23）；`autoViewport: true`：视野切到北京（116.59/40.13）；`viewport: true`（历史名字）：**也切到北京** → 4.0 接受未声明的别名，改名是「不依赖别名」而不是「修失效」；`name: '(北京市)'`（组件的括号形式）同样生效 |

smoke 顺带确认（并已回写到决策里）的运行时事实：

- **`NavigationControl#setType()` 要求控件已挂载**：未 `addControl` 时调用抛
  `TypeError: Cannot read properties of undefined (reading 'show')`（第一轮 smoke 就在这一步失败，
  第二轮把「先挂载再改 kind 专属 option」写进流程后通过）。Fake v4 已把这条约束建模出来，
  避免它只存在于注释里。
- 区划图层的 `autoViewport` 是**一次性**效果：摘掉图层后视野停留在新区间（不会回跳），
  也不存在「摘除后迟到回调又改视野」的现象（3 秒观察窗口内）。

## 已知限制（显式接受）

- **真实 AK smoke 覆盖面**：覆盖构造 / 挂载记账 / 显隐 / 锚点与偏移 / 版权读写 / 图层挂载 /
  `autoViewport` 语义；**没有**覆盖真实交互（拖动控件、点城市列表、鹰眼展开、行政区点击事件）、
  多分辨率 / 多浏览器，以及 4.0 的 `MapTypeControl` 样式切换视觉结果。这些留到 M3A.3（#25）。
- **控件的 option 分类是「声明层」**：官方类型给出「应该有 setter」而运行时没有时，
  `setOptions` 只能告警一次（同 Overlay Facet 的限制）。分类表本身与官方 4.0.4 声明和
  smoke 实测逐项对齐过。
- **`map.addControl` 的重复挂载**：Driver 用记账保证「重复 add 只挂一次」，但**真实 SDK 上
  `addControl` 自身的去重行为未单独实测**（官方把重复添加列为常见错误，故按「会重复挂」防御）。
  #25 可以在浏览器里直接调用两次 `addControl` 核对这条防御是否正确。
- **webgl-v1 的 `setOptions` 不追平**：v1 仍是「把键写到实例上」的实现（#26 待删除），
  与 v4 的分类语义不是同一套；本 issue 只统一了 add/remove 与 target 语义。
- **`listCopyrights` 的 `bounds` 差异**：v4 回读、v1 不回读（见「迁移影响」），随 #26 消失。
- **`layer.traffic` 仍无 Facet 入口**：见 §12（本 issue 明确不承接，登记欠账与复现方式）。
- **控件不在 Capability Catalog 内**：因此能力矩阵不会体现「控件支持情况」，这是 `#15` 冻结的
  family 划分的结果，不是本 issue 的遗漏；如需控件级能力探测，应在 M7（#41）与 ControlSpec
  一起设计。

  > ⚠️ **部分取代（2026-09-17 / #41）**：「控件不进 Catalog」这条**保持不变**（`planOptions` 是
  > **option 级**的更新口径查询，与 family 划分无关）；M7 交付的是一套声明式 `ControlSpec` +
  > 统一 adapter，**没有**引入控件级的能力探测。见
  > [2026-09-17 控件统一 spec 与全景基线](./2026-09-17-control-spec-and-panorama.md) §2 与「非目标」。
- **非四角 `anchor` 只能告警后交给 SDK 回落**：4.0 没有「顶部居中」这类落点的等价表达，
  所以本库无法把它「显式化」——issue 风险条目里的「显式传递默认值」在**四角**与 `offset` 上是
  满足的（组件 `withDefaults` 显式给出，Driver 缺省不补第二份默认表）。
- **`destroy` 之后再调控件 / 图层的 add / remove**：Facet 不持有 Map 的生命周期状态
  （只有 `rawSdk` / `registry` / `capabilities`），会照常把调用转给 SDK；真实 SDK 在这种顺序下的
  行为未实测。组件路径保证 `destroy` 是最后一步（`plugins → controls → layers → overlays →
  map.destroy`），#25 接通 v4 组件路径后应补一条顺序断言。
- **`map.addControl` 的重复挂载**：见上（防御未在真实 SDK 上单独实测）。
- **行政区图层的官方清理建议与动态增删有张力**：官方 Skill 的「资源清理」写的是
  「解绑事件 → `map.removeLayer(districtLayer)`；**因迟到挂载边界，把它与 Map 同生命周期**」。
  本库的组件路径会按 `visible` 动态增删图层（`BDistrictLayer`），因此「迟到回调」是官方已知风险。
  我们做到的：业务事件**先**解绑（§6），所以迟到事件不会打到已拆解的回调；smoke 的 3 秒观察窗口内
  也没有观察到迟到回调改视野。但「与 Map 同生命周期」这条建议本身与动态增删的语义不同，
  登记在此而不是假装已解决；#25 接通 v4 组件路径后应在真机上看一次快速 `visible` 抖动。

## 提交前的双轴自审（Standards / Spec，各一个子代理）

**Standards 轴**（无硬违规；以下为判断项，已修）：

| 发现 | 处置 |
| --- | --- |
| Duplicated Code：`warnOnce` / 挂载记账 / Map 目标守卫 / 运行时构造器探测在 controls.ts 与 layers.ts 近乎逐字重复 | 四种基元收敛到 `internal.ts`（`createWarnOnce` / `createMountTracker` / `createMapTargetResolver` / `requireRuntimeCtor`），Overlay Facet 也改用共享的运行时构造器探测 |
| Data Clumps：`DECLARED_LAYER_KINDS` 与 `LAYER_CLASSIFICATION[*].ctorOnly` 表达同一事实，可各自漂移 | 合并为单一 `LAYER_DESCRIPTORS`（`ctor` / `declared` / `mutable` / `aliases`），文件末尾的类型断言从 `declared` 派生 |
| Middle Man + 双层 `sdkCall`：`callLayer` 包了一层而已归一过的 `callRequired` | 删除该转发，直接调 `callRequired` |
| 契约断言近乎空转：Fake 的 `addLayer` 自己去重，而 `addControl` 的注释明确说不该去重 | 去掉 `addLayer` 的去重（口径统一），共享契约的「重复 add 只挂一次」在 v4 侧改由 Driver 记账承担，另有 `callLog` 计数断言 |
| 格式：`driver-contract.ts` 被压行 / 缺尾换行 | 修 |
| Mysterious Name：`readNamespaceMember` 用于读**实例**成员 | **接受不改**：它是 `#19` 的既有基元，被 map/events/overlays 多处使用；重命名属跨 Facet 的独立清理，不塞进本 PR |

**Spec 轴**（issue 逐条核对，缺项已补）：

| 发现 | 处置 |
| --- | --- |
| 实施步骤 4「确保 remove 先解绑业务事件，再由 Map 移除资源」未落实（两个 composable 都是先移除后 dispose） | 已在 `useControlResource` / `useLayerResource` 实现，并新增 `useResourceTeardown.test.ts`（**先跑红**：旧顺序得到 `[add-to-map, sdk-remove, unbind]`）；见 §6 |
| 「建立不支持能力的 warn/throw/silent 行为」只有 `throw` 用例 | 补 `warn` / `silent` / 三策略无多余告警共 4 条用例（`layers.test.ts`） |
| 「所有资源可移除且 dispose 幂等」缺重复移除断言 | 共享的 Control / Layer 契约补「重复 remove 不抛错、计数归零」 |
| 「Layer add/remove/**visible**/options 测试」没有 visible 断言 | v4 图层的 visible 语义就是 add/remove（没有 `show`/`hide`），已在「迁移影响」写清覆盖位置（契约的挂载计数 + 既有组件测试） |
| ADR 过度承诺：能力守卫「避免孤儿实例」只在 `throw` 策略下成立 | 收窄表述：`warn`/`silent` 下按设计继续构造，并用测试固定三种策略的语义 |
| 疑似 scope creep：`ControlHandle` 放宽、webgl-v1 行为修正、catalog 两条、`listCopyrights` 回读 `bounds` | 正文各自登记了理由与迁移影响（§3 / §8 / §9 / §11），属 issue 目标「统一 add/remove、options、visible、target 与 Catalog 一致」的直接推论 |

## 外部评审轮次记录（PR #62，基线 `f0b55b9`）

评审提出 3 个 P2。逐条在仓库内先写**会红**的用例（同一次运行里 6 条断言红）再修：

| 发现 | 复现结果 | 处置 |
| --- | --- | --- |
| P2-1 移除 `location` 控件时没有停止持续定位跟踪（`watchPosition` 仍在跑） | **确认**：跨对象顺序记录得到 `["removeControl"]`（没有 `stopLocationTrace`）；重复移除时该方法的调用数为 **0** | `remove` 对 `location` 先**无条件** `stopLocationTrace()` 再 `removeControl`（该调用对自己没启动过的跟踪是 no-op，且**不**读挂载记账——记账只服务去重，不能当清理的前置条件）；补 3 条用例：顺序、重复移除安全、其他 kind 不受影响。**不**声称能取消一次性 `getCurrentPosition`（官方也没有取消入口） |
| P2-2 挂载失败后记账没有回滚，用同一句柄重试会被静默跳过 | **确认**：自定义控件首次 `render` 抛错后再 `add`，`addControl` **不再被调用**、`map.controls` 仍为 0（图层侧同形）；只有显式 `remove` 才会解除记录 | 两个 `add` 都在 SDK 抛错时 `release()` 记账并**重新抛出原错误**；补「首次失败 → 第二次成功」「失败后 remove 仍到达 SDK」用例。故障模型随修复一起进 Fake：`addControl` 改为**先 `initialize` 再登记**（`initialize` 抛错时控件确实没挂上），并新增 `failNextAddControl` / `failNextAddLayer` 注入开关（同 `FakeV4ViewAnimation.failNextCancel` 的口径） |
| P2-3 `autoViewport: undefined` 会吞掉有效的 `viewport: true` | **确认**：两种书写顺序都得到 `{}`（目标键「存在但无值」按「键在」让位，历史键被跳过，而 `undefined` 本身又被忽略） | 别名让位的判据从「目标键在不在」改成「目标键有没有**有效取值**」（`source[target] !== undefined`）；保留「显式 `false`/`true` 优先」的用例，新增「`undefined` 不遮蔽历史键」的用例 |

同轮顺手修：`callControl` 的缺成员告警文案原先写死「PanoramaControl 由全景模块提供」，现在它也服务于
`stopLocationTrace` 这类**普通控件也该有**的成员，因此改成泛化表述（仍保留 PanoramaControl 这个具体原因）。

两个「修复自身的边界」也核对过：`remove` 不读记账，所以**即使 SDK 部分挂载后抛错**，调用方仍能靠
`remove` 清理（有用例）；而「先记账再调 SDK」保留下来是因为它挡的是**重入**（自定义控件的
`initialize` 里再次 `add` 同一个句柄），删掉它会让重入真的挂两次。

## 参考

- issue #22 `[M3A2] 实现 JSAPI 4.0 ControlDriver 与基础 LayerDriver`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- 官方 4.0 API 参考：`BMap.Control` / `ZoomControl` / `ScaleControl` / `NavigationControl` /
  `NavigationControl3D` / `CityListControl` / `GeolocationControl` / `MapTypeControl` /
  `OverviewMapControl` / `PanoramaControl` / `CopyrightControl` 与 `Map#addControl/removeControl`、
  `Map#addLayer/removeLayer`
- 官方类型包 `@baidumap/jsapi-v4-types@4.0.4`：`control/*.d.ts`、`layer/*.d.ts`、
  `const/Anchor.d.ts`、`core/Map.d.ts`
- 官方 Skill `bmap-jsapi-v4`：`references/controls-and-context-menu.md`、
  `references/tile-and-service-layers.md`、`references/administrative-district.md`
- 代码：`src/driver/jsapi-v4/{controls,layers}.ts`、`src/driver/types/{controls,layers,handles}.ts`、
  `src/driver/webgl-v1/{controls,layers}.ts`、`src/driver/capability/catalog.ts`
- Fake 与契约：`packages/test-utils/fake-bmap-v4/{controls-layers,FakeMap,index}.ts`、
  `packages/test-utils/fake-bmapgl/index.ts`、`packages/test-utils/driver-contract.ts`
