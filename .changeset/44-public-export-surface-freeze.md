---
"bmap-vue": major
---

# 1.0 公共出口冻结（#44）

本票是 1.0 的**唯一**公共 API / package freeze 点：根入口与六个子入口（`.` / `./components` /
`./composables` / `./plugins` / `./resolver` / `./advanced` / `./ui-kit`）的导出面从此被门禁钉死，
`package.json#exports` 不再有 `./core`。决策与逐条依据见
[ADR 2026-09-25 公共出口冻结](../docs/adr/2026-09-25-public-export-surface-freeze.md)。

**为什么**：`./core` 在冻结点上有 **105 个值导出**（#104 第三批删掉 `useMapResource` 一族之前
是 113 个），其中只有 4 个（v4 Provider 家族）有仓库之外的扩展消费者，其余 101 个全是内部
Runtime / Registry / Scope。issue 的决策门明确「禁止『先全导出以后再删』」，而「收窄到 4 个」之后
剩下的仍是一个把内部实现整包暴露的出口 ⇒ 落点是**彻底取消**，不是收窄。

## 破坏性变更

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `bmap-vue/core` 子入口 | 公开子路径（105 个值导出；#104 第三批之前是 113） | **取消**：`exports` / Vite 构建入口 / `verify:package` 必需子路径清单一并去掉，`dist/core.{mjs,d.ts}` 不再产出。仓库内部仍用 `src/core/index.ts`（测试按相对路径 import，内部化 ≠ 删除） |
| v4 Provider 家族 4 个值 | `import { baiduJsapiV4Provider } from "bmap-vue/core"` | `from "bmap-vue/advanced"`：`baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider` / `createLoadedJsapiV4`（含它们的选项类型 `BaiduJsapiV4ProviderOptions` / `CustomScriptV4ProviderOptions` / `JsapiV4ProviderOptions` / `CreateLoadedJsapiV4Input`） |
| `LoadedSdk`（根入口与 `./advanced` 的类型别名） | `LoadedSdk = LoadedJsapiV4` 单成员别名 | **删除**，唯一名字是 `LoadedJsapiV4`。`assertLoadedSdk` / `isLoadedSdk`（`./advanced`）返回值也写成 `LoadedJsapiV4`。取代 ADR 2026-09-14 决策 2 的「保留为别名」 |
| `MapRuntimeStatus`（根入口类型） | 含 `"loading"` 别名的状态类型 | **删除**，唯一名字是 `MapStatus`（运行期 #71 起已不写 `"loading"`，文档承诺已在 #104 修正） |
| `MapRuntimeOptions.clientFactory` | 与 `clientContext` 二选一的第二条臂 | **删除**，只认 `clientContext`（`MapRuntimeOptions` 本身只在内部 barrel 上，随 `./core` 取消不再公开） |
| `UseUnifiedSdkResourceResult` | `./core` 上 `UseSdkResourceResult` 的别名 | **删除**：`useSdkResource` 的结果类型从根入口以 `UseSdkResourceResult` 导出（不变），别名不再存在 |

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
- 根入口与 `./components` **暂时进不了 API report**：Volar 生成的多声明 `var`（`__VLS_1` / `__VLS_3` /
  `__VLS_5`）没被 `bundleTypes` 带进合并后的 d.ts，留下悬空引用，AE 抛
  `Symbol not found for identifier: __VLS_*`。这不是本票引入的（源与打包配置都没动），门禁对这两个
  出口跑**探针**并断言失败模式仍是这一种——阻塞被修好或变质都会红。根入口的类型面此时由
  `check:public-dts` + 上面的值集合测试 + `generate:api-diff:check` + `verify:package` 四道守。

`UseSdkResourceOptions` 作为**未导出**的参数类型仍出现在 `dist/index.d.ts` 的 `useSdkResource`
签名里（消费方无法为它命名），这条如实登记为欠账，不在本票顺手修——它进不了「声明文本里不得出现」
的名单，否则必然误报。
