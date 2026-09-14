# ADR 2026-09-14：插件 Catalog、global / map 作用域与依赖调度

- 状态：已接受（Accepted）
- 日期：2026-09-14
- 计划键：`M8-PLUGIN-CORE`（issue #42，追踪 #12）
- 相关：`packages/baidu-map-gl-vue/src/plugins/catalog.ts`、`packages/baidu-map-gl-vue/src/core/plugins/PluginHost.ts`、`packages/baidu-map-gl-vue/src/core/plugins/PluginRegistry.ts`、`packages/baidu-map-gl-vue/src/core/plugins/pluginAbort.ts`、`packages/baidu-map-gl-vue/src/components/map/BMap.vue`、`tests/behavior/v3-plugin-catalog-scope.test.ts`
- 与既有决策的关系：**不改动** [Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)（默认加载委托官方 Loader、标准 UI 委托官方 UI Kit）与 [插件兼容 inventory](./2026-09-13-plugin-compat-inventory.md)（隔离口径 / inventory 是数据）。本文只收口它们没有覆盖的一角：**插件名字的映射、作用域归属与依赖调度**。inventory 决策 8 把「插件页」留给 #43，本文不碰。

## 背景

`#42` 的验收清单落在 `PluginRegistry` 上，但开工前的实测盘点显示它是**半成品**：七个实施步骤里有五步没有实现。

| issue 实施步骤 | 实测状态 |
| --- | --- |
| 2. Catalog 把插件名映射到准确类型，unknown 明确失败 | ❌ `stringToPluginDefinitions` 对未知名字返回 `{ required: false, load: async () => undefined }` —— 一个**永远成功的空实现** |
| 3. global 与 map 实例分别管理 owner / cache / dispose | ❌ `BMapPluginDefinition.scope` 字段**声明了但从未被任何代码读取**；每张地图各建一份注册表 |
| 4. 消费者取消只影响自身 | ❌ `whenPlugin(name, signal)` 收了 `signal` 参数却**完全忽略** |
| 5. 拓扑排序按层并行 | ❌ `loadPluginsInOrder` 是逐个 `await` 的串行实现 |
| 5. 失败重试、取消、dispose 的状态可读取 | 🟡 重试会重进 `load()`，但**成功后 `getError()` 仍返回旧错误**；取消与消费者数完全不可观察 |
| 6. 基础 Map ready 不等待可选插件 | ✅ 已由 `BMap.vue` 的 `loadPluginsInBackground` 保证（本轮保持） |
| 7. 保留集中兼容说明与迁移警告，不扩大为通用工作流引擎 | ✅ 本轮不新增框架（见决策 8） |

三个后果里最严重的一个是**跨地图**的：`scope` 没被读取 + 每张地图一份注册表 + `load()` 收到的是地图自己的 `scope.signal`，于是同页面两张 `<BMap :plugins="['TrackAnimation']">` 会插两份 `<script>`，而且**一张地图卸载可能把另一张地图正在等的加载一起取消**（谁先谁后决定成败）。

第二个是把「假支持」写进了默认路径：`plugins: ['TrackAnimatino']`（少一个 n）既不报错、`getStatus()` 也是 `ready` —— 这正是 Official-first 里明令禁止的「接收后忽略」。

### 实施步骤 1 的盘点结论：真正的外部插件只有四个

「先盘点真正的外部插件，排除 JSAPI Loader 与标准 UI Kit 的已确定集成职责」这一步的结论如下（它决定了本票的**边界**）：

| 候选 | 归属 | 依据 |
| --- | --- | --- |
| JSAPI Loader | **不属于本票**，已由 #71 完成 | 默认 Provider 委托官方 `@baidumap/jsapi-loader@1.0.0`，见 [默认在线路径切换](./2026-09-13-default-online-loader-cutover.md)。官方 [`BMapLoaderOptions`](https://registry.npmjs.org/@baidumap/jsapi-loader) 里**没有** `plugins` 字段，所以插件脚本不可能交给它加载 |
| 标准 UI Kit | **不属于本票**，已由 #73 / #75 完成 | `./ui-kit` 薄封装官方 `@baidumap/jsapi-ui-kit@1.1.2`，见 [UI Kit 子路径与类型边界](./2026-09-13-ui-kit-subpath-and-type-boundary.md) |
| `BMapGLLib` 家族（`TrackAnimation` / `DrawingManager` / `GeoUtils`）与 MapVGL | **是**本票的对象 | 它们是**非官方 SDK 包**的独立 `<script>`，不在任何官方包的能力面里；逐个状态见 [插件兼容 inventory](./2026-09-13-plugin-compat-inventory.md) |
| TrackLine 等原生图层 | **不是**本票的对象 | 4.0 原生能力，走 Facet / 原生图层（#36），不是「外部插件」 |

