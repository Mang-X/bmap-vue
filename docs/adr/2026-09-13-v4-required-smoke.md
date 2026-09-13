# ADR 2026-09-13：v4 required smoke 的交付形态与判定口径

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`R25-E`（issue #74，追踪 #12，收口目标 #25）
- 相关：`tests/browser/jsapi-v4/**`、`scripts/smoke-jsapi-v4.mts`、`scripts/official-probe/**`、`tests/behavior/v3-v4-smoke-gate.test.ts`、`.github/workflows/nightly-v4-smoke.yml`、`docs/zh-CN/contributing/v4-browser-smoke.md`
- 修正：ADR [2026-09-11 v4 Map Facet](./2026-09-11-jsapi-v4-map-facet.md) 的**决策 9**（`MapTypeId` 成员名以官方类型声明为准 → 改为以真实运行时为准）。

## 背景

`#25`（M3A.3 默认切换）的验收长期缺一块：**没有任何一条门禁在真实 SDK 上证明「默认入口 + 现有
Vue 组件」真的可用**。已有的两层证据都够不到那里：

- `Fake v4` 是替身边界，它的形状由我们决定——它比真实 SDK 宽容时，缺陷会被掩盖（本次就发生了）；
- `probe:official` 只驱动**官方两个包**，页面里没有本库的组件。

同时 #72 明确欠下三条、因为 `tests/browser/jsapi-v4/**` 当时只存在于 #25 的开发分支而无法落地：

1. smoke 判定补齐五态，**required 只接受 `pass`**（历史 characterization 不得计入通过）；
2. **取消「按跨域来源一律豁免异常」**（原 `report.mts` 的 `thirdPartyUnhandled` 口径是
   「只记录，不计入门禁」），未归因错误必须失败或阻塞，白名单要带具体原因/版本/责任人/到期条件；
3. 在同一候选提交上、用**默认官方 Loader 路径**跑 required smoke（气泡显示内容、Autocomplete 回收干净）。

`#74` 承接这三条。**前提是不反向依赖 #25**（否则 #74 与 #25 互为前置，形成环）。

## 决策

### 1. harness 落在 `main` 上，PR 以 `main` 为 base

不把实现建在 #25 的开发分支上：那会让 #74（#25 的合并前置）依赖 #25，直接成环；而且
`m3a3-cutover` 停留在 #70~#73 之前，基线相差四个已合并 PR。做法是把 harness 按**当前**
（Official-first 之后的）架构重写后落到 `main`，#25 分支随后 rebase 并收缩。

harness 复用 #70 建的两个语义已评审的模块（`scripts/official-probe/readiness.mts` 保证
「就绪判定绑定本轮实例」、`official-probe/cdp.mts` 保证「CDP 一定有截止时间」），不再自造一套。

### 2. 五态判定，required 只接受 `pass`

| 结论 | 含义 | 可放行 |
| --- | --- | --- |
| `pass` | 断言成立，且是本轮真实观察到的 | 是 |
| `fail` | 断言不成立，或出现归属到本库的未处理异常 | 否 |
| `blocked` | 前置不满足（AK / 配额 / 网络 / 浏览器），本轮无法得出结论 | 否（**不是通过**） |
| `skipped` | 登记了但本轮没执行，必须给出理由 | 否 |
| `expected-failure` | 已知缺口，**必须**带追踪票与到期日 | 否（阻止发布） |

三条防空转的硬规则（都有单测，且都配反证）：

1. **required 必须真的跑过**：登记为 required 但报告里缺席 ⇒ `REQUIRED_CHECK_MISSING` → `fail`。
   「这次没执行」与「这次执行且失败」必须都能红。
2. **元数据缺失即退化**：`expected-failure` 缺 `tracking` / `expires`、或已过期 → `fail`；
   `skipped` 缺 `reason` → `fail`。可以登记已知缺口，不可以登记无法追踪的缺口。
3. **跨域来源不构成豁免**：未归因错误必须被一条带齐 `reason` / `version` / `owner` /
   `tracking` / `expires` 且未过期的白名单条目覆盖，此时结论是 `blocked`（仍不可放行）；
   否则 `fail`。白名单**缺省为空**；可选插件的噪声靠单独页面隔离。

