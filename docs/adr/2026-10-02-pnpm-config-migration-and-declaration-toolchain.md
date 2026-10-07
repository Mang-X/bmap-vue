# ADR 2026-10-02：pnpm 失效配置清理与声明工具链的事实化（#187）

- 状态：Accepted
- 日期：2026-10-02
- 关联：issue **#187**、**#188**（声明产物修复，本票的前置）、#45、#50
- 影响范围：安装配置、声明工具链版本基线、CI 接线、贡献文档

## 背景

根 `package.json` 声明 `pnpm@12`，却把三类 pnpm 设置放在 `package.json` 的 `pnpm` 字段里。
pnpm 12 **不再读取该字段**，因此每次干净安装都打印：

```text
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys
were ignored: "pnpm.peerDependencyRules", "pnpm.onlyBuiltDependencies", "pnpm.overrides".
```

`pnpm-workspace.yaml` 里没有对应的 `overrides`。这不是「配置不够新」，而是三处**各自失效**的
配置，其中 `overrides` 谎报了类型工具链的锁定状态。

本票的前提边界：主干 CI 的安装日志只能证明「配置失效」，**不能**据此认定它就是所有声明
错误的根因。因此本票只**确认实际构建配置**，不做全仓依赖升级；悬空声明问题（#188）不在本票
关闭条件内。

### 逐条取证

基线在动手前先验证为绿：`rm -rf node_modules` → `pnpm install --frozen-lockfile` →
`typecheck:package` → `build:package` → `test:unit`（210 文件 / 3783 用例）全通过。

| 键 | 声称 | 实测 |
| --- | --- | --- |
| `peerDependencyRules.ignoreMissing: ["@algolia/client-search"]` | 压掉一条 peer 告警 | `@algolia/client-search` **全树不存在**。唯一痕迹是 `docs/.vitepress/config.mts` 里一段**被注释掉**的 algolia 配置——它从未启用，因此也没有这个 peer |
| `onlyBuiltDependencies: [esbuild, pre-commit, spawn-sync, vue-demi]` | 批准 4 个包的构建脚本 | 这 4 个包**全都不在**树里；扫描 2649 个已安装包，**0 个**带 `preinstall` / `install` / `postinstall`。该键本身也已被 `allowBuilds` 取代（pnpm 11 移除 `onlyBuiltDependencies`） |
| `overrides: {vue-tsc: 3.3.11, @vue/language-core: 2.2.0}` | 把类型工具链锁在指定版本 | **从未生效**，见下 |

### 为什么那句 override 是假的

三条彼此独立的证据：

1. `pnpm-lock.yaml` 里**没有** `overrides:` 块。pnpm 会把生效的 override 写进 lockfile，缺失即未应用。
2. 实际解析与它**相反**：包构建与 `typecheck:*` 走 `vue-tsc@2.2.12`，只有 `docs` 用 `3.3.11`。
   `node_modules/.bin/vue-tsc` 实体指向 `vue-tsc@2.2.12`。
3. 它写的 `@vue/language-core: "2.2.0"` 这个版本**根本不存在**——声明的 `^2.2.0` 实际解析到 `2.2.12`。

溯源：那份 override 与把 `vue-tsc` **降到** `^2.2.0` 的 devDep 是同一次提交（`a455565`）加入的，
因此**自相矛盾**：`git log -S'"vue-tsc": "3.3.11"' -- package.json` 可复现。同一批提交还把
`pnpm-workspace.yaml` 的 `allowBuilds` 写成了 `esbuild: set this to true or false` 这样的占位串
（后续 `f027fe4` 才修回）。

## 决策

### 1. 三项全部删除，不做「迁移到新位置」

失效配置**逐条删除**，而不是搬到 `pnpm-workspace.yaml` 让它生效：

- `peerDependencyRules.ignoreMissing`：**无消费者**。目标包不在树里，没有告警可压。
- `onlyBuiltDependencies`：**已被取代且无对象**。构建脚本审批的唯一入口是 `allowBuilds`；
  而 2649 个包里没有任何一个需要审批。
- `overrides`：**刻意不恢复**。理由见决策 3。

不保留「以后可能有用」的扩展面（与 `2026-09-25-clean-slate-migration-baggage-removal`
同一条处置口径）。

### 2. 顺带删除 `.npmrc` 的三行失效设置

同一次审计里发现 `.npmrc` 也在使用 pnpm 12 **已不再读取**的安装设置：`shamefully-hoist=true`、
`engine-strict=true`、`auto-install-peers=false`。三项均无效果（`pnpm config get` 全为
`undefined`，删掉后干净安装结果逐字节一致）。

