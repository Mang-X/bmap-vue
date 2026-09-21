# ADR 2026-09-21：插件迁移结论定型与 `./advanced` 冻结

- 状态：已接受（Accepted）
- 日期：2026-09-21
- 计划键：`M8-ADAPTERS-ADVANCED`（issue #43，追踪 #12）
- 相关：`packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts`、`packages/baidu-map-gl-vue/src/advanced.ts`、`packages/baidu-map-gl-vue/src/core/index.ts`、`scripts/probe-plugin-runtime.mts`、`scripts/probe-plugin-compat.mts`、`scripts/plugin-runtime-report.mts`、`scripts/advanced-bundle-shake.mts`、`scripts/verify-package.mts`、`tests/behavior/v3-plugin-compat-inventory.test.ts`、`tests/behavior/v3-advanced-contract.test.ts`、`fixtures/v3-consumer/`、`.github/workflows/nightly-v4-smoke.yml`
- 与既有决策的关系：**取代** [插件兼容 inventory](./2026-09-13-plugin-compat-inventory.md) 的**决策 3**（结论取值三种）与**决策 7 里那行的退出码表**（「有插件 `threw` ⇒ 1」）。其余决策（依据三档 / 私有面布尔口径 / 内置插件一律 optional / 能力互锁 / 两个探针不进 PR 门禁 / 插件页不塞进必需链路）**仍然成立**，本文不改动。

## 背景

`#43` 开工时的状态是「证据齐、结论不齐」：

- `compat-inventory.ts` 的词汇是 `incompatible` / `no-declaration-gap` / `undetermined`。#25 的 ADR 已经说明 `no-declaration-gap` **不等于**兼容，但读者读完仍然不知道**该用什么**——`undetermined` 只表达「还没查完」，那不是结论。
- 运行时档只覆盖「构造 + 一次真实调用」：DrawingManager 只证到 `getDrawingMode()`，TrackAnimation 只证到 `start()`，MapVGL 只记了「抛错」而没定位根因。清单里写着「完整链路未验证」，但没写清**未验证的是哪几条**。
- 三个 `BMapGLLib/*` URL 指向百度自托管的 GitHub 镜像，路径里**没有 tag / commit**：上游改一次内容，URL 与依赖声明都不会变，本仓没有任何手段发现。
- `./advanced` 与 `./core` 的分工从没被写下来过：`./advanced` 里有 Provider / Driver / Handle / Capability，`./core` 里既有 Provider 家族、也有 `MapRuntime` / `SdkRuntime` / `hash` 这类内部实现，但**哪一份是承诺维护的扩展契约**没有任何文档或门禁。

`#43` 的开工前范围纠正（Evidence-before-abstraction）把顺序定死了：**先判定，再适配**；只有结论明确是 `adapter` 且存在真实消费者时才写 adapter 代码；不得先建设统一插件生命周期 / 兼容 Runtime 再把插件塞进去。因此本票的交付物是**结论 + 边界 + 证据**，不是适配层。

## 决策

### 1. 结论词汇换成五值，并给每条补「迁移路径」

`PluginVerdict` = `native` | `compatible` | `adapter` | `incompatible` | `unverified`，每条再加一份
`migrationPath`（`kind` = `native` / `plugin` / `none`，加 `target` 与一句话说明）。四个内置插件的结论：

| 插件 | 结论 | 迁移路径 | 决定性依据 |
| --- | --- | --- | --- |
| `TrackAnimation` | `native` | `layer.track-line` → `<BTrackLineLayer>` | 4.0 有原生轨迹线图层；本库不该再为 legacy 插件提供封装 |
| `GeoUtils` | `compatible` | 按官方文档直接用（本库只加载脚本） | 纯谓词集合、无私有面、无副作用 |
| `DrawingManager` | `compatible` | 按官方文档直接用（本库只加载脚本） | 真实 4.0 上用合成指针事件序列**画出了一个多边形** |
| `Mapvgl` | `incompatible` | `none`（改用原生图层） | 私有回调表 + `getPanes().mapPane` 不存在 |
| （无条目） | `adapter` | — | 见决策 2 |