### 3. 退出码

`0` 全 required `pass` 且无不可放行结论；`1` 有 `fail`；`3` 有
`blocked` / `skipped` / `expected-failure`；`2` 脚手架失败（页面未写出报告、Vite 未就绪、
CDP 超时等）。**`3` 不等于通过**——调用方（nightly、发布流程）必须区分。

判定在 **Node 侧重算**：页面的结论不作为判退依据（页面可能被旧 dev server 或旧模块图污染）。

### 4. 两档：`fixture` 与 `live`，档内不适用的检查**不登记**

| 档 | 前置 | 用途 | 组件树 |
| --- | --- | --- | --- |
| `fixture` | 无 AK、无外网 | PR 门禁 / 本地快速回归 | `existingGlobalV4Provider()` + 注入 Fake v4 命名空间 |
| `live` | 真实 AK + 外网 | nightly / 发布前验收 | `<BMap :ak>` **不传 provider**，走默认入口 |

`skipped` 的语义是「**登记了却没跑**」（会阻止放行），所以「本档不需要这条检查」不能表达成
`skipped`，只能**不进登记表**。登记表（`registry.mts`）因此是「哪些检查在哪些档跑、哪些算
required」的单一事实源，页面按表执行、orchestrator 按表判定、单测按表做一致性校验
（含一条「登记表里的 required 必须在页面实现里出现」的静态检查）。

两档读数差异（覆盖物 / 控件 / 图层 / 泄漏门禁 / 命名空间形状）全部收进 `ModeDescriptor`，
检查体只写领域语言；live 档不可读的量（真实 4.0 的 `Map` 没有 `getControls()` / `getLayers()`）
如实记进 `detail`，并在 fixture 档用账本做精确断言——**不用弱读数替代精确断言**。

### 5. `MapTypeId` 成员名以真实运行时为准（修正决策）

本次 smoke 第一次运行就抓到：按官方类型声明使用 `MapTypeId.BMAP_NORMAL_MAP` 会让 `<BMap>` 在
真实 SDK 上**永远进不了 `ready`**（`applyMapType` 抛错 → `boot()` 落 `catch` → 整张地图不可用）。

- 声明：`@baidumap/jsapi-v4-types@4.0.4` 的 `map-type/MapTypeId.d.ts` 写的是 `BMAP_*_MAP`；
- 运行时：`BMap.MapTypeId` 实际是 `{ NORMAL, EARTH, SATELLITE }`，带前缀的常量挂在**全局**。

处置：候选顺序改为**运行时名优先、声明名后备**（仍只读命名空间成员，不读全局、不猜值）；
`FakeV4MapTypeId` 改为**只**提供运行时那三个成员——夹具比真实 SDK 宽容时，这类缺陷只能靠真实
smoke 抓，所以夹具必须按运行时造。细节见 [v4 Map Facet ADR](./2026-09-11-jsapi-v4-map-facet.md) 决策 9。

## 后果

- 正面：`#25` 的「默认链路可用」第一次有了可复现的真实证据（14 项 required 全 `pass`，
  `gate.exit=0`）；判定口径可单测、可反证，不依赖浏览器；PR 门禁有确定性档（fixture）；
  #72 的三条欠账全部落地。
- 成本：新增一个必跑脚本（nightly）与一个浏览器 harness；`ModeDescriptor` 的两档差异需要维护
  ——但这是「真实 SDK 与替身的差异」本身，藏在用例里只会更难维护。
- 回滚：删掉 `tests/browser/jsapi-v4/**` + `scripts/smoke-jsapi-v4.mts` + 两条 npm script +
  nightly workflow 即回到「只有 Fake 与官方包探针」的状态。**不回滚** `MapTypeId` 的成员名修正
  （那是缺陷修复，与 harness 是否保留无关）。

## 已知限制与欠账

- **live 档的图层检查是弱读数**（能力表声明 + 无 `console.error`）：真实 4.0 没有图层读数接口、
  矢量图层不落 DOM。精确断言留在 fixture 档；要更强只能等上游提供读数入口。