所以「外部插件 Catalog」的规模就是**四个**：`TrackAnimation` / `DrawingManager` / `GeoUtils` / `Mapvgl`。
本票不新增第五个，也不为它们自研替代实现（TrackLine 迁移属 #43）。

## 决策

### 1. Catalog 是「名字 → definition」的单一事实源，未知名字**明确失败**

`src/plugins/catalog.ts` 承担 `BUILTIN_PLUGIN_CATALOG` / `resolvePluginDefinition` / `stringToPluginDefinitions`；`builtins.ts` 只留**工厂与 URL**，不再持有名字表（一份清单放两处正是 `GeoUtils` 当初「有 URL、没条目、被静默降级」的来源）。

未知名字抛 `BMAP_PLUGIN_UNKNOWN`，与 `BMAP_PLUGIN_LOAD_FAILED` 分开：

| code | 含义 | retryable |
| --- | --- | --- |
| `BMAP_PLUGIN_UNKNOWN` | 名字不在 Catalog 里（调用方配置错误） | ❌ |
| `BMAP_PLUGIN_LOAD_FAILED` | 认得名字，但脚本 / 依赖加载失败（CDN 抖动） | ✅ |

合在一起会让 `BMapError.retryable` 说谎。

判据用**函数同一性**（`BUILTIN_PLUGIN_CATALOG[name].create === trackAnimationPlugin`），不用「有没有 `scope` 字段」这类特征：特征判据挡不住「把工厂换成另一个也叫这名字的空实现」，同一性判据挡得住。

`stringToPluginDefinitions` 由此变成**整体失败**（列表里任何一个未知名字都抛），不做「部分成功」——部分成功比整体失败更糟，调用方会以为列表里的插件都装上了。

### 2. 「明确失败」≠「让整张地图失败」

`<BMap :plugins="['Typo']">` 不该让整张地图不渲染：那既把运行时问题变成渲染期崩溃，也违反既有隔离口径。因此分层：

- **Catalog 层**：`resolvePluginDefinition` / `stringToPluginDefinitions` **抛**（不静默降级，这是本票要消灭的行为）；
- **组件层**（`BMap.vue`）：**逐个名字**解析并捕获，未知名字进 `pluginPlan`（带错误），稍后按 `plugin-error` 回执。地图照常 `ready`，同一列表里的其它插件照常加载。未知名字**不进注册表**——它本来就不是这个注册表里的插件，所以 `getStatus` / `inspect` 是 `undefined`（读数的这层区分是要的：「名字不认识」与「认得但加载失败」不该长得一样）。

`.vue` 里的循环也因此不再用 `stringToPluginDefinitions`（它的整体失败语义在这里不合适），而是逐个 `resolvePluginDefinition` + `try/catch`。附带修掉一个小缺陷：`plugins` 里重复写同一个名字不再触发注册表的 `already registered` 抛错，而是按一次处理、只回执一次。

### 3. 作用域：`global` 归宿主，`map` 归注册表；**缺省是 `map`**

| scope | 谁持有资源 | 谁有权释放 | 典型 |
| --- | --- | --- | --- |
| `"global"` | 进程级 `PluginHost`（模块级单例） | 宿主 `dispose()`（测试 / 热更新） | 文档级脚本插件（内置四个） |
| `"map"`（**缺省**） | 该地图的注册表 + 其 `ResourceScope` | 随地图卸载 | 只服务单张地图的自定义插件 |

