# ADR 2026-09-13：默认在线路径委托官方 Loader（v4 默认切换）

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`R25-B`（issue #71，追踪 #12，收口目标 #25）
- 落地：[ADR 2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md) 的决策 1 / 2 / 5 / 7。
  **本 ADR 不取代它**，只把「默认入口具体解析到哪个 Provider」「默认路径的配置面」这些落地细节
  与随之产生的**已知限制**钉下来。
- 相关：`packages/baidu-map-gl-vue/src/core/loader/providers/{BaiduJsapiV4Provider,official}.ts`、
  `packages/baidu-map-gl-vue/src/plugins/createBMapPlugin.ts`、
  `packages/baidu-map-gl-vue/src/components/map/BMap.vue`、
  `tests/behavior/v3-official-loader-default.test.ts`、
  `tests/behavior/v3-default-loader-boundary.test.ts`

## 背景

Official-first ADR 已经把「默认加载委托官方 Loader」定成决策，但当时默认入口仍然解析到
**迁移期 legacy `baiduCdnProvider()`**：它使用独立的 `BMapGL` 冲突域、自拼入口 URL、自管 JSONP
回调名，属于 ADR 明确要消除的「第二套加载状态机」。R25-B 就是把这条默认路径真正换掉的那一步。

## 决策

1. **默认入口解析到 `baiduJsapiV4Provider()`。**
   `createBMapPlugin()` 未显式传 `provider` 时、`<BMap>` 的隐式 Provider 兜底（`ak` / `apiUrl`
   props 与 `app.use` 默认定义两条入口）都解析到它；它内部真的调用官方
   `@baidumap/jsapi-loader` 的具名 `load()`。legacy `baiduCdnProvider()` 仍可从根入口显式传入
   （删除属 #26），但不再是任何默认值。

2. **加载状态机只有一份。**
   官方 Loader 负责：入口 URL、script 单例、JSONP 回调、超时、同页版本 / AK 冲突、复用页面已有全局。
   本库负责：配置口径校验、域内指纹记账与冲突、按消费者取消等待、`LoadedSdk` 归一化、错误码与脱敏。
   因此本库**不再**对默认路径做「探测已有全局后短路」（那会重新引入第二套判定），也**不**
   自建 JSONP、不自管回调、不在失败时移除 script。
   *（唯一的「入口 URL 形状」出现在 metadata 里：`officialEntryUrl()` 按已锁定的两种形状标注
   本次请求的入口，见决策 3；它不参与加载，加载侧从不触碰 URL。）*

3. **默认路径的配置面是显式的、可测的。**
   - 支持并正确映射：`ak`、`version`（**只接受官方版本表里的 `'4.0'`**）、`timeout`
     （`0` = 不超时，原样传递，不当作「用默认值」）、`serviceHost`（代理模式；与 `ak` 二选一）；
   - `serviceHost` 的三条口径：
     ① **参与指纹**（`host:` 段），换代理就是另一份 SDK 配置，否则冲突会漏判；
     ② 指纹里**只出现哈希**（`host:${hash(...)}`）——指纹会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息，
     代理地址可能含内部域名 / 路径 / userinfo / token query（官方封装的
     `stableHash` 是同一口径）；
     ③ 末尾斜杠按官方行为**规范化**（官方会 warn 后补 `/`），因此 `/svc` 与 `/svc/` 是同一份配置；
   - **入口 metadata 按官方实际入口构造**：代理模式是 `<serviceHost>/api?v=4.0` 且**不带 `ak`**，
     非代理模式才带 `ak`；代理模式下 `akRef` 记 `none`（否则 `ak + serviceHost` 会让人以为
     AK 参与了实际入口）。metadata 里的 userinfo 与 `ak` 一样会被脱敏；
   - 上游没有入口的一律 **显式报 `BMAP_INVALID_ARGUMENT`**（接收后忽略属于假支持）：
     `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` → 指引「外部预加载 + `existingGlobalV4Provider()`」；
     `apiUrl` / `callbackParam` / `language` → 指引 `customScriptV4Provider()`（非标准入口的唯一合法路径）。
   清单以 `OFFICIAL_LOADER_UNSUPPORTED_KEYS` 为单一事实源，测试与文档共用。

