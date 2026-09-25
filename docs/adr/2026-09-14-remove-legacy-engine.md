# ADR 2026-09-14：删除旧引擎（webgl-v1 / BMapGL）与迁移期归一

- 状态：已接受（Accepted）
- 日期：2026-09-14
- 计划键：`M3A3-REMOVE-LEGACY`（issue #26，追踪 #12，前置 #25）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-11 LoadedSdk 客户端收口](./2026-09-11-loaded-sdk-client-boundary.md) 的决策 1 / 2 / 3
    中「判别联合 + 迁移期归一入口」那部分（`LoadedLegacySdk`、`normalizeMigrationProvider`、
    `legacyDriverFactory`、`withMigrationDriver` 全部删除）；
  - [ADR 2026-09-13 默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)
    的决策 10（`<BMap allowExistingGlobal>` 与「页面已有全局就自动回退」）与其「已知限制」里的
    Playground legacy 档条目。
- 相关：`packages/baidu-map-gl-vue/src/driver/types/bmap.ts`、`client/createBMapClient.ts`、
  `core/loader/loaded.ts`、`scripts/check-no-bmapgl.mts`、`packages/test-utils/fake-v4-harness.ts`
- **后续（2026-09-25，issue #44）**：两处口径已被
  [ADR 2026-09-25 公共出口冻结](./2026-09-25-public-export-surface-freeze.md) 取代：
  1. 决策 2 里「`LoadedSdk` 保留为 `LoadedJsapiV4` 的别名（名字不变，避免无谓的签名抖动）」——
     1.0 冻结面里不留 deprecation / 单成员别名，`LoadedSdk` 直接改名为 `LoadedJsapiV4`
     （要出一次 release note）；
  2. 下面「迁移影响」表里 `baidu-map-gl-vue/core` 那个落点——`./core` 子入口已于 #44 取消，
     v4 Provider 家族改从 `bmap-vue/advanced` 取。
  那张表按 ADR 惯例**保持原文不动**（它记录的是 #26 当时的迁移口径），现状以 ADR 2026-09-25 为准。
  本文其余决策——单一 engine 取值、`assertLoadedSdk` 是唯一收口点、
  Provider 只接受结构化形状、`no-bmapgl` 门禁——**全部仍然有效**。

## 背景

JSAPI 4.0 单引擎基线在 [ADR 2026-09-10](./2026-09-10-jsapi-v4-only-baseline.md) 就冻结了：
GL v1（`BMapGL`）只是迁移期过渡实现，M3A.3 删除。R25 阶段（#70~#75）已经把**默认路径**
换成官方 `@baidumap/jsapi-loader`，但旧引擎的**实现**一直留着，代价是三重的：

1. **两套加载状态机**：legacy Provider 用独立 `BMapGL` 冲突域、自拼入口 URL、自管 JSONP
   回调名——这正是 #71 要消除的东西，只是当时只切了默认值，没删实现；
2. **两套 Driver**：`webgl-v1/**` 与 `jsapi-v4/**` 各自实现同一批 Facet，公共契约不得不
   迁就「两边都能满足」（`BMapDriver` 不能放 v4 独有的面）；
3. **一个隐式的 engine 分派**：`BMapEngine` 判别联合 + `withMigrationDriver` 按加载结果的
   engine 选 Driver。它让「Provider 返回裸全局对象」也能工作，代价是**默认路径上存在一条
   谁都没显式选择的 legacy 通道**——正是 #71 决策 2 禁止的「第二套判定」。

本决策把这三样一次性删掉，并把「删除」变成可执行的不变量。

## 决策

### 1. 删除的产物与入口