- **可选插件的独立页面尚未交付**：本轮只把「必需链路」与「可选插件」的边界写成口径
  （必需要求未归因错误失败/阻塞、可选插件另页验证），插件页本身仍由 #42 / #43 承接。
- **多地图 / retry / 路由卸载**只覆盖到「第二个入口复用 SDK」与「卸载后重挂载」两条；
  完整的多地图与路由卸载矩阵仍按 #25 的保留项推进。
- **`docs:build` / `docs:format:check` 的既存失败未在本轮处理**（与本次改动无关，基线对照证据见
  PR 正文）；它们也**没有**接入任何 CI，所以「docs 通过」这条验收不能由本 PR 声称完成。
  同理 `fixtures/` 下只有 `v3-consumer` 一个 consumer，**advanced / SSR 的独立 consumer 仍缺**
  （属 #44 / #45）。
- **仓库地址与包元数据不在本 PR 范围内**：`package.json` 的 `repository.url`、README/文档站的
  旧地址由仍在 open 的 PR #69（`chore/repo-migration-references`）覆盖，两者文件不重叠、无冲突。
  因此验收项「仓库链接为新地址」不能由本 PR 声称完成；本 PR 只负责**功能性**的那一条
  ——「新组织 owner 条件不会静默跳过必要 CI」。
- **实跑证据不进仓库**：真实的 `pnpm smoke:v4` 报告已脱敏，但仍按「不入库」处理（避免把运行时
  日志/授权信息带进版本库），落在 PR 正文与 nightly 的 artifact 里；候选 commit 以 PR head SHA
  为准。因此**证据的可复核性依赖 PR 与 CI**，读者不能只凭仓库内容复现那一次运行。
- **orchestrator 与 `scripts/probe-official-packages.mts` 有一份重复的进程工具**
  （`spawnTracked` / 等 DevTools 端口 / 等 page target / 解析浏览器）：刻意不复用——抽成共享模块
  要改动 #70 已评审的文件，收益不抵评审成本。CDP 与就绪判定确实复用了 `official-probe/*`；
  重复项已在 `scripts/smoke-jsapi-v4.mts` 的注释里写明，列为后续收敛项。
- **`tests/browser/**` 不在任何常规 typecheck 门禁的扫描范围内**：本次用一次性 tsconfig
  复核过（与洁净基线的错误数同为 65，本 PR 的文件 0 错误，见 PR 正文），但常规门禁仍不覆盖；
  要常态化需要给浏览器 harness 单独加一条 `tsc --noEmit`。
- **浏览器只覆盖 headless Chromium（SwiftShader）**：真实 GPU、移动端 UA、Safari 不在门禁内。
  nightly 不安装 Playwright 浏览器，走 runner 预装的 `/usr/bin/google-chrome`。

## 非目标

- 不发布 Stable、不合并 PR、不删除旧引擎（属 #26）、不擅自变更 GitHub / npm 权限；
- 不把 fixture 档的结论当成 live 档的替代品（两档的 required 列表不同，且 fixture **不**
  包含默认官方入口与真实服务/UI Kit）；
- 不恢复默认自研 Loader，也不为通过门禁放宽白名单。

## 参考

- issue #25（M3A.3 默认切换）、#72（R25-C）、#74（R25-E）；总追踪 #12
- ADR [Official-first：默认加载委托官方 Loader](./2026-09-13-official-first-loader-and-ui-kit.md)
- ADR [默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)
- ADR [v4 Map Facet](./2026-09-11-jsapi-v4-map-facet.md)（决策 9 本次被修正）
- `docs/zh-CN/contributing/v4-browser-smoke.md`、`docs/zh-CN/contributing/official-packages.md`
- 同源参考实现 `huiyan-fe/react-bmap` v2.0.1（官方 React 组件库，同以 JSAPI 4.0 + 官方
  `@baidumap/jsapi-loader` 为目标）：本次用它核对「一个完整组件库对外承诺的组件面」，
  逐项分类结论见 PR 正文的对照表