其中 `auto-install-peers=false` 还与 lockfile 自己记录的 `settings.autoInstallPeers: true`
**相互矛盾**——lockfile 记录的一直是 pnpm 12 的实际默认值。删掉整个 `.npmrc`（该文件当时只有
这三行，不含凭据）。`.npmrc` 在 pnpm 12 仍是 registry 凭据的正统位置，需要时再加。

### 3. 工作区**故意**跑两个 vue-tsc major，不强行统一

这是本票最关键的一条判断。实测：

| importer | 用途 | vue-tsc | language-core |
| --- | --- | --- | --- |
| `packages/bmap-vue` + 根 | 发布包构建、`typecheck:package` / `:tests` / `:type-contracts` | **2.2.12** | **2.2.12** |
| `docs` | 文档站 `vp exec vue-tsc`，对着 `dist/*.d.ts` 做消费方校验 | **3.3.11** | （传递依赖）3.3.11 |

要弄清这条依赖链，必须看**声明产出的真实产出者**是谁：`build-package.mts` 只 shell out 两次
`vite`，**从不**执行 `vue-tsc`；声明由 `vite-plugin-dts` → `unplugin-dts` 产出，而后者在
`dist/chunks/vue.mjs` 里直接 `import { createParsedCommandLine, getDefaultCompilerOptions,
createVueLanguagePlugin } from '@vue/language-core'`。也就是说：

- **声明的产出者是 `@vue/language-core@2.2.12`**，`vue-tsc` 只服务于三个独立的 typecheck 门禁；
- `packages/bmap-vue` 因此把 `@vue/language-core` 声明为**直接** devDep，而不只是传递 peer；
- 全仓库**没有任何源码** import `vue-tsc` 或 `@vue/language-core`，它们全部是 shell 调用。

`unplugin-dts@1.1.0` 声明 peer `@vue/language-core: ^3.1.5`，实装 `2.2.12`——**一个 major 的
不匹配**。它能工作是因为 unplugin-dts 只 import 上面三个符号，而 `2.2.12` **全部导出**（实测）。
这是**已知、已验证、刻意接受**的状态，不是隐患。⚠️ #187 当时它登记在
`scripts/toolchain-boundary.mts#KNOWN_PEER_MISMATCHES`（带 `observedVersion`，由门禁核对）；
**该表与核对逻辑已在 #192 删除**，因此现在这条事实**只记在本 ADR**，没有任何门禁在看它。
追踪票为 #188。

因此**不**把 `overrides` 搬到 `pnpm-workspace.yaml`：那会把包构建的 `vue-tsc` 从 2.2.12 提到
3.3.11，属于一次**真实升级**，需要重新验证声明产物——正是本票明令禁止的「不盲目恢复旧
overrides、尤其不强行组合不匹配的 vue-tsc / language-core」，也不是 #188 的前置。

### 4. 用一道门禁把「实际生效的版本」变成可核对的事实（#187；#192 瘦身为三条 pnpm 配置判据）

新增 `check:toolchain`（`scripts/check-toolchain.mts` + 判据内核 `scripts/toolchain-boundary.mts`）。
这道门禁在 #187 落地、在 #192 被**大幅瘦身**：

- **4a 记的是初版（#187，现已删除）**——它曾做什么、以及为什么被删；
- **4b 记的是瘦身后的现状（#192）**——留在门禁里的只有三条。

⚠️ **当前实现以 4b 与 `scripts/toolchain-boundary.mts` 为准。** 4a 里出现的判据名
（`resolution-drift` / `specifier-unpinned` / `disk-mismatch`）、`KNOWN_PEER_MISMATCHES`、
`observedVersion`、`TOOLCHAIN_PINS` 与手写 lockfile 解析器**在 #192 之后都不再存在**；
它们保留在此只作决策史，读到时不要以为门禁还在核对它们。

#### 4a. 初版（#187，现已删除）：三方对照

初版的判据是**三方对照**，任一漂移都红：

| 来源 | 判什么 |
| --- | --- |
| `package.json` | 声明的 **specifier**（且不接受 `latest` / `*`）；`pnpm` 读 `packageManager` |
| `pnpm-lock.yaml` | 该 importer 实际解析到的 **version** |
| `node_modules` / **运行时** | 磁盘上真实安装的版本；`pnpm` 改为 `pnpm --version` |

**`pnpm` 自身是三层里的特例，且必须如此。** 它由 `packageManager` 字段钉住、不在
`dependencies` 里（所以它没有「lockfile 解析」之外的 importer 概念），更**不在 `node_modules`
里**——真正跑的那个版本由 corepack / CI 的 `pnpm/action-setup` 决定，**不写进任何文件**，
只能问它本人（`pnpm --version`）。因此它的第三层是「运行时」而非「磁盘」。