| 类别 | 删除内容 |
| --- | --- |
| 旧 Driver | `src/driver/webgl-v1/**`（11 个文件） |
| 自维护类型 | `packages/baidu-map-gl-vue/types/BMapGL/**`（11 个 `.d.ts`） |
| 测试替身 | `packages/test-utils/fake-bmapgl/**`、`packages/test-utils/lifecycle-inspector/**` |
| 迁移期入口 | `src/client/migration.ts`（`withMigrationDriver` / `normalizeMigrationProvider` / `legacyDriverFactory` / `createLegacyBMapClient`）、`src/core/loader/Provider.ts`（`baiduCdnProvider` / `customScriptProvider` / `existingGlobalProvider` / `hasExistingGlobalSdk`） |
| 旧 engine 猜测 | `driver/index.ts` 的 `detectEngine`、`createDriver`、`detectVersion` 再导出 |
| 双跑矩阵 | `packages/test-utils/driver-matrix.ts` → 收敛为 `fake-v4-harness.ts`（只留组件级装配与读数） |
| 各档 legacy | Playground 的 `legacy-fake` 档与 `VITE_BMAP_MODE` 开关、`createLegacyFakeProvider`、`createLegacyMatrixEngine` / `createMigrationMatrixEngines` |

### 2. 引擎模型收敛为单一取值

`BMapEngine = "jsapi-v4"`。构造 Driver 的唯一入口是 `createJsapiV4Driver`，它要求调用方
显式给出 SDK 运行时版本（来自结构化加载结果），不再探测——**「猜」这个动作本身被删除**，
而不是留一个只在高级路径里用的猜测函数。

`LoadedSdk` 保留为 `LoadedJsapiV4` 的**别名**（名字不变，避免无谓的签名抖动），
`assertLoadedSdk` 成为唯一收口点，两个失败形态各自有明确错误码与文案：缺 `engine`
（裸全局对象）、`engine !== "jsapi-v4"`（旧引擎结果）。

> **后续（2026-09-25，issue #44）**：上面那句「保留为别名」不再成立——别名已删除，公共面里
> 只有 `LoadedJsapiV4`（见 [ADR 2026-09-25](./2026-09-25-public-export-surface-freeze.md) 决策 3）。
> 「`assertLoadedSdk` 是唯一收口点」与两条错误文案**不变**。

### 3. Provider 只接受结构化形状

`LooseBMapProviderLike` / `AnyBMapProviderLike` 与它们带来的「裸全局对象按 engine 归一」
一起删除：`BMapProviderLike` 现在就是 Provider 的全部契约。这是**刻意的破坏性变更**——
「接收裸全局再猜 engine」与本 ADR 决策 2 互斥。

### 4. `<BMap allowExistingGlobal>` 与自动全局回退删除

ADR 2026-09-13 决策 10 明确把这两条挂到了本票。它们走的是 legacy `existingGlobalProvider()`
（读 `BMap ?? BMapGL`）。宿主自己加载了 SDK 的场景改走 **v4 语义**的
`existingGlobalV4Provider()`（一次性显式传入），不再有「页面里恰好有全局就用它」的隐式行为。

### 5. 新增 `no-bmapgl` 门禁：把「删除」变成不变量

`pnpm check:no-bmapgl`（`scripts/check-no-bmapgl.mts`）扫两个相位：

| 相位 | 目录 | 判定 |
| --- | --- | --- |
| 运行时源码 | `packages/baidu-map-gl-vue/src`（跳过 `*.test.ts`） | `BMapGL` 标识符 / 精确字符串键 / 类型位置 / `namespace BMapGL`；以及 `"webgl-v1"` / `"jsapi-v3"` 字符串字面量 |
| 公共声明 | `packages/baidu-map-gl-vue/dist`（只认 `*.d.ts`） | 同上第一条 |

**为什么需要它**：`check:raw-sdk` 只在禁区目录（`components` / `composables` /
`core/runtime` / `integrations`）里拦 `BMapGL`；`driver/**`、`client/**`、`core/loader/**`、
`plugins/**` 是白名单，而旧引擎恰恰住在白名单里。删除一次靠 diff 就能检查，**让删除保持
删除**只能靠门禁。

**范围刻意收窄**（误伤会逼出「为了过门禁改注释」这种本末倒置）：

- 不扫 `node_modules` 与供应商包——官方 4.0 runtime 自己就把 `BMapGL` 作为同一命名空间的
  别名挂上，UI Kit 也从它取配置；
