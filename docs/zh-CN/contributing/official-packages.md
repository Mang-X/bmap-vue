# 官方包发布契约（Loader / UI Kit）

本页是 `@baidumap/jsapi-loader` 与 `@baidumap/jsapi-ui-kit` 的**发布契约单一事实源**：
版本、入口形状、运行时行为、不支持项与验证方式。决策依据见
[ADR 2026-09-13：Official-first](/adr/2026-09-13-official-first-loader-and-ui-kit)。

> 结论一律以**发布产物 + 真实运行**为准，不以官方文档、示例或 Skill 的转述为准。
> 上游改版时，`tests/behavior/official-packages-*.test.ts` 会先红——先回来更新本页，再改实现。

## 锁定版本与来源

| 包 | 版本 | 发布时间 | 许可 | 用途 | 依赖策略 |
| --- | --- | --- | --- | --- | --- |
| `@baidumap/jsapi-loader` | `1.0.0` | 2026-07-17 | MIT | 默认在线加载 JSAPI 4.0 | 运行时依赖（精确锁定，无 `^` / `~`） |
| `@baidumap/jsapi-ui-kit` | `1.1.2` | 2026-03-23 | MIT | 标准 UI（建议 / 检索 / 详情 / 路线） | optional peer + 开发期精确锁定 |

出处核对方式（发布产物，不是仓库源码）：

```bash
curl -s "https://registry.npmjs.org/@baidumap%2Fjsapi-loader" | jq '.versions["1.0.0"].dist.integrity'
curl -s "https://registry.npmjs.org/@baidumap%2Fjsapi-ui-kit" | jq '.versions["1.1.2"].dist.integrity'
```

**包名核对（#70 实施步骤 6）**：issue 正文里写的 `@baumap/jsapi-loader` / `@baumap/jsapi-ui-kit`
在 npm 上**不存在**（`scope:baumap` 检索结果为 0，两个包名都是 404）——正确 scope 是 `@baidumap`。
本仓库实际安装与锁定的就是 `@baidumap/*`。另：组件库 npm 包名仍是 `baidu-map-gl-vue`（仓库改名不改包名），
源码路径仍是 `packages/baidu-map-gl-vue/src`。

- loader `1.0.0`：`sha512-f88EFIvbICW3AtnbhYcnvlpG/bIY2hZyokdCgf30RVXvs67aDkBtFJnDO/C8Bf7p4O8MvlTU6rW8jz8ev1MayA==`
- ui-kit `1.1.2`：`sha512-VYiipooQSuhDUKHhVA8/n3wkHmNAXKL959/jZVoiy6WliP43BJe77U9rHTW1Qj0sety/5Yf3yi9K8ieH0ghNcg==`

包内实际文件（决定所有「能不能 import / 有没有样式」的判断）：

| 包 | `main` | `module` | `types` | `style` | `exports` |
| --- | --- | --- | --- | --- | --- |
| loader | `dist/index.js` | `dist/index.mjs` | `types/index.d.ts` | — | `{".":{types,import,require}}`，`sideEffects: false` |
| ui-kit | `dist/jsapi-ui-kit.iife.js` | `dist/jsapi-ui-kit.esm.js` | `dist/index.d.ts` | `dist/css/jsapi-ui-kit.css` | **无** |

最后一行是 UI Kit SSR 结论的根因：没有 `exports` 字段 ⇒ Node 侧 `import` 落到 IIFE 产物。

## 复现方式

### 1. 无网络契约锁（进 CI）

```bash
pnpm test:unit        # 含 tests/behavior/official-packages-loader.test.ts 与 official-packages-ssr.test.ts
```

- `official-packages-loader.test.ts`：happy-dom（关掉 happy-dom 的外部脚本加载，并抹掉 `tests/setup.ts`
  的 SDK 桩）驱动**真实的** loader，覆盖导出形状、校验、单例、冲突、超时重试、reset、代理模式；
- `official-packages-ssr.test.ts`：在**真的无 DOM 的 Node 子进程**里 import 两个包，固定 SSR 结论。

### 2. 真实 v4 原生探针（人工 / 发布前；不进 CI）

```bash
export PATH="/Users/mang/.vite-plus/bin:$PATH"          # Node 24
BAIDU_MAP_AK=<你的 ak> pnpm probe:official -- --out=/tmp/official-probe.json
```

