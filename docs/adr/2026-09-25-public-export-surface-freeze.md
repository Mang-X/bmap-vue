# ADR 2026-09-25：1.0 公共出口冻结（取消 `./core`、出口白名单与 API report 单源）

- 状态：已接受（Accepted）
- 日期：2026-09-25
- 计划键：`1.0-FREEZE`（issue #44，追踪 #12；前置 #134 / #135 / #136 / #124 / #137 / #138 / #139 / #140 全部完成）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-14 删除旧引擎](./2026-09-14-remove-legacy-engine.md) 决策 2 中
    「`LoadedSdk` 保留为 `LoadedJsapiV4` 的别名（名字不变，避免无谓的签名抖动）」——**别名删除**，
    见本文决策 3；该 ADR 其余决策（单一 engine 取值、`assertLoadedSdk` 收口、no-bmapgl 门禁）不变；
  - [ADR 2026-09-11 LoadedSdk 客户端收口](./2026-09-11-loaded-sdk-client-boundary.md) 决策 12
    中「`LoadedSdk` 从根入口导出」的**名字部分**——仍需为 `load()` 返回值命名，但名字是
    `LoadedJsapiV4`。该决策「不导出就无法为返回值命名」的理由继续成立。
- 落实：[ADR 2026-09-21 插件迁移与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md)
  决策 5 已把 `./core` **声明**为内部面；本文把「声明」变成 `package.json#exports` 与门禁里的**事实**。
- 相关：`packages/bmap-vue/package.json#exports`、`packages/bmap-vue/src/{index,advanced}.ts`、
  `scripts/check-api.mts`、`tests/behavior/export-surface-freeze.test.ts`、
  `tests/behavior/core-surface.test.ts`、`docs/zh-CN/contributing/architecture-ownership-audit.md`

## 背景

#44 是 1.0 的**唯一**公共 API / package freeze 点：在此之前允许 clean-slate 重命名与删除兼容层，
冻结之后只修 blocker。做这件事要同时回答四个问题，而它们在 #44 之前都只有**声明**、没有**事实**：

1. **`./core` 是什么？** 它当时是公开子路径，同时装着内部实现（`MapRuntime`、`SdkRegistry`、
   `ScriptLoader`、`SharedLoadTask`、`ResourceScope`、`DataLayerManager`……）与真正有扩展需求的
   v4 Provider 家族。审计表在 #104 第三批**之前**记的是 113 个值导出；第三批删掉
   `useMapResource` / `SdkResourceAdapter` / `conflictPolicy` 一族后，冻结点上实测是
   **105 个**（`import * as core` 的 `Object.keys` 计数，含 4 个待迁移的 Provider 值）。
2. **「删过的别名」到底删干净了没有？** #104 第三批把「零消费者、纯删就完事」的收掉了，
   但留下 **7 项**「要连带改夹具或改公共命名约定」的登记项（见 issue #44 2026-09-22 的评论），
   它们的共同点是：不动就会随冻结被**顺手承诺**成 3.0 的契约。
3. **组件元数据有几个来源？** 组件清单（Manifest）、Resolver、Volar、API report 各写一份名字，
   任何一处手改都造成漂移。
4. **谁来证明「冻结面就是这些」？** 没有 API report 时，「公共类型面变了」这件事只能靠人眼。

本决策把这四件事各钉成一条**会变红**的规则。

## 决策

### 1. 彻底取消 `./core` 子入口，而不是收窄它

issue 的 `./core` 决策门要求「禁止『先全导出以后再删』」，并要求把现有 consumer **分成两列**
（有公开消费者 / 只有库内消费者）。按门逐项盘完，105 个值导出落在四档：

| 档 | 判据 | 命中（冻结点实测） |
| --- | --- | --- |
| 已有别的公共出口 ⇒ `./core` 这份只是**重复出口** | 名字同时出现在根入口（16 个）或 `./advanced`（7 个）上 | **A 列，23 个**（逐项见下） |
| 有真实第三方 / 公开扩展需求 → 迁到 `./advanced` | 被**仓库之外**的扩展路径按名字取用 | 4 个 v4 Provider 值（已含在 A 列那 7 个里） |
| 只有仓库内部 consumer → 不公开 | 本仓源码按相对路径引用 | **B 列，82 个**（`MapRuntime`、`SdkRegistry`、`ScriptLoader`、`optionKey`、`getProcessSdkRegistry`……） |
| 仅测试 / 历史迁移 consumer → 删除 | 无生产消费者 | 已在 #104 第三批删掉的 `useMapResource` / `conflictPolicy` / `resetProcessSdkRegistryForTests` 等 |