- 不扫 `docs/**`——迁移指南必须能写出「旧版叫什么」；
- 不扫 `tests/**` 与 `packages/test-utils`——Fake v4 按**真实运行时的形状**同时挂 `BMap` 与
  `BMapGL`，它是「官方别名的镜像」而不是本库回退旧引擎；
- **官方插件命名空间 `BMapGLLib` 不误报**：规则按 AST 标识符判定（`BMapGLLib` 是另一个标识符），
  `TrackAnimation` / `DrawingManager` / `GeoUtils` 的 CDN URL 也不受影响。

### 6. 官方 React 封装对照（`huiyan-fe/react-bmap@2.0.1`）

维护者给的参考实现是官方同名封装。逐点核对后，本库与它的**关系**与上一轮一致，但有一处
**明确分歧**，值得写下来（它也是本决策最容易被质疑的地方）：

| 维度 | `react-bmap@2.0.1` | 本库（本 ADR 之后） |
| --- | --- | --- |
| 引擎数量 | **两个**：`src/drivers/v3Driver.ts` + `v4Driver.ts`，`createDriver(version)` 按 `version` 分派（`'3.0'` → v3，其余按 4.0 处理） | **一个**：`jsapi-v4`。旧引擎整份删除，不做「按版本分派」 |
| 加载实现 | `dependencies: { "@baidumap/jsapi-loader": "^1.0.0" }` | 同源：精确锁定 `1.0.0`（[ADR 2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)） |
| 是否改全局 | 注释明写「**不修改 `window.BMap` / `BMapGL` 原型、不做命名空间别名**」 | 同：本库只在官方结算后校验命名空间；Fake 里那个 `BMapGL` 别名是**镜像官方行为**，不是本库新建的 |
| 旧引擎声明 | 无自维护的 `BMapGL` 类型包 | `types/BMapGL` 已删除，类型面只剩官方 `@baidumap/jsapi-v4-types` + 最小 augmentation |
| `BMapGL` 字符串 | 作为**世代探测**读一次（`typeof globalThis.BMapGL === 'undefined'` 判 v3/v4） | 不读：宿主预加载走 `existingGlobalV4Provider()`，命名空间校验只认 `BMap` |

**为什么本库比它更激进**：`react-bmap` 从 v2 起就同时支持两代 SDK，删 v3 会破坏它已有的
用户；本库的 3.0 是**一次性大版本**，[ADR 2026-09-10](./2026-09-10-jsapi-v4-only-baseline.md)
已经把「v3 Stable 单引擎、不提供 `BMapGL` 回退开关」冻结在前，需要 `BMapGL` 的用户应停留在
`baidu-map-gl-vue@2.x`（2.x 分支与产物继续维护）。方向一致（都走官方 Loader、都不动全局），
分歧只在「保留几代引擎」。

## 后果

- **正面**：只剩一份加载状态机、一套 Driver、一个 engine 取值；`BMapDriver` 与
  `JsapiV4Driver` 的区分重新变成纯粹的「v4 独有面」，不再需要为「旧引擎也能满足」而妥协；
  默认路径上不存在任何隐式 legacy 通道（`no-bmapgl` 门禁可执行地保证这一点）。
- **负面 / 成本（破坏性变更）**：见下表。全部属于 3.0.0-beta 内允许的直接变更
  （ADR 2026-09-11 已冻结「不保留兼容层」）。
- **回滚**：整份回滚本 PR（`git revert`）。**不提供局部回滚**——`types/BMapGL` 与 `webgl-v1`
  的调用点已经消失，局部恢复等于重建第二套状态机，正是 ADR 2026-09-13 决策 2 禁止的。

