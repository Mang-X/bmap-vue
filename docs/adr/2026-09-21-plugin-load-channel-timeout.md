# ADR 2026-09-21：插件脚本加载通道的超时与取消语义

- 状态：已接受（Accepted）
- 日期：2026-09-21
- 计划键：无（承接 #43 的欠账；#43 的 `M8-06`~`M8-11` 在仓库与追踪票里都没有定义，本条按内容切分）
- 相关：`packages/baidu-map-gl-vue/src/plugins/builtins.ts`、`scripts/probe-plugin-load-channel.mts`、`scripts/plugin-load-channel-report.mts`、`tests/browser/plugin-load-channel/`、`tests/behavior/v3-plugin-load-channel-decision.test.ts`、`.github/workflows/nightly-v4-smoke.yml`
- 与既有决策的关系：**取代** [插件兼容 inventory](./2026-09-13-plugin-compat-inventory.md) 已知限制里「插件加载没有超时」那一条，以及 [插件迁移结论定型与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md) 已知限制 **8** 的**后半句**（「因此没有超时」）。两处 ADR 的其余内容**仍然成立**：插件通道**依然不复用** `ScriptLoader`（决策 1 给出判据），也**依然不接收** `nonce` / `integrity` / `crossOrigin` / `referrerPolicy`（接收后忽略属于假支持）。

## 背景

`#43` 按「先判定、再适配」只交付结论与边界，**没有动插件脚本的加载通道**，于是留下一条被记录、但当时没有归属的欠账：`plugins/builtins.ts` 的 `urlPluginDefinition` / `loadScriptWithExport` 是**第三份**脚本加载实现（另两份是默认路径的官方 `@baidumap/jsapi-loader` 与显式高级路径的 `core/loader/ScriptLoader`），而它**只有** `<script>` + 全局导出短路 + `AbortSignal` —— **没有超时**。

后果在 #25 的 ADR 里已经写下来了：「脚本服务器不响应也不报错时 `whenPlugin` 会一直挂着」。`#121` 要求**先取证再决定**，因此本票的顺序是：真实浏览器 + 真实 AK 的 live 探针 → 判据 → 最小实现。

## 决策

### 1. 两条通道**保持分离**，本票只补缺口（issue 实施步骤 3 的判据）

| 维度 | `ScriptLoader`（`core/loader`） | 插件通道（`plugins/builtins.ts`） |
| --- | --- | --- |
| 就绪信号 | `mode: "load"` 的 script `load` 事件；`mode: "jsonp"` 的全局回调（`callbackName` 必须与 URL 参数一致） | 注入 `<script>` 后**读一个文档级全局**（`exportGetter`） |
| 去重键 | `src` + `mode` + `integrity` + `crossOrigin`（实例级 `completed` / `inFlight` 两张表） | **插件名**（`PluginHost` 那一层），跨地图共享 |
| 已存在即短路 | 无（已成功的配置直接复用上次结果） | **有**：全局已存在 ⇒ 连脚本都不插（`PluginHost.dispose()` 之后的复用依赖它） |
| 内联注入 | 不支持（只有 `src`） | **支持**：`Mapvgl` 分支 `fetch` 后剥掉统计脚本再内联 |
| 属性面 | `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` / `retention` | 刻意不接收（见「已知限制」） |
| 失败语义 | `BMapError`（`BMAP_SDK_LOAD_TIMEOUT` / `BMAP_SDK_LOAD_FAILED` / `BMAP_PROVIDER_ABORTED`） | 纯 `Error`；最终由 `BMap.vue` 包成 `BMAP_RESOURCE_CREATE_FAILED` 并回执 `plugin-error` |

判据是「**mode 语义与『读一个文档级全局导出』是不是同一件事**」——不是：`ScriptLoader` 的 `load` / `jsonp` 两种模式都以「就绪信号」为中心，而插件通道的契约是「**注入脚本 + 校验那个全局在不在**」，并且**还要**支持内联注入与「全局已存在」的短路。为了统一而统一，就得给 `ScriptLoader` 加一条与 SDK 入口无关的 `inlineSource` 模式，或者把插件通道两条既有语义搬走。

