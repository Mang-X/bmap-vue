---
"@mangax/bmap-vue": patch
---

#187 清理 pnpm 失效配置并把声明工具链变成可核对的事实

根 `package.json` 的 `pnpm` 字段在 pnpm 12 下**整个不被读取**，其中三项各自失效：

- **`overrides: {vue-tsc: 3.3.11, @vue/language-core: 2.2.0}`** —— 从写下起就没生效过。
  它声称把类型工具链锁在 3.3.11，而实际是**包构建与三个 typecheck 门禁走 `vue-tsc@2.2.12`**，
  只有 `docs` 用 `3.3.11`；`node_modules/.bin/vue-tsc` 实体指向 2.2.12。它写的
  `@vue/language-core: "2.2.0"` 这个版本甚至**不存在**。溯源：它与把 `vue-tsc` 降到
  `^2.2.0` 的 devDep 是同一次提交（`a455565`）加入的，自相矛盾。
- `onlyBuiltDependencies` 的四个包**全都不在**树里，2649 个已安装包**无一个**带安装脚本钩子；
  该键也已被 `allowBuilds` 取代。
- `peerDependencyRules.ignoreMissing` 指向的 `@algolia/client-search` **全树不存在**
  （文档站里那段 algolia 配置是被注释掉的）。

**逐条删除，不做迁移**。工作区**故意**跑两个 vue-tsc major——声明由
`@vue/language-core@2.2.12` 产出（`vite-plugin-dts` → `unplugin-dts`，`build-package.mts`
只 shell out 两次 `vite`，从不执行 `vue-tsc`），包 typecheck 用 2.2.12，文档站对着
`dist/*.d.ts` 做消费方校验用 3.3.11。把 override 搬到新位置会让包构建真的升到 3.3.11，
那是一次未经验证的升级，本票不做。

顺带删除 `.npmrc` 的三行失效设置（`shamefully-hoist` / `engine-strict` /
`auto-install-peers`，pnpm 12 均不读取），其中 `auto-install-peers=false` 还与 lockfile 记录的
`autoInstallPeers: true` 相互矛盾。

**新增 `check:toolchain`**：对声明 → `pnpm-lock.yaml` 解析结果 → `node_modules` 实际安装做三方
核对，fail-closed。三方都要**判**而不是只打印——`package.json` 与 lockfile 记录的 specifier
脱节同样会红（那正是「改了 manifest 没重新 install」的形态）。判据落到**实际解析结果**而非
声明面（`^` / `~` 不是事实）。仓库此前**没有任何门禁读 lockfile 或已安装版本**，这个缺口由
本票补上。

`unplugin-dts` 对 `@vue/language-core` 的 peer major 不匹配（要 `^3.1.5`、实装 `2.2.12`）登记
为**刻意接受**（已验证它所需的三个符号 2.2.12 全部导出），以结构化字段 `observedVersion`
记录「例外基于哪个实装版本成立」——升级后该字段与磁盘不一致即红，逼人重审这条例外。追踪 #188。

⚠️ 本门禁**不具备**「自动发现新增 peer 不匹配」的能力：pnpm 的 isolated 布局下
`unplugin-dts` 位于 `node_modules/.pnpm/` 虚拟 store 深层，扫工作区 `node_modules` 够不到
（实测只覆盖 53 个包）。曾实现过全树扫描，因恒为「没有不匹配」（等价于常量）而按
AGENTS.md 的口径删除，详见 ADR 2026-10-02 的非目标。

**无行为变更**：依赖版本一律未动，`pnpm-lock.yaml` **零 diff**（被删的设置本就未被读取）。
干净安装 + 三个 typecheck + build + 3824 条用例 + 其余 16 道门禁全绿（ADR 记录了完整实测）。