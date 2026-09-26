---
"bmap-vue": major
---

# 1.0 公共出口冻结（#44）

本票是 1.0 的**唯一**公共 API / package freeze 点：根入口与六个子入口（`.` / `./components` /
`./composables` / `./plugins` / `./resolver` / `./advanced` / `./ui-kit`）的导出面从此被门禁钉死，
`package.json#exports` 不再有 `./core`。决策与逐条依据见
[ADR 2026-09-25 公共出口冻结](../docs/adr/2026-09-25-public-export-surface-freeze.md)。

**为什么**：`./core` 在冻结点上有 **105 个值导出**（#104 第三批删掉 `useMapResource` 一族之前
是 113 个），其中 **23 个本来就有别的公共出口**（16 个同时是根入口的导出，7 个同时在
`./advanced` 上——含 4 个 v4 Provider 值），另外 **82 个只有仓库内部消费者**，是内部
Runtime / Registry / Scope。issue 的决策门明确「禁止『先全导出以后再删』」，而「只留那 23 个」
之后剩下的仍是一个把内部实现整包暴露、且与根入口 / `./advanced` 重复的出口 ⇒ 落点是
**彻底取消**，不是收窄。

## 破坏性变更

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `bmap-vue/core` 子入口 | 公开子路径（105 个值导出；#104 第三批之前是 113） | **取消**：`exports` / Vite 构建入口 / `verify:package` 必需子路径清单一并去掉，`dist/core.{mjs,d.ts}` 不再产出。仓库内部仍用 `src/core/index.ts`（测试按相对路径 import，内部化 ≠ 删除） |
| v4 Provider 家族 4 个值 | `import { baiduJsapiV4Provider } from "bmap-vue/core"` | `from "bmap-vue/advanced"`：`baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider` / `createLoadedJsapiV4`（含它们的选项类型 `BaiduJsapiV4ProviderOptions` / `CustomScriptV4ProviderOptions` / `CreateLoadedJsapiV4Input`） |
| `./advanced` 上三个 Provider 工厂的**签名** | 直接 re-export 内部工厂：返回未导出的具体类；`existingGlobalV4Provider(options?)` 收 `registry` / 自研 `loader` 注入 | 返回**导出的** `JsapiV4Provider`；`BaiduJsapiV4ProviderOptions` 只剩 `loader?: OfficialJsapiLoader`、`CustomScriptV4ProviderOptions` 只剩 `mode?: JsapiV4ScriptMode`、`existingGlobalV4Provider()` 不再收参数；两个外部**无法构造**的注入字段（`registry?: SdkRegistry`、`loader?: ScriptLoader`）从公共选项**移除**（内部以 `*InternalOptions` 保留，测试按相对路径注入不受影响）；类型 `JsapiV4ProviderOptions` 从 `./advanced` 移除；新增类型导出 `JsapiV4Provider` / `OfficialJsapiLoader` / `OfficialJsapiLoadOptions` / `JsapiV4ScriptMode` |
| `LoadedSdk`（根入口与 `./advanced` 的类型别名） | `LoadedSdk = LoadedJsapiV4` 单成员别名 | **删除**，唯一名字是 `LoadedJsapiV4`。`assertLoadedSdk` / `isLoadedSdk`（`./advanced`）返回值也写成 `LoadedJsapiV4`。取代 ADR 2026-09-14 决策 2 的「保留为别名」 |
| `MapRuntimeStatus`（根入口类型） | 含 `"loading"` 别名的状态类型 | **删除**，唯一名字是 `MapStatus`（运行期 #71 起已不写 `"loading"`，文档承诺已在 #104 修正） |
| `MapRuntimeOptions.clientFactory` | 与 `clientContext` 二选一的第二条臂 | **删除**，只认 `clientContext`（`MapRuntimeOptions` 本身只在内部 barrel 上，随 `./core` 取消不再公开） |
| `UseUnifiedSdkResourceResult` | `./core` 上 `UseSdkResourceResult` 的别名 | **删除**：别名随 `./core` 取消而不复存在（它**只**在内部 barrel 上，从来不是根入口或 `./advanced` 的导出）。`useSdkResource` 仍在根入口，但它的返回类型 `UseSdkResourceResult` 与参数类型 `UseSdkResourceOptions` **始终未被导出**——消费方无法为它们命名，这条如实登记为欠账（见文末） |

随 `./core` 一起移出公共面的还有 `MapRuntime` / `SdkRegistry` / `getProcessSdkRegistry` /
`ScriptLoader` / `optionKey` / `createLayerRegistry` / `DataLayerManager` 等内部实现——它们从来
不在根入口上（根入口 120 个值导出未变），所以对根入口消费者没有影响；只有显式 `bmap-vue/core`
的 import 需要迁移。

## 不变的部分

- 根入口 120 个值导出、`./components` 52、`./composables` 23、`./plugins` 20、`./resolver` 1、
  `./ui-kit` 10 —— 集合与 #135 的无前缀命名一致；`./advanced` 21 → **25**（只多上面那 4 个
  Provider 值）。`./components` 与 `./composables` 是根入口的子集，根入口 ∩ `./ui-kit` = ∅。
