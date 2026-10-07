---
"@mangax/bmap-vue": patch
---

#187 清理 pnpm 失效配置（#192 瘦身门禁与补注释卫生）

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

**新增 `check:toolchain`**（#192 瘦身）：只判三件**真实发生过**的事——`package.json` 不得有
`pnpm` 字段、lockfile 顶层不得有 `overrides:` 块、`packageManager` 声明必须等于
`pnpm --version` 实际跑的那个。**版本基线表刻意不做成门禁**：升级会动 lockfile，而 lockfile
入库 + CI `--frozen-lockfile` + dependabot major 忽略 + PR diff 已经把它挡住；初版还自己假绿过
一次（`pnpm` 三层里两层被作者短路却仍报「三方一致」，靠评审才发现）。版本事实记在 ADR。

`unplugin-dts` 对 `@vue/language-core` 的 peer major 不匹配（要 `^3.1.5`、实装 `2.2.12`）是
**已知、已验证、刻意接受**的状态（实测它所需的三个符号 2.2.12 全部导出），不是隐患。

⚠️ 这条事实**只记在 ADR 2026-10-02**，**没有任何门禁**在核对它。#187 当时用
`KNOWN_PEER_MISMATCHES` + 结构化字段 `observedVersion` 做过机器登记（升级后该字段与磁盘不一致
即红，逼人重审），那套登记**已随 #192 瘦身一起删除**——所以**不要**再以为升级
`@vue/language-core` 会因为这条例外过期而自动变红。追踪 #188。

⚠️ 本门禁**不具备**「自动发现新增 peer 不匹配」的能力：pnpm 的 isolated 布局下
`unplugin-dts` 位于 `node_modules/.pnpm/` 虚拟 store 深层，扫工作区 `node_modules` 够不到
（实测只覆盖 53 个包）。曾实现过全树扫描，因恒为「没有不匹配」（等价于常量）而按
AGENTS.md 的口径删除，详见 ADR 2026-10-02 的非目标。

**无行为变更**：依赖版本一律未动，`pnpm-lock.yaml` **零 diff**（被删的设置本就未被读取）。
干净安装的复核记录见 ADR §6（#187 当时）；#192 瘦身与后续评审修复后复跑：三个 typecheck +
build + 全量用例 + 其余门禁全绿。

⚠️ 这里**刻意不写精确用例数**：它随树增长，写死必然漂移（#196 评审连续两轮抓到
「刚修完事实源漂移、又留下新的一处」）。要看当前读数就跑 `pnpm test:unit` 或看 CI 输出。