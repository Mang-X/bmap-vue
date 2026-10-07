# ADR 2026-10-02：开放 ESM 样式子路径（`./styles.css`）与纯资源出口的形状

- 状态：Accepted
- 日期：2026-10-02
- 关联：issue **#189**、#45、#158、#44
- 影响范围：`package.json#exports` / `sideEffects`、attw 例外表、文档与消费门禁
- 取代：仅取代 [ADR 2026-09-30](./2026-09-30-pack-contents-and-publish-shape-gates.md)
  决策 4 中「包管理器消费方目前无法引用这个 CSS……属独立决策，本 ADR 不做」这一段——
  #189 正是那个独立决策。该 ADR 的其余决策（tarball 门禁、publint/attw 锁定、
  sourcemap 保留、发布身份）不变。

## 背景

`dist/bmap-vue.css` 是 `<Autocomplete>` 输入框的样式（定位 `position: absolute`、
层级 `z-index: 10`、尺寸与外观），由该 SFC 的 scoped `<style>` 在 ESM 与 IIFE 两档
构建中产出。ADR 2026-09-30 决策 4 已经把它从「构建副产物」提升为**按文件名显式声明的
公共面**，并同时记下一条限制：

> `exports` 没有开放 CSS 子路径，`import 'bmap-vue/dist/bmap-vue.css'` 被 Node 判为
> `ERR_PACKAGE_PATH_NOT_EXPORTED`。因此它目前只服务于 `<script>` 直引的 CDN 场景。

后果是**同一个文件有两条互不相通的消费路径**：CDN 用 `<link>` 能用，npm/Vite 消费方
不能。而后者是主流安装方式（README 与安装页的首选），于是「`<Autocomplete>` 有样式」
在主流路径上不成立——**文件在 tarball 里，不等于消费路径可达**。

## 决策

### 1. 开放**一个**精确子路径：`"./styles.css": "./dist/bmap-vue.css"`

裸字符串目标，**没有** `types` / `import` 条件，也不配任何假 `.d.ts`：

```json
"./styles.css": "./dist/bmap-vue.css"
```

用户写 `import '@mangax/bmap-vue/styles.css'`。

三条刻意收窄：

- **精确子路径，不用后缀模式。** 实测 Node 的 `"./*.css": "./dist/*.css"` 模式出口会让
  `dist/` 下**任意** `.css` 都可解析（`pkg/other.css` → `dist/other.css` 也成立）。
  出口面白名单本来就是白名单，一条通配会把它静默放宽成「以后加的任何 CSS 都自动是公共面」。
  门禁因此断言 exports 的键里没有 `*`（`doc-subpath-exports.test.ts`）。
- **不配 `.d.ts`。** 假声明会让 `import '…/styles.css'` 变成一条类型声明引用，
  消费方拿到的是「声明存在但内容无关」的假承诺。代价是 attw 会在四个档位下各报一条
  `NoResolution`（见决策 3），本 ADR 明确接受并登记它。
- **不动其余出口。** 七个 JS 出口（`.` / `./components` / `./composables` / `./plugins` /
  `./resolver` / `./advanced` / `./ui-kit`）与纯 types 出口 `./volar` 全部不变；
  根入口仍不静态引入 UI Kit，SSR 边界不变。

### 2. `sideEffects` 从 `false` 改为只声明那个 CSS

```json
"sideEffects": ["./dist/bmap-vue.css"]
```

意图是把**样式**与 **JS** 分开声明：JS 必须保持可摇（`./advanced` 的「不拉进组件」
承诺依赖它），而样式需要被声明成有副作用，否则一个把 `import '<pkg>/styles.css'`
视为无副作用的打包器会整条删掉它。

⚠️ **实测边界（不要把这条写成比证据更强的话）**：在 Vite 7.3.7 与 8.3.3 上，
`sideEffects` 取 `false` / `["./dist/bmap-vue.css"]` / `[]` 三种写法，生产构建**都**产出了
那份 CSS 资产。原因是本库**没有任何 JS import 它**——ESM 产物里零 CSS 引用，
只有消费方写下的那一条纯副作用 import，而 Vite 不按包的 `sideEffects` 摇掉入口自身的
副作用 import（`moduleSideEffects` 只作用于解析出来的依赖模块）。