`native` 的迁移落点必须是**本库真实存在的组件**：`migrationPath.nativeComponent` 由门禁对照
`src/manifest.ts` 核对（写成不存在的组件名比不写更坏）。

### 2. 结论不许强于证据，且 `adapter` 需要真实消费者

三条机器判据（`v3-plugin-compat-inventory.test.ts`，都配了反证）：

- `compatible` ⇒ 必须有 `runtime` 档且 `status === "verified"`（不许用「声明面通过」冒充「兼容」）；
- `unverified` ⇒ 不得同时挂着已验证的读数。**它是允许的最终结论**，不为了「功能完整」强行实现成 adapter；
- 当前**没有任何 `adapter` 条目**，这条被显式断言下来：要新增必须同时给出消费者与迁移落点，并删掉那条门禁。四个内置插件都不满足「结论是 adapter 且存在真实消费者」这个条件。

### 3. 「已验证」是有范围的：覆盖与未覆盖都进数据

`runtime` 从 `{ status, detail }` 扩成 `{ status, detail, covered[], uncovered[] }`，文档表里逐条列出。
「没跑过的部分留白」会被读成「也验过了」（与 #85 第三轮同源），因此 `uncovered` 是必填项。

本轮把运行时档扩到各自的最小功能链路：

| 插件 | 新增覆盖 |
| --- | --- |
| TrackAnimation | `pause()` 后 path 冻结 → `continue()` 后恢复增长 → 播放到结尾（path 收敛 + 构造选项 `onAnimateEnd`）；`setSpeed()` 的实测结果进 `readings`（**不设门禁**，理由见决策 6） |
| DrawingManager | `confirmVisible: false` 下沿**公开 DOM 事件链路**发**合成指针事件序列**（`dispatchEvent`，`isTrusted === false`；按下 → 3 次拖动 → 双击收尾）画出一个多边形：收到 `overlaycomplete`（载荷 `drawingMode: "polygon"`）、覆盖物真的在图上、且被记进 `dm.getOverlays()` |
| MapVGL | 抛错**根因**：产物里那一行是 `map.getPanes().mapPane.appendChild(div)`，而 4.0 的 `getPanes()` 只有 `floatPane` / `markerMouseTarget` / `floatShadow` / `labelPane` / `markerPane` |

驱动方式刻意限定在**公开面**：构造选项、`open` / `setDrawingMode` / `getOverlays`、事件
`overlaycomplete`。探针不碰任何下划线成员——结论要能归到「用户操作」上，而不是「我们调了私有 API」。

> ⚠️ 措辞口径（评审 2026-09-21）：DrawingManager 那一行的输入是 `dispatchEvent` 造出来的**合成事件**
> （`isTrusted === false`），它验的是「库自己的公开 DOM 事件处理链路 + SDK 的坐标归一化」，
> **不等于**浏览器真实用户输入 —— 指针捕获 / 合成 `click` / 双击判定那一段没有覆盖，
> 已明确写进 `runtime.uncovered`。文档、PR 与探针注释里都不要把它写成「真实指针输入」。

### 4. 未版本化的 URL 用**内容摘要**锁住

`versionLock` + `artifactDigest`（`sha256`）进数据；`pnpm probe:plugin-compat` 每次拉取后核对摘要，
不一致 ⇒ `fail` 并提示「重新核对结论并更新摘要」。

- `mapvgl` 的 URL 自带精确版本（`mapvgl@1.0.0-beta.188`，`versioned: true`）；
- 三个 `BMapGLLib/*` **没有版本号**（`versioned: false`）。把 URL 换成 commit-pinned CDN 是一次独立的
  「受控资产」决策（涉及可用性与国内可达性），本文不做；摘要只解决「变了要能被发现」。

摘要**不是**完整性校验（不做 SRI、不给浏览器校验），只是漂移探测。

### 5. `./advanced` 冻结为承诺维护的扩展契约，`./core` 是内部面

三条边界（`v3-advanced-contract.test.ts`）：