A 列逐项（16 + 7 = 23）：

- **16 个本来就从根入口导出**（取消 `./core` 对它们**没有任何影响**）：`OVERLAY_EVENT_MATRIX`、
  `OVERLAY_KINDS_WITHOUT_EVENT_MATRIX`、`ResourceScope`、`bmapClientContextKey`、
  `createClientContext`、`defaultClientDefinitionKey`、`dynamicEmit`、`overlayEventOf`、
  `overlayEventsOf`、`overlayPointerFallback`、`targetContextKey`、`useOptionalClientContext`、
  `useOverlaySpec`、`useParentOverlayHandle`、`useRequiredClientContext`、`useSdkResource`；
- **7 个经 `./advanced` 拿到**：迁移过去的 `baiduJsapiV4Provider` / `customScriptV4Provider` /
  `existingGlobalV4Provider` / `createLoadedJsapiV4`，加本来就在 `./advanced` 上的
  `assertLoadedSdk` / `isLoadedSdk` / `isPointLike`；
- **B 列 82 个不逐个抄表**：文档表格会漂移，所以这两列由
  `tests/behavior/core-surface.test.ts` 的分栏用例**当场重算**——A 列钉成精确集合，
  B 列由定义就是「不在任何公共出口上」（补集的**个数**刻意不钉，否则「新增一个内部实现」
  这种合法改动也要改测试）。

**23 : 82 同样不构成一个「收窄后的稳定出口」**——剩下的 82 个仍是把内部 Runtime / Registry /
Scope 整包暴露；而那 23 个又各自已经有根入口 / `./advanced` 两个合法落点，留着 `./core` 只会
再制造一处重复事实源。因此落点是**删除子路径**：`package.json#exports` 去掉 `./core`、
Vite 构建入口去掉 `core`、`verify:package` 的必需子路径清单去掉 `./core`、消费方 fixture 从
`bmap-vue/core` 改成 `bmap-vue/advanced`。

`src/core/**` 这个**内部 barrel 保留不动**：仓库内的测试按相对路径 import 它，
「内部化」不等于「删除」（与 #104 把 `resetProcessSdkRegistryForTests` 内部化是同一条口径）。
`tests/behavior/core-surface.test.ts` 因此**反转**了原先的前置断言：现在要求 `./core`
**不在** `exports` 里、`dist/core.{mjs,d.ts}` **不存在**，同时给出正证（`Object.keys(core).length > 50`、
`getProcessSdkRegistry` 身份可取）——证明它只是不再公开。

### 2. 根入口 + 六个子入口，各自的值导出集合被测试钉死

| 出口 | 值导出 | 守门测试 |
| --- | --- | --- |
| `.` | 120 | `export-surface-freeze.test.ts` 精确集合 |
| `./components` | 52 | 同上，且必须**等于** `componentManifest.exportName` 集合 |
| `./composables` | 23 | 同上 |
| `./plugins` | 20 | 同上 |
| `./resolver` | 1 | 同上 |
| `./advanced` | 25 | 同上 + `advanced-contract.test.ts` 的 `FROZEN_ADVANCED_EXPORTS` |
| `./ui-kit` | 10 | `ui-kit-entry.test.ts` + 根入口不重叠的反证 |

外加四条关系不变量，也在同一个测试里：`./components`、`./composables` 是根入口的**视图**（子集）；
根入口 ∩ `./ui-kit` = ∅（basic path 不静态拉 UI Kit 的第一道静态防线）；
`package.json#exports` 的每个键都有 `dist` 产物（`*.mjs` + `*.d.ts`）。
增删任何导出都要改测试文件本身——「顺手加一个导出」从静默变成一次显式评审。

### 3. #104 留下的 7 项 + 出口形状的 1 项，逐条结清（不留别名）

前 7 项是 #104 2026-09-22 评论登记的「要连带改夹具或改公共命名约定」清单；第 8 项是
[Ownership-first 审计表](../zh-CN/contributing/architecture-ownership-audit.md) 里同样挂在 #44
名下的**出口形状收窄**，一并在这里结清（审计表处置列已同步）。