缺省取 `map` 是刻意的：不写 `scope` 的自定义插件保持「这张地图自己的事」这一既有语义，不会因为本票突然变成跨地图共享。内置四个插件在 `builtins.ts` 里**显式**传了 `scope: "global"`（读代码可见，不靠工厂缺省）。

**两个缺省不一样，且都是有意的**：`urlPluginDefinition(...)`（脚本插件工厂）的 `scope` 缺省是 `"global"` —— 它产出的就是「注入 `<script>` + 读一个文档级全局」，资源本来就是文档级的；而**手写 definition** 的缺省是 `"map"`（保守、不改变既有行为）。`builtins.test.ts` 两个方向都锁住（不传是 `global`、传 `map` 生效），避免有人把它们当成同一个缺省而悄悄改掉一半。

宿主做成**模块级单例**而不是「每个 Client 一份」：被共享的资源是 `window.BMapGLLib.*` 这类**文档级全局**，同一份文档里两套 Client 看到的是同一个全局。按 Client 分桶只会把「同一份脚本被加载两次」从「跨地图」缩小到「跨 Provider」。

### 4. 地图卸载**无权**释放 global 资源（引用计数方案被否）

被否的替代方案是「引用计数，最后一个消费者离开时释放」。它听起来更干净，但实现只能是「删 `<script>` + 抹全局」，而：

- 上游（`BMapGLLib` / MapVGL 脚本）**没有卸载入口**，这一动作没有公开契约支撑；
- AGENTS.md 明令不得删除 / 改写上游注入的 script、不得在组件卸载中 reset SDK；
- 删掉全局会波及页面里**其它已经拿到它**的代码（业务自己的代码、其它库）。

所以 `global` 资源活到宿主 `dispose()`；`dispose()` 是**纪元重置**（换一个纪元 scope、让每个已就绪实例过一遍 `definition.dispose`、清空缓存与计数，之后仍可继续 `acquire`），只由测试 / 热更新显式调用。释放顺序固定为三步：**先摘出并清空当前条目**（dispose 期间到来的 `acquire` 必须落到新纪元，而不是复用一份正在被释放的实例）→ **abort 在飞加载并跑 `setup` 登记的 disposer** → **最后把已就绪的实例交给 `definition.dispose`**。

⚠️ **它不是「让内置插件回到没加载过」的手段**：`dispose()` 不移除第三方脚本、也不抹 `window.BMapGLLib.*`，因此下一次 `acquire` 会命中 `urlPluginDefinition` 的「导出已存在 ⇒ 直接 resolve」短路 —— 复用同一个全局对象，**既不重新拉脚本、也不重新初始化**（`builtins.test.ts` 有一条用例把这句话钉成可执行事实）。要真正的干净起点只能刷新文档，或由宿主页面自己卸载那个全局。

**纪元校验是必须的，不是防御性编程**（评审 #88 P1-2）：`dispose()` 清空条目之后同名插件可以立刻重新 `acquire`，而**上一个纪元**那条在飞任务之后才结算时，它的处理器仍会碰这张表 —— 失败时按名字 `delete` 会把新纪元的同名条目一起删掉（去重失效、重复加载），成功时旧实例既不在 entries 也不在 dispose 快照里（孤儿资源）。所以每次加载都记下自己的纪元号，结算时比对：过期的结算不写状态、不动这张表，只处理它带来的那个实例。

**旧纪元实例的释放要「推迟判定」，不能当场按 identity 比**（评审第三轮 P1-1）：**判定「没人认领」需要知道新纪元会不会 claim 同一个实例**，而新纪元的同名条目可能**还在 loading** —— 此时 `current.instance` 是 `null`，当场比较只会得出「没人用」这个错结论，于是把一个新纪元马上就要拿到的单例提前释放掉。规则因此是：

| 旧纪元迟到成功时的状态 | 处理 |
| --- | --- |
| 当前同名条目已 `ready(X)` | 立即判定：`X === instance` 就丢弃（新纪元在用），否则就地释放 |
| 当前同名条目仍 `loading`，或该名字暂无条目 | **挂起**成候选孤儿，等这个名字下一次有确定结论 |
| 当前条目 `ready(X)` 触发结算 | 释放所有 `!== X` 的候选，`=== X` 的丢弃 |
| 宿主 `dispose()` | 剩下仍挂起的候选全部释放（纪元结束，不会再有人认领） |