1. **导出面是精确集合**（21 个值导出）。不是「包含关系」——包含关系挡不住悄悄新增一个内部实现；
2. **内部面不得进入 `./advanced`**：`MapRuntime` / `SdkRegistry` / `ScriptLoader` / `createMapEventBus` /
   `hash` / `fingerprintConfig` / `normalizeApiUrl` / `ResourceScope` / `createPluginRegistry` … 一个都不许有。
   **配正证守卫**：同一批名字必须能在 `./core` 里找到，否则「清单拼错 / 名字早改了」会让负向断言静默变绿；
3. **产物层**：`dist/advanced.mjs` 的静态 import 闭包不含组件标记、不引用官方 UI Kit；`sideEffects: false`。
   正证是根入口的闭包**必须**含组件标记。

`./core` **仍然是公开子路径**（Provider 家族在那里），但它是**内部实现面**：本库不承诺它的稳定性，
第三方要用扩展契约就用 `./advanced`。把 `./core` 整体删除或搬迁是破坏性改动，需要独立的决策，
本票**不做**（见已知限制）。

同时补了消费方一侧的证据：`fixtures/v3-consumer` 里有一份**第三方 adapter fixture**
（`src/advanced-adapter.ts`：装配自定义 Provider/Driver、raw 逃生口、能力查询、插件定义工厂），
它由 `verify:package` 用 `vue-tsc` 对着 tarball 的 `dist/*.d.ts` 编译；同一个脚本还在 Node 里
**真正调用**这些扩展点一次（handle/能力表/收口校验/插件名字表/`normalizeProvider` 的 `this` 绑定）。

### 6. 可选插件的运行时档**单独**进 nightly，并修正「已登记 threw = fail」

- 新增 nightly job `plugin-runtime`（与 `plugin-compat` 并列）。它**不是** required smoke 的一部分：
  插件脚本抖动不该染红必需链路，但每天都核对一次才能发现上游漂移。AK 从 secret 读；
  显式给 `SMOKE_BROWSER=/usr/bin/google-chrome`（探针的默认候选是 macOS 路径，不给会退 2）。
- **取代** 2026-09-13 ADR 决策 7 的退出码表最后一行：`threw` 且与 inventory 的 `runtime.status`
  **一致** ⇒ 是**已登记的结论**，不算 fail；只有**未登记过期望值**的 `threw` 才退 1。
  理由：MapVGL 的结论就是「它在 4.0 上抛错」，旧规则会让这个 job 每天红一次，而假警报训练出来的
  习惯是「不看它」。「本来 verified 的插件开始抛错」这条回归由 `statusMismatch` 继续抓，没有漏。

### 7. 与同源参考实现 `huiyan-fe/react-bmap` 的对照

`@baidumap/react-bmap@2.0.6`（2026-09-20 仍有推送，官方 React 组件库）本轮被当作**接口面的证据**读了一遍，
逐项分三类：

| 项 | 参考实现 | 本库 | 判定 |
| --- | --- | --- | --- |
| 默认加载 | 依赖 `@baidumap/jsapi-loader@^1.0.0` | 依赖同一包、**精确锁定** `1.0.0` | **同源**，我们更严（精确版本是上一轮契约表冻结的） |
| 四个插件 | `src/` 下 **0 个**文件/能力项与 `TrackAnimation` / `DrawingManager` / `MapVGL` / `GeoUtils` 相关 | 加载脚本但不封装组件，并把结论写进 inventory | **同源**：同源封装同样不提供它们 ⇒「不自研、也不假装支持」是对的，但**必须把结论写出来**（这正是本票） |
| 「不支持」的表达 | `UnsupportedCapabilityError(capability, version)` + `reportUnsupported`（throw/warn/ignore） | `UnsupportedCapabilityError` + 能力注册表 + Catalog 的 `unsupported` 状态 | **同源**，措辞与分流口径一致（「成员不存在」与「成员存在但抛错」也分开） |
| 扩展契约入口 | 只有 `.` 一个导出子路径；内部实现不对外承诺（也没有单独契约） | 显式拆出 `./advanced`（冻结的扩展契约）与 `./core`（内部面） | **本库更显式**：多一个「承诺维护的扩展面」，代价是两处边界要靠门禁维持 |
| 引擎数量 | 仍保留 `src/drivers/v3Driver.ts`（多引擎） | #26 已删除旧引擎（单引擎 `jsapi-v4`） | **本库更窄**，也正是 #43「不以兼容旧插件为由重新引入本库 BMapGL 引擎」这条要求 |
| 能力矩阵 | 枚举 SDK 成员（`Map.flyTo`、`Layer` 类…） | Capability Catalog（62 项，`status` + `runtimeOnly`） | 同源，粒度与命名不同；不互相采用（各自的 `id` 面已经冻结） |