> ⚠️ 票面把 `ScriptLoader` 的 mode 写成 `script` / `jsonp` / `runtime`，与代码不符：实际取值是
> `"load" | "jsonp"`（`ScriptLoaderMode`，`core/loader/SharedLoadTask.ts`），**没有** `runtime`。
> 本票按实际代码判定，不动 mode 面。

### 2. **内置工厂**内补默认超时 `BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS = 60_000`（公共工厂的**超时语义**不变）

> ⚠️ **评审修正（2026-09-22，PR #125 评审 P1/P2）**：本决策第一版把超时加在**共用的**
> `loadScriptWithExport` 上，并把 `urlPluginDefinition` 误当成内部函数（本文初稿写着「也不是公开导出」——
> 这是一处**事实错误**：它从根入口 `src/index.ts` 与 `./plugins` 双导出，消费方用例见
> `fixtures/v3-consumer/src/advanced-adapter.ts` 与 `scripts/verify-package.mts`）。
> 后果是：任意第三方 / 自托管脚本插件也被强制截断，而调用方可以传 `{ required: true }`，
> 于是「过去只是慢」的脚本会直接失败，公开面又没有任何选项能保留旧语义 —— 那是**兼容性回退**。
> 现在把超时**收回到四个内置工厂**（`createUrlPluginDefinition` 这个内部入口），
> 公共 `urlPluginDefinition` 保持不设超时；取值同时从 30s 提到 **60s**（见下面取值依据的算术）。

- **范围**：只作用于四个内置工厂（`trackAnimationPlugin` / `mapvglPlugin` / `drawingManagerPlugin` /
  `geoUtilsPlugin`）。公共扩展契约 `urlPluginDefinition(name, url, readExport, options)` 的语义
  **与本票之前一字不差**：不设超时（`timeoutMs = 0`）。第三方要超时，它本来就持有
  `load(context, signal)` 的完全控制权，可以自己包一层 —— 本库不替它决定。
- **语义**：超时 = **作废**（与取消同一类），错误文本形如
  `plugin load timed out after 60000ms: <url>`，**可被调用方与日志归类为超时**；
- **收尾**：与既有的取消分支一致 —— **摘掉 `<script>`**、清掉计时器与 abort 监听；
- `error` 事件 / 「脚本加载成功但没导出」/ `fetch` 失败这三条**既有路径的行为不变**（错误如实上报，元素处理沿用原语义）；
- 计时器在**任何异步动作之前**起：`Mapvgl` 分支先 `fetch` 再内联，超时同样覆盖那一段；
- **不复用 SDK 入口的 `timeout`**：那个参数是**官方 Loader 的参数**（`0` = 不超时，见
  `2026-09-13-official-first-loader-and-ui-kit`），把它挂到插件通道上会让一条已冻结的语义凭空多管一件事。

**为什么不走评审给的另一条路（给公开 options 加 `timeout`，建议 `0 = 不超时`）**：那会新增一个
**没有当前消费者**的公开配置面（本仓库明文：没有消费者不加），而默认值仍会改变第三方行为 ——
兼容性照样要写迁移说明，却多了一个要长期维护的契约面。等真有消费者要它时再单独决策。

取值依据（本轮实测的脚本体积，`curl -o /dev/null -w '%{size_download}'`）：

| 插件 | 体积 | 来源 |
| --- | --- | --- |
| `TrackAnimation` | 4.9 KB | `mapopen.bj.bcebos.com` |
| `DrawingManager` | 41.7 KB | 同上（还会自行注入两个脚本） |
| `GeoUtils` | 5.8 KB | 同上 |
| `Mapvgl` | 621 KB | `unpkg`（走 `fetch` + 内联分支） |