代价是「这个名字再也没人 acquire」时候选会多留一会儿（有界的保留），换掉的是「把在用的资源拆掉」这个更坏的失败。候选按**实例 identity 去重**：`definition.dispose` 没有幂等契约，而两个旧纪元完全可能 `load` 出同一个单例，挂两次就会 dispose 两次（评审第四轮 P2）。同理，**`setup` 必须在「这次加载还算不算数」校验之后才执行**（评审第三轮 P1-2）：跑在校验之前的话，地图销毁后还会冒出一个 `setup`，而且 `setup` 抛错会把 promise 推进 catch、绕过上面那条过期结算的释放路径 —— 实例就此泄漏。

**`setup` 由资源的所有者执行，而且只执行一次**（评审第四轮 P1 + 自查）：`map` 作用域归这张地图的注册表，`global` 作用域归宿主。两边都跑会让同一个副作用被登记两遍，而且注册表那次返回的 disposer 会被挂到**地图** scope 上（地图一卸载就拆掉了宿主持有的状态）。两个所有者都要在自己那一侧处理「`setup` 抛错」：实例已经创建但没能就绪 ⇒ 由**所有者**调 `definition.dispose` 回收，然后清掉缓存条目进入可重试状态。`global` 资源的所有权在宿主，注册表不替它回收。

`disposeDefaultPluginHost()` 从 `baidu-map-gl-vue/plugins` 子路径导出（根入口保持最小面）；调用方要自己负责「此刻没有地图还在用这些插件」。

### 5. 消费者取消只影响自身；共享任务保留

`whenPlugin(name, signal)` 的 signal 只解绑**这一个**等待者（它自己的 promise 以 `BMAP_PROVIDER_ABORTED` 拒绝），共享任务继续跑、结果照旧被后来的消费者复用。这与 AGENTS.md「组件取消等待 = 解绑消费者 + 丢弃回包；不等于终止上游加载」是同一条口径。

两条配套的细节：

- **已 abort 的 signal 立刻拒绝且不启动任何加载** —— 不该产生一个没有任何人等待的请求（与 `MapRuntime.whenReady` 同一习惯）；
- 取消**不是插件失败**：注册表状态不得被写成 `error`（否则一次组件卸载会污染插件状态、把后续请求变成「重试」）。取消的可观察读数是 `inspect(name).consumers` 的下降。

`map` 作用域插件另有自然收口：注册表额外持有一个内部 `AbortController`（同时注册到地图 `ResourceScope` 上），`dispose()` 或地图 scope 释放都会结算本注册表的等待者 —— 否则「注册表已销毁、消费者还在等一个不会有人管的加载」会挂住（`MapRuntime.dispose()` 里 `plugins.dispose()` 排在 `resources.dispose()` **之前**，中间没有 abort）。

### 6. optional 失败 resolve `null`，不是 `undefined`

`undefined` 是 **void 插件**（`load` 出 `undefined`，只注册副作用不产出资源）的合法成功值。用它表达失败会让两种语义撞车（评审 #85 P1-2）。因此：

| 情形 | `whenPlugin` 的结算 | 状态 |
| --- | --- | --- |
| 成功（含 void） | 资源实例（可能是 `undefined`） | `ready` |
| optional 失败 | `null` | `error`，`getError()` 有原始错误 |
| required 失败 | 抛原始错误对象 | `error` |
| 消费者取消 | 抛 `BMAP_PROVIDER_ABORTED` | 不变（共享任务仍在飞） |

### 7. 依赖按层并行 + 失败即出缓存 + 状态可读