参考实现里**没有**「插件迁移结论表」这种东西——它不需要，因为它不加载这四个插件脚本。
本库需要，因为 `plugins: [...]` 是公开配置面。

## 后果

- 读者打开 `docs/zh-CN/contributing/plugin-compat-inventory.md` 能直接看到：**结论**（五值）、
  **迁移路径**、版本锁定与内容摘要、运行时**覆盖到哪几步 / 哪几步没覆盖**、以及残余风险各自的去处。
  `docs/zh-CN/guide/config.md` 的插件状态表与 `migration-v1-to-v4.md` 的插件段落同步改成「结论 + 去向」。
- 三个 `BMapGLLib` 脚本换内容时，nightly 的 `probe:plugin-compat` 当天变红并提示更新摘要——
  「某人曾经读过一遍 minified 源码」不再是一次性的。
- 可选插件的运行时结论每天被核对一次，且**与必需链路的判定完全分离**。
- `./advanced` 的导出面从此是「改一次要显式改一次清单」的东西；内部实现想进扩展契约必须过三条门禁。
- 顺带修掉两处**文档与实现不符**：`docs/zh-CN/guide/config.md` 里「未知插件名静默变成空实现」（#42 已改为
  `BMAP_PLUGIN_UNKNOWN`）与 MapVGL 那段只写了 `_rd` 一条依据（现在补齐根因）。

**回滚**：本票不改 SDK 加载路径、不改 Driver/Facet、不改 `./advanced` 的实际导出（只是把它钉住），
因此回滚成本集中在数据与文档：还原 `compat-inventory.ts` 的字段与生成物、删掉 `plugin-runtime` job
与两条新用例即可。`verify-package` 里新增的消费方检查是纯增量，去掉不影响发布正确性。

## 已知限制

1. **两个插件探针都不进 PR 门禁**（需要网络 / AK / 浏览器）。结论的新鲜度靠 nightly；PR 上只能保证
   「数据 ↔ 文档 ↔ 门禁」无漂移。