4. **官方 `load` 的注入点是独立字段。**
   `BaiduJsapiV4ProviderOptions.loader` 的类型是官方 `load` 的最小接口，**不是**自研 `ScriptLoader`
   （后者仍是 CustomScript 的实现）。两者混成一个字段会得到一个「类型不匹配但看起来能传」的入口。
   注入点里**没有** `reset()`：它是进程级破坏性操作，组件生命周期任何一处都不得调用。

5. **「最后一个消费者离开」按任务能否取消分流（`SdkRegistryLoadRequest.cancellable`）。**
   取消一个消费者只结算它自己；**最后一个**消费者离开时才按该位决定怎么处理条目与占用：
   - `cancellable: true`（缺省，自研 `ScriptLoader`）：同步释放 entry + occupancy 并 abort 聚合
     signal，让「abort 之后同一同步回合内重试」既不会命中已取消的任务，也不被过期占用挡住；
   - `cancellable: false`（官方 Loader——没有公开取消接口）：**只结算消费者，保留 entry +
     occupancy + task**。同指纹后来者复用原任务，另一份指纹在启动前就被冲突拒绝，直到任务真正
     成功 / 失败。官方 React 封装 `react-bmap` 的 registry 是同一语义（promise 注册后一直保留，
     只有失败才删除条目）。

   为什么必须这样分流：若「消费者全走了」就释放一个**仍然在飞**的任务，它随后成功时域里可能
   已被另一份配置占用，于是要么抢记（域声称 A 而真实在飞的是 B），要么放弃登记（真实成功的
   配置被永久遗忘，后续请求被误判成无冲突）。两种都是错的，**把「不可取消」显式建模**才能从
   源头消除这个窗口。因此 `settle()` 的成功分支保持最朴素的规则：**任务真的成功就登记**
   （`??=`，第一个真实成功者留下记录），不再需要任何 stale-settle 所有权条件。
   与之配套的取舍：不可取消任务在结算前会一直占住冲突域——这与官方 Loader 自身的行为一致
   （它的单例在 `loading` 期间同样会拒绝另一份 ak / 版本），想加截止时间就用 `timeout`。

   **`cancellable: true` 这一侧也要真的成立**，不能只在官方路径上声明 `false` 就算完：
   `SdkRegistry.start()` 是在 microtask 里调用 loader 的，而 `CustomScriptV4Provider` /
   `ExistingGlobalV4Provider` 的第一步「复用页面已有全局」（`reuseExistingJsapiV4()`）是**同步
   成功**的——不看聚合 signal，就会出现「调用方 load 后立刻 abort ⇒ registry 已释放条目 ⇒
   被取消的任务在 microtask 里成功结算并抢走记账」的窗口。因此 `reuseExistingJsapiV4()` 接收
   聚合 signal 并在开头检查它（aborted ⇒ `BMAP_PROVIDER_ABORTED`），两个 Provider 都传。