### 迁移影响（对调用方可见）

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| 根入口 Provider factory | `baiduCdnProvider()` / `customScriptProvider()` / `existingGlobalProvider()` | 根入口**不再导出任何 Provider**；v4 家族在 `baidu-map-gl-vue/core`（既有入口） | 改用 `baiduJsapiV4Provider()` / `customScriptV4Provider()` / `existingGlobalV4Provider()` |
| `./advanced` 的 Driver 构造 | `createDriver({ engine, rawSdk })`、`detectEngine()` | 只剩 `createJsapiV4Driver({ rawSdk, version, unsupported })` | 显式给 `version`（来自结构化加载结果）；不要再猜 engine |
| `./advanced` / `./core` 的加载结果 | `LoadedSdk = LoadedJsapiV4 \| LoadedLegacySdk`、`isLoadedLegacySdk` / `toLoadedLegacySdk` / `assertLoadedJsapiV4` | `LoadedSdk = LoadedJsapiV4`；只留 `isLoadedSdk` / `assertLoadedSdk` | 判别联合退化为单成员；`assertLoadedSdk` 就是「只接受 4.0」的判定点 |
| Provider 形状 | `AnyBMapProviderLike`（结构化 + 宽松裸值） | 只有结构化 `BMapProviderLike` | 让 `load()` 返回 `{ engine: "jsapi-v4", version, namespace, … }` |
| 组件默认路径 | `withMigrationDriver(definition)` 归一 | 定义**原样**交给 `createBMapClient` | 无需改动；自己拼 definition 的调用方删掉那层包装即可 |
| `<BMap allowExistingGlobal>` / 插件 `allowExistingGlobal` | 显式 opt-in 复用已有全局 | prop 已删除 | 传 `provider: existingGlobalV4Provider()` |
| 「页面已有全局」自动回退 | 有全局就回退并 warn | 已删除 | 同上 |
| Playground | `VITE_BMAP_MODE=legacy-fake` 对照档 | 该档与开关删除（只剩 `real-v4` / `fake-v4`） | 无需配置；传旧档位名会被忽略并落到默认档 |
| `BMapEngine` | `"webgl-v1" \| "jsapi-v3" \| "jsapi-v4"` | `"jsapi-v4"` | 类型收窄；Capability Catalog 的引擎列随之退化为一列 |
| 包文件清单 | `files: ["dist", "types", "volar.d.ts"]` | `files: ["dist", "volar.d.ts"]` | `types/` 只剩构建期占位文件（`shared/`、`ui-kit/upstream.d.ts`），不再发布；**`volar.d.ts` 必须保留**——`tsconfig` 里的 `"types": ["baidu-map-gl-vue/volar"]` 靠它，删掉会静默破坏消费者的模板类型提示 |
| 构建 tsconfig | `include` 收窄为 `types/shared/**/*.d.ts`（迁移期为了避开旧 `types/BMapGL` 的全局常量与官方 `BMap` 声明冲突） | 恢复为 `types/**/*.d.ts` | 无。收窄的前提（`types/BMapGL`）已消失，恢复后 `types/` 下的声明占位文件重新按整目录参与编译 |

## 已知限制（显式接受，带归属）

1. **`BContextMenu` 挂不到覆盖物目标上（v4）**。`driver.overlays.attachContextMenu` 在 v4 上
   只接受**地图**目标（`requireMapTarget`），而组件传的是 `{ kind: "overlay", handle }`，异常被
   组件里的 `catch {}` 吞掉 ⇒ 菜单静默不出现。这不是本票引入的缺陷（v4 Driver 一直是这个
   契约），但**旧引擎删除后它成了唯一行为**，因此本票把它钉成可断言的现状
   （`tests/behavior/v3-bcontextmenu.test.ts`）并记入欠账：完整修复（组件 + 声明式 ContextMenu
   的状态机）属 **M5 / #33**。刻意不在本票顺手改组件——那会把「删除旧引擎」变成「重构气泡 /
   菜单」，评审无法分辨两件事。
