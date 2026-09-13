# ADR 2026-09-13：Official-first —— 默认加载委托官方 Loader、标准 UI 委托官方 UI Kit

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`R25-A`（issue #70，追踪 #12，收口目标 #25）
- 取代：ADR [2026-09-10 进程级 SDK 冲突域与迁移期分阶段域划分](./2026-09-10-sdk-conflict-domain.md) 中「**默认在线加载由本库自研 `ScriptLoader`（JSONP transport）承担、官方 Loader 只在显式 CustomScript 场景下可选**」的部分。该 ADR 的其余决策（冲突域、占用登记、`assertReady`、指纹口径）继续有效。
- 相关：`packages/baidu-map-gl-vue/src/core/loader/**`、`scripts/probe-official-packages.mts`、`tests/browser/official-packages/**`、`tests/behavior/official-packages-*.test.ts`、`docs/zh-CN/contributing/official-packages.md`

## 背景

#16 / #17 把加载能力做成了**本库自研**的一套：`ScriptLoader`（显式 `load` / `jsonp` 两种就绪信号）、`SharedLoadTask`、`SdkRegistry`，以及三个 v4 Provider（CDN 自拼 URL + 自管 JSONP 回调名、CustomScript、ExistingGlobal）。当时官方没有可用的加载器，这条路线是必要的基础设施。

现在前提变了：**官方发布了自己的加载器与标准 UI**，而且 #12 的 R25 阶段要求「官方实现优先」的增量纠偏。

- `@baidumap/jsapi-loader@1.0.0`（2026-07-17 发布，MIT，`sideEffects: false`）：统一 `load()`，自己管 script 单例、回调、代理模式、超时。
- `@baidumap/jsapi-ui-kit@1.1.2`（2026-03-23 发布，MIT）：`PlaceAutocomplete` / `PlaceSearch` / `PlaceDetail` / `RoutePlan` 四个 widget，**自己实现**建议下拉、结果列表、键盘导航、详情面板、路线面板与主题。

如果继续默认走自研加载、并在 Vue 侧自研标准 UI，会产生两个不可接受的结果：**同一页面两套 SDK 加载状态机**（谁的 script 算数？谁的回调算数？），以及**同一份检索发两次请求**（UI 一次、headless 一次）。

因此本 ADR 把「官方包是**可选的逃生口**」翻转为「官方包是**默认实现**」，并把默认路径允许做什么、禁止做什么一次性钉死。

## 依据：锁定的官方契约（实测，不是文档转述）

下表全部来自**发布产物本身**（npm tarball 的 `dist/**` + `types/**` + `package.json`）与**真实浏览器运行**。
运行方式：`BAIDU_MAP_AK=<ak> pnpm probe:official`（Vite dev server + headless Chromium + CDP，31 个探针，四 widget 各自独立）。
完整契约表与逐条结论见 [`docs/zh-CN/contributing/official-packages.md`](../zh-CN/contributing/official-packages.md)。

| 维度 | `@baidumap/jsapi-loader@1.0.0` | `@baidumap/jsapi-ui-kit@1.1.2` |
| --- | --- | --- |
| 导出 | 具名 `load` / `reset` / `getStatus` + default 对象 | 四个 widget + `applyTheme` / `registerTheme` + 主题变量 + 策略枚举 |
| 入口 | `exports` 映射到 `dist/index.mjs`（ESM）/ `dist/index.js`（CJS）；`types` 指 `types/index.d.ts` | **无 `exports` 字段**；`main` = IIFE 产物、`module` = ESM 产物、`types` = `dist/index.d.ts`、`style` = `dist/css/jsapi-ui-kit.css` |
| 加载 | 只做 JSONP（URL 恒带 `callback=`），**没有**「无回调的 load 模式」 | 自己起 JSONP（`qt=` 私有请求码 + `getSeckeyAndSign` 签名），经 `api.map.baidu.com` |
| 缓存 | 模块级单例：并发同配置返回**同一 Promise**；已 loaded 后直接返回缓存 | 无跨实例缓存 |
| 失败 / 超时 | `timeout: 0` 表示**不超时**；失败 / 超时**不移除**已注入的 script，重试会再插一个 | 单请求 50s 超时；请求用的 script 在结算时移除 |
| reset | `reset()` 清状态并 `delete window.BMap` / `BMapGL` / `_BMapSecurityConfig`；**不清理 script** | 无 reset |
| CSP | **不支持** `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` | 不适用（不注入 SDK script） |
| SSR | import 安全；`load()` 拒绝（`只能在浏览器环境使用`） | **import 即失败**（IIFE 撞 `document`，ESM 撞 `location`） |
| 副作用 | 注入 `<script>`（留在 DOM）、写回调全局、`window._BMapSecurityConfig`、`globalConfig` 写到 `window.BMapGL \|\| ns` | 挂 1 个 `document` 级 click 监听（Autocomplete，destroy 时归还）、AK 缓存写 `window.BMAP_AUTHENTIC_KEY` |
| v4 前提 | 4.0 下 `window.BMap === window.BMapGL`（**实测成立**），`BMap.version === "gl"` | 需要 `window.BMapGL` 存在（`new BMapGL.Point` 是裸全局引用）；AK 来源为 `window.BMAP_AUTHENTIC_KEY` → 文档里 `script[src*="api.map.baidu.com/api"]` 的 `ak=` → 否则抛 `BMap AK is not set` |