⚠️ 初版的第一版把 `pnpm` 的第二、三层都短路掉（`return []`），于是门禁输出
`pnpm 声明 — / 解析 12.0.0 / 磁盘 n/a` 却依然报「**三方一致**」——**两个层面都没查，还报绿**。
PR 评审 #191 的 P2 正是这一条。修完之后三层确实都真核对（反向验证：把 `packageManager`
改成 `pnpm@11.5.0` → 报 `[specifier-unpinned]` + `[disk-mismatch]`）——**但这整套判据本身
在 #192 被判定为「代价与它防的风险不成比例」而删除**，理由见 4b。

这恰好是 #187 原始命题的**同构重演**：lockfile 与 `packageManager` 都只记录「应该用哪个」，
管不住「实际跑的是哪个」。

当时的另一个关键点是**判落到「实际解析结果」而不是「声明」**：声明面上的 `^` / `~` 不是事实，
`^2.2.0` 今天解析到 `2.2.12`，下次 `pnpm install` 就可能变成 `2.2.13`。

仓库此前**没有任何门禁读 lockfile 或已安装版本**（`upstream-types-reference-case.test.ts`
里的 `pnpm-lock` 字样只是报错文案，不是被解析的对象）——这个缺口正是本票当初要补的。

三种失败形状**当时**刻意分开，因为它们对应三种不同的处置：`resolution-drift`（该评估升级了）、
`specifier-unpinned`（锁定失效）、`disk-mismatch`（lockfile 与现场不一致）。fail-closed：
读不到 importer / 版本 / 磁盘包一律判失败，「没读到」不等于「没问题」。

`KNOWN_PEER_MISMATCHES` 与 `package-shape-boundary.mts#ATTW_EXCEPTIONS` 同一处置：**刻意非空**
（空表会让「不匹配消失了」与「没检查」无法区分），每条必须带 `why` + `tracking` +
**`observedVersion`**（结构化字段，不是从 `why` 的散文里 `includes(version)`——实测那样做会漏：
`why` 里该版本号出现两次，改一处仍判真），并由用例断言非空。**该表与 `observedVersion` 字段
已随判据在 #192 一并删除**；今天「刻意接受的例外」只存在于
`package-shape-boundary.mts#ATTW_EXCEPTIONS`。

初版的 lockfile 解析刻意**不引 YAML 库**：仓库没有直接依赖它（`yaml` 只是传递依赖），而
`importers` 段缩进固定、字段有限。该解析器在本仓库真实 lockfile 上踩过三个坑（顶部 pnpm
自身的 `importers` 段、只认 2 空格边界的段截断），**每次都是门禁按 fail-closed 正确判红**——
判据没错，错的是解析器。三个坑与合成样本 + 真实 lockfile 的双份断言当时留在代码注释与
`tests/behavior/toolchain-gate.test.ts` 里。**解析器与那批断言在 #192 一并删除。**

### 4b. 瘦身（#192）：删掉三方对照与版本基线表，只留三条真实判据

#192 评审把 4a 描述的整套三方对照（含 `TOOLCHAIN_PINS` 版本基线表、三种失败码、
`KNOWN_PEER_MISMATCHES` / `observedVersion`、手写 lockfile 解析器及其实例）**整体移出门禁**：
基线表搬进本 ADR 的「版本事实」表，其余直接删除。理由：

- **它守的风险已被别处挡住**。升级 `vue-tsc` 会动 lockfile，而 lockfile 入库、CI 走
  `--frozen-lockfile`、dependabot 对 vue-tsc / typescript / vue 的 major 是忽略的、
  任何升级都会在 PR 的 lockfile diff 里露出来。再加一道机器检查是重复投资。
- **它自己假绿过**。初版把 `pnpm` 的三层里两层 `return []` 短路掉，却仍输出「三方一致」，
  靠人工评审（PR #191 的 P2）才发现。一道需要评审才发现自己没在看的检查，
  代价与它防的风险不成比例。
- **它有两份事实源**。1276 行里 391 行是中文注释，大量在复述本 ADR 已经写过的决策史
  （#192 的核心判据：ADR 记录「为什么」，代码注释记录「这是什么」，两者不重复）。

**留在门禁里的只有三条**（每条都对应一次已发生的故障，见
`scripts/toolchain-boundary.mts` 文件头的表格）：`package.json` 不得有 `pnpm` 字段、
lockfile 顶层不得有 `overrides:` 块、`packageManager` 声明 == `pnpm --version`。