| # | 项 | 处置 |
| --- | --- | --- |
| 1 | `MapRuntimeOptions.clientFactory`（与 `clientContext` 二选一的第二条臂） | **删除**：`clientFactory` 臂不再存在，夹具与实现收敛到 `clientContext` |
| 2 | `MapRuntimeStatus` 的 `"loading"` 别名 | **删除类型**：唯一名字是 `MapStatus`（运行期 #71 起已不写 `"loading"`，文档承诺已在 #104 修正） |
| 3 | `LoadedSdk = LoadedJsapiV4` 单成员别名 | **删除别名**：唯一名字是 `LoadedJsapiV4`（取代 ADR 2026-09-14 决策 2 的「保留为别名」） |
| 4 | `client.version` 的 `@deprecated` 别名 | **已不存在**：`BMapClient` 三个维度各自报告（组件库版本 / engine / SDK 运行时版本），无单字段别名 |
| 5 | `optionKey()` 对 `stableKeyOf` 的一行转发 | **内部化**：随 `./core` 取消一并移出公共面，仓库内按相对路径使用 |
| 6 | `useBMapServiceTask` 经 `export * from "./composables"` 从根入口外泄 | **#139 已内部化**：根入口与 `./composables` 都不再有它，且无公开签名引用它的类型 |
| 7 | `UseSdkResourceOptions` / `UseSdkResourceResult as UseUnifiedSdkResourceResult` | **内部化**：`UseUnifiedSdkResourceResult` 这个别名已从内部 barrel 之外消失（文本门禁可钉）；`UseSdkResourceOptions` 仍作为**未导出**的参数类型出现在 `dist/index.d.ts` 的 `useSdkResource` 签名里，因此它**不能**进「声明文本里不得出现」的名单（那样必然误报），欠账如实登记 |
| 8 | `getProcessSdkRegistry(domain, options)` 首参与 `options.domain` 语义重复（删掉冲突开关后 `SdkRegistryOptions` 只剩 `domain`，三个 Provider 曾写成 `getProcessSdkRegistry(JSAPI_V4_DOMAIN, { domain: JSAPI_V4_DOMAIN })`） | **收窄 + 内部化**：签名收成单参 `getProcessSdkRegistry(domain = DEFAULT_DOMAIN)`，且随 `./core` 取消只在内部 barrel 上（ADR 2026-09-10 已加后续注记） |

判据是**一条**：冻结面里不留任何 deprecation alias / 单成员别名——「以后再删」在 1.0 之后成本更高。

### 4. Manifest 是唯一的组件元数据源，但**不新增字段**

`./components` 的导出集合与 `componentManifest.exportName` 集合必须逐个相等（集合相等，不是子集），
重复名字另有断言。这样 Resolver、Volar、组件清单从 Manifest 派生这件事，由测试**反向**钉住：
任何一侧手改名字都会红。

刻意**没有**给 Manifest 增加 `stability` / `entry` / `sdk` / `capability` / `backend` 之类字段：
仓库现有的证据优先口径（Evidence-before-abstraction）要求先有消费者再建字段——当前没有任何代码
读这些字段，加进去只会把 Capability Catalog 与 API diff **抄第二遍**，制造新的漂移面。
`generate:manifest:check` 已经在守「生成物无手工漂移」。

### 5. API report：5 份基线 + 2 份签名基线 + 2 个**探针**（而不是静默跳过）

`scripts/check-api.mts`（`pnpm check:api` / `pnpm generate:api`）：

- **有基线**：`./advanced` `./composables` `./plugins` `./resolver` `./ui-kit` ——
  报告在 `packages/bmap-vue/etc/<出口>/bmap-vue.api.md`，与基线不一致就红，
  这就是「API report 只有经过审核的新 1.0 面」那条验收。
- **没有 report 但有类型级签名基线**：`.` 与 `./components` 在
  `etc/<出口>/bmap-vue.dts.md` —— 它是 `dist/<出口>.d.ts` 经 TypeScript printer
  （`removeComments: true`）规范化后的全文快照。**只有探针等于「已知分析不了 ⇒ 没人守」**：
  AE 分析不了不等于这两个出口没有基线，`MapProps`、组件的 props / emits / slots / 暴露方法、
  根入口函数签名一改就红（#159 评审 P1-1；走的是评审给的第二条路 —— 修 Volar `__VLS_`
  打包属于另一件事，见「非目标」）。
