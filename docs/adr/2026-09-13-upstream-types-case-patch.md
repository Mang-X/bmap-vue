# ADR 2026-09-13：上游类型包大小写引用缺陷的补丁处置

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`M3A0-BOUNDARY`（衍生，issue #50；发现于 #15 / PR #49 的 CI 首轮）
- 取代：无
- 相关：ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)；
  `patches/@baidumap__jsapi-v4-types@4.0.4.patch`；`patches/README.md`

## 背景

ADR 2026-09-10 把 `skipLibCheck: false` 定为本仓库最严格的一道类型门禁：官方类型包
`@baidumap/jsapi-v4-types`（精确锁定 `4.0.4`）与最小 augmentation 必须在同一 Program 内可合并。
该 ADR 同时记录「已验证 `pnpm typecheck:v3` 在 `skipLibCheck: false` 下通过」——**这条验证只在
macOS 成立**。

实测（issue #50）：`@baidumap/jsapi-v4-types@4.0.4` 的 `index.d.ts` 把
`index.d.ts:67` 写成 `/// <reference path="core/displayOptions.d.ts" />`，而发布产物中的真实文件名是
`core/DisplayOptions.d.ts`。macOS 的 APFS 默认大小写不敏感，会解析到真实文件；Linux / 任何大小写
敏感的卷上则直接失败：

```text
error TS6053: File '.../core/displayOptions.d.ts' not found.
error TS2552: Cannot find name 'DisplayOptions'.   // core/Map.d.ts / core/MapOptions.d.ts
```

影响：本仓库最严格的类型门禁无法进入 CI，只能在 macOS 上手工验证；PR #49 把
`typecheck:v3` 从 `.github/workflows/quality.yml` 移除并在原位留 NOTE。

包内共 193 个 `.d.ts`、192 条 `/// <reference path>` 引用（`index.d.ts` 全文 192 行**全部**是引用，
是唯一聚合入口，子文件之间不互相引用）。按文件名大小写逐条比对，**恰好只有这 1 处不匹配**，
且包内不存在任何小写 `displayOptions*` 文件。复核 npm dist-tags：`latest = 4.0.4`（2026-09-13），
上游暂无修复版本。

## 决策

1. **采用「精确版本 + pnpm 补丁」在上游产物内部修正这一行**：
   `patches/@baidumap__jsapi-v4-types@4.0.4.patch` 由 `pnpm-workspace.yaml` 的
   `patchedDependencies` 在安装期应用到 `node_modules`。补丁只改文件名大小写，不改任何声明内容。
2. **类型接入方式不变**：入口仍是 `src/driver/jsapi-v4/types-reference.d.ts` 的
   `/// <reference types="@baidumap/jsapi-v4-types" />` + `tsconfig.build.json` 的
   `compilerOptions.types`；`skipLibCheck` 仍为 `false`；augmentations 治理规则不变。
3. **`typecheck:v3` 重新纳入 CI**（`.github/workflows/quality.yml` 的 `quality` job），
   并且**排在 `build:v3` 之前** —— `vue-tsc` 会把声明 emit 到 `dist/`，放在 build 之后会让
   `check:public-dts` 看到 typecheck 的产物而假失败（`build:v3` 会先清空 `dist`）。
4. **把「补丁已生效」变成可执行门禁**：`tests/behavior/v3-upstream-types-case-patch.test.ts`
   用 `readdirSync` 的精确文件名比对（而不是 `existsSync`，后者在 macOS 上会对大小写不匹配的路径
   返回 true）核对已安装上游声明的全部三斜线引用，并核对补丁声明与 CI step 形态。该用例不依赖
   运行平台的大小写敏感性，macOS 与 Linux 结论一致。
5. **删除条件**：上游发布修正大小写的版本后 → 升级精确版本 → 删除补丁与
   `patchedDependencies` 条目 → 重跑门禁。补丁以 `包名@精确版本` 为键，只升级依赖而留下旧键时
   `pnpm install` 会直接失败（实测 `ERR_PNPM_UNUSED_PATCH`），因此这一步不会被悄悄漏掉。

6. **披露对 ADR 2026-09-10 的原地更正**：该 ADR 的「已验证」句尾被追加了一条
   「平台前提（2026-09-13 更正）」。这是更正一句事实性的验证口径（当时的结论只在 macOS 成立），
   不是变更决策，因此按 `docs/adr/README.md` 的冻结约定在原文件上标注，并由本 ADR 记录这件事。
   将来若要改变「`skipLibCheck: false` + 官方类型精确锁定」这个决策本身，必须新开 ADR 取代
   2026-09-10。


- **路线 1「等上游」**：不可作为唯一手段 —— `latest` 仍是 `4.0.4`，无修复版本；且它无法解释
  为什么本项目要在 macOS-only 的条件下继续保留这条门禁。
- **路线 2「绕过官方 `index.d.ts`，改由 `types-reference.d.ts` 逐条引用所需子文件」**：
  实证 `index.d.ts` 是唯一聚合入口（192 行全是引用，子文件不互相引用），而所有子文件都是同一个
  全局 `namespace BMap` 的平铺声明，因此「引用所需子文件」实际等于在仓库里维护一份 192 行的上游
  入口镜像，还要与 pnpm 的 `node_modules` 真实路径耦合；上游增删文件即漂移，维护成本远高于
  1 行补丁。
  （若改用 `tsconfig` 的 `include` 通配让 TS 用目录展开代替入口，虽然可自动跟随上游文件集，
  但它把 192 个上游文件变成 Program 根，会影响 `vite-plugin-dts` 的 `copyDtsFiles` 与声明打包
  形状，收益与风险不成比例，未采用。）
- **路线 3「对官方包放开 `skipLibCheck`」**：直接推翻 ADR 2026-09-10 决策 5，放弃本仓库最严格的
  类型门禁，拒绝。

## 后果

- 正面：Linux 与 macOS 行为一致，`typecheck:v3` 回到 CI；根因被精确修复；删除条件由包管理器强制执行
  （只升级依赖而留下旧补丁键时 `pnpm install` 报 `ERR_PNPM_UNUSED_PATCH`），门禁用例会在补丁未生效时变红。
- 负面/成本：仓库首次引入依赖补丁机制（`patches/` + `patchedDependencies`），升级类型包时多一步
  必须处理的手续；补丁修改的是上游产物，需要靠 `patches/README.md` 与门禁用例保证它不被遗忘。
- 回滚：删除补丁与 `patchedDependencies` 条目后 `typecheck:v3` 会在 Linux 上重新失败，因此回滚
  必须同时把该 step 从 CI 摘掉，并同步更新 `CONTRIBUTING.md` 与
  `docs/zh-CN/contributing/ai-development.md` 的验证口径（步骤见 `patches/README.md`）。

## 非目标

- 不修改 augmentations、公共 API 或类型接入方式。
- 不把官方类型包变成运行时依赖，不 vendoring 上游声明，不 fork 上游包。
- 不保证上游其他版本（`4.0.0` ~ `4.0.3`）的行为；本决策只覆盖精确锁定的 `4.0.4`。

## 参考

- issue #50 `[M3A0.0] 上游 @baidumap/jsapi-v4-types@4.0.4 大小写引用缺陷：typecheck:v3 无法在 Linux 通过`
- issue #15 `[M3A0] BMap / raw SDK / 公共声明边界与 Capability Catalog`
- PR #49（CI 首轮暴露该缺陷）
- ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- 上游仓库：<https://github.com/baidu-maps/jsapi-v4-types>
- 上游包：<https://www.npmjs.com/package/@baidumap/jsapi-v4-types>
