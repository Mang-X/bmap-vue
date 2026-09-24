<!--
PR 标题会成为 squash 之后的 commit 标题，请用 Conventional Commits（feat/fix/chore/docs/refactor/test）+ 中文简述。
分支请语义化命名（如 m3a2-overlays、docs/oss-collaboration），不要直接把工作区分支合并进 main。
提交前请跑通「本地门禁」，清单见 CONTRIBUTING.md。
-->

## 变更概述

<!-- 这个 PR 做了什么、为什么这么做。 -->

## 依据

<!-- 关联 issue / ADR / 上游文档。若是兼容上游行为，给出链接与版本号。 -->

## 生命周期与资源释放

<!--
本仓库的硬性要求：所有监听器、覆盖物、控件、图层、服务结果、Observer、Timer、RAF 与动画
都必须有释放路径。请说明新增或改动的资源在哪里创建、何时释放，以及哪条用例在守它。
-->

## 迁移影响

<!--
对外 API / 类型 / 行为是否变化。破坏性变更请写清迁移步骤，并在 .changeset 里标 major。
无影响就写「无」。
-->

## 测试

<!--
贴出实际执行的命令与结果，不要只写「已测试」。至少覆盖：

- [ ] `pnpm check:raw-sdk` 与 `pnpm check:raw-sdk:tree`
- [ ] `pnpm generate:manifest:check` 与 `pnpm generate:capability-matrix:check`
- [ ] `pnpm build:package` 与 `pnpm check:public-dts`
- [ ] `pnpm test:unit`

新增行为请说明用例在改动前是失败的（先红后绿），并贴出红/绿的失败信息。
-->

## DoD

- [ ] 改动只落在允许的模块内：`components` / `composables` / `core/runtime` 不得直接触碰 `BMap.*`
- [ ] 新增行为有用例覆盖，且这些用例在改动前确实失败
- [ ] 若改动了能力清单，`src/driver/capability/catalog.ts` 已同步（能力矩阵由脚本生成，不要手改生成物）
- [ ] 文档 / 示例 / AGENTS.md 与最终实现一致
- [ ] 需要对外发布时已补 `.changeset`