- 起 Vite dev server（**必须绑 `localhost`**：百度 AK 的 Referer 白名单按主机名匹配，`127.0.0.1` 不放行）
  + headless Chromium（`SMOKE_BROWSER` → Playwright 缓存 → 系统 Chrome），经 CDP 读 `window.__PROBE__`；
- AK 只经 URL 查询参数传入，**不落盘**；报告在页面侧与 orchestrator 侧各做一次 `ak=` 脱敏；
- 退出码：`0` 全 pass / `1` 有 fail / `3` 只有 blocked / `2` 脚手架失败。
  **`blocked` 不等于通过**：对照组的 `PlaceSearch.search` 没回包时，其余网络结论一律 blocked；
- 探针源码：`tests/browser/official-packages/main.ts`（页面侧 31 个探针）+ `scripts/probe-official-packages.mts`；
- **探针不在 `test:unit` 范围内**（要真实 AK + 网络），由 `pnpm probe:official` 单独驱动；
  可进 CI 的是不依赖网络的契约锁（上一节）。原始报告是运行产物（含 UA / 时间戳），**不入库**，
  需要留证时用 `--out=<path>` 落在仓库外；
- 报告里的 `packages` 字段是**实际安装到的版本**（直接读 `node_modules/<pkg>/package.json`），
  因此每条结论都能追到具体产物；核对 tarball 用上面的 integrity 哈希。

最近一次运行（2026-09-13，macOS，node 24.21.0，headless Chromium 149 / SwiftShader，真实 AK，对照组回包正常，退出码 `0`，浏览器 UA `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7827.55 Safari/537.36`）：
**31 个探针全部 pass，四个 widget 结论分别为 pass / pass / pass / pass。**

## Loader 契约（`1.0.0`）

| 维度 | 契约 | 依据 |
| --- | --- | --- |
| 导出 | 具名 `load` / `reset` / `getStatus`，外加 default 对象 `{load,reset,getStatus}` | `types/index.d.ts` + 浏览器实测 |
| `load(options)` 参数 | `ak`、`version`（`'3.0'｜'gl'｜'4.0'`，默认 `'4.0'`）、`serviceHost`、`protocol`（默认 `https`）、`timeout`（默认 `0`）、`globalConfig.{apiVersion,uiVersion,coordType}` | 同上；**没有** `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` |
| 入口 URL | `{serviceHost 或 protocol://api.map.baidu.com}/api?v=<…>&ak=<…>&callback=<…>`；`serviceHost` 末尾缺 `/` 会补并 `console.warn`；代理模式 URL **不带** `ak` | 实测 src：`https://api.map.baidu.com/api?v=4.0&ak=<redacted>&callback=__bmapJSApiOnLoad_0` |
| 就绪信号 | **只有 JSONP 回调**（URL 恒带 `callback=`），没有「无回调的 load 模式」 | 实现与实测一致 |
| 缓存 / 单例 | 模块级状态；并发同配置返回**同一 Promise**；已 loaded 后直接返回缓存；script 只注入一次 | 实测 `p1 === p2` 且 `scriptDelta === 0` |
| 冲突判定 | 已加载后请求另一 `version` → 拒绝 `不允许在同一页面混用多个版本 JSAPI（已加载 4.0，本次请求 gl）`；另一 `ak` → 拒绝 `不允许使用多个不一致的 ak`。`protocol` / `timeout` / `globalConfig` **不参与**判定（沿用首次调用） | 实测 |
| 复用既有全局 | 页面已有 `window.BMap` 时直接复用（`console.warn`）且**不注入 script** | 实测 |
| 失败 / 超时 | 超时 `timeout > 0` 才生效；拒绝文案 `JSAPI 加载超时(<n>ms)`；脚本失败 `JSAPI 脚本加载失败: <url>`；两种情况下状态都转 `failed` | 单测 + 探针 |
| 重试 | `failed` 状态下再次 `load()` 会先清状态再重新注入 script；**上一次的 script 节点不会被移除**（重试后 DOM 里会有两个） | 单测（已观察行为） |
| `reset()` | 状态回 `notload`，清缓存，`delete window.BMap` / `BMapGL` / `_BMapSecurityConfig`；**不清理 script**。官方定位是「便于单测与热更新」 | 单测 + 探针 |
| SSR | 模块可 import；`load()` 拒绝 `只能在浏览器环境使用`；`getStatus()` / `reset()` 无副作用 | 无 DOM 的 Node 子进程实测 |
| 副作用 | 注入 `<script>`（结算后仍留在 DOM）、写/删回调全局 `__bmapJSApiOnLoad_<n>`、代理模式写 `window._BMapSecurityConfig`、`globalConfig` 写到 `window.BMapGL \|\| 命名空间` | 探针 |
| 真实加载后的全局 | `window.BMap` 与 `window.BMapGL` **都存在且相等**（4.0）；`BMap.version === "gl"`，**没有** `VERSION` 键 | 探针 |