- **按层并行**：依赖闭包按深度分层，同层 `Promise.all`，层间顺序等待。层内保持发现顺序，让加载顺序可复现。
- **失败即出缓存**：与同源参考实现的 `registry.ts` 同形（见下文对照表），失败条目立刻从宿主缓存移除，下一次请求**真的**重新加载。注册表侧成功后会清掉 `record.error`（此前留着旧错误会让调用方以为「刚加载好的插件其实还在错」）。
- **状态可读**：新增 `inspect(name)`，给出 `{ scope, required, status, attempts, consumers, error }`。`plugin:ready` / `plugin:error` 是瞬时的，错过就没了；而「现在什么状态、试过几次、还有几个消费者在等」才是排查时要问的三个问题。
- **同步抛错也算失败**：`definition.load` 是调用方给的函数，没有 `async` 的写法同步抛错完全可能。不接住它，异常会穿透注册表 —— 不记 `record.error`、不发 `plugin:error`、`status` 永久停在 `loading`（隔离失效，且变成一个卡住的状态）。因此启动加载的那次调用包在 `try` 里。
- **dispose 不让计数变负**：注册表的 `dispose()` 结算在飞消费者（内部 abort 信号），但**不**把 `consumers` 清零 —— 那些消费者会在自己的 `finally` 里递减，先清零会让 `inspect()` 读到 `-1` 这种不可能的值。

### 8. 不引入新框架：不新增全局 EventBus、不新增第二套资源运行时

- 宿主与注册表都复用既有的 `ResourceScope`（abort + 逆序 disposer），没有第二套资源运行时；
- 取消逻辑抽到 `core/plugins/pluginAbort.ts`（`abortRace`），`PluginHost` 与 `PluginRegistry` 共用同一实现，避免「取消到底影响谁」有两个版本；
- 事件仍是每 Runtime 的诊断总线，**没有**新增全局 EventBus。

## 与同源参考实现 `huiyan-fe/react-bmap` 的对照

维护者给的对标对象是 `huiyan-fe/react-bmap`（官方 React 组件库，`2.0.1`）。读它的办法是下载 tarball 后 grep，结论有几条是**反面**的：

| 读到的 | 结论 |
| --- | --- |
| `src/loader/index.ts` + `src/loader/registry.ts`：进程级 `globalRegistry`，按 `loadKey`（`v/ak/host/lang/plugins`）去重；**`promise.catch(() => registry.delete(loadKey))`** | ① 同源印证「共享资源用进程级 registry + 指纹去重」的方向；② **本库采纳**它「失败即从 registry 移除」这半条（= 失败可重试，见决策 7） |
| `src/provider/BMapProvider.tsx` 的 `plugins?: string[]` **只进 `loadKey`**，`doLoad()` 不转发它 | 它的 `plugins` 是**去重键的一部分**，不产生任何加载行为 |
| `@baidumap/jsapi-loader@1.0.0` 随包发布的 `types/index.d.ts` 里 **`BMapLoaderOptions` 没有 `plugins` 字段** | 所以「`plugins` 不转发」不是疏漏 —— 上游 Loader 根本没有这个入口 |
| 全仓 grep `plugin`（`src/**`、README） | 它**没有**插件 Catalog、作用域、依赖调度或 `plugin-ready`/`plugin-error` 这类回执面；README 一个字没提插件 |
| 它的 `src/utils/createComponent.tsx` 处理的是 Overlay 的 create/add/remove | 与插件层无关 |

因此本票**不能**照抄参考实现（它没有这一层），但两条判断得到它支持：① 上游 Loader 的 `plugins` 不是可依赖的入口，插件脚本必须由本库自己管；② 「不自研标准 UI / 不假装支持」的既有立场是对的 —— 同源封装同样把四个 `BMapGLLib` 插件留在外面。

