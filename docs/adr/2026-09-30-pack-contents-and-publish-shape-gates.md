# ADR 2026-09-30：发布包形状契约与 tarball 消费门禁（#45）

- 状态：Accepted
- 日期：2026-09-30
- 关联：issue **#45**、#44、#158
- 影响范围：发布前门禁、CI 接线、CDN 文档、发布流程

## 背景

1.0 的公共 API 已在 #44 冻结、文档已在 #141 重写。Stable 之前必须回答一个问题：
**「本地产物能跑」不等于「发布产物能跑」**。调查发现三类门禁空洞：

1. **发布 tarball 的文件清单完全没有门禁。** `publint` 与 `@arethetypeswrong/cli` 都在
   `package` job 里跑着，看起来「产物面被检查了」，但两者都只看**目录**（各自重新打包
   一次）。`package.json#files` 声明的每一项是否真的发出去了，没有任何东西断言。
2. **attw 的判定被压成一句 grep。** `grep -q 'node16 (from ESM).*🟢'` 只看四档解析里的
   一格，并且 `|| true` 吞掉了 attw 自己的退出码——attw 崩溃与 attw 判了契约不满足，
   在这一步长得一模一样。
3. **publint / attw 走未锁版本的 `npx -y`。** lockfile 管不到它们，上游一次 minor 就能在
   无人 review 的情况下改变一个 PR 的判定。

## 决策

### 1. 新增 `check:pack-contents`，判的是 tarball 而不是目录

`scripts/check-pack-contents.mts` + 判据内核 `scripts/pack-contents-boundary.mts`
（内核单列是为了能被用例直接 import，与 `docs-brand-boundary.mts` / `raw-sdk-boundary.mts`
同一理由）。判据：每个 `files` 条目都真的发出去了；`exports` 与 `main`/`module`/`types`/
`unpkg`/`jsdelivr` 引用的文件都在包里；无凭据 / `node_modules` / 源码 / CI 目录；
`dist` 下形态已登记；**空条目与 `files` 缺失一律判失败**（fail-closed）。

两条匹配口径必须写清，否则会各自产生一种假绿（都是 PR 评审实测确认的）：

- **`files` 条目分目录项与文件项**。只有目录项（`dist`、以 `/` 结尾的）允许前缀匹配；
  文件项只允许精确相等。第二版把两者合并成同一个前缀表达式，于是 tarball 里有
  `volar.d.ts/leftover.txt` 就算「`volar.d.ts` 已发出」——文件明明不在包里，
  `files-entry-missing` 却不触发（实测判定结果为 `[]`）。
- **顶层字段的 `./` 前缀不是必需的**。`main` / `unpkg` 写成 `dist/index.js` 是 npm 完全
  接受的形态；只收 `./` 开头的会让 `unpkg: "dist/index.global.js"` 被**静默跳过**，
  于是「改了 `unpkg` 指向不存在的文件」这条 CDN 契约无人把关。归一化后排除 URL 与绝对路径
  （那不是「tarball 里有没有这个文件」能判的）。

### 2. `volar.d.ts` 的生成顺序从「碰巧」变成「强制」

`files` 声明 `volar.d.ts`，而它是 `.gitignore` 的生成产物，只由
`generate-manifest-artifacts.mts` 第 81 行写（连 `--check` 模式也写）。实测：

| 顺序 | tarball 条目 | `volar.d.ts` |
| --- | --- | --- |
| 干净检出直接 `pnpm pack` | 47 | **缺失** |
| 先跑 manifest 生成器再 pack | 48 | 存在 |

CI 此前恰好因为 `quality` job 的 manifest 步骤而侥幸带上；一次真正的 `npm publish`、
或任何人直接跑 `pnpm pack:package`，都会静默发出**缺 Volar 类型**的包，而 README 与安装页
都承诺了自动补全。

处置是**三管齐下**，且必须包含 lifecycle 那一层（PR 评审 P1 实测发现：只做前两层仍有洞）：

| 层 | 手段 | 覆盖的路径 |
| --- | --- | --- |
| 本地 | 根 `pack:package` 内置 `pnpm generate:manifest &&` | `pnpm pack:package` |
| **发布** | **子包 `prepack` 调 `generate-manifest-artifacts.mts --check`** | **`npm publish` / `pnpm publish`** |
| 结果 | `check:pack-contents` 从 tarball 钉死 | 任何 pack 路径 |

⚠️ 中间那层是关键：实测 `npm publish` 会执行**子包**的 `prepublishOnly` 与 `prepack`
（在探针包上验证），但**不会**跑根级脚本。因此只给根 `pack:package` 加前置，干净检出直接
`npm publish` 仍会复现 47 条目的缺件包。加了子包 `prepack` 后，实测裸
`pnpm --filter bmap-vue pack` 直接产出 **48 条目**（含 `volar.d.ts`），无需人工记顺序。