6. **`ak` 与 userinfo 两类 URL 凭据不得经错误文本外泄，且身份用途与展示用途分开处理。**
   入口 URL 可能带这两类凭据：`ak=` 与 userinfo（`https://user:pass@host/...` 的 HTTP 认证）。
   两类都要覆盖到**所有出口**：`message`、`cause.message` / `cause.stack`、`toJSON()`、
   自研 transport 的失败文案，以及**指纹**（指纹会进 `BMAP_SDK_CONFIG_CONFLICT` 的消息）。统一口径：

   - **展示 / 错误用途** → 抹成 `***`（`maskUserinfo()`，形状匹配 + 已知值兜底；AK 同理）；
   - **身份 / 指纹用途** → 换成**哈希**（AK 一直是哈希；userinfo 也改为哈希）——不能统一抹成
     同一个值，否则不同凭据会被合并成同一份配置，冲突漏判。URL 解析不了时**整串哈希**
     （`invalid-url:<hash>`）：这时无法逐项脱敏，宁可丢掉诊断形状也不能留原文。

   实现落在共享的 `url.ts`（`readUrlUserinfo` / `maskUserinfo` / `fingerprintApiUrl`），
   三个 Provider 与 `SharedLoadTask` 共用，不再各写一份。

   **本决策不承诺识别任意「敏感 query 参数」**：signed URL 的 `token` / `signature` 等与 `ak`
   一样会进入入口 metadata、失败文案与（可解析 URL 的）指纹。本库不做通用的敏感参数嗅探
   （不可靠，且会误伤业务参数）；需要这类入口时，请勿把 metadata / 错误送进可公开的日志或遥测。
   通用方案（整条 query 哈希、或参数 allowlist）不在本 ADR 范围内，需要时另立决策。

7. **版本探测只认「形如版本号」的取值。**
   真实 4.0 的 `BMap.version` 是构建标记 `"gl"`（#70 实测），`window.BMap` 也没有 `VERSION` 键。
   探测值不是 `4.0` / `4.0.4` 这种形状时一律按「探测不到」处理并标 `versionSource: "declared"`，
   **不能**拿它去跑「是不是 4.x」的断言——否则「宿主预加载 / 同页复用既有全局」这整条路径会被判成
   「不是 JSAPI 4.0」。*（该修正属 `core/loader/providers/namespace.ts`，对三个 Provider 同时生效。）*

8. **打包策略：ESM 产物 external，CDN/IIFE 产物内联。**
   官方包是模块级单例，内联会让同一页面出现两份加载状态机；但官方包没有 IIFE/global 产物，
   CDN 构建无法 external。因此 ESM 保持 external（消费方按 `dependencies` 精确安装），
   IIFE 内联（CDN 场景页面里只有本库一份副本）。

9. **配置校验发生在进入冲突域之前。**
   `load()` 先做「版本 + 可表达性」校验再交给 `SdkRegistry`：否则一份**表达不了**的配置会先被
   当成正常配置参与指纹与冲突判定，调用方拿到的可能是 `BMAP_SDK_CONFIG_CONFLICT`，而不是
   「这个配置不支持」的准确原因。

10. **legacy 的显式回退分支不动。** ~~`<BMap allowExistingGlobal>` 与「页面已有全局」的兼容回退
    仍走 `existingGlobalProvider()`（webgl-v1 语义）。它们服务迁移期宿主自定义加载的场景，
    随 #26 一并删除；本次切默认不触碰。~~
    **（2026-09-14 更新：#26 已完成——`allowExistingGlobal` prop、`createBMapPlugin` 的同名选项
    与「页面已有全局就自动回退」全部删除，`existingGlobalProvider()` 也不存在了。宿主自己加载
    SDK 的场景改走 v4 语义的 `existingGlobalV4Provider()`，见
    [ADR 2026-09-14 删除旧引擎](./2026-09-14-remove-legacy-engine.md) 决策 4。）**

11. **Playground 用「应用级装配决定加载方式」的形态覆盖默认路径。**
    `apps/playground` 不在 `<BMap>` 上收 `ak`，而是由应用级装配选择：配了 `VITE_BMAP_AK` 走
    `createBMapPlugin({ ak })`（默认 Provider = `baiduJsapiV4Provider()`，即真实默认路径）；
    没配则显式注入 fake provider 让 CI / 无外网环境可用。两种模式都不给 `<BMap>` 传 `provider`，
    因此解析始终落在 `app.use` 的默认 definition 上。官方 React 封装就是这个分工：
    `react-bmap@2.0.1` 把密钥放在应用级 `<BMapProvider ak="…" version="4.0">` 上，
    `<Map>` 不带密钥，README 明确「**不用**在 `index.html` 里手动加 `<script>`，组件库会自动加载」。
    Fake v4 场景（让无 AK 模式也跑 v4 引擎）仍属 #25 的 `M3A3-04`。