## 公开 API 与迁移影响

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `stringToPluginDefinitions(names)` 对未知名字**抛** `BMAP_PLUGIN_UNKNOWN`（此前返回空实现） | 破坏性：`plugins: ['Typo']` 从「静默 noop」变成「抛错 / 组件层回执 `plugin-error`」 | 记入 `guide/breaking-changes.md`；组件层仍不阻断地图 |
| `whenPlugin(name)` 的 optional 失败由 `undefined` 改为 `null` | 破坏性（严格比较的调用方） | 同上；`BMap.vue` 的判据一直是注册表状态，不受影响 |
| `PluginRegistry.inspect(name)` 新增 | additive | 文档补 `plugins` 一节的读数说明 |
| `BUILTIN_PLUGIN_CATALOG` / `BUILTIN_PLUGIN_NAMES` / `resolvePluginDefinition` / `PluginCatalogEntry` 新增（根入口与 `./plugins`） | additive | issue 的「插件 catalog/types」就是这一项；`stringToPluginDefinitions` 语义随之收紧 |
| `getDefaultPluginHost` / `disposeDefaultPluginHost` / `PluginHost` 新增（仅 `./plugins` 子路径） | additive | 宿主是 global 资源的合法所有者，释放入口不能只存在于测试能碰到的深路径里 |
| `PluginRegistry` 的 `dispose()` 不再清空记录 | additive（`getStatus` 在 dispose 后仍可读） | 用例锁住 |
| `register()` 校验 `scope` 取值、`name` 非空 | additive（此前非法值被静默接受） | JS 调用方是唯一防线，符合既有「运行时边界校验与公开契约一一对应」的立场 |
| `stringToPluginDefinitions` 从 `plugins/builtins.ts` 迁到 `plugins/catalog.ts` | 源码路径变化，**公共导出路径不变**（根入口仍导出同名函数） | 无需迁移 |

## 后果

- 同页面多张地图的插件脚本从「每张一份」变成「一份文档一份」，且一张地图卸载不再牵连另一张。
- 插件名字拼错会**明确失败**，不再有「看起来成功」的空实现。准确的语义分两层：**Catalog 层抛**
  `BMAP_PLUGIN_UNKNOWN`；**组件层**该名字发一次 `plugin-error`（载荷 `error.code` 同上）。要留意
  **它不会在注册表里留下记录**，所以 `getStatus(name)` / `inspect(name)` 是 `undefined` 而**不是**
  `'error'` —— 「名字不认识」与「名字认得但加载失败」（有记录、状态 `error`）是两个不同的可观察结果
  （评审 #88 文档项，`PluginRegistry.test.ts` 有一条用例钉住）。
- 依赖加载从串行变成按层并行；同层插件的就绪时间不再相加。
- `inspect()` 让「试过几次 / 还有几个消费者在等」可轮询，不再依赖瞬时事件。
- **卸载时的在飞插件不再「复活」或泄漏**：`dispose()` / 纪元切换之后到达的结算不改状态、不广播，
  它带来的 `map` 实例就地释放；`setup` 也因此不会在地图销毁之后再跑一次（评审第三轮）。

**回滚**：本决策只影响插件层的名字映射、作用域归属与调度实现，不涉及 SDK 加载路径、Driver、公共声明面。回滚方式是把 `catalog.ts` 的映射改回 `builtins.ts` 内的名字表 + 空实现降级、把 `PluginHost` 从注册表里摘掉（`global` 分支改回本地加载）、`whenPlugin` 去掉 signal 包装；生成物与文档随之回滚。`PluginHost` 与 `pluginAbort.ts` 是新增文件，删除即可（无外部引用）。

## 已知限制

- **插件加载仍然没有超时**：`urlPluginDefinition` 的 `loadScriptWithExport` 只认 `AbortSignal`，脚本服务器「不响应也不报错」时 `whenPlugin` 会一直挂着。本轮只保证「失败被隔离」与「消费者取消不被牵连」，**不保证**「挂起被隔离」。加超时属于加载层语义，需要单独决策（与 [inventory](./2026-09-13-plugin-compat-inventory.md) 的同名限制一致，本轮未推进）。
- **全局脚本无法卸载**：`PluginHost.dispose()` 只释放本库登记的 `setup` disposer 与调用 `definition.dispose`，**不**删 `<script>`、**不**抹 `window.BMapGLLib`（上游没有卸载入口，见决策 4）。后果是双向的：① 「宿主 dispose 后重新加载」**不会**重新拉脚本（`loadScriptWithExport` 先读 `exportGetter()`，导出还在就直接 resolve），所以别把它当「干净起点」—— 这条由 `builtins.test.ts` 的用例钉住；② 用**自定义** `load`（没有这个短路）的宿主单测才会看到「重新加载」，别把那条例外用例读成「真实脚本会重拉」。
- **挂起的候选孤儿是有界保留，不是即时释放**：旧纪元迟到成功而新纪元同名条目仍在飞时，实例会先被挂起，等这个名字下一次有结论（ready / 宿主 dispose）才判定。若这个名字此后再也没人 `acquire`，它就留到下一次 `dispose()` —— 刻意选择「多留一会儿」而不是「可能拆掉新纪元要用的单例」（评审第三轮 P1-1）。判定点本身不重复释放：同一个实例被新纪元 claim 时直接从候选里丢弃。
- **宿主只记录第一个消费者的 context**：共享任务用发起那次加载的 `PluginContext`。内置脚本插件忽略 context，因此无影响；自定义 global 插件若依赖 context 要知道这件事。
- **`map` 作用域插件的底层 `load` 仍由地图 scope 收口**：注册表 `dispose()` 会立刻结算消费者，但底层在飞 promise 要等 `scope.signal` abort（`MapRuntime.dispose()` 里紧随其后）。中间窗口内 `load()` 仍可能结算，其结果不会被任何人使用。
- **`PluginHost` 的 `attempts` 是名字级累计**：失败条目会被移除，所以「重试过几次」只能记在名字级计数器上；宿主的 `dispose()`（纪元重置）会清零。
- **同名不同 definition 会复用先到的那一份**：宿主按**名字**去重，不比较 definition 身份（两个注册表各自 `resolvePluginDefinition("TrackAnimation")` 拿到的本来就是两个对象，按身份比会误判）。跨注册表的同名冲突检测需要 definition 级指纹（参考实现用的是 `loadKey`），属扩展契约，本票不做 —— 现状由 `PluginHost.test.ts` 的一条用例钉住，不是没人知道的意外。
- **名字到「准确类型」只做到工厂级**：`resolvePluginDefinition` 返回 `BMapPluginDefinition<unknown>`，没有 `名字 → Resource` 的类型映射。上游那四个资源是 `BMapGLLib.*` 的全局对象，给它们写具体类型等于在本库里维护一份非官方 SDK 的声明面；按计划键这属于 `M8-06`…`M8-11`（#43，逐插件结论与 `./advanced` 契约），本票只承诺「名字 → 确定的工厂 + 元数据（scope / required）」，并把它记成有意的欠账。
- **两个 `consumers` 读数口径不同**：注册表级 `inspect().consumers` 是**精确**的（每次 `whenPlugin` 进出各一次，消费者取消会让它下降，是取消的主读数）；宿主级 `inspect().consumers` 只是「有几个注册表在等这个资源」，一个注册表内部的多个消费者在那里只算一次。
- **组件层不提供 `map` 作用域的内置插件**：`plugins: [...]` 只接受 Catalog 里的名字，四个内置插件都是 `global`。`map` 作用域目前只对**自定义** definition 有意义（经 `PluginRegistry.register` 直接注册）。
- **`M8-01`…`M8-05` 这五个计划键在仓库与追踪票里都没有定义**（`#12` 只有泳道标题，issue #42 只列了键名）。本轮按 issue 正文的七条实施步骤与六条验收做内容级对照，**不硬编键名映射**。

## 非目标

- 不重写 Loader 与 UI Kit（Official-first 已冻结）；不为通过门禁去动 SDK 私有面。
- 不新增全局 EventBus、通用工作流引擎或第二套资源运行时。
- 不交付「插件页」（仍属 #43）、不为任何插件写 Vue 组件或 Driver 装配入口。
- 不修 `Mapvgl` 的运行时结论、不改 Capability Catalog 的状态（由 #43 承接）。
- 不给插件加载加超时（见已知限制第 1 条）。

## 参考

- issue #42（`M8-PLUGIN-CORE`，追踪 #12）
- ADR [插件兼容 inventory 与「必需功能不依赖插件脚本」的隔离口径](./2026-09-13-plugin-compat-inventory.md)
- ADR [Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)
- 同源参考实现 `huiyan-fe/react-bmap@2.0.1`（`src/loader/{index,registry}.ts`、`src/provider/BMapProvider.tsx`）与官方 `@baidumap/jsapi-loader@1.0.0` 随包发布的 `types/index.d.ts`
- `tests/behavior/v3-plugin-catalog-scope.test.ts`、`packages/baidu-map-gl-vue/src/core/plugins/{PluginHost,PluginRegistry}.test.ts`、`packages/baidu-map-gl-vue/src/plugins/catalog.test.ts`
