# 贡献指南

感谢你愿意为 `baidu-map-gl-vue` 花时间。这份文档说明本仓库的提交约定与门禁要求；
更深入的专题（AI 开发流程、Capability Catalog）见文档站：

- [AI 开发与官方 Skill](https://MangMax.github.io/baidu-map-gl-vue/zh-CN/contributing/ai-development)
- [Capability Catalog 能力矩阵](https://MangMax.github.io/baidu-map-gl-vue/zh-CN/contributing/capability-matrix)

## 先确认去哪儿

| 你想做的事 | 去哪儿 |
| --- | --- |
| 提问、用法讨论、提想法 | [Discussions](https://github.com/MangMax/baidu-map-gl-vue/discussions) |
| 报可复现的缺陷 / 提明确的需求 | [Issues](https://github.com/MangMax/baidu-map-gl-vue/issues/new/choose) |
| 报告安全漏洞 | [私密报告表单](https://github.com/MangMax/baidu-map-gl-vue/security/advisories/new)（不要发公开 issue） |

报缺陷前请先确认是**本组件库**的问题还是**百度地图 JSAPI** 本身的问题（用官方示例对比一下即可），
并在 issue 里写明版本、复现步骤与期望表现。

## 环境要求

- Node.js `>= 24.0.0`
- pnpm `>= 12.0.0`（仓库用 pnpm workspace，请不要用 npm / yarn 安装依赖）

```bash
git clone https://github.com/MangMax/baidu-map-gl-vue
cd baidu-map-gl-vue
pnpm install

pnpm playground:dev   # 起 playground 手动验证
pnpm docs:dev         # 起文档站，写文档 / 调试组件
```

## 版本模型（提 issue / PR 时请说清是哪一种）

| 维度 | 说明 |
| --- | --- |
| 组件库版本 | `packages/baidu-map-gl-vue/package.json` |
| SDK engine（内部） | `webgl-v1` / `jsapi-v3` / `jsapi-v4` |
| SDK version | 百度 JSAPI `4.0` |

仓库目前正在从旧 engine 迁移到 `jsapi-v4`，所以「升级」这类说法必须指明是哪一维。

## 提 PR 的流程

1. 从 `main` 切出语义化分支，例如 `m3a2-overlays`、`fix/infowindow-teleport`、`docs/contributing`。
2. 提交信息用 [Conventional Commits](https://www.conventionalcommits.org/)：`feat` / `fix` / `chore` / `docs` / `refactor` / `test`，正文用中文描述即可。
3. 推送后开 PR，按仓库的 PR 模板填写。**PR 标题会成为 squash 后的 commit 标题**，所以要按提交信息的规范写。
4. `main` 已开启分支规则集：必须走 PR、必须通过 `quality (24)` 与 `v3` 两项检查、线性历史、只允许 squash 合并。
   合入后源分支会自动删除。

## 提交前的本地门禁

CI 跑的就是下面这些，本地先跑一遍能省一轮往返：

```bash
pnpm install --frozen-lockfile

pnpm check:raw-sdk              # 禁区目录静态扫描
pnpm check:raw-sdk:tree         # 按白名单扫描整棵 src
pnpm generate:manifest:check    # v3 组件 manifest 无漂移
pnpm generate:capability-matrix:check
pnpm typecheck:v3               # 官方类型 + 最小 augmentation 在 skipLibCheck:false 下可合并
pnpm build:v3
pnpm check:public-dts           # dist/**/*.d.ts 不得泄漏 BMap.*
pnpm test:unit
```

顺序不是随意的：`typecheck:v3` 会把声明 emit 到 `dist/`，所以它要排在 `build:v3` **之前**
（`build:v3` 会先清空 `dist`）；而 `check:public-dts` 与 `test:unit` 依赖 `dist/` 产物，必须排在
`build:v3` 之后。

如果 `generate:*:check` 报漂移，而你**确实**是有意改的，用对应的生成命令（`pnpm generate:manifest`、
`pnpm generate:capability-matrix`）重新生成并一起提交；生成物不要手改。

包出口相关改动还要验证 tarball 消费方：

```bash
pnpm --filter baidu-map-gl-vue pack --pack-destination .artifacts
pnpm verify:package
```

`pnpm typecheck:v3` 依赖 `patches/@baidumap__jsapi-v4-types@4.0.4.patch`：上游 `4.0.4` 的
`index.d.ts` 有一处文件名大小写缺陷，只在大小写敏感的文件系统上暴露（issue #50）。补丁清单与
删除条件见 [`patches/README.md`](./patches/README.md)，决策见
[ADR 2026-09-13](./docs/adr/2026-09-13-upstream-types-case-patch.md)。升级类型包时请一并处理这个补丁。

## 代码约束（会被静态扫描挡住）

这是本仓库最关键的两条纪律，违反会直接 CI 失败：

1. **raw SDK 边界**。`BMap.*` / `BMapGL` / `window.BMap` / 官方类型包只允许出现在
   `src/driver/**`、`src/client/**`、`src/core/loader/**`、`src/plugins/**`。
   组件、composable 与 runtime 只能依赖项目自己的领域类型和 Facet Driver。
   边界的单一事实源是 `scripts/raw-sdk-boundary.mts`，门禁是 `pnpm check:raw-sdk`。
2. **一切都要有释放路径**。监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF、动画，
   全部必须能在卸载时被清理；新增这类资源时请一并补上守护用例。

类型边界 augmentation 放在 `src/driver/jsapi-v4/augmentations/`，每个文件必须带
`@upstream` / `@upstreamVersion` / `@runtimeBasis` / `@deletionCondition` 元数据，且禁止 `any`，
详见该目录的 `README.md`。

## 文档与示例

- 文档站在 `docs/`，示例组件在 `docs/examples/`，改公共 API 时请同步更新。
- 面向 AI 编码工具的说明在 `AGENTS.md`，改动架构约定时一起更新。

## 版本发布

发布走 [Changesets](https://github.com/changesets/changesets)。

```bash
pnpm changeset          # 交互式生成一个 changeset
pnpm changeset status   # 查看当前待发布内容
```

面向使用者的行为变更（新组件、修 bug、破坏性变更）请补一个 changeset；纯文档 / CI / 内部重构不需要。