- **没有基线但每次真的跑一遍**：同一个 `.` 与 `./components` 还各有一道**探针**。API Extractor
  的符号表无法分析 Volar 生成的**多声明 `var`**（`declare var __VLS_1: {...}, __VLS_3: {...};`），
  `vite-plugin-dts` 的 `bundleTypes` 又没把它带进合并后的声明，于是 `dist/index.d.ts` 与
  `dist/components.d.ts` 留下 `typeof __VLS_1` 这样的**悬空引用**，AE 抛
  `Symbol not found for identifier: __VLS_*`。这**不是** #44 引入的（源与打包配置都没动）。
  门禁对这两个出口跑探针并断言失败模式仍是这一种——阻塞被修好、或变成别的错误，都会红，
  提示把它们加进名单。**静默跳过**才是真正的风险：没人会发现阻塞已经消失或变质。
- **未导出类型条数上限**：`FORGOTTEN_EXPORT_CEILING` 按出口钉住 `ae-forgotten-export` 的条数，
  **只许减不许增**（#159 评审 P1-2）。原因见「后果」：这类类型在报告里只剩一个名字，它们的
  结构漂移不会改变基线文本 —— 条数是唯一可比的量。存量清零之后这张表可以直接删掉。

`--local` 写基线时还有一条**回滚**规则：AE 是先落盘、后判定成败的（`_writeApiReport` 早于
success 判定），`localBuild` 下即使分析报错也会覆盖既有基线。所以报错时先把文件恢复成运行前的
内容再退出，否则一次失败的 `pnpm generate:api` 会留下被污染的基线（#159 评审 P2）。

根入口与组件的类型面另有四道门守：`check:public-dts`（不泄漏 raw SDK / 官方类型包）、
`export-surface-freeze.test.ts`（值导出精确集合）、`generate:api-diff:check`（根入口导出名 vs
官方参考）、`verify:package`（tarball 消费方 `vue-tsc`）。

### 6. 门禁的顺序约束写进 CI

`tsconfig.build.json` 的 `declarationDir` 是 `./dist/dts`，所以 `typecheck:package` 会**写**进
`dist`；`check:public-dts` 与 `check:api` 都读 `dist`。顺序因此是
`typecheck:*` → `build:package` → `check:public-dts` / `check:raw-sdk:declarations` / `check:api`
→ `test:unit`，并在 `quality.yml` 里注明，避免「先跑门禁再构建」的假红。

## 后果

**正面**

- 冻结面第一次变成**可执行的**：根入口 + 六个子入口的值导出集合（7 个 `exports` 键，另有
  `./package.json`）、五份 API report、两个出口的类型级签名基线、组件集合与 Manifest 的
  相等关系，四处都是一改就红。
- `./advanced` 成为唯一的扩展契约入口，v4 Provider 家族只此一处（根入口反证也钉住）。
- `./core` 的 105 个值导出里，**82 个内部实现**不再被冻结成 3.0 的契约；另外 23 个本来就有
  根入口 / `./advanced` 这两个落点，取消子路径不改变它们的公共身份。

**负面 / 代价**

- **破坏性变更**：`bmap-vue/core` 消费方必须改 import（迁移目标是 `bmap-vue/advanced`）；
  `LoadedSdk` → `LoadedJsapiV4`、`MapRuntimeStatus` → `MapStatus` 的改名要出 release note；
  `./advanced` 上三个 Provider 工厂的签名同样变了 —— 返回值收成 `JsapiV4Provider`、
  `existingGlobalV4Provider()` 不再收 options、`JsapiV4ProviderOptions` 这个类型名从
  `./advanced` 移除（内部仍以 `JsapiV4ProviderInternalOptions` 存在）。
  当前 `1.0.0-rc.0`，按 **`major`** 登记（`.changeset/44-public-export-surface-freeze.md`），
  变更一并写在那份 changeset 里。
- `dist/index.d.ts` / `dist/components.d.ts` 的 `__VLS_` 悬空引用**仍然**在（且会被
  `skipLibCheck` 掩盖），本决策只保证「有探针盯着它」，不修复它 —— 但这两个出口的**类型级
  签名基线**已经补齐，签名漂移照样红。