## UI Kit 契约（`1.1.2`）

| 维度 | 契约 |
| --- | --- |
| 导出 | `PlaceAutocomplete` / `PlaceSearch` / `PlaceDetail` / `RoutePlan`、`applyTheme` / `registerTheme` / `darkThemeVariables` / `warmThemeVariables` / `coolThemeVariables`、`DrivingPolicy` / `TransitPolicy` / `IntercityPolicy` / `TransitTypePolicy` / `LineType` |
| 样式 | **不在 JS 里注入**：JS 入口 eval 后页面里 0 个 UI Kit 样式节点；必须显式引入 `@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css` |
| 依赖的 JSAPI 面 | 只要求全局 `window.BMapGL`（`new BMapGL.Point` 是裸全局引用）+ 地图实例的 `getCenter` / `getZoom` / `getProjection`（或 `getMapType().getProjection()`）。**不使用** `BMapGL.LocalSearch` |
| 检索通道 | 自建 JSONP 到 `api.map.baidu.com`，使用私有请求码（`qt=cen/s/con/bd/nb/bda/sa/nba/inf/cur/placesug/drct` 等）与 `getSeckeyAndSign` 签名（读 `window.___abvk` / `localStorage.BMAP_SECKEY`） |
| AK 解析链 | `window.BMAP_AUTHENTIC_KEY` → 文档里 `script[src*="api.map.baidu.com/api"]` 的 `ak=`（命中即缓存到 `window.BMAP_AUTHENTIC_KEY`）→ 都没有则抛 `BMap AK is not set` |
| SSR | **import 即失败**：CJS/IIFE 入口 → `ReferenceError: document is not defined`；ESM 产物 → 模块求值期崩溃。只能在浏览器挂载后动态 import |
| 释放 | `destroy()` 撤除自身 DOM；四个 widget 生命周期内 UI Kit 自己只挂 **1 个** `document` 级监听（`PlaceAutocomplete` 的外点关闭），`destroy()` 同数归还，净 0 |

**监听归因口径（探针里带正证守卫，别简化）**：探针只把栈帧落在 UI Kit bundle 里的调用点算作 UI Kit 的。
`PlaceAutocomplete` 构造期**确定**会挂 1 个监听，探针据此设了一条正证断言；一旦归因规则与
打包后的模块路径失配（Vite 预打包会把包名压平成 `@baidumap_jsapi-ui-kit.js`），
计数会静默变成 0/0，「是否归还」的门禁就成了空转——正证守卫把这种情况变成显式失败。

## 四个 widget 的独立结论（真实 v4）

评测口径：`pass` = 构造前提、公开动作与释放路径都在真实 JSAPI 4.0 上验证通过；
`fail` = 断言不成立；`blocked` = 前置（AK / 回包对照组）未满足，**不计为通过**。