`--check` 在此是安全的：该模式虽然名为 check，但 `generate-manifest-artifacts.mts`
第 81 行**无条件写** `volar.d.ts`；同时它仍会在 manifest 真有漂移时失败——两个语义都要。

### 3. sourcemap 保留

`dist` 下 16 个 `.map`（约 6.7 MB / 8.9 MB 展开体积）**有意发布**。依据不是「map 有用」
这种泛泛之论，而是一条可验证的事实：产物里**带 `//# sourceMappingURL=` 注释**的文件必须有
同名 `.map`，否则消费方浏览器逐文件 404，且从本包出发的 stack trace 查不到任何东西。

⚠️ 反向不成立：`components.mjs` / `composables.mjs` / `resolver.mjs` 是 vite 的**纯
re-export facade**，只含 `import`/`export`，**没有**注释也没有 map（实测
`grep -c sourceMappingURL` 为 0）。因此判据**不是**「每个 `.mjs` 都要有 map」——第一版
这么写，把这三条最普通的产物全判红了。清单层只表达「`.map` 是允许的形态」；
「有注释却缺 map」由驱动脚本读文件内容判定。

### 4. CSS 显式声明，且**明确它只对 CDN 场景有效**

`dist/bmap-vue.css`（由 `<Autocomplete>` 的 scoped `<style>` 产出）此前**在任何地方都没有
被声明**：`files` 只有目录项 `"dist"`、`exports` 里没有它、`unpkg`/`jsdelivr` 只指向
`index.global.js`。它靠目录项顺带发出，是构建副产物而非承诺——而文档的 CDN 示例却让用户
`<link>` 它。处置：在 `files` 里**按文件名显式列出**，并由门禁要求 CSS 必须这样声明
（否则报 `undeclared-css`）。CDN 示例同时锁定版本并指向显式的 `dist/index.global.js`。
这是一条**纯声明性**的改动：包内条目实测 48 → 48 不变。

⚠️ 评审时实测出一条必须写清的限制：**包管理器消费方目前无法引用这个 CSS**。
ESM 与 IIFE 两档都会产出该文件，但 `exports` 没有开放 CSS 子路径，
`import 'bmap-vue/dist/bmap-vue.css'` 被 Node 判为 `ERR_PACKAGE_PATH_NOT_EXPORTED`
（在真实 `npm install` 后的消费方里实测）。`src` 里也没有任何运行时样式注入，
ESM 产物中同样零 CSS 引用。

因此安装页**不能**声称「包管理器安装时不需要手动引入」——那是不实陈述（评审第一版草稿
写过这句，被抓出并改正）。当前准确的说法是：它只服务于 `<script>` 直引的 CDN 场景。
要让包管理器消费方也能引用，需新增 `./styles.css` 出口，那会改动 #44 冻结的出口面，
属独立决策，本 ADR 不做。

### 5. publint / attw / API Extractor 精确锁定，attw 改为结构化断言

三个工具都是**门禁**不是库，带 `^` 时上游一次 minor 就能静默改变判定，因此锁到 `x.y.z`
（`publint@0.3.24`、`@arethetypeswrong/cli@0.18.5`、`@microsoft/api-extractor@7.59.0`）。

attw 改读 JSON 的 `problems` 字段。实测当前 tarball 上有两类结论，**原先被 grep 全部藏住**：

| kind | 数量 | 档 | 成因 |
| --- | --- | --- | --- |
| `CJSResolvesToESM` | 7 | `node16-cjs` | `exports` 只有 `import` 条件、无 `require`，而包是 ESM-only |
| `NoResolution` | 6 | `node10` | 未提供 `typesVersions` |

**两者都是有意设计的后果，不是缺陷**，且都源于 #44 冻结的出口面。门禁的职责不是修掉它们，
而是把它们**枚举成有测试覆盖的显式例外**并打印出来——让「刻意接受」与「没看见」不再一样。
例外表 `ATTW_EXCEPTIONS` 刻意非空（空表会让「attw 报了新问题」与「attw 什么都没报」无法区分），
每条带 `why` + `tracking`，用例断言表非空且条目都有理由。

例外还必须**逐条钉住次数、解析档位与子路径清单**（`expectedCount` + `expectedResolutionKind`
+ `entrypoints`）。只按 `kind` 匹配的话，`CJSResolvesToESM` 从 7 处涨到 8 处仍然放行——而那
意味着多了一个子路径解析不对，正是需要人看一眼的变化。「刻意接受某一类问题」不等于「刻意接受
它出现在任意多个地方」。次数对不上、出现新子路径、或某个子路径消失（说明问题被修好了、该去
登记），都判红。

