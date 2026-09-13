# AGENTS.md

## 项目

`baidu-map-gl-vue`：Vue 3 的百度地图组件/hooks 库。

工程：pnpm workspace（Node >= 24，pnpm >= 12），Vite + vue-tsc + Vitest + VitePress。

## 版本模型

| 维度 | 说明 |
| --- | --- |
| 组件库版本 | `packages/baidu-map-gl-vue/package.json` |
| SDK engine（内部） | `webgl-v1` / `jsapi-v3` / `jsapi-v4`（`src/driver`） |
| SDK version | `4.0`（`v=4.0`） |

讨论「升级」时需说明是哪一种版本。

## 架构与模块分布

组件库源码在 `packages/baidu-map-gl-vue/src`，顶层模块：

- `driver`：raw SDK 边界与 Facet Driver。
- `client`：`createBMapClient`，聚合 Driver 与运行时能力。
- `core`：loader/provider、context、lifecycle、runtime、events、errors 等底座。
- `components`、`composables`：面向使用者的 Vue 组件与 hooks。
- `plugins`、`resolver`、`advanced`：插件适配、按需解析、raw SDK 逃生口。
- `types`、`manifest`：公共类型与组件清单。

约定：`BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK 与最小类型边界；组件/composable/runtime 只依赖项目领域类型与 Facet Driver，不得直接访问全局 SDK。所有监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF 与动画都必须有释放路径。

## SDK 边界与门禁

边界配置的单一事实源：`scripts/raw-sdk-boundary.mts`（白名单 + 命名空间/全局对象清单）；
检测引擎：`scripts/raw-sdk-detector.mts`（源码门禁与公共声明门禁共用）。

raw SDK 白名单（相对 `packages/baidu-map-gl-vue/src`）：`driver/**`、`client/**`、`core/loader/**`、`plugins/**`；
`packages/test-utils` 作为 Fake 边界在扫描范围之外。其余目录（`components`、`composables`、`core/runtime` 等）为禁区。

| 命令 | 作用 |
| --- | --- |
| `pnpm check:raw-sdk` | 禁区目录静态扫描（`BMapGL`、`window.BMap`、`new BMap.*`、`BMap.*` 类型、`namespace BMap`、官方类型包导入） |
| `pnpm check:raw-sdk:tree` | 以白名单扫描整棵 `src` |
| `pnpm check:public-dts` | `dist/**/*.d.ts` 不得泄漏 `BMap.*` / `BMapGL` / 官方类型包引用（需先 `pnpm build:v3`） |
| `pnpm generate:capability-matrix:check` | Capability Catalog 能力矩阵无漂移 |

类型边界 augmentation 位于 `src/driver/jsapi-v4/augmentations/`，治理规则与元数据模板见该目录 `README.md`；
每个文件必须带 `@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` 元数据，禁止 `any`。

Capability Catalog 是能力清单的单一事实源（`src/driver/capability/catalog.ts`），
覆盖 Map / Overlay / Layer / Service / Panorama / Runtime，用 `status`（`native` / `extended` / `experimental` / `unsupported`）与 `runtimeOnly` 表达能力语义；
能力矩阵由 `pnpm generate:capability-matrix` 生成，禁止手工编辑。

## Official-first 约束

**官方已经提供的能力一律不自研。** 决策与全部依据见 ADR `2026-09-13-official-first-loader-and-ui-kit`，
锁定的发布契约见 `docs/zh-CN/contributing/official-packages.md`。

| 场景 | 必须走 | 禁止 |
| --- | --- | --- |
| 默认在线加载 JSAPI | 官方 `@baidumap/jsapi-loader`（精确锁定 `1.0.0`） | 默认路径自研 JSONP transport / 自拼入口 URL / 自管回调；官方失败时静默回退自研 |
| 非标准入口 / 企业自托管 / 宿主已加载 | 显式 `customScriptV4Provider` / `existingGlobalV4Provider`（自研 `ScriptLoader` 只服务这两条路径） | 把高级路径写成默认，或为「省事」复用它的实现 |
| 标准 UI（建议、结果列表、翻页、键盘导航、详情面板、路线面板、主题） | 官方 `@baidumap/jsapi-ui-kit`（精确锁定 `1.1.2`，optional peer） | 自研标准 UI；复制官方 UI 的内部 DOM / 交互算法；UI 与 headless 同时发同一份请求 |
| 上游没有的能力 | 按 Capability Catalog 标 `unsupported` / `unverified` | 访问 `_rd` 回调表、`qt=` 私有请求码、`getSeckeyAndSign` 等私有面来「补齐」 |

生命周期与共享状态（**没有任何组件有权处置**）：

- 不要调用官方 `reset()`（它会删进程级 `window.BMap` / `BMapGL`），只允许出现在测试与热更新；
- 不要删除 / 改写上游注入的 SDK `<script>`、回调全局或 namespace；
- **组件取消等待** = 解绑消费者 + 丢弃回包；**不等于**终止上游加载。官方没有公开取消接口，
  全部消费者取消后**保留**底层在飞任务，且不得为后续请求另插重复 script；
- 上游**没有**的脚本属性（`nonce` / `integrity` / `crossOrigin` / `referrerPolicy`）必须明确报错或
  指引外部预加载，**接收后忽略属于假支持**；
- `timeout` 与上面不同：它是**官方支持**的参数，只是语义需要显式映射——`0` = **不超时**（不是「默认超时」）。
  契约里关于 `timeout` 的语义以 ADR / 契约表为准，不要把它归进「不支持项」；
- UI Kit 在无 DOM 环境 **import 即失败**（无 `exports` 字段，`main` 指向 IIFE）：`./ui-kit` 与其 Vue 封装
  只能动态 import，不得进入根入口或任何 SSR 可达的模块图；
- 泄漏门禁按**来源**归因：真实 SDK 与百度统计脚本也会往 `document` 上挂监听且不释放，
  只数「净增 / 归零」会得到假红或假绿。

## 测试基建（`packages/test-utils`）

Fake SDK 在 raw SDK 扫描范围之外，是「组件/Facet 与 SDK 之间」的替身边界。两条约定：

- **诊断分两个口径**：`fake.diagnostics.snapshot()` 返回 `leaks`（当前**未释放**的资源，门槛值恒为 0，`assertNoLeaks()` 逐项点名）与 `activity`（累计发生过什么，不要求归零）。定时器与回调是「在飞」而非「未释放」，**只进 `activity` 与 `pendingAsync()`**——需要断言「没有在飞窗口」时要显式写出来。新增资源种类必须同时登记进 `LeakCounters` 与 `LEAK_FIELD_BY_KIND`（后者穷尽，漏登记会编译失败），并选对销账方式：`map` / `panorama` / `autocomplete` 是**生命周期类**（按实例销账，重复销毁同一个实例不能抵消别的实例的泄漏），其余是**挂载类**（按次数销账，因为 SDK 不去重、挂两次就要摘两次）。
- **跨引擎行为用 driver matrix**：`packages/test-utils/driver-matrix.ts` 的 `runDriverMatrix` / `expectSameDomainResult` 让同一份场景在多个引擎上跑并比较**领域结果**（不比较 raw SDK 调用序列）；引擎差异（Provider 形状、假账本位置、气泡活状态怎么读）一律收在引擎描述里。旧引擎把多种资源混在一个容器时，读数必须按构造器身份分类，不能把 raw 容器当领域结果用。迁移期双跑只用于验证，不形成长期兼容承诺（见 ADR `2026-09-12-fake-v4-diagnostics-and-dual-driver-matrix`）。