## 决策

1. **默认在线加载委托官方 Loader，版本精确锁定 `1.0.0`（不加 `^` / `~`）。**
   默认路径（`baiduJsapiV4Provider()` → 组件默认 definition / `createBMapPlugin` / `<BMapProvider>` / `<BMap>` 的隐式 Provider / Playground）内部必须真的调用官方 `load()`，而不是「装了依赖但继续自研 JSONP」。
   判断标准是可测的：默认路径下页面里那段带 `ak=` 的 SDK `<script>` 由官方 Loader 注入，本库源码里默认路径不再出现自建 JSONP callback / 自拼入口 URL。

2. **保留两条显式高级路径，但默认不经过它们。**
   `customScriptV4Provider(scriptSrc, { mode: "load" | "jsonp" })`（企业自托管、非标准资源，继续用自研 `ScriptLoader`）与 `existingGlobalV4Provider()`（宿主自己加载、本库只消费）保持现状。
   **自研 `ScriptLoader` 退出默认路径、但不删除**：它是这两条路径的实现，删掉会让「非标准入口」无路可走。
   **官方加载失败禁止静默回退到自研**——回退会把「官方契约没满足」变成运行时不可解释的偶发行为。

3. **标准 UI 一律使用官方 UI Kit，本库不自研标准 UI。**
   建议下拉、结果列表、结果翻页、键盘导航、详情面板、路线面板、主题变量都由 `@baidumap/jsapi-ui-kit` 负责；本库只做 host（容器 / 生命周期 / props → setter / 事件 DTO / 公开动作）。
   UI Kit 的依赖策略是 **optional peer + 开发期精确锁定**：「optional」只意味着**不使用 UI 的消费者可以不安装**，不意味着可以在它缺失时改走自研实现。

4. **UI Kit 的运行时前提是硬前提，缺一个就按「未满足」处理，不做假设。**
   - 四个 widget 构造时**都强制要求** `options.map`（缺则 `X: options.map is required.`）。但「要求」≠「使用」：实测只有 `PlaceSearch` 在调用期读 `map.getZoom()` 与 `map.getProjection()`，`PlaceAutocomplete` 仅在**未传 `location`** 时用地图中心城市解析 cityId；`PlaceDetail` / `RoutePlan` 的 `map` 在构造之后**不被读取**（仅为契约一致与前向扩展保留）。→ Vue 层仍需等 Map ready 再构造（构造前提），但不要为详情/路线额外强加地图视野联动。
   - UI Kit 的检索/详情/建议/路线全部走 `api.map.baidu.com` 的 JSONP 私有通道（`qt=` 请求码 + `getSeckeyAndSign` + `_rd` 风格回调），**不经过 `BMapGL.LocalSearch`**。
   - AK 解析链要求页面里存在带 `ak=` 的 SDK `<script>`，或 `window.BMAP_AUTHENTIC_KEY`。**这直接约束 #71：默认路径不得删除官方 script，代理模式（`serviceHost`，URL 不带 ak）必须额外提供 `window.BMAP_AUTHENTIC_KEY`，否则 UI Kit 会在第一次检索时抛出 `BMap AK is not set`。**
   - 4.0 下 `window.BMapGL` 存在且 `=== window.BMap`（实测）。`requireBMapGL()` 空值即抛，所以「只提供 `BMap`、不提供 `BMapGL`」的环境不能声称支持 UI Kit。
   - CSS 单独发布、JS 不注入样式：样式必须由消费方（或 `./ui-kit` 入口的使用方）显式引入，且不得为了让「根入口也有样式」而把 CSS 塞进根入口。