## 对照：官方 React 封装 `react-bmap@2.0.1`

官方同名封装（`huiyan-fe/react-bmap`，描述即「基于百度地图 JavaScript API 封装的官方 React 组件库」，
文档站 `lbs.baidu.com/jsapi/react/docs`）与本库是**同一族设计**，实现前逐点对照过：

| 维度 | `react-bmap@2.0.1` | 本库（本 ADR 之后） |
| --- | --- | --- |
| 加载实现 | `dependencies: { "@baidumap/jsapi-loader": "^1.0.0" }`，`loadJSAPI()` 内部 `import('@baidumap/jsapi-loader')` | 同源：`dependencies` 精确锁定 `1.0.0`，`official.ts` 内委托官方 `load()` |
| 「已有全局」怎么办 | 不自己探测 `window.BMap`，完全交给官方 Loader（注释：**不修改 `window.BMap` / `BMapGL` 原型、不做命名空间别名**） | 同上：本库只在官方结算后校验命名空间，不另建状态机 |
| 去重 / 冲突 | 自建 `loader/registry.ts`：`loadKey`（version/ak/serviceHost/language/plugins）+ `globalRegistry` `Map` + `detectConflict` | 自建 `SdkRegistry` + `fingerprintConfig`，**共享在 `globalThis[Symbol.for(...)]`** 上（同页两份独立打包的副本也一致） |
| 冲突默认行为 | `onLoadConflict` 回调 + **返回已加载的那份**（不覆盖） | 恒 `throw`（`BMAP_SDK_CONFIG_CONFLICT`）——唯一的冲突处置，没有降级开关（ADR 2026-09-10 决策 6，其后半句已由 `#104` 第三批取代） |
| 取消语义 | 消费者共用一个 Promise，没有「按消费者取消」的概念 | 每个消费者独立 `AbortSignal`；全部取消后保留在飞任务（ADR 决策 5） |
| AK 脱敏 | src 内**没有**脱敏（`redact` / `脱敏` / `sanitiz` 零命中），错误原样经 `onError` / `console.error` 暴露（官方消息含入口 URL + `ak=`） | `message` / `cause` / `toJSON()` 三处统一脱敏（ADR 决策 6） |
| 代理模式 | `<BMapProvider serviceHost="…">` 是公开 Prop（「隐藏 ak / 走代理」） | `BMapLoadOptions.serviceHost` → 官方 `load()`，并参与指纹（ADR 决策 3） |
| 其他选项 | `language` 进 loadKey 但**不传**给 Loader（接收后忽略）；`version` 原样透传（注释称 Loader「实际接受任意字符串」，与 1.0.0 的版本表校验**不符**） | `language` 显式报错；`version` 只接受官方版本表里的 `'4.0'`（ADR 决策 3、7） |

最后一行的判断依据是本库 #70 的契约锁：`@baidumap/jsapi-loader@1.0.0` 的 `E()` 先查
`{"3.0","gl","4.0"}` 版本表（不命中即 `不支持的 version`），随后才 `d[e.version].query` ——
因此 `'4.1'` / `'5.0'` 不可能加载成功，提前拒绝比透传后再报错更清楚。

这次对照的净结果：补上 `serviceHost`（官方封装把它当公开 Prop，本库此前无法表达）；
其余是「同源」或「本库更严」（冲突默认 throw、按消费者取消、跨副本共享记账、AK 脱敏），
均属既有 ADR 已冻结的取舍，不在本次改动。

## 后果

- 正面：默认路径只剩一份加载状态机与一段 SDK script；「装了依赖但默认仍走自研」不可能再发生
  （静态门禁 `tests/behavior/v3-default-loader-boundary.test.ts` 锁住）；配置面与错误码可测；
  `timeout` / 冲突 / 取消的语义都有真实官方模块驱动的用例。