约束来自 `Mapvgl`：621 KB 在 20 KB/s 的链路上**仅传输**就要约 **31s**；而计时器在 `fetch` **之前**起，
还要吃掉响应头、`response.text()`、解析执行与调度 —— 取 30s 会在我们自己假设的链路条件下稳定误杀
（本决策第一版就是 30s，被评审按同一张表算出来了）。**60s 给出约 2× 余量**（对应约 10 KB/s 仍能过）。
代价只是「更晚才回执失败」；四个内置插件**都是 optional**（`required: false`），失败后果是
「这个插件没有就绪 + 回执 `plugin-error`」（可重试），不是「地图失败」。

### 3. 取消语义**不变**，并顺手修掉一处同族的洞

三条既有语义由探针 + 用例双双钉住：

| 入口 | 语义 |
| --- | --- |
| `map` 作用域插件的 signal abort | 消费者 reject，**真的** `script.remove()` |
| `global` 插件的一个消费者 abort（共享宿主） | 只解绑自己：共享任务保留、`<script>` 仍在、其它消费者不受影响（AGENTS.md：「组件取消等待 = 解绑消费者 + 丢弃回包；不等于终止上游加载」） |
| 宿主 `dispose()`（纪元重置） | 在飞加载 abort ⇒ `<script>` 移除、等待者结算 |

**顺带修掉**：`Mapvgl` 分支的脚本是**异步**插入的（先 `fetch` 再 `appendChild`），旧实现在这段时间里
取消只对「还没插进文档的元素」调 `remove()`，于是**迟到的 `fetch` 回来时照样把内联脚本插进文档**。
现在用一个 `settled` 标记统一挡掉所有「已作废之后」的写入。

⚠️ **它的生效范围与超时不同**（评审第二轮 P2-2）：这处修复在**共用的** `loadScriptWithExport` 里，
所以**用公共 `urlPluginDefinition` 构造的第三方 URL 插件同样受益** —— 尤其 URL 命中 `mapvgl` 分支时，
取消竞态从「已经 reject 但迟到 `fetch` 仍然 `appendChild`」变成「reject 后不再写入」。
因此准确的说法是：**公共 API 与超时语义不变；共用加载器里那处取消竞态修复覆盖所有调用者**
（`builtins.test.ts` 里那条 `Mapvgl` 用例就是用公共工厂构造的，正是这条覆盖关系的证据）。

### 4. 隔离口径的边界写清楚（不扩大到「后续插件并发加载」）

实测：插件挂起期间**地图照常 ready**（探针读数 `mapReadyAtMs`：修复前 30ms / 修复后 25ms）—— `BMap.vue` 的
`loadPluginsInBackground` 本来就「不等插件」。但它是**顺序 `await`**，所以挂起会阻塞**同一个
`plugins` 列表里后面的插件**：修复前 25s 窗口内后一个插件的 `attempts` 是 **0**（从未被请求）。
本票**不**把顺序 await 改成并发加载（那会改变事件顺序与既有语义），而是让「一次挂起最多占用一个
超时窗口」——超时之后后续插件照常被请求（修复后 `attempts = 1`）。

## 证据（live 探针，真实 AK + headless Chrome）

`pnpm probe:plugin-load-channel`（`scripts/probe-plugin-load-channel.mts`）。三个场景各用一个全新文档；
「永不响应」的地址是同源 dev server 的一个中间件（接受连接后不写响应也不关闭），
唯一被替换的输入是 `BUILTIN_PLUGIN_URLS.trackAnimation`（`env.urlPatched` 如实记录）。

