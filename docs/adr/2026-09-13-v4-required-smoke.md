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

### 6. bootstrap 阶段的两类失败必须落到不同结论（第 1 轮评审后补）

初始挂载没有 ready 时，**不能让所有 required 以「缺席」收场**：缺席 ⇒ `REQUIRED_CHECK_MISSING`
⇒ 退出码 1，于是网络 / CDN / AK 这类外部前置问题被写成「库回归」，在最关键的初始化场景把两类
问题重新混在一起。修订后的口径：

- 只有 `BMAP_SDK_LOAD_FAILED` / `BMAP_SDK_LOAD_TIMEOUT`（或压根没有可归属的错误）⇒ **外部前置**：
  本档 required **逐条登记为 `blocked`** ⇒ 退出码 3（不可放行）；
- 出现任何其它错误码 ⇒ **实现 / 上游契约**：登记一条 `fail` + required 保持缺席 ⇒ 退出码 1。
- 判定方向保守：**只要有任何一个非外部码，整轮按实现回归处理**（宁可红不可绿）。

同理，**明确属于外部依赖的网络阶段**（服务回包、官方 UI Kit 的检索）超时按 `blocked` 结算
（`withBlockedTimeout`），但 promise 自身的拒绝照原样透传——那是被测对象的结论，不能被吞成
「环境问题」。服务**返回空**与**一直不返回**从此得到同一个结论（都是 `blocked`）。

### 7. 判定输入的信封自检（第 1 轮评审后补）

Node 侧重算判定时，`mode` / `runId` / `akUsed` 必须与**本轮 CLI 请求**一致，且 required 取
**CLI 的档**而不是报告自报的档。否则页面若意外按另一档跑，Node 会跟着换成一个**更小**的
required 集合——门禁看着绿、其实少跑了一片。不一致按脚手架失败（退出 2）退出。

### 8. 控件 / 图层的挂载证据改为「拦截真实 SDK 调用」（第 1 轮评审后补）

原实现里 live 档只能核对「能力表声明 + 无 `console.error`」，`layer-district` 因此会在图层静默
no-op 时 PASS（评审指出；实测把 `<BDistrictLayer>` 的挂载改成 no-op，旧断言仍然绿）。
改为临时拦截真实 `Map.addControl` / `Map.addLayer` 并记录调用：证据从「没抛错」变成
「SDK 的那次调用确实发生了」。

**边界（写进文档与 PR）**：拦截证明调用发生，不证明 SDK 采纳；要证明采纳需要 SDK 提供读数接口，
上游 4.0.4 没有。拦截器必须在 `finally` 还原。

### 9. 四个 wrapper 全部进 required smoke（收口 #75 之后的组件面）

`#75`（PR #82）交付了第三个与第四个薄封装（`BPlaceDetail` / `BRoutePlan`），因此 required smoke
的 UI Kit 部分从两个扩到四个，且都是**真实 AK**：

| 检查 | 关键断言 |
| --- | --- |
| `ui-kit-autocomplete-search` | `ready`、检索写入输入框、官方 UI Kit 渲染出输入框、卸载后宿主子树撤走 |
| `ui-kit-placesearch-load` | 检索结算 + **`load` 事件带回 POI**（并从中取一个**真实 uid** 交给下一条） |
| `ui-kit-placedetail-load` | 用上一步的真实 uid 打开、`load` 事件带回详情、面板渲染、卸载后撤走 |
| `ui-kit-routeplan-search` | 驾车检索返回方案、**`result` 事件与返回值同源**、面板渲染、卸载后撤走；`BMAP_SERVICE_FAILED` 记 `blocked` |

细节口径：**事件也要断言**（不能只看 `search()`/`load` 的返回值或 `search()` 是否结算）——事件
绑定断掉时返回值可能仍然正常；uid **从真实检索结果取**，不硬编码某个 POI（硬编码的 POI 会随
数据变化而失效，让检查变成偶然通过）；四个 wrapper 的「回收」都按同一条口径检查宿主子树撤走。

### 10. docs 三件套进 PR 门禁，且类型检查对着发布声明面（收口 #74 的 docs 验收）

`docs:format:check` / `docs:typecheck` / `docs:build` 三样**长期是红的**，而且**没有任何 CI 跑它们**
——「docs 通过」这条验收因此一直挂在 #25/#74 上却没人执行。三个根因与处置：

| 症状 | 根因 | 处置 |
| --- | --- | --- |
| `docs:format:check` 报 2 个文件 | `examples/expand/bmap-draw/draw.vue`、`examples/expand/mapvgl/pointLayer.vue` 未被格式化 | 按仓库自身的 formatter 输出重排 |
| `docs:typecheck` 23 条 `Cannot find name 'BMap'` / `BMAP_ANCHOR_*` | `docs/tsconfig.json` 的 `paths` 把 `baidu-map-gl-vue` 映射到组件库**源码**，而 docs 的 types 环境没有上游全局声明 | 改为映射**发布声明面**（`dist/index.d.ts` / `dist/ui-kit.d.ts`）：docs 示例是消费方，对着发布面检查才有意义，也不需要在 docs 侧引入上游全局声明 |
| `docs:build` 报 `Element is missing end tag`（位置误导） | 某个 ADR 在**行内代码里写了「反斜杠转义的反引号」**：markdown-it 把被转义的字符当普通文本、不当代码跨度分隔符 ⇒ span 不闭合 ⇒ 后面的裸 `<...>` 被当作 Vue 标签（真正的元凶在第 83 行，报的却是 128 行） | 改述那一段；并加一条静态用例禁止 docs 的 markdown 出现该写法（用围栏代码块或改述代替） |

三条新门禁（`quality.yml` 的 `docs` job + `tests/behavior/v3-docs-gate.test.ts`）都配了反证：
把 `paths` 指回 `src` / 删掉 docs job 的构建步骤 / 往文档里塞回转义反引号，对应用例都会红。

## 已知限制与欠账

- **live 档的图层 / 控件检查只到「调用发生过」**：真实 4.0 没有读数接口，拦截 `Map.addLayer` /
  `Map.addControl` 只能证明调用发生、不能证明 SDK 采纳（见决策 8）。要更强只能等上游提供读数入口。
- **AK 被拒的场景仍未归到 `blocked`**：实测用一个无效 AK 跑，官方仍会注入入口 script、`BMap`
  命名空间也在，`<BMap>` 甚至照常发 `ready`，但地图对象是半初始化的（本库的 Driver 读它时会抛
  `TypeError`）⇒ 整轮以 `fail` 收场。官方 `Map` **没有** `getStatus()` 这类入口（`BMAP_STATUS_INVALID_KEY`
  只在服务类实例上可达），因此「AK 被拒」在当前可观察面上无法与「实现回归」区分。处置：保持保守的
  `fail`，不猜；这条作为一个明确的开放问题留给后续（需要在真实运行面上找到可观察的凭据状态信号）。
- **可选插件的独立页面尚未交付**：本轮只把「必需链路」与「可选插件」的边界写成口径
  （必需要求未归因错误失败/阻塞、可选插件另页验证），插件页本身仍由 #42 / #43 承接。
- **多地图 / retry / 路由卸载**只覆盖到「第二个入口复用 SDK」与「卸载后重挂载」两条；
  完整的多地图与路由卸载矩阵仍按 #25 的保留项推进。
- **`fixtures/` 下只有 `v3-consumer` 一个 consumer**：**advanced / SSR 的独立 consumer 仍缺**
  （属 #44 / #45）。docs 三件套已进 CI（见决策 10），但「advanced / SSR 的消费验证」不在其中。
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