档位也要钉：这两条例外的**理由本身就是特定解析档位下的行为**（`CJSResolvesToESM` 只在
`node16-cjs` 出现、`NoResolution` 只在 `node10` 出现）。只钉 entrypoint 时，同一组子路径从
`node10` 漂到 `node16-cjs` 仍会被 `accepted`。

反向也要遍历：登记过、但这一轮**没出现**的例外（整类消失，或出现数为 0）报
`exception-vanished`。「问题被修好」意味着该**删掉登记**并重新审阅，而不是让门禁静默变绿。
第一版只遍历报告里现有的 key，于是 `NoResolution` 从 6 处降到 0 处、甚至 `problems: {}` 时
`expectedCount` 根本不进比较，`problems` 仍是 `[]`——那是假绿（PR 评审 P1 实测确认）。

### 5. 发布身份：`@mangax/bmap-vue`（取代 ADR 2026-09-24 决策 1 的包名）

npm 上的 `bmap-vue` 归另一位作者所有（维护者 `minichen`，1.0.0–1.5.0，2024-10-30
最后更新），且**本库目标发布的 `1.0.0` 那个版本号已被占用**。ADR 2026-09-24 第 12 行
已把它记为未决阻塞项；本次核实确认仍然成立，故发布身份迁到维护者自有 npm scope
**`@mangax/bmap-vue`**（scope 必须等于 npm 用户名或组织名，不能自选前缀）。

**这不是一次 API 变更**：5 份 API report 基线只重录了 header 一行
（`## API Report File for "…"`），7 份签名基线逐字节未变，产物条目数 48 → 48 不变。

包名不写死在任何脚本里，全部经 `scripts/release-identity.mts` 从 manifest 派生：

| 位置 | 派生规则 |
| --- | --- |
| tarball 文件名 | `mangax-bmap-vue-1.0.0-rc.0.tgz`——npm 去掉前导 `@`（实测） |
| `node_modules` 目录 | `node_modules/@mangax/bmap-vue`——**保留** `@scope/name` |

这两条规则**不一致**，是 npm 的既有行为，两个都要各自钉住（用例见
`tests/behavior/release-identity.test.ts`）。散落的字面量是「改一处、漏三处」的来源：
漏掉的那处不会报错，只会让门禁静默不生效——本次就有一处漏了（消费 fixture 的
`docs-examples/`，被 `vue-tsc` 的几十条 `TS2307` 当场抓出来）。

#### 「临时重写」不能替代改源码——第二轮评审的教训

第一轮只改了安装命令与 CDN 那类形态。文档**代码块里的裸 specifier**
（`from 'bmap-vue'`、`bmap-vue/volar`）共 **119 个文件**没改，而那正是用户直接
复制走的代码。更糟的是：消费 fixture 在**验证时**会重写包名，所以 `verify:package`
照样全绿——**临时重写掩盖了公开文档本身的迁移遗漏**。

因此两件事都要做：

1. **公开 docs / examples 源码直接改为 `@mangax/bmap-vue`**（119 个文件）；
2. **新增门禁规则 `retired-scope`**（`scripts/docs-brand-boundary.mts`），让旧名
   在发布面的**导入语句**里无法回流。

这条规则的判据收窄过一次，值得记下来：初版写成「任何位置的裸 `bmap-vue` 都命中」，
结果 `title: "bmap-vue"`、PWA 应用名、SEO 关键词、NOTICE 归属说明、docs 站自己的
vite/tsconfig alias 共 16 处**合法**用法一起躺枪，只能靠逐行豁免——而豁免一旦超过
`MAX_ESCAPES`，门禁自己会提示「**判据该改，不是豁免该加**」。于是收窄为只命中
`from` / `require(` / `import(` 三种导入上下文；豁免随即归零。

顺带修掉两处「门禁自己没跟上身份迁移」：`check:snippet-consistency.mts` 的标识符
提取正则写死 `'bmap-vue'`，迁移后一条都匹配不到（`createBMapPlugin` 从校验集合里
消失而报告仍显示 OK）；`generate-api-diff.mts` 把旧包名写进生成物。**门禁的判据
同样必须从 manifest 派生**，否则「包名改了」这件事会先让门禁失灵、再让人误以为
门禁是绿的。

`publishConfig.access` 此前对无 scope 名是空操作，迁到 scope 后**必需**：npm 对 scoped
包默认按 restricted 处理，漏掉它首次 `npm publish` 会直接失败。`verify:package` 现在
断言这一项——这正是「换身份」带来的一个真实行为变化，不是纯改名。