所以这次改动**不是**「修了一个 Vite 上看得到的缺陷」，而是**声明正确性**：
`sideEffects: false` 是在对全世界声明「本包的每个文件都没有副作用」，而这条样式出口
恰恰**就是**一个副作用。声明成 `true` 则有实证代价（JS 失去 tree-shaking）。
「实测 Vite 恰好不受影响」不等于「声明可以继续写错」。

### 3. `./styles.css` 的 attw `NoResolution` 登记为显式例外

开这条出口后 attw 多报 **4** 条 `NoResolution`（`node10` / `node16-cjs` /
`node16-esm` / `bundler` **各一条**）。成因与既有的那条**不同**：

| 登记 | 成因 | 档位 |
| --- | --- | --- |
| `#158`（既有） | 未提供 `typesVersions`，node10 拿不到子路径 | 仅 `node10`，6 个子路径 |
| `#189`（新增） | `./styles.css` 是**纯资源出口**，CSS 不是声明 ⇒ **所有**档位都无解析 | 四档齐全，**1** 个 entrypoint |

attw 判的是「类型声明能不能解析」，资源出口天然不参与这件事。把两者合并成一条会让
`expectedCount` 变成一个没有依据的合数，也让「哪一条成立」不可见，因此**分成两条登记**。

例外模型为此扩展了两个字段（都保持逐条全等比对，不是放宽）：

- `expectedResolutionKind` 可以是**一组**档位（四档逐个比，多一档少一档都判红）；
- `entrypointShape: "per-resolution-kind"`：`entrypoints` 是**每个档位各出现一次**的清单。
  不引入它的话，4 条 problem 只有 1 个 entrypoint，会被算成「新增子路径
  `./styles.css` ×4」这种读不出信息的结论。

**一个 `kind` 有多条登记**要求 occurrences 按 entrypoint **分摊**给各条再逐条比对。
第一版写成「某一条能解释全部就放行」，实测把两条**都**判成不一致——判据退化成了永远判红。

**「这一轮出现过」的状态必须追踪到单条登记，不能追踪 `kind`**（PR #200 评审 P1）。
按 `kind` 追踪有一条实测确认的假绿路径：`NoResolution` 的两条登记里，#158 的 6 条正常、
而 #189 的 `./styles.css` 4 条**整条消失**时，本轮会 `seenKinds.add("NoResolution")`，
反向遍历再按 `seenKinds.has(kind)` 逐条跳过 ⇒ **两条都被跳过**，`problems` 为空 ——
而「一条登记消失也要 fail-closed」正是本 ADR 承诺的事。修复用**对象身份**追踪
（比较的就是登记数组里的同一批对象，不必自造 `kind + tracking + …` 拼接键），
并补了两个方向的回归用例（哪一条消失都要点名报出，描述里带追踪票号 + 子路径清单，
否则同 kind 的两条 vanished 在日志里长得一样）。

### 4. 门禁与文档同源

| 位置 | 判据 |
| --- | --- |
| `check:pack-contents` | `exports` 引用的文件必须在 tarball 里（`.css` 目标天然覆盖）；CSS 仍须按文件名列入 `files` |
| `export-surface-freeze` | 每个出口要么有 `import` → `.mjs`、要么是**裸字符串 → `dist/*.css`**、要么是纯 `types` → `.d.ts`。裸字符串那支**不放宽成跳过**：按扩展名限定为 `.css`，`"./x": "./dist/nope.css"` 这类仍要红 |
| `doc-subpath-exports` | 文档写的每个 `<pkg>/<subpath>` 都在 `exports` 里（覆盖 `styles.css`）；出口/files/sideEffects 三者一致；出口里没有 `*` |
| `advanced-contract` | `sideEffects` 仍不得给 JS 发副作用通行证（`false` 或**只含 CSS** 的列表） |
| `verify:package` | 在**装出来的 tarball** 上：`import.meta.resolve` 能解析 `./styles.css`、内容含 Autocomplete 的 `position: absolute` / `z-index: 10`；且**深路径** `pkg/dist/bmap-vue.css` **仍然** `ERR_PACKAGE_PATH_NOT_EXPORTED` |