代价是**大幅**收缩——初版 1276 行（含 391 行中文注释）与 46 条用例，瘦身后只剩两个小文件
与它们的用例组。

⚠️ 这里**刻意不写精确行数 / 用例数**：它们的真实值由当前树决定，写死进 ADR 必然随下一次
改动漂移（#196 评审连续两轮抓到「刚指出漂移、修完又留下新漂移」）。要当前规模就直接
`wc -l scripts/check-toolchain.mts scripts/toolchain-boundary.mts`——ADR 记的是**决策**，
不是随时会变的读数。

**搬进本 ADR 的版本事实**（干净安装实测，#192 复核仍成立）：

| importer | 包 | 解析版本 |
| --- | --- | --- |
| `.` / `packages/bmap-vue` | `vue-tsc` | `2.2.12` |
| `.` / `docs` | `vue-tsc` | `3.3.11`（**另一个 major**，见决策 3） |
| `packages/bmap-vue` | `@vue/language-core` | `2.2.12`（声明的**真实产出者**） |
| `.` / `packages/bmap-vue` / `docs` | `typescript` | `5.9.3` |
| `packages/bmap-vue` | `vite-plugin-dts` | `5.1.0` |
| `packages/bmap-vue` | `@microsoft/api-extractor` | `7.59.0`（精确锁定的门禁工具，#45 决策 6） |
| `.` | `vue` | `3.5.42` |
| `.` | `pnpm` | `12.0.0` |

⚠️ 表里「`pnpm`」那一行的**判据只覆盖绑定失效**（corepack 被禁用、action-setup 被显式指定
别的版本等），**防不了「声明被改」**：corepack 与 `pnpm/action-setup@v6` 都从 `packageManager`
取版本，改声明会让实际执行的也照着切（实测：改成 `pnpm@11.0.0` 后实际跑的就是 11.0.0，判据仍绿）。

### 5. CI 里的位置：排在昂贵的 build / typecheck / test 之前

**初版**的理由是：它判的**正是**安装结果，放到任何构建步骤之后，读到的就已经是别的步骤留下的现场。

⚠️ **瘦身（#192）后这条理由不再成立。** 现在三条判据读的是 `package.json`、
`pnpm-lock.yaml` 顶层与 `pnpm --version`——**没有一条读 `node_modules`**，构建步骤不会改变
它的输入。当前仍排在 `Install dependencies` 之后，但那只是**习惯与廉价**（pnpm 与 lockfile
的状态此时已确定），它**不再是**一条必须遵守的次序约束。

CI 侧的断言因此只锁**真实理由**：`tests/behavior/toolchain-workflow.test.ts` 现在只要求它排在
昂贵的 `playground:build` / `typecheck:package` / `test:unit` 之前（尽早失败）。#196 评审前那条
「必须在 `Install dependencies` 之后」的断言已删除——它把一条废弃的历史约束机器化，
会误拦一个本来正确的改动（把门禁提到 install 之前，它照样能跑）。

### 6. 实施后的实测记录（验收项 1 / 2 / 3 的证据）

⚠️ **本节记录的是 #187 落地当时的状态**，那时门禁仍是 4a 的三方对照。表中与
「三方一致 / 11 条登记 / `resolution-drift` / `KNOWN_PEER_MISMATCHES`」有关的行
**随 #192 瘦身已不再适用**，保留为当时的证据。表中的文件数 / 用例数**只描述那一刻的树**，
不要当成当前读数。

改动**之后**在干净检出上重跑（`rm -rf node_modules packages/*/node_modules docs/node_modules
apps/*/node_modules` 后 `pnpm install --frozen-lockfile`）：

| 检查 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过，**无** `[WARN] ... no longer read`；lockfile **零 diff** |
| `pnpm check:toolchain`（**#187 当时**） | 三方一致，11 条登记全绿（该判据已在 #192 删除） |
| `pnpm typecheck:package` / `:tests` / `:type-contracts` | 全通过（vue-tsc 2.2.12，未变） |
| `pnpm build:package` | 通过，`dist/*.mjs` + `dist/*.d.ts` 正常产出 |
| `pnpm test:unit` | **212 文件 / 3818 用例全绿**（基线 210 / 3783，净增为本门禁的用例） |
| `pnpm check:api` | 5 份 API report + 5 份未导出类型集合 + 7 份签名基线全一致 |
| `pnpm check:package-shape` / `check:pack-contents` | 通过（tarball 50 个条目） |
| `pnpm verify:package` | `ALL PASSED`（含 tarball 消费方的 `npx vue-tsc`） |
| 其余 16 道门禁 | 全部通过 |