- Manifest 仍是唯一的组件元数据源：`./components` 的导出集合必须**等于** `componentManifest.exportName`
  集合（不新增 `stability` / `entry` 之类字段——没有消费者就不建抽象）。
- 默认 Loader 继续委托官方 `@baidumap/jsapi-loader`；`./ui-kit` 继续是官方 UI Kit 的薄封装，
  且不被根入口或 basic path 静态引入。

## 新增门禁（会真变红的那种）

- `tests/behavior/export-surface-freeze.test.ts` —— 每个入口的**值导出精确集合** + 四条关系不变量
  （子集 / 不重叠 / Manifest 相等 / `exports` 每个键都有 `dist` 产物）。增删导出必须改测试本身。
- `pnpm check:api`（新）—— API Extractor 基线报告，`packages/bmap-vue/etc/<出口>/bmap-vue.api.md`，
  覆盖 `./advanced` `./composables` `./plugins` `./resolver` `./ui-kit`；改了公共类型面而没跑
  `pnpm generate:api` 就红。CI 在 `typecheck:*` → `build:package` 之后跑它（`dist` 是它的输入）。
- `pnpm check:api` 同时钉住各出口 `ae-forgotten-export` 的**身份集合**
  （`etc/<出口>/forgotten-exports.json`，全等才通过）。**五份基线已全部清零（issue #160）**，
  门禁从「已知的存量清单」变成**零容忍**：任何一个名字重新出现在公共声明里、而没有被对应出口
  导出，门禁立刻红。文件与比对逻辑**保留** —— 它就是这道 freeze 门本身。
  比条数会漏掉「删一个 + 新增一个」与「先降后涨回」（#159 二轮评审 P1），所以判据是**名字集合**、
  新增与清理都得经 `pnpm generate:api` 在 diff 里留痕。
- **每个出口都有一份类型级签名基线** `packages/bmap-vue/etc/<出口>/bmap-vue.dts.md`
  （`dist/<出口>.d.ts` 经 TypeScript printer `removeComments` 规范化后的全文）：`MapProps`、
  组件的 props / emits / slots / 暴露方法、根入口函数签名、以及**未导出类型的结构**一改就红。
  后者是 report 与身份集合都看不见的那层 —— `ae-forgotten-export` 在 report 里只留
  `getInputValue: typeof getInputValue` 这种名字引用，签名一改两层都不动（#159 三轮评审 P1）。
  AE 分析不了 ≠ 没有基线。
- 根入口与 `./components` **进不了 API report**：Volar 生成的多声明 `var`（`__VLS_1` / `__VLS_3` /
  `__VLS_5`）没被 `bundleTypes` 带进合并后的 d.ts，留下悬空引用，AE 抛
  `Symbol not found for identifier: __VLS_*`。这不是本票引入的（源与打包配置都没动），门禁对这两个
  出口跑**探针**并断言失败模式仍是这一种——阻塞被修好或变质都会红。
  对这两个出口，签名基线就是它们**唯一**的类型面基线。另有 `check:public-dts` + 上面的值集合测试 +
  `generate:api-diff:check` + `verify:package` 四道守。

`UseSdkResourceOptions` 作为**未导出**的参数类型仍出现在 `dist/index.d.ts` 的 `useSdkResource`
签名里：它进不了「声明文本里不得出现」的名单（那样必然误报），但**已经**被上面那份根入口签名基线
钉住 —— 形状一改基线就漂移。它是登记在案的存量，不是无从钉起的欠账。

Provider 家族迁进 `./advanced` 时留下的注入面欠账**已收口**（#159 评审 P1-2）：`registry?: SdkRegistry`
与 `loader?: ScriptLoader` 引用的两个类型没有被导出，而它们又带私有成员、外部**无法构造** ——
留在公共选项里就是「赋不了值、结构也不进报告」的假支持，因此从公共选项**移除**，只留在内部选项里。
可构造的那部分反过来**补上了导出**：`OfficialJsapiLoader` / `OfficialJsapiLoadOptions` /
`JsapiV4ScriptMode` / `JsapiV4Provider`。未导出类型的存量**已由 #160 全部结清**（五份集合基线均为
`[]`）：处置逐条走 ADR 2026-09-25 的二选一 —— 签名暴露出来的形状升为公共导出，内部运行时
（`MapContext` / `MapRuntimeShape` / `ResourceScope` / `MapEventBus` / `MapRuntime` …）
改为**让引用消失**（对外只给窄面 `PublicMapContext` / `PublicBMapClient` / `EventSourceClient`），
私有数据表（`MARKER_ICON_SPRITES`）改为**让引用它的类型不再依赖它**。`ae-unresolved-link` 两条
（`useViewAnimation` 里指向非导出成员的 `{@link start}` / `{@link cancel}`）同票结清。
详见 [ADR 2026-09-25 后果](../docs/adr/2026-09-25-public-export-surface-freeze.md)。