5. **区分「调用方取消等待」与「终止上游加载」。**
   - **调用方取消等待**：解绑该消费者、让它的 Promise 以取消结算、丢弃后续回包。这是本库唯一承诺的取消语义。
   - **终止上游加载**：官方 Loader **没有**公开取消接口（`cancel` 是内部实现）。因此**全部消费者取消后，底层在飞任务保留**；后续请求不得因此另插一个重复 SDK script——官方单例会返回同一个 Promise，本库只需如实订阅它。
   - **组件卸载 / Map 销毁一律禁止**：调用 `reset()`、删除或修改上游注入的 `<script>`、改写或删除 `window.BMap` / `BMapGL` / `_BMapSecurityConfig` / 回调全局。这些是**进程级共享状态**，不属于任何组件。

6. **`reset()` 只允许出现在测试与热更新场景。** 这是官方对它的定位（"便于单测与热更新"），且它会删掉进程级全局；组件/应用生命周期里调用它会连带毁掉同页其它地图。

7. **上游不支持的配置必须明确处理，不能「接收后忽略」。**
   `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` 在 Loader `1.0.0` 上没有入口，`timeout` 语义也不同（`0` = 不超时）。默认路径遇到这类配置时只有两种合法处置：**明确报错**，或**指引走外部预加载 + `existingGlobalV4Provider`**。静默吞掉属于「假支持」。

8. **RoutePlan 的模式只按锁定版本实际支持开放。**
   `1.1.2` 里 `enabledTypes` 硬编码为 `["driving"]`、`showTabs: false`，`switchType("walking" | "riding" | "transit")` 是 **no-op + `console.warn`**（实测）。Vue 封装只能开放驾车；headless 的四类路线（#39）**不受** UI 模式限制，不得被 UI Kit 的驾车限制绑架。

9. **能力缺失如实标注，不兜底、不假装。**
   本库源码**不得**访问 UI Kit 使用的私有请求码位（`qt=` 诸值）、`_rd` 回调表、`getSeckeyAndSign` 之类的私有签名。缺什么能力就按 Capability Catalog 标 `unsupported` / `unverified`，而不是照抄一份自研实现。

10. **边界分工（供 R25-B / R25-C / R25-D 直接引用）**

    | 事项 | 归属 | 本 ADR 给出的边界 |
    | --- | --- | --- |
    | 默认 Provider 内部委托官方 Loader、取消语义、错误脱敏、`nonce`/SRI 处置 | #71 / R25-B | 决策 1、2、5、7；官方 `load()` 的 exports / 单例 / reset / script 记账以本 ADR 的契约表为准，不重读文档 |
    | 删除 `_rd` 私有嗅探、InfoWindow / Autocomplete 的真实可用性门禁 | #72 / R25-C | 决策 9；本库不得自建私有表，缺口按 unsupported 标注 |
    | `./ui-kit` 子路径、`BPlaceAutocomplete` / `BPlaceSearch` 薄封装、CSS 消费、SSR | #73 / R25-D | 决策 3、4、8；依赖策略、AK 前提、CSS 单独引入、DOM 级监听归还口径都已在决策 4 固定 |
    | 重新验收同一候选提交 | #74 / R25-E | 本 ADR 是「已验证项 vs 未验证项」的唯一口径来源 |