### 6. `publishConfig`：access 与 provenance

`packages/bmap-vue/package.json` 新增：

```json
"publishConfig": { "access": "public", "provenance": true }
```

两条都**不含包名**，因此与 scope 待定这件事无关（#45 第 5 条的「trusted publisher / 认证」由
npm 侧的 OIDC 配置承担，仓库内不需要任何字面量）。

- **`access: "public"`**：对今天的无 scope 名 `bmap-vue` 是空操作，但**发布身份迁到维护者
  自有 scope 之后它是必需的**——npm 对 scoped 包默认按 restricted 处理，漏掉这一项会让
  第一次 `npm publish` 直接失败。提前写好，避免在发版当天才发现。
- **`provenance: true`**：#45 第 5 条要求核对 provenance。npm 侧的 trusted publisher 会给
  OIDC token，**没有** provenance 的话供应链元数据不会附上。这一项把意图固化在 manifest 里，
  具体的发布 workflow 属 #45 后续工作。

## 后果

- 发布 tarball 的内容第一次成为**可断言的事实**，而不是「build 跑过了就假定没问题」。
- `check:package-shape` 一条命令取代 CI 里两行内联命令，且 attw 的退出码不再被吞。
- **`pack:package` 自带 `pnpm generate:manifest` 前置**。`volar.d.ts` 那条隐患的根因是
  「顺序靠人记得」，把它封进最可能被直接跑的那条命令里，才真正消掉了「跳过生成直接打包」
  这条路径。
- **`check:pack-contents` 按 manifest 的 `name + version` 定位 tarball**，以便 scope 迁移后
  无需改代码。⚠️ npm 对 scoped 包产出的文件名**不带前导 `@`**：实测
  `npm pack @mangmax/bmap-vue@1.0.0-rc.0` → `mangmax-bmap-vue-1.0.0-rc.0.tgz`。
  第一版写成 `name.replace("/", "-")`，会算出 `@mangmax-bmap-vue-…`——迁移后门禁**找不到
  刚打出来的包**，而它恰恰是为了让迁移不出问题才读 manifest 的（PR 评审 P2 实测确认）。
- **修掉一个间歇性故障**：attw 报告 134541 字节 > 65536（Node 管道读取的分块边界），
  且它用**非零退出码**表示「有 problem」——这两件事同时发生时 `execFileSync` 的
  `error.stdout` 被截断，`JSON.parse` 抛 `Unterminated string`。症状是**时绿时红**，
  而 attw 单独跑完全稳定。改为 shell 重定向落文件再读（attw 0.18.5 无 `--out`），
  连续 8 次运行全绿。已加回归用例，并顺手加固 `tests/behavior/workflow-helpers.ts`：
  `stepBlockContaining` 此前会先命中 workflow 里的**注释**行（每个门禁上方都写了
  「为什么」，注释里提到命令名是常态），导致切出**上一步**、断言非架空成了假绿。
  现在只匹配非注释行。
- CDN 示例锁版本；`dist/bmap-vue.css` 从「碰巧存在」变成「承诺存在」，但**明确标注它
  只对 CDN 场景有效**（包管理器消费方受 `exports` 白名单限制，引用不到）。
- 门禁对**今天的 tarball 就是绿的**：已审阅的例外被显式登记，不会一上来就红一片。

## 回滚

门禁本身可独立回滚（删脚本 + 删 CI 步骤）。`files` 新增 `dist/bmap-vue.css` 是**纯增量**
（该文件此前已在包里，只是未被声明），回滚不改变发布内容。sourcemap 保持原状，无需处置。

## 非目标

- **不**补 `typesVersions` 或 `require` 条件：那是 #44 冻结面的变更，连动五份 API report 与
  `export-surface-freeze.test.ts`，属 **#158** 的范围。
- **不**改 `exports` / 公共 API 面。
- **不**动 SSR / Volar / generic 三档 consumer（#158）。
- **不**引入 Node 版本矩阵：`engines.node >= 24` 就是当前唯一支持版本，加一个跑不过的下界
  只会制造永久红灯。
- **不**在 PR 门禁里做真实发布演练：不可逆且需要维护者凭据。

## 参考

- issue #45 / #158；`docs/adr/2026-09-25-public-export-surface-freeze.md`（出口面冻结）
- `docs/adr/2026-09-24-bmap-vue-release-identity-reset.md`（发布身份与 1.0 版本线）
- `scripts/pack-contents-boundary.mts`、`scripts/package-shape-boundary.mts`（判据与例外表）