| widget | 结论 | 构造前提 | 真实使用到的地图面 | 已验证的公开面 | 释放 |
| --- | --- | --- | --- | --- | --- |
| `PlaceAutocomplete` | **pass** | `options.map` 必传（缺则抛 `PlaceAutocomplete: options.map is required.`） | 仅在**未传 `location`** 时用 `map.getCenter()` / `getZoom()` 解析 cityId | `search` / `setInputValue` / `getInputValue` / `setLocation` / `setCitylimit` / `setTypes` / `show` / `hide`；事件 `suggest` / `select` / `highlight`（真实建议回包 10 条） | `destroy()` 撤 DOM + 归还 document 监听 |
| `PlaceSearch` | **pass** | `options.map` 必传；**调用期真的用地图**（`getZoom()` / `getProjection()`） | 检索、周边检索、范围检索 | `search` / `searchNearby` / `searchInBounds` / `prevPage` / `nextPage` / `goToPage`；事件 `load` / `select`（真实回包 10 条 POI） | `destroy()` 撤 DOM；构造期不挂 document 监听 |
| `PlaceDetail` | **pass** | `options.map` 必传 | **构造之后不读地图**（`options.map` 只用于前置校验，按 uid 拉详情不依赖地图） | `setPlace(uid \| poi)` / `clear`；事件 `load`（按对照组 POI 的 uid 真实拉到详情） | 同上 |
| `RoutePlan` | **pass** | `options.map` 必传 | **构造之后不读地图** | `search`（真实驾车回包 3 个方案）/ `switchType` / `clear` / `getCurrentType` / `getLastResult`；事件 `result` / `error` / `typechange` / `planselect` / `clear` / `navclick` | 同上 |

**RoutePlan 的模式口径**：`1.1.2` 里 `enabledTypes` 硬编码 `["driving"]`、`showTabs: false`。
`switchType("walking" | "riding" | "transit")` 实测为 **no-op + `console.warn('路径规划类型 X 未启用')`**，
类型不会被改写。→ Vue 封装只开放驾车；headless 的四类路线（issue #39）不受此限制。

**「`options.map` 必传」不等于「必须有可用地图」**：四个 widget 的前置校验都是 `if (!options.map) throw`，
但 `PlaceDetail` / `RoutePlan` 在后续调用里并不读它。因此 Vue 层仍需满足「构造前 Map ready」这一硬前提，
但不要为详情 / 路线额外承诺视野联动。

## 不支持项与未验证项

| 项 | 状态 | 说明与处置 |
| --- | --- | --- |
| Loader 的 `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` | **不支持** | 上游没有入口。默认路径必须明确报错，或指引走外部预加载 + `existingGlobalV4Provider`；接收后忽略属于假支持 |
| Loader 的上游取消接口 | **没有公开接口** | 「取消等待」由本库自己做；全部消费者取消后保留在飞任务，不得另插重复 script |
| Loader 的 `timeout: 0` | 语义是**不超时** | 不要把它当成「默认超时」 |
| UI Kit 的 SSR | **不可用** | 只能浏览器内动态 import；根入口与 SSR 模块图不得静态引入 |
| UI Kit 的 AK 前置 | **强依赖** | 需要带 `ak=` 的 SDK `<script>` 或 `window.BMAP_AUTHENTIC_KEY`；代理模式务必补后者 |
| UI Kit 的 CSS | **需消费方引入** | 不引入不会报错，只会「无样式」；UI 消费者 fixture 必须覆盖这一点 |
| `RoutePlan` 的公交 / 步行 / 骑行 | **锁定版本未开放** | `switchType` no-op + warn；需要时走 headless 路线能力 |
| UI Kit 在 proxy（`serviceHost`）模式下的端到端可用性 | **未验证** | 本次探针只验证了代理模式 URL 形状与全局声明，未在真实代理后端上跑四个 widget |
| UI Kit 的主题变量与多地图共享 | **未验证** | 主题写入页面级变量，多图场景的影响未测 |
| `RoutePlan` 的 `navclick`（含微信 `wx-open-launch-app` 路径） | **未验证** | 该路径会按需注入 `res.wx.qq.com/open/js/jweixin-1.6.0.js` 并挂 `document` 监听，只在点击时发生；未纳入本轮探针 |

## 与本轮拆分任务的对应

| 任务 | 本页提供的输入 |
| --- | --- |
| #71 / R25-B（默认 Provider 委托官方 Loader） | Loader 契约表全部；单例 / 冲突 / 重试 / reset / script 记账的**实测**行为；`nonce` / SRI / timeout 的处置口径 |
| #72 / R25-C（删私有嗅探、真实可用性门禁） | 「本库不得访问 `_rd` / `qt=` / 私有签名」的边界；release 口径「按来源归因，不数净增」 |
| #73 / R25-D（`./ui-kit` 与两个薄封装） | UI Kit 契约表；四个 widget 的构造前提与真实地图使用面；AK 前置、CSS、SSR、`destroy` 口径 |
| #74 / R25-E（同一候选提交重新验收） | 「已验证 vs 未验证」列表；探针命令与退出码语义；四 widget 结论 |