`runtimeExportSubpaths()` 的判据同步收窄为「spec 最终解析到 `.mjs`」——原来那句
「有 `import` 条件」会把资源出口也算成入口，得出「dist 少了两个入口」的误判。

## 后果

### 验收证据（全部实测，2026-10-02）

| 项 | 结果 |
| --- | --- |
| Node 解析 | `import.meta.resolve('@mangax/bmap-vue/styles.css')` → `…/dist/bmap-vue.css` |
| 深路径 | `@mangax/bmap-vue/dist/bmap-vue.css` → `ERR_PACKAGE_PATH_NOT_EXPORTED`（**未**被 `exports` 意外放开） |
| Vite 8.3.3 生产构建 | 产出 `dist/assets/style-*.css`，内容为 `.b-auto-complete-input{…}` 全量规则 |
| Vite 7.3.7 生产构建 | 同上 |
| `verify:package`（装出来的 tarball） | `styles.css 可解析且含 Autocomplete 规则` + `deep path still rejected (ERR_PACKAGE_PATH_NOT_EXPORTED)`，其余全部步骤 ALL PASSED |
| 浏览器计算样式 | `position: absolute`、`top/left: 10px`（相对 `<Map>` 容器，实测偏移恰为 10/10）、`z-index: 10`、`max-width: calc(100% - 20px)` |
| 因果验证 | 禁用该样式表 → `position` 从 `absolute` 退回 `static`、`z-index` 退回 `auto`；恢复后回到 `absolute` |
| tarball 条目 | **50 → 50 不变**：`dist/bmap-vue.css` 早在 #45 就已按文件名列入 `files`，本票只改**可达性**（`exports`）与**声明**（`sideEffects`），不改发布内容 |
| 根入口 SSR | 无 DOM 的 Node 里 `import '@mangax/bmap-vue'` 正常（124 个导出） |
| `./ui-kit` | 仍可按需加载，未被根入口静态拉入 |
| attw | 例外表枚举后放行 **12** 条（8 `CJSResolvesToESM` + 6+4 `NoResolution`），未登记的一律红 |

### 代价与剩余

- attw 的 `NoResolution` 从 6 条涨到 10 条，**全部**是上面登记过的两类，逐条可见。
- 样式仍**不自动注入**：消费方必须显式 `import '@mangax/bmap-vue/styles.css'`。
  这是有意的——自动注入会引入运行时副作用、破坏 tree-shaking，并与「根入口 SSR-safe」
  冲突（#189 边界明确「不增加自动注入框架」）。
- `typesVersions` 与 `require` 条件仍缺，属 **#158** 范围，本 ADR 不动。

## 回滚

删掉 `exports["./styles.css"]` 与 `sideEffects` 那一项，并把 `ATTW_EXCEPTIONS` 里
`tracking: "#189"` 的那条登记一并删除（不删会立刻报 `exception-vanished`——这正是
反向判据的作用）。文档三处（安装页、Autocomplete 页、两个 README）回到「仅 CDN 可用」
的措辞。`files` 里的 `dist/bmap-vue.css` 保留（#45 的决策，与本 ADR 无关）。

## 非目标

- **不**改七个 JS 出口与 `./volar`，**不**重开 #44。
- **不**引入自动样式注入、**不**复制官方 UI Kit 的 CSS、**不**新增 UI 依赖。
- **不**为 CSS 造 `.d.ts`，**不**开 `./*.css` 通配出口。
- **不**补 `typesVersions` / `require`（#158）。

## 参考

- issue #189（本票）、#45（tarball 与形状门禁）、#158（消费验证）、#44（出口面冻结）
- `docs/adr/2026-09-30-pack-contents-and-publish-shape-gates.md`（决策 4 被本 ADR 取代）
- `docs/adr/2026-09-25-public-export-surface-freeze.md`（出口面冻结）
- `scripts/package-shape-boundary.mts`（例外表）、`scripts/release-identity.mts`
  （`runtimeExportSubpaths`）、`scripts/verify-package.mts`（tarball 消费探针）