- 负面 / 成本（**破坏性变更**）：`createBMapPlugin({ apiUrl })`、`<BMap api-url>`、以及
  `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` / `language` / `callbackParam`
  从「静默生效或静默忽略」变成**加载前显式报错**。报错信息给出替代路径：
  自托管 / 非标准资源用 `customScriptV4Provider(scriptSrc)`，宿主已加载用 `existingGlobalV4Provider()`。
- 回滚：把默认 Provider 换回 `baiduCdnProvider()`，并删除 `./official` 适配层即可；本决策不删除
  任何既有加载实现，Driver / Facet / Client 契约不受影响。

## 已知限制（显式接受）

- **全部消费者取消后请求另一份配置**：官方任务不可取消 ⇒ 本库保留条目与占用，另一份配置会在
  **启动前**被本库拒绝为 `BMAP_SDK_CONFIG_CONFLICT`（不再出现「官方在更晚一层报 `BMAP_SDK_LOAD_FAILED`」
  那种错误码退化）。代价是这份占用要等任务结算才释放；需要截止时间就配 `timeout`
  （官方 Loader 在 `loading` 期间本身也会拒绝另一份 ak / 版本，所以这不是本库新增的限制）。
- **失败 / 超时不移除官方注入的 script**：重试会再插一个 script 节点（官方 1.0.0 的已观察行为）。
  本库不代官方清理，也不修改它的 script。
- **「官方 resolve 成功但命名空间不可用」不可重试**：官方此时状态已是 `loaded`，其公开契约只在
  `failed` 时重置状态，而 `reset()` 属禁用项。本库如实报 `BMAP_SDK_LOAD_FAILED` 并登记残留标记，
  不做 `reset()`。
- ~~**代理模式（`serviceHost`）没有公共配置入口**~~：**本条已被后续实现推翻**（`serviceHost` 已作为
  `BMapLoadOptions` 字段公开、经 `createBMapPlugin({ defaults })` 可达，并以哈希参与指纹，
  见本文决策 3 与对照表）。**仍然成立的是后半句**：UI Kit 在代理模式下的端到端可用性未验证。
- **Playground 的「无 AK 也跑 v4」场景**仍属 `M3A3-04`：无 AK 模式目前注入 Fake BMapGL（`webgl-v1`），
  真实 v4 模式需配 `VITE_BMAP_AK`（该模式同时受 #72 的 InfoWindow / Autocomplete 修复影响）。
- ~~**真实 AK 的浏览器默认路径 smoke** 未在本 PR 执行~~：**已由 #74 完成**（真实档结论见
  `docs/zh-CN/contributing/v4-browser-smoke.md` 与 ADR `2026-09-13-v4-required-smoke`）；
  nightly 会持续重跑，PR 门禁跑同 harness 的 fixture 档。

## 非目标

- 不删除 legacy Provider / `ScriptLoader` / `BMapGL` 冲突域（属 #26）。
- 不新增 `protocol` / `globalConfig` 等公共配置（`serviceHost` 按 ADR 决策 3 支持，它对应官方封装
  已公开的「隐藏 ak / 走代理」入口）。
- 不实现 UI Kit 接入（属 #73），不修 InfoWindow / Autocomplete（属 #72）。
- 不发布 Stable，不改 npm 包名。

## 参考

- issue #71 `[R25-B][P0] 默认 Provider 委托官方 jsapi-loader，隔离取消等待与高级自定义加载`
- issue #25 `[M3A.3][Official-first] 通过官方 Loader 完成 v4 默认切换、UI Kit 最小集成与真实验收`
- [ADR 2026-09-13 Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)
- [官方包发布契约（Loader / UI Kit）](../zh-CN/contributing/official-packages.md)
- [`react-bmap`](https://github.com/huiyan-fe/react-bmap)（官方 React 同名封装，`2.0.1`）——
  同源对照见上文「对照」一节
- [ADR 2026-09-10 进程级 SDK 冲突域与迁移期分阶段域划分](./2026-09-10-sdk-conflict-domain.md)