| 场景 | 读数 | 修复前（`main` = `2290f8a`） | 本票（内置工厂 60s 超时） |
| --- | --- | --- | --- |
| `control`（真实内置 URL，正证） | map ready / plugin-ready / 脚本数 | 262ms / 465ms / 1 | 285ms / 488ms / 1 |
| `hang` | 地图 ready | ✅ 30ms | ✅ 25ms |
| `hang` | 挂起是否在窗口内结算 | ❌ **否**（25s 窗口内无任何事件） | ✅ **60028ms** 收到 `plugin-error` |
| `hang` | 注册表状态（挂起期间 → 结算之后） | `loading` / `consumers=1` —— 窗口内**一直**如此（永不结算） | 结算前 `loading` / `1` → 结算后 `error` / `0` |
| `hang` | 失败原因 | （无） | `plugin load timed out after 60000ms: /__hang/plugin-load-channel` |
| `hang` | 结算后残留的脚本元素 | ❌ 1（永不响应的请求留在文档里） | ✅ 0 |
| `hang` | 列表里后一个插件 `attempts` | ❌ 0（从未被请求） | ✅ 1 |
| `cancel` | `map` 作用域 abort：脚本数 1 → 0 | ✅ | ✅ |
| `cancel` | 共享宿主：`consumers` 2 → 1、脚本仍为 1、另一消费者未被结算 | ✅ | ✅ |
| `cancel` | 宿主 `dispose()`：等待者结算、脚本归零 | ✅ | ✅ |
| 退出码 | | **1**（`hang：插件在超时窗口内没有结算（永久挂起）`） | **0** |

> 右列是**当前实现**（`BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS = 60_000`）的重跑读数。
> 本票第一版是 30s，当时的读数（`30030–30035ms` 结算、错误文本 `timed out after 30000ms`）
> **已被取代**：那正是评审按「621 KB / 20 KB/s ≈ 31s + 计时器覆盖 `fetch` 全段」判定余量不足、
> 要求提高取值的依据（见决策 2 的评审修正段）。排障时请以右列这一版为基线。

结论：① 挂起确实存在（不是理论担忧）；② 「失败被隔离」成立但**「挂起被隔离」只到「地图 ready」为止**——
同一列表里后面的插件会被永久阻塞；③ 取消语义三条与 AGENTS.md 的口径一致，本票只需保证不破坏它们。

## 与同源参考实现 `huiyan-fe/react-bmap` 的对照

维护者给出该仓库作为参考，逐项核对后**这条通道没有先例可借**：

| 项 | 参考实现（`@baidumap/react-bmap@2.0.6`，master） | 本库 | 判定 |
| --- | --- | --- | --- |
| 插件脚本加载 | **没有**这条通道：`src/` 下 `TrackAnimation` / `DrawingManager` / `GeoUtils` / `Mapvgl` 命中 **0** 处；`plugins` 只进 `loadKey`（`src/loader/registry.ts` 的 `buildLoadKey`），`doLoad` 不把它转发给 Loader | 有通道：四个内置插件各一条 URL，注入 `<script>` 后读文档级全局 | 本库**多一层**，因此这条边界没有参考实现的经验可用 |
| `timeout` | 公开 prop，**只**喂给官方 SDK Loader（`src/loader/index.ts` 的 `Loader.load({...timeout})`） | 同样是 SDK 入口的参数（`BMapLoadOptions.timeout`，`0` = 不超时） | **同源**：两边都没把它当成「插件脚本超时」 |
| 取消语义 | 无插件消费者可取消（`loadJSAPI` 的 promise 由 registry 缓存，组件卸载只是 `cancelled` 标记 —— `src/provider/BMapProvider.tsx` 的 generation token） | 消费者级 `AbortSignal`（`whenPlugin(name, signal)`），共享任务保留 | 本库**更细**（消费者粒度），这条差异是既有决策不是本票引入的 |

因此「插件脚本超时」的取值与判据只能由本库自己的探针证据决定（决策 2）。

## 后果

- **公共工厂只吃到一处独立修复**：`urlPluginDefinition` 的超时语义不变（不设超时），但共用加载器里
  决策 3 的取消竞态修复对它同样生效 —— 影响面表述必须按这一条收窄，别写成「第三方完全不受影响」。
- **挂起不再是无界的**：一次挂起最多占用一个超时窗口（内置工厂 60s），之后插件以 `error` 结算、回执
  `plugin-error`、后续插件继续加载 —— 诊断从「一直加载中」变成「明确的超时」。
- **可重试**：失败条目会被 `PluginHost` 从缓存移除（`promise.catch(() => entries.delete(name))`），
  下一次 `whenPlugin` 真的重新加载。
- 新增 nightly job `plugin-load-channel`（与 `plugin-runtime` 并列、`if: github.repository == …` 守卫、
  显式 `SMOKE_BROWSER`），并有「它真的在跑、没被 `if:` / `continue-on-error:` 架空」的门禁用例。

**回滚**：把 `loadScriptWithExport` 里的计时器去掉（或把内部入口
`createUrlPluginDefinition(..., timeoutMs)` 的第四参固定为 `0`）、删掉 `BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS`
与三处新用例（`builtins.test.ts` 的超时组、`v3-plugin-failure-isolation.test.ts` 的挂起用例、
`v3-plugin-load-channel-decision.test.ts` 的判定组），删 nightly job 与探针脚本即可。
`settled` 守卫（决策 3 的顺带修复，覆盖所有调用者）与超时无关，可独立保留。

## 非目标

- **不做 SRI**：上游 `BMapGLLib` / `unpkg` 的脚本没有完整性信息，伪造一个更糟；
- **不改默认 SDK 加载路径**：那由 `2026-09-13-official-first-loader-and-ui-kit` 的契约冻结；
- **不改插件作用域与 Catalog 语义**（`2026-09-14-plugin-catalog-scope-scheduling`）；
- **不顺手改 `DrawingManager` 运行时自行注入脚本**：它绕过本库，属于上游行为，已在 inventory 里记录；
- **不新增公开配置面**：`plugins: string[]` 不接受逐插件选项，所以本票**不**给超时加一个没有消费者的
  公开选项（评审 2026-09-22 给了这条替代路，见决策 2 的说明）。

## 已知限制

1. **超时值不可按站点配置**：`BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS` 是模块常量，只作用于四个内置工厂。
   要按站点调，得先有一个真实的配置入口（`plugins` 目前只接受名字），那是一次独立的公开 API 决策。
   第三方脚本插件**保持既有语义：没有超时**（它自己持有 `load`，要超时请自行包一层）。
2. **失败的脚本元素仍留在文档里**（`error` / 「没暴露全局」两条路径）：这是**既有行为**，本票只改了
   「超时 / 取消」这两条**作废**路径（摘元素）。留着不动是为了让本票的行为增量可核对。
3. **`Mapvgl` 分支的 `fetch` 本身不可取消**：取消 / 超时只保证「不再插脚本」，没有 `AbortController`
   传给 `fetch`（上游没有要求，且这段代码在 `Mapvgl` 被判定为 `incompatible` 之后仍然只是加载层）。
4. **同一列表里后续插件仍会等一个超时窗口**（决策 4）：顺序 `await` 未改。
5. **本探针不进 PR 门禁**：需要真实 AK + 外网 + 浏览器，还要真的等一个超时窗口。结论新鲜度靠 nightly；
   PR 上只保证「判定层 + 门禁 + 文档」无漂移。
6. **取消语义的读数只在真实浏览器上量得到**：happy-dom 会在 `appendChild` 时**同步**给不可达的
   `<script src>` 派发 `error`（实测事件顺序 `error → after-appendChild`），
   因此单测里「挂起」是用普通元素替身构造的（见 `builtins.test.ts` 的说明）。

## 参考

- issue [#121](https://github.com/Mang-X/bmap-vue/issues/121)（承接 [#43](https://github.com/Mang-X/bmap-vue/issues/43) 的欠账）
- ADR [插件兼容 inventory 与「必需功能不依赖插件脚本」的隔离口径](./2026-09-13-plugin-compat-inventory.md)（本文取代其「插件加载没有超时」一条）
- ADR [插件迁移结论定型与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md)（本文取代其已知限制 8 的后半句）
- ADR [Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)（`timeout` 的冻结语义）
- ADR [插件 Catalog、global / map 作用域与依赖调度](./2026-09-14-plugin-catalog-scope-scheduling.md)（作用域与共享宿主）
- 同源参考实现 `huiyan-fe/react-bmap`（`@baidumap/react-bmap@2.0.6`）：`src/loader/index.ts`、`src/loader/registry.ts`、`src/provider/BMapProvider.tsx`