**#188 的悬空声明问题仍然存在**（`pnpm check:api` 报告「Volar `__VLS_` 悬空引用」仍然成立，
探针通过）——本票如实记录，处置留给 #188。

**门禁的反向验证（#187 当时）**：把 lockfile 里包级 `vue-tsc` 的解析版本改成 `2.2.99` →
报 `[resolution-drift]` + `[disk-mismatch]` 并以退出码 1 失败；把 `KNOWN_PEER_MISMATCHES`
的 `observedVersion` 改成 `9.9.9` → 报「例外登记已过期」并失败。两次均已还原。
⚠️ 这两条**随 #192 删除判据一起失效**；瘦身后判据的反向验证见 `tests/behavior/toolchain-gate.test.ts`
（例如 `packageManager` 声明成 `npm@…` 必须红、带 `+sha512` 后缀必须能提取版本）。

lockfile 无需更新：被删的三项设置本就未被读取，因此 `--frozen-lockfile` 直接通过，
`settings.autoInstallPeers: true` 记录的一直是 pnpm 12 的实际默认值。

## 后果

- 干净安装不再出现 `[WARN] The "pnpm" field in package.json is no longer read by pnpm`。
- ⚠️ **本项随 #192 瘦身失效**：`vue-tsc` / `typescript` / `@vue/language-core` /
  `vite-plugin-dts` / `@microsoft/api-extractor` 的实际生效版本**不再**由
  `pnpm check:toolchain` 核对——版本事实记在 4b 的「搬进本 ADR 的版本事实」表，
  升级靠 lockfile diff 与 dependabot 的 major 忽略来暴露。
- **lockfile 无需改动**：删除的三项设置本来就未被读取，所以 `pnpm install --frozen-lockfile`
  直接通过。`settings.autoInstallPeers: true` 记录的一直是实际生效值。
- 工具链升级的路径改为**看 4b 的表 + PR 的 lockfile diff**；`TOOLCHAIN_PINS` **已不存在**，
  不要再去改它（#192 之前的那种「改数字让门禁带着差异红」的流程已随判据删除）。

## 回滚

改动全部是配置删除 + 新增门禁，回滚即还原 `package.json` 的 `pnpm` 字段、恢复 `.npmrc`、
删除 `check:toolchain` 的接线。**不建议**回滚：恢复即恢复那句失效的版本声称与干净安装的 WARN。

## 非目标

- **不修 #188 的悬空声明**（`dist/*.d.ts` 里的 `__VLS_*` 悬空引用）。本票只提供它需要的
  配置基线：#188 应在**本票确定的版本组合**上验证，避免两边各自改版本与 lockfile。
- **不升级任何依赖版本**。本票确认配置，不做全仓升级。
- **不统一两个 vue-tsc major**。它们各自服务不同环节，见决策 3。
- **不具备「自动发现新增 peer 不匹配」的能力**。曾尝试扫遍依赖树，但 pnpm 的 isolated 布局下
  `unplugin-dts` 位于 `node_modules/.pnpm/` 虚拟 store 深层，不在任何工作区包的直系
  `node_modules` 下；扫根 / `packages/bmap-vue` / `docs` 三处实测只覆盖 53 个包，其中没有
  `unplugin-dts`——判据恒为「没有不匹配」，与常量无异。按「判据退化成常量的一律删除」把它删了。
  ⚠️ **#192 之后连「登记 + `observedVersion` 与磁盘实装一致」那部分也已删除**：它随整套
  lockfile / 磁盘核对一起移出门禁，今天**没有任何门禁**在核对 peer 不匹配的实装版本。
  第一次尝试还暴露了另一个问题：只比 major 的范围判定会把 `^20.19.0 || >=22.12.0` 误读成
  「要 20.x」，实装 26.4.1 判不匹配——**一道会误红的门禁会被习惯性忽略**，那比不设更糟。
- **不处理 `unplugin-dts` 的 peer 不匹配本身**。当时登记为刻意接受（该登记已随 #192 删除），
  处置属 #188。

## 参考

- issue #187（本票）、#188（声明产物修复）、#45（发布形状门禁）、#50（上游类型包大小写）
- `scripts/toolchain-boundary.mts`、`scripts/check-toolchain.mts`、
  `tests/behavior/toolchain-gate.test.ts`、`tests/behavior/toolchain-workflow.test.ts`
- ADR `2026-09-30-pack-contents-and-publish-shape-gates`（门禁工具精确锁的同一处置口径）
- ADR `2026-09-13-upstream-types-case-patch`（声明工具链的历史与 `typecheck:v3` 的由来）