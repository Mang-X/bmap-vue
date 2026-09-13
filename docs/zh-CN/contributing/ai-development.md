# AI 开发与官方 Skill

本页说明在本仓库中使用 AI Agent 与百度地图官方资料的规则。核心原则：**官方 Skill 与官方类型包都是开发期知识来源，不是运行时依赖**。

## 版本模型

仓库里同时存在三种「版本」，讨论时必须区分：

| 维度 | 含义 | 当前取值 |
| --- | --- | --- |
| 组件库版本 | `baidu-map-gl-vue` 包版本 | `3.0.0-beta.x` |
| SDK engine | 项目内部驱动引擎枚举（`webgl-v1` / `jsapi-v3` / `jsapi-v4`） | 迁移期并存，Stable 目标 `jsapi-v4` |
| SDK version | 百度地图 JSAPI 运行时版本 | Stable 目标 `4.0`（`v=4.0`） |
| 官方类型包版本 | `@baidumap/jsapi-v4-types` | `4.0.4`（精确锁定） |

决策依据见 [ADR 2026-09-10：冻结 JSAPI 4.0 单引擎基线](/adr/2026-09-10-jsapi-v4-only-baseline)。

## 官方 Skill：`bmap-jsapi-v4`

官方 Skill 是百度地图维护的 JSAPI 4.0 开发知识包，覆盖加载、Map、覆盖物、图层、服务、生命周期与排障。它在编码、评审、排障时提供 API 参考，**不是源码、不是依赖、不参与打包**。

### 安装与更新（必须使用 skills CLI）

本仓库用 [`skills`](https://skills.sh) CLI 管理，安装产物由 `skills-lock.json` 锁定。不要手工复制或改写 Skill 文件。

```bash
# 查看已安装
npx skills list

# 首次安装（会写入 .agents/skills 与 .claude/skills，并更新 skills-lock.json）
npx skills add baidu-maps/jsapi-skills --skill bmap-jsapi-v4

# 按锁文件恢复到干净环境
npx skills experimental_install

# 更新到最新版本
npx skills update bmap-jsapi-v4
```

安装落点：

- `.agents/skills/bmap-jsapi-v4/` —— 规范副本（含 `SKILL.md` 与 `references/`）。
- `.claude/skills/bmap-jsapi-v4` —— 指向规范副本的符号链接。
- `skills-lock.json` —— 版本与完整性哈希，必须随仓库提交。

### 使用规则

- 只把它当作 `v=4.0` + 全局 `BMap` 的 API 参考，**禁止混用其他版本的加载参数与命名空间**（如 `BMapGL`、`v=1.0`）。
- 从 reference 中选取满足需求的最小 API 组合，不要凭类名猜测构造参数、事件或清理方法。
- 创建监听器、覆盖物、控件、图层、服务结果、动画、全景或 `Map` 时，必须同时给出解绑/移除/取消/销毁路径。
- 依赖 AK、在线服务、CORS、WebGL 或真实数据的结果**必须在真实浏览器验证**；类型检查通过不等于运行成功。
- 不得把 Skill 文件当作源码引用、复制进 `src/` 或打进构建产物。

## 官方类型包

`@baidumap/jsapi-v4-types` 以精确版本声明在 `packages/baidu-map-gl-vue/package.json`，并通过 `packages/baidu-map-gl-vue/tsconfig.build.json` 的 `compilerOptions.types` 接入。

- 纯 `.d.ts`，没有运行时代码，也不是运行时依赖。
- 业务代码使用全局 `BMap.*`，**禁止具名导入**：

  ```ts
  // 错误
  import { Map } from "@baidumap/jsapi-v4-types";

  // 正确：类型由全局命名空间提供
  const map = new BMap.Map("container");
  ```

- 官方声明缺口只在 `packages/baidu-map-gl-vue/src/driver/jsapi-v4/augmentations/` 做最小 augmentation；禁止 `any`、禁止复制整套声明。
- 每个 augmentation 文件都必须带 `@augmentation` / `@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` / `@owner` 元数据，模板与删除流程见 [`augmentations/README.md`](https://github.com/MangMax/baidu-map-gl-vue/blob/main/packages/baidu-map-gl-vue/src/driver/jsapi-v4/augmentations/README.md)。
- 入口文件 `src/driver/jsapi-v4/types-reference.d.ts` 只用三斜线引用官方类型与 augmentation 目录，本身不再内联声明。
- 保持 `skipLibCheck: false`。升级类型包后必须重新核对 augmentation，官方补齐的声明要删除。

### 已知问题：官方 `4.0.4` 的大小写引用缺陷（已处置）

`@baidumap/jsapi-v4-types@4.0.4/index.d.ts:67` 写的是 `/// <reference path="core/displayOptions.d.ts" />`，
而发布产物中的真实文件名是 `core/DisplayOptions.d.ts`。在 macOS（默认大小写不敏感）上解析正常，
在 Linux 上则依次报：

```text
error TS6053: File '.../core/displayOptions.d.ts' not found.
error TS2552: Cannot find name 'DisplayOptions'.   // Map.d.ts / MapOptions.d.ts
```

处置（issue #50，决策见 [ADR 2026-09-13](../../adr/2026-09-13-upstream-types-case-patch.md)）：仓库用
`patches/@baidumap__jsapi-v4-types@4.0.4.patch` 在 `pnpm install` 阶段修正这一行，因此
`pnpm typecheck:v3` 在任何平台都成立，并已重新纳入 `.github/workflows/quality.yml`。

- 补丁只改文件名大小写、不改声明内容；清单、生成方式与删除条件见仓库根目录的
  `patches/README.md`（`pnpm patch` / `pnpm patch-commit`）。
- 「补丁已生效」由 `tests/behavior/v3-upstream-types-case-patch.test.ts` 把关：它用 `readdirSync`
  的精确名字比对核对已安装上游声明的全部三斜线引用（`existsSync` 在大小写不敏感卷上会误判），
  因此 macOS 与 Linux 结论一致。
- 删除条件：上游发布修正大小写的版本后，升级精确版本并删除补丁与 `pnpm-workspace.yaml` 的
  `patchedDependencies` 条目。
- 回滚：删除补丁后 `pnpm typecheck:v3` 会在 Linux 上重新失败，回滚必须同时把该 step 从 CI 摘掉，
  并更新本页与 `CONTRIBUTING.md`。

## SDK 边界：raw SDK 与公共声明

边界配置的单一事实源是 `scripts/raw-sdk-boundary.mts`，源码门禁与公共声明门禁共用同一份规则与检测引擎（`scripts/raw-sdk-detector.mts`）。

### 目录白名单

`BMap.*` / `BMapGL` 只允许出现在以下边界（相对 `packages/baidu-map-gl-vue/src`）：

| 边界 | 用途 |
| --- | --- |
| `driver/**` | v4 Driver 实现与 `driver/jsapi-v4/**` 类型边界 |
| `client/**` | `createBMapClient` 聚合层 |
| `core/loader/**` | Loader / Provider / SdkRegistry。全局探测只允许在这一层：迁移期 `Provider.ts`（内部 `readGlobalSdk()`，对外 `hasExistingGlobalSdk()`）、v4 目标 `providers/namespace.ts`（`readJsapiV4Global()`）；v4 Provider 家族见该目录 `providers/` |
| `plugins/**` | 插件适配与 CDN 定义 |
| `packages/test-utils` | Fake SDK（独立测试边界，不在扫描范围内） |

其余目录（尤其 `components`、`composables`、`core/runtime`）一律视为禁区。

### 检测规则

| 规则 | 说明 |
| --- | --- |
| `legacy-namespace` | `BMapGL` 标识符 / `"BMapGL"` 字符串键 |
| `global-member` | `window.BMap` / `globalThis.BMap` / `self.BMap` / `window["BMap"]`（含 `as any` 双转型） |
| `namespace-root` | `BMap.*` 成员访问、方括号访问与 `new BMap.*()`；接收者会先解包 `( )`、`as`、非空断言与 `satisfies`，因此 `new (BMap as any).Point()` 同样被拦截 |
| `type-position` | `BMap.*` 类型位置（`BMap.Point`、`BMap["Point"]`、`typeof BMap`） |
| `namespace-declaration` | `namespace BMap` / `declare global` |
| `official-types-import` | 具名导入 `@baidumap/jsapi-v4-types` |
| `official-types-reference` | 三斜线 `/// <reference types="@baidumap/jsapi-v4-types" />`（按包名判定，属性顺序、引号与空格不影响） |

组件同名导出 `export { BMap }`、字符串 `"BMap"`、`BMapProvider` 等复合名、以及 `h(BMap)` / `{ BMap }` 这类把 `BMap` 当组件值的用法都不会误报。注意：仅做「重命名到另一个变量再访问」的别名（如 `const M = BMap; new M.Map()`）不在静态门禁范围内——这需要数据流分析，目前依靠目录白名单约束。

### 门禁

| 命令 | 作用 |
| --- | --- |
| `pnpm check:raw-sdk` | 扫描禁区目录（`components` / `composables` / `core/runtime`） |
| `pnpm check:raw-sdk:tree` | 以白名单扫描整棵 `src`，白名单外的任何 raw SDK 引用都会失败 |
| `pnpm check:public-dts` | 校验 `dist/**/*.d.ts` 无 `BMap.*` / `BMapGL` / 官方类型包引用，且类型边界文件未被发布 |

`pnpm check:public-dts` 需在 `pnpm build:v3` 之后运行；CI 的两个 job 都会在构建后执行。

## Capability Catalog

能力清单的单一事实源是 `packages/baidu-map-gl-vue/src/driver/capability/catalog.ts`，覆盖 **Map / Overlay / Layer / Service / Panorama / Runtime** 六个 family，并用 `status` 表达 `native` / `extended` / `experimental` / `unsupported` 四种状态、用 `runtimeOnly` 标注只能运行时探测的能力。

- 能力矩阵由数据生成，请勿手工编辑：`pnpm generate:capability-matrix` 生成
  [Capability Catalog 能力矩阵](./capability-matrix) 与 `docs/.vitepress/capability-catalog.json`，
  CI 用 `pnpm generate:capability-matrix:check` 校验无漂移。
- `status: "unsupported"` 的条目 `supports()` 恒为 `false`（用户 override 除外），保留槽位使错误信息、文档与能力矩阵保持一致。
- `rawMembers` 名称以官方 `@baidumap/jsapi-v4-types@4.0.4` 声明为基准核对（`core/Map.d.ts` 与各子目录的 `declare namespace BMap`）。

## AI Agent 边界

- `BMap.*` 只允许出现在 v4 Driver/Provider、Fake SDK、`src/driver/jsapi-v4/**` 类型边界与最小 augmentation。
- 组件、业务 composable、runtime 只能依赖项目领域类型与 Facet Driver，禁止直接访问 `window.BMap` / `window.BMapGL`。
- raw SDK 只允许出现在 `src/driver`、`src/client`、`src/core/loader`、`src/plugins` 适配层与 Fake 边界。
- 任何资源都必须有释放路径；`pnpm check:raw-sdk` 与 `pnpm check:public-dts` 是硬门禁。

## 提交前验证

```bash
pnpm typecheck:v3          # 官方类型 + 最小 augmentation 在 skipLibCheck:false 下可合并（须排在 build:v3 之前）
pnpm test:unit
pnpm build:v3
pnpm check:raw-sdk         # 禁区目录 raw SDK 边界
pnpm check:raw-sdk:tree    # 整棵 src 按白名单校验
pnpm check:public-dts      # 公共声明无 BMap.* 泄漏(需先 build:v3)
pnpm generate:capability-matrix:check
pnpm docs:build            # 涉及文档时
```

涉及 SDK 行为的改动，在 PR 描述中说明：

- SDK 依据（`v=4.0`/`BMap` 还是迁移期 `webgl-v1`）；
- 生命周期检查（监听器/覆盖物/控件/图层/异步/动画的释放路径）；
- 迁移影响（是否改变公共 API、是否影响 2.x/3.x 支持政策）。