2. **`./core` 仍是公开子路径**，本票只声明它是内部面、并用门禁防止内部实现进入 `./advanced`，
   **没有**收缩 `./core` 的导出面。按 issue 原文，「把 `./core` 内部实现收缩为承诺维护的 `./advanced`
   扩展契约」这件事的物理落点（`exports` 收窄 / `Provider` 家族迁移 / 内部面去留）属于
   **#44（冻结 core / ui-kit / advanced 包出口）** —— 它是破坏性改动，需要与 `./ui-kit` 的出口面一起决策，
   本文只把「哪一份是承诺维护的扩展契约」这件事冻结下来并留下可执行的门禁。（已在 [#44](https://github.com/Mang-X/bmap-vue/issues/44) 上登记。）
3. **TrackAnimation 的播放命令面不在本票**：本票只把结论定型为 `native` 并指向 `layer.track-line`，
   播放控制（start / pause / resume / stop / setSpeed 一类）归 **#110**。
4. **DrawingManager 只覆盖了 polygon 的「画一个」链路**：`confirmVisible` 缺省分支、其余绘制模式、
   编辑 / 裁切 / 合并 / 测量、顶点吸附与 `limit` 校验都未验证（写在 `runtime.uncovered` 里）。
5. **`setSpeed()` 不进 `checks`**：它调的是上游未声明的 `ViewAnimation` 私有成员
   （`animation` / `_options` / `_beginTime` 与 `setBeginTime` / `setDuration`）。本次实测在 4.0 上未抛错
   且 duration 被改短，但这依赖私有面、随时可能消失 ⇒ 记为读数与残余风险，**不设为门禁**（否则上游一改
   就会得到一个无法行动的红灯）。同族的「播放到结尾」也只在 `readings` 里，理由相同（轮询到稳定几乎恒真）。
6. **MapVGL 的根因只是记录，不是修复**：`_rd` 与 `getPanes().mapPane` 都是脚本自己的实现，
   本库不修，只把结论与替代路径写清楚。
7. **内容摘要会随上游更新而红**：这是有意的（逼着重新核对并更新 inventory），但意味着 nightly 的
   `plugin-compat` job 偶发红时需要人判断「是漂移还是上游正常发布」。
8. **插件脚本加载通道没有复用显式 `ScriptLoader`**：`urlPluginDefinition` 走的是自己的
   `loadScriptWithExport`（只有一个 `<script>` + 全局导出短路 + `AbortSignal`），
   因此**没有超时**，也没有 SRI / `nonce` 之类属性（上游脚本本来也不提供这些入口）。
   这条与 [2026-09-13 ADR](./2026-09-13-plugin-compat-inventory.md) 已知限制里的「插件加载没有超时」
   是同一件事；本票按「先判定、再适配」没有改动加载层，已拆成独立欠账票 [#121](https://github.com/Mang-X/bmap-vue/issues/121)。
9. **CSP 没有被审计**：三个 `BMapGLLib` 脚本来自 `mapopen.bj.bcebos.com`、`Mapvgl` 来自 `unpkg.com`，
   `DrawingManager` 还会**自己**注入 `mapopen.cdn.bcebos.com` 上的两个脚本；站点的 CSP 需要放行这些来源。
   本票只在 `docs/zh-CN/guide/config.md` 写明这件事，没有做 CSP 的自动化核对。
10. **计划键 `M8-06` ~ `M8-11` 在仓库与追踪票里都没有定义**（与 2026-09-14 ADR 那条同源现象）。
    本票按**内容**逐条对照 issue 的「目标与范围 / 实施步骤 / 测试与验收」，不硬编键名到实现的映射。

## 非目标

- 不为任何插件写 Vue 组件或适配层；不新增标准搜索 / 路线 UI；不重新造 Loader；
- 不恢复 MapVGL，不为通过门禁去动 SDK 的私有回调表或 `getPanes()`；
- 不把 `MapRuntime` / `EventBus` / hash 之类内部实现搬进 `./advanced`；
- 不改官方 UI Kit 的接入方式，也不改供应商自行提供的 namespace 别名。

## 参考

- issue #43（M8-ADAPTERS-ADVANCED）、#25（M3A3-07 插件 inventory）、#110（原生 TrackLine 命令面）、#104（Evidence-before-abstraction 的存量审计）
- ADR [插件兼容 inventory 与「必需功能不依赖插件脚本」的隔离口径](./2026-09-13-plugin-compat-inventory.md)（本文取代其决策 3 与决策 7 的退出码表）
- ADR [Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)
- ADR [删除 SDK 私有面嗅探](./2026-09-13-private-sdk-surface-removal.md)
- ADR [删除旧引擎（webgl-v1 / BMapGL）](./2026-09-14-remove-legacy-engine.md)
- ADR [插件 Catalog、global / map 作用域与依赖调度](./2026-09-14-plugin-catalog-scope-scheduling.md)
- 生成物：`docs/zh-CN/contributing/plugin-compat-inventory.md`、`docs/.vitepress/plugin-inventory.json`
- 同源参考实现 `huiyan-fe/react-bmap`（`@baidumap/react-bmap@2.0.6`）：`src/drivers/unsupported.ts`、`src/drivers/capabilityMatrix.ts`、`package.json` 的 `exports` 与依赖面