- `UseSdkResourceOptions` 作为未导出参数类型留在 `dist/index.d.ts` 里（形状上是「引用了一个
  没有导出的类型」），现在由 `etc/index/bmap-vue.dts.md` 钉住：形状一改基线就漂移。
  它是**登记在案的存量**，不再是「无从钉起」的欠账。
- **Provider 选项的注入面（随它们迁进 `./advanced` 而产生）已收口**：原先三个字段引用的类型
  （`registry?: SdkRegistry`、`loader?: ScriptLoader`、`loader?: OfficialJsapiLoader`）都没被
  导出，`./advanced` 基线里 33 条 `ae-forgotten-export` 就包含它们。#159 评审指出这里原先的
  理由有一处**事实错误**：没导出 ≠ 消费方无法命名 —— `NonNullable<BaiduJsapiV4ProviderOptions["registry"]>`
  这类 indexed access 一样取得到，所以这两个字段**确实是公共契约的一部分**；而
  `SdkRegistry` / `ScriptLoader` 带私有成员、外部**无法构造** ⇒ 赋不了值，它们的结构也不进
  报告（`ae-forgotten-export` 只在报告里留一个名字）。按本 ADR 自己预留的二选一走**第二条**：
  这两个字段从公共选项**移除**，只留在内部选项（`JsapiV4ProviderInternalOptions` /
  `BaiduJsapiV4ProviderInternalOptions` / `CustomScriptV4ProviderInternalOptions`，测试仍按
  相对路径注入）。公共面只承诺外部**能自己构造**的东西 —— `BaiduJsapiV4ProviderOptions.loader`
  （`OfficialJsapiLoader` 是全公开接口，连同 `OfficialJsapiLoadOptions` 一起导出）、
  `CustomScriptV4ProviderOptions.mode`（`JsapiV4ScriptMode`），工厂返回值收成导出的
  `JsapiV4Provider`（AE 报告**不渲染 `private` 成员** —— `ApiReportGenerator` 对
  `ModifierFlags.Private` 直接 `return false` —— 所以返回契约只含 `id` / `getCacheKey` / `load`，
  实现里的私有状态不会被冻结）。
- **结构仍不可见的存量**由 `FORGOTTEN_EXPORT_CEILING` 按**条数**兜底（只许减不许增）：
  `advanced` 27 / `composables` 41 / `plugins` 9 / `ui-kit` 21（`resolver` 已是 0）。逐条决定
  「导出还是收窄签名」是后续票的事，至少这条门保证它不会静默变多。

**回滚**

- 三样都是独立开关：`exports` 加回 `./core` + Vite 加回 `core` 入口（但要连带恢复
  `core-surface.test.ts` 的反向前置）；删除 `export-surface-freeze.test.ts` 与 `etc/**`；
  摘掉 `quality.yml` 的 `check:api` 步骤。改名项（`LoadedJsapiV4` / `MapStatus`）回滚代价最高，
  因此它们**先**在 #44 里做掉，不留别名。

## 非目标

- **不修** Volar `__VLS_` 悬空引用（它是 SFC 声明生成 + `bundleTypes` 的缺陷，与冻结出口无关；
  修好之后 `.` 与 `./components` 应进 API report 名单——探针会在那一刻红）。
- **不给** Manifest 新增 `stability` / `entry` / `sdk` 等字段（无消费者即不建抽象）。
- **不建** `@bmap/core` 包，也不为「未来可能的其它框架消费者」预建包。
- **不补**能力矩阵：冻结标准是「边界清楚且有证据」，未知能力按 Capability Catalog 标
  `unsupported` / `experimental` 即可。
- **不**把 `./core` 的 105 个值导出钉成精确集合——决策是取消它，而不是冻结它；
  被钉住的只有「还能从公共出口拿到的那 23 个」，它证明的是**取消没有波及公共面**，
  不是「内部 barrel 的形状从此不能变」。

## 参考

- issue [#44](https://github.com/Mang-X/bmap-vue/issues/44)（含 2026-09-21 的 `./core` 欠账登记
  与 2026-09-22 的 7 项出口收窄清单）
- [Ownership-first 存量审计表](../zh-CN/contributing/architecture-ownership-audit.md)
- ADR 2026-09-14 `remove-legacy-engine`、ADR 2026-09-11 `loaded-sdk-client-boundary`、
  ADR 2026-09-21 `plugin-verdicts-and-advanced-freeze`