2. **`useBMapTrackAnimation` 在 v4 上不可用**。它调用 `driver.services.createTrackAnimation()`，
   而 v4 侧明确抛 `BMAP_CAPABILITY_UNSUPPORTED`（Catalog 里 `service.track-animation` 是
   `unsupported`），指引改用原生图层 `track-line`。迁移结论（BMapGLLib 插件在 4.0 上的去向）
   属 **M8 / #43**，本票只保证错误信息可诊断、且组件/用例把它钉成现状。
   **[已被 #104 / 2026-09-19 取代]** 该 hook 连同它的 `INITIAL/PLAYING/STOPPING/…` 状态机已**删除**
   （连同文档、示例与行为用例）：在 v4 上它永远只会走「构造即抛」这一条分支，状态机因此退化成常量，
   且没有任何消费者。轨迹的现状路径就是原生图层 `track-line`；插件侧结论仍在 **#43**。
   同参考实现 `huiyan-fe/react-bmap`（236 个 TS 文件）也没有任何 TrackAnimation 抽象。
3. **服务类 composable 仍直读 `geocoder.raw.*`**。[ADR 2026-09-13 私有面删除](./2026-09-13-private-sdk-surface-removal.md)
   的已知限制写明「要等 #26 删除 webgl-v1 之后，与 #38 的服务生命周期一起做」。本票完成了
   删除，但**没有**顺手做这层收口（它属 **#38**）——这是有意的欠账，不是遗漏。
4. **能力矩阵的 `engines` 维度退化**。64 条能力现在都只声明 `jsapi-v4`，`engine-unsupported`
   只剩「描述符缺失」这条防御路径可达。是否**移除**整个维度（连同生成物里的引擎列）属独立
   决策：本票只做「如实反映单引擎」，把形状变更留给下一张票，避免在一个删除 PR 里同时改
   公共类型与生成物结构。

## 验证

- `pnpm check:no-bmapgl`：运行时源码 + 公共声明 0 命中（`tests/behavior/v3-no-bmapgl-gate.test.ts`
  同时钉住「真实树干净」与「正例会被抓到」，以及 `BMapGLLib` / 注释 / 官方依赖**不误伤**）。
- `pnpm check:raw-sdk` / `check:raw-sdk:tree` / `check:public-dts`：边界门禁不变红（删除没有
  在别的方向上放松边界）。
- `pnpm typecheck:v3` → `build:v3` → `check:public-dts` → `check:no-bmapgl` → `test:unit`：
  顺序按实测（`typecheck` 会写 `dist`，必须排在读 `dist` 的门禁之前；`build` 会清 `dist`）。
- `pnpm verify:package` + `fixtures/v3-consumer` 的 `vue-tsc`：tarball 消费方仍只靠
  `baidu-map-gl-vue` + `vue` 就能类型检查。
- `pnpm smoke:v4:fixture` / `docs:build`：删除没有破坏浏览器链路与文档站。

## 非目标

- **不删除 2.x 分支与产物**，也不改 npm 包名（仓库改名不等于包名变化）。
- 不开启任何「隐藏 legacy 开关」；不修改供应商（官方 SDK / Loader / UI Kit / BMapGLLib）实现。
- 不在本票开展新 Map API，也不顺手修上面「已知限制」里的组件 / composable 缺陷。
- 不删除官方插件命名空间 `BMapGLLib` 的使用（`plugins/builtins.ts` 仍按真实可用性加载），
  也不因依赖里包含该字符串判定「回退旧引擎」。

## 参考

- issue #26 `[M3A.3] 删除 webgl-v1、types/BMapGL 与 fake-bmapgl，启用 no-bmapgl 门禁`
- issue #25 / #12（前置与总追踪）
- [ADR 2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- [ADR 2026-09-11 LoadedSdk 客户端收口与迁移期 Driver 分派](./2026-09-11-loaded-sdk-client-boundary.md)
- [ADR 2026-09-13 默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)
- [ADR 2026-09-12 Fake v4 诊断与双 Driver 矩阵](./2026-09-12-fake-v4-diagnostics-and-dual-driver-matrix.md)
- WebGL v1 → JSAPI 4.0 迁移指南（`../zh-CN/guide/migration-v1-to-v4.md`，**已随 #136 下线**：1.0 不提供旧版迁移路径）
- [`react-bmap`](https://github.com/huiyan-fe/react-bmap)（官方 React 同名封装，`2.0.1`）——
  对照见本文决策 6