11. **泄漏门禁的口径要按来源归因，不能只数 `document` 级监听总数。**
    实测：四个 widget 生命周期里 `document` 上共新增 11 个监听，其中**只有 1 个属于 UI Kit**（`PlaceAutocomplete.setupOutsideClick`），且 `destroy()` 同数归还（净 0）；另外 7 个来自**真实 SDK**（`api.map.baidu.com/getscript` 内的 `gz.on` / `Object.init`）与**百度统计脚本**（`dlswbr.baidu.com/heicha/abclite-*`），它们不会被释放，也不该被本库负责。
    → 任何「`removeEventListener` 计数必须归零」的门禁都必须先按来源分类，否则要么假红（把 SDK 的算成自己的），要么被写宽成「不为零也说得过去」。

## 后果

- 正面：默认路径只剩一个加载状态机与一段 SDK script；标准 UI 不再有两套实现；契约来自发布产物而非文档与示例转述；#71 / #72 / #73 的边界一次性固定，避免互相越界；官方包升级时 `tests/behavior/official-packages-*.test.ts` 会先红。
- 负面 / 成本：默认路径失去本库自己的 `mode: "load"`、`nonce` / `integrity` / `crossOrigin`、可取消的上游任务——这些能力要么报错要么走高级路径；UI Kit 的 SSR 不可用把「按需 + 浏览器内动态 import」变成硬要求；官方包锁死精确版本意味着每次升级都要重跑探针。
- 回滚：把默认 Provider 的加载实现换回自研 `ScriptLoader`（`jsonp` 模式）、并恢复「UI 由本库自研」的路线即可回滚；本决策不删除任何现有代码路径，回滚不触及 Driver / Facet / Client 契约。

## 非目标

- 不在本决策中实现默认切换、删除 `_rd` 嗅探或写任何 Vue UI 封装（分别属于 #71 / #72 / #73）。
- 不实现完整 headless Service 框架，也不自研高级图层。
- 不复制官方 UI 的内部 DOM、搜索结果列表、键盘导航与路由算法。
- 不把「安装依赖」当成「集成成功」，不把真实网络失败标成通过。
- 不改 npm 包名或仓库 owner（迁仓不影响包名）。

## 已知限制（显式接受）

- **UI Kit 在无 DOM 环境下 import 即失败**：`./ui-kit` 与其 Vue 封装只能动态 import，且根入口的 SSR 路径不能碰到它。这是上游包形状决定的，本库不通过 fork / patch 规避。
- **`reset()` 与 script 记账都不由本库控制**：失败 / 超时后官方不移除旧 script，重试会叠加 script 节点。本库只在自身加载尝试层记账，不代官方清理。
- **UI Kit 的检索走私有通道**：其可用性受服务端配额与 AK 权限影响；探针因此把「对照组必须回包」写成硬前提，对照组失败时其余网络结论一律记 `blocked` 而不是通过。
- **`RoutePlan` 的公交 / 步行 / 骑行在 `1.1.2` 不可用**：Vue 封装只开放驾车；四类路线的 headless 能力由 #39 另行提供。
- **探针依赖真实 AK 与网络**，不进 CI 门禁；CI 里跑的是不依赖网络的 `tests/behavior/official-packages-*.test.ts`（契约锁）与 `pnpm probe:official`（人工/发布前，`blocked` 不等于通过）。

## 参考

- issue #70 `[R25-A][P0] 冻结 Official-first 决策并验证官方 Loader / UI Kit 发布契约`
- issue #25 `[M3A.3][Official-first] 通过官方 Loader 完成 v4 默认切换、UI Kit 最小集成与真实验收`（含 #71 / #72 / #73 / #74 拆分）
- issue #12 `[Roadmap] bmap-vue v3：Official-first 纠偏、JSAPI 4.0 与 Stable 实施总览`
- [`@baidumap/jsapi-loader`](https://www.npmjs.com/package/@baidumap/jsapi-loader) `1.0.0`（2026-07-17）
- [`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit) `1.1.2`（2026-03-23）
- 契约表与复现方式：[`docs/zh-CN/contributing/official-packages.md`](../zh-CN/contributing/official-packages.md)
- ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- ADR [2026-09-10 进程级 SDK 冲突域与迁移期分阶段域划分](./2026-09-10-sdk-conflict-domain.md)（本 ADR 取代其中「自研 transport 为默认」的部分）
- ADR [2026-09-12 v4 Service / Panorama / Native Layer Facet](./2026-09-12-jsapi-v4-service-panorama-native-layers.md)（`_rd` 嗅探的现状，将在 #72 移除）
