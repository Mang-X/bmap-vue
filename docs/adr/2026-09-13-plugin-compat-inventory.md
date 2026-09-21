# ADR 2026-09-13：插件兼容 inventory 与「必需功能不依赖插件脚本」的隔离口径

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`M3A3-07`（issue #25，追踪 #12）
- 相关：`packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts`、`scripts/generate-plugin-inventory.mts`、`scripts/probe-plugin-compat.mts`、`tests/behavior/v3-plugin-compat-inventory.test.ts`、`docs/zh-CN/contributing/plugin-compat-inventory.md`、`packages/baidu-map-gl-vue/src/driver/capability/catalog.ts`
- 与既有决策的关系：不改动 [Official-first](./2026-09-13-official-first-loader-and-ui-kit.md) 与 [默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)；本文只补它们没有覆盖的一角——**第三方插件脚本**（`plugins: [...]` 加载的那四个）在 JSAPI 4.0 上的状态与隔离口径。

> ⚠️ **两处已被取代**（2026-09-21，[插件迁移结论定型与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md)）：
> **决策 3** 的结论取值（`incompatible` / `no-declaration-gap` / `undetermined`）换成五值
> `native` / `compatible` / `adapter` / `incompatible` / `unverified` 并补 `migrationPath`；
> **决策 7** 退出码表里「有插件 `threw` ⇒ 1」改成「已登记的 `threw` 不算 fail」（并新增 nightly
> `plugin-runtime` job）。本文其余决策（依据三档 / 私有面布尔口径 / 内置插件一律 optional /
> 能力互锁 / 两个探针不进 PR 门禁 / 插件页不塞进必需链路）**仍然有效**。历史正文保留不变。

## 背景

`#25` 的验收清单里有一条长期没有答案：「插件兼容 inventory 有证据；可选插件故障与必需功能隔离」。

当时的实际状态是：

- Capability Catalog 里 `overlay.mapvgl` 与 `service.track-animation` 的说明写的是
  「迁移结论待定（M8），本阶段明确不支持」。**那不是结论**：读者看不出已经查过什么、
  依据是什么、还差什么；
- `#67`（本票的原始切换 PR，已关闭）的分支上曾留下过一句「真实 4.0 上脚本加载成功后运行时抛错」，
  但那次观察的原始日志没有入库、分支也已停止合并，**无法在本仓库复现**，所以它不能当依据用；
- `TrackAnimation` 被标成 `required: true`。按 `PluginRegistry` 的语义
  （`required !== false` ⇒ 失败即抛），这意味着**一个第三方 CDN 脚本的抖动能让整张地图失败**，
  而这个插件恰恰是四个里唯一被本库标为 `unsupported` 的；
- `GeoUtils` 的 URL 早就在 `BUILTIN_PLUGIN_URLS` 里，却既没有工厂、也不在
  `stringToPluginDefinitions` 的名字表里——`plugins: ['GeoUtils']` 会被静默当成未知插件，
  变成一个永远成功的空实现。

运行时那一档一开始以为取不到（当时的判断是「本机没有 AK」）——这个判断是错的：仓库
`docs/.vitepress/theme/index.ts` 里就有一支已入库的浏览器端 AK，本机也有 Chrome。于是本轮补了
一条**运行时探针**（`pnpm probe:plugin-runtime`），四个插件都拿到了真实 4.0 上的读数，
结论也随之更硬（见决策 7 与「运行时读数」）。

本 ADR 要解决的不是「凑一条证据出来」，而是让状态**如实**：查过的写成查过的，没跑的写成没跑的，
并且把「怎么复现」交给下一个人。

## 决策

### 1. inventory 是数据，文档是它的生成物

单一事实源：`packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts`。
`pnpm generate:plugin-inventory` 生成 `docs/zh-CN/contributing/plugin-compat-inventory.md` 与
`docs/.vitepress/plugin-inventory.json`（带 `Generated file. Do not edit directly.`，不写时间戳）。
CI 的 `quality` job 跑 `--check` 校验无漂移——与 `generate:capability-matrix` 同一套做法。

### 2. 依据分三档，且**不许混写**

| 依据 | 含义 |
| --- | --- |
| `artifact` | 对 `BUILTIN_PLUGIN_URLS` 锁定 URL 的**真实发布产物**做静态抽取（`pnpm probe:plugin-compat`） |
| `declaration` | 与官方类型声明核对。**自动部分只到命名空间级成员**（`BMapGL.<Member>` 是否存在）；`Owner#member` 形态的实例成员由**人工**逐条对照声明，记在 `manualInstanceChecks` |
| `runtime` | 真实 JSAPI 4.0 运行时观察（`pnpm probe:plugin-runtime`，需 AK + 浏览器） |

没跑过的档位不写进依据。这条是刻意的：把「声明面没缺口」说成「兼容」，是把结论说得比证据强。

### 3. 结论取值三种，`no-declaration-gap` **不等于**兼容

> ⚠️ **本节已被取代**（2026-09-21）：取值改为五值词汇并补 `migrationPath`，见
> [插件迁移结论定型与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md) 决策 1 / 2。
> 下面这段记录的是当时的取值，保留作历史。

| 结论 | 含义 |
| --- | --- |
| `incompatible` | 有决定性依据说明它在 4.0 上不可用（必须给出决定性的私有面，见决策 4） |
| `no-declaration-gap` | 脚本引用的命名空间级成员在官方声明里没有缺口、也没有私有面 |
| `undetermined` | 既有缺口也有不确定项 |

`no-declaration-gap` 只承诺「按声明面核对没有缺口」。真实的 MapVGL 就是反例：它的成员引用面
**干净**（只引 `Overlay`），决定性依据藏在传输层——它把 SDK 的私有回调表（成员名 `_rd`）当 JSONP 回调表
（脚本把自己的回调注册进那张表，再把 `callback=` 指向表里的条目）。这正是 `#72`
（[删除 SDK 私有面嗅探](./2026-09-13-private-sdk-surface-removal.md)）明令本库不得访问的私有面，
所以 `overlay.mapvgl` 的 `unsupported` 现在是**有依据的结论**。

### 4. 「有没有私有面」是数据里的**布尔值**，不是成员名清单

清单里与私有面相关的字段是 `hasPrivateSurface: boolean` + 一段人读说明，而不是成员名数组。
这不是偷懒，是被本库自己的门禁逼出来的正确形状：

- 生产源码的私有面门禁（`tests/behavior/v3-private-sdk-surface.test.ts`，
  [#72](./2026-09-13-private-sdk-surface-removal.md)）匹配的是**访问形态**。成员名在字符串字面量里
  写成「命名空间 + 点号 + 成员名」时，与「真的去把它读出来」在文本上无法区分，判违规是对的；
- 所以本库源码解释这类成员时的约定是**只写成员名（反引号包起来）**。数据文件属于生产源码，
  就必须守这个约定；
- 可核对性没有因此下降：探针仍然从真实产物里抽取私有成员名（脚本不在扫描范围内），并断言
  「抽到的集合是否为空」与这个布尔值一致 —— 上游哪天不再依赖那张私有表，探针会红。

口径边界写进字段注释：**只覆盖命名空间级私有成员**。实例级私有字段（例如插件读覆盖物实例上的
下划线字段）不进这一列，写在 `residualRisks` 里。

### 5. 内置插件一律 optional（隔离口径），且失败不得被回执成成功

四个内置插件的 `required` 恒为 `false`：**必需功能不得依赖任何插件脚本**。`required: true` 在
`PluginRegistry` 里是「失败即抛」，只留给真正「没有它就不该继续」的插件定义 —— 目前一个内置插件
都不属于这类。inventory 的 `required` 字段标成字面量类型 `false`，把它改回必需必须同时改数据与
用例，不会是一次悄悄的一行改动。

不过 `required` 定成 `false` 只解决了「失败会不会阻断地图」。同一处还有第二个坑：注册表的失败策略是
**optional 插件失败时以 `undefined` resolve**（`PluginRegistry.loadPlugin`），于是
`await whenPlugin(name)` 拿到返回值并不等于成功 —— `BMap.vue` 曾经据此发 `plugin-ready`，
把「插件没加载起来」回执成「加载成功」。把四个内置插件都变成 optional 之后，这个坑的暴露面从两个
插件扩到四个，因此本次一并修掉：组件以**注册表状态**（`getStatus`）为准回执，失败时经
`PluginRegistry.getError()` 带出原始错误，而不是另造一个没有 `cause` 的替代品。

回归用例在 `tests/behavior/v3-plugin-failure-isolation.test.ts`（组件级，刻意不用 `vi.mock`：
成功一半靠预置全局导出走真实的「不碰网络」分支，失败一半用未知插件名走 optional 空实现；
把上面那句状态判断去掉，两条用例立刻变红）。

### 6. 能力与清单**双向互锁**

Catalog 里被标为 `unsupported` 的插件类能力，必须在 inventory 里有对应条目（否则「不支持」是一句
没有依据的话）；反过来，条目声明的能力必须真实存在于 Catalog。两个方向都由behavior 用例钉住，
并要求那些 `description` 指向 `plugin-compat-inventory` 而不是继续写「待定」。

### 7. 两个证据生成器都不进 PR 门禁

- `pnpm probe:plugin-compat`（需要网络）：从锁定 URL 拉真实产物，抽三列（引用的 SDK 命名空间成员 /
  私有面 / 副作用标记）、与官方声明逐成员核对、再与 inventory 比对；
- `pnpm probe:plugin-runtime`（需要 AK + 浏览器）：起本机页面，真实加载 JSAPI 4.0 与**单个**插件脚本，
  跑最小可用路径，产出 inventory 的**运行时读数**。**每个插件一个全新文档**（`?only=<id>`），并要求
  `globalExistedBeforeLoad === false` —— 这是证据独立性的前置断言：DrawingManager 会自己注入
  GeoUtils / gpc 脚本，同页串跑会让「GeoUtils 那支 URL 生效了」与「捡了别人的副作用」无法区分
  （评审 #85 P2-2）。它**不是** smoke harness 的插件页
  （决策 8）：不登记进 `tests/browser/jsapi-v4` 的检查表、不进任何 CI job、不参与必需链路的放行判定。

两个探针的判定与退出码沿用 `scripts/probe-official-packages.mts` 的口径：

> ⚠️ **本表的最后一行（`fail`：有插件 `threw`）已被取代**（2026-09-21）：
> 「已登记的 `threw`」是结论、不算 fail，只有未登记过期望值的 `threw` 才退 1。
> 见 [插件迁移结论定型与 `./advanced` 冻结](./2026-09-21-plugin-verdicts-and-advanced-freeze.md) 决策 6。

| 结论 | 触发 | 退出码 |
| --- | --- | --- |
| `pass` | 抽取结果与 inventory 完全一致 | 无 |
| `fail` | 不一致，或锁定 URL 返回 4xx | 1 |
| `blocked` | 产物取不到（网络 / CDN 不可用、超时、5xx），或运行时档里 SDK 没起来 | 3 |
| 脚手架失败 | 读不到数据模块 / 类型包 | 2 |

**`blocked` 不是通过**，只有 `0` 放行。它放在 nightly / 手工执行；PR 门禁只跑无网络的 `--check`。

#### 运行时档的小结是**结构化状态**，不是「没抛错」

评审第三轮指出：只要「`probe` 不以 `THREW` 开头」就算过，那句 `0` 实际只表达了「脚本加载了、全局存在、
没抛错」，而不是 inventory 想说的「**已跑通该插件的最小功能路径**」——页面存在多种「没走到最小路径但
不抛异常」的返回（构造器不是 function、`mapvgl.View` 不是 function……）。同一批输入的实测对比：
这四种形态在旧规则下**全部退 `0`**，现在全部退 `3`。

因此页面侧统一产出 `{ status: "verified" | "threw" | "inconclusive", detail, reason?, checks?, error? }`，
**每条最小路径的 invariant 由插件自己判定**，判定只看 `status`：

| 插件 | 判 `verified` 的必要 invariant |
| --- | --- |
| TrackAnimation | 构造器是 function；`start()` 后折线 path **真的增长**；`map.getZoom()` **真的变化**（视角跟随） |
| GeoUtils | 静态成员数 > 0；`getDistance((0,0),(0,1))` 是有限数值且 ≈ 111194.87（容差 1%）；`isPointInRect` 返回布尔 |
| DrawingManager | 构造器是 function；`getDrawingMode()` 返回非空字符串；**自行注入** `GeoUtils` 与 `gpc` 两个脚本 |
| Mapvgl | `mapvgl.View` 是 function；`new View(...)` 构造成功；图层能挂上 —— 真实 4.0 上这条必然不成立，故落到 `threw` |

运行时档的退出码表：

| 结论 | 触发 | 退出码 |
| --- | --- | --- |
| 全成立 | 每个插件都有报告、SDK 都起来、脚本都加载、全局都暴露、独立性成立、**`status` 都是 `verified`**，且与 inventory 记录的 `runtime.status` 一致 | 0 |
| `fail` | 有插件 `threw`；或独立性被打破；或读数与 inventory **不一致**（说明 inventory 已过期，必须更新） | 1 |
| `blocked` | 任一页 `sdkLoaded !== true`；任一 run 没给出 `result`；`status` 缺失或不是三个取值之一；脚本加载/全局暴露不成立；**`inconclusive`（最小路径 invariant 不成立）** | 3 |
| 脚手架失败 | 缺 AK / 找不到浏览器 / 页面脚本语法错或自身抛错 / 期望的插件没有报告 | 2 |

优先级：**脚手架(2) > blocked(3) > fail(1) > 通过(0)**。一个插件没跑通最小路径时，不该拿另一个插件的
观察当结论。判定与清单都收在纯函数模块 `scripts/plugin-runtime-report.mts`，桩测试见
`tests/behavior/v3-plugin-runtime-decision.test.ts`。

### 8. 「插件页」仍归 #43，本轮不越界

[ v4 required smoke ](./2026-09-13-v4-required-smoke.md) 决策 2 已经定下「可选插件的噪声靠单独页面
隔离」，并把这个页面记成由 #42 / #43 承接。本轮交付的是**结论与隔离口径**，不是那个页面；
把插件脚本塞进 `tests/browser/jsapi-v4/main.ts` 会让跨域脚本异常直接染红必需链路，方向正好相反。

## 运行时读数（2026-09-13，真实 JSAPI 4.0 + 真实 AK + Chrome）

复现：`BAIDU_MAP_AK=<ak> pnpm probe:plugin-runtime`（AK 用 `docs/.vitepress/theme/index.ts` 里那支
已入库的浏览器端 AK；退出码 `0` 通过 / `1` 有插件运行时抛错 / `3` SDK 没起来 / `2` 脚手架失败）。
同一次运行顺带证实了页面环境：

| 环境事实 | 读数 |
| --- | --- |
| `BMap` 命名空间 | 就绪，278 个键 |
| `BMapGL === BMap` | 是（同一对象别名） |
| `BMap.version` | `"gl"`（构建标记，不是版本号 —— 与 #70 的实测一致） |
| 私有回调表（成员名 `_rd`） | **存在**（所以 MapVGL 的问题是「它依赖私有面」，而不是「运行时没有这张表」） |

| 插件 | 脚本加载 | 暴露全局 | 最小路径 |
| --- | --- | --- | --- |
| TrackAnimation | ok | 是 | **通过**：构造成功；`start()` 后折线 path 由 2 点增到 39 点、`getZoom()` 由 13 变到约 15.15 |
| DrawingManager | ok | 是 | **通过**：构造成功、`getDrawingMode()` 为 `marker`；并**证实脚本自行注入** `GeoUtils.min.js` 与 `gpc.js` |
| GeoUtils | ok | 是 | **通过**：10 个静态成员；`getDistance((0,0),(0,1))` 返回 111194.87 |
| Mapvgl | ok | 是 | **抛错**：`new mapvgl.View({ map, mapType: "bmap" })` → `Cannot read properties of undefined (reading 'appendChild')` |

同一天、同一支 AK，在候选提交上跑了 live required smoke：`gate.ok=true gate.exit=0`，
16 项 required 全部 `pass`（含真实服务 `service-geocode` 与四个 UI Kit 项）——这同时满足 #25
验收里「真实 required smoke 在**同一候选 commit** 通过」那一条。

这两组读数都**不进仓库**（与 #74 对实跑证据的处置一致）：命令与期望写在 ADR 与生成文档里，
原始输出落在 PR 正文 / nightly artifact。

## 后果

- 读者打开 `docs/zh-CN/contributing/plugin-compat-inventory.md` 能看到：四个插件各自的
  锁定 URL、应暴露的全局、引用的 SDK 成员、私有面、副作用标记、关联能力、结论、依据档位与残余风险；
  以及一条可复现命令。
- 脚本换版本（URL 变化）时，`probe:plugin-compat` 会比对三列并变红，逼着 inventory 跟着更新——
  「某人曾经读过一遍 minified 源码」不再是一次性的。
- 隔离变严：插件脚本失败不再能把地图带崩。代价是**失败变得更安静**（只有 `plugin:error` 事件与
  `getStatus() === 'error'`），迁移者如果原来「靠抛错发现插件没加载」，需要改成监听事件。
- **顺带修掉一个把失败报成成功的地方**：`BMap.vue` 的插件回执改以注册表状态为准。对调用方是
  **可观察的行为变化** —— 此前 optional 插件失败会发 `plugin-ready`，现在发 `plugin-error`
  （载荷里的 `error.cause` 是注册表记录到的原始错误）。依赖「收到 `plugin-ready` 就认为插件可用」
  的代码此前就已经是错的，这次只是让它显形。
- `plugins: ['GeoUtils']` 开始真的加载脚本（此前是静默空实现）。对既有使用者是行为变化：
  原先它什么都不做也不会失败，现在它会插一个 `<script>`，失败时发 `plugin:error`。

**回滚**：本条决策只影响插件层的数据、文档与 `required` 标志。回滚方式是把
`compat-inventory.ts` 与生成物删除、`builtins.ts` 的 `required` 改回原值，并回滚 catalog 的两条
`description`——不涉及 SDK 加载路径、公共类型与发布契约。`GeoUtils` 名字表条目如需回滚，
删除该条目即可（其余行为不变）。

## 已知限制

- **运行时读数只覆盖「最小路径」**：每个插件只跑了「构造 + 一次真实调用」，没有覆盖完整功能链路
  （DrawingManager 实际画一个圆/多边形、TrackAnimation 的 `pause` / `continue` / `setSpeed` /
  播放到结尾、GeoUtils 各谓词的签名语义、MapVGL `View` 构造失败的根因）。把这些搬进 CI / nightly
  的插件页仍属 #43。**「构造成功」不等于「功能可用」，读数里不这么写也是刻意的。**
- **插件加载没有超时**：`urlPluginDefinition` 的 `loadScriptWithExport` 只认 `AbortSignal`
  （`scope.signal`），脚本服务器「不响应也不报错」时 `whenPlugin` 会一直挂着。本轮只保证
  「失败被隔离」，**不保证**「挂起被隔离」。加超时属于加载层语义，需要单独决策。
- **实例成员没有被自动校验**：`probe:plugin-compat` 只做命名空间级存在性核对（`BMapGL.<Member>`）；
  `Map#getViewport` 这类实例成员是**人工**对照声明核对的（见各条目的 `manualInstanceChecks`）。
  上游若新增一个不存在的实例方法调用，nightly **不会**报——owner/member 级的 AST / 类型校验属 #43
  与工具收敛项，本轮采用「收窄口径 + 结构化区分」而不是硬做一个不可靠的推断器。
- **探针的三列抽取是文本级的**：它从 minified 产物里按正则抽，对「换一种写法但语义相同」的脚本
  可能漏读（保守方向是少报，不会假绿）。`exposedGlobal` 的核对也只证「脚本会创建这个全局」，
  不证「它挂在 window 上」。
- **`types/BMapGL/lib.d.ts` 里 `GeoUtils` 的 legacy 声明与真实脚本不符**
  （声明成 `new GeoUtils(map, options)` 的类，实际是静态谓词命名空间）。本轮只把差异写进清单，
  不在 `#26` 之前动那份 legacy 声明面。
- **`selfInjectedMarkers` 是子串核对**，不做语义判断：DrawingManager 与 MapVGL 运行期自行注入
  外部脚本这个事实被记录了，但那些脚本仍然绕过本库的加载 / 取消 / 清理路径。
- **对照时发现、本轮刻意不处理的一件事**：同源参考实现 `huiyan-fe/react-bmap` 里有
  `src/components/Overlay/Marker3D.tsx` 与 `MapMask.tsx`，两者的注释与实现都写的是**原生构造器**
  （`new SDK.Marker3D(point, height, opts)`、`new SDK.MapMask(path, opts)`），而本库把
  `overlay.marker-3d` 与 MapMask 归在「官方 4.0.4 类型包未声明、官方参考也没有对应章节」那条
  依据上。两条依据至少有一条要修正——但它属于 Overlay Facet 的决策
  （[v4 Overlay Facet](./2026-09-11-jsapi-v4-overlay-facet.md)），不在 `#25` 的保留项里，
  因此本轮只登记事实与出处，**不改 capability 状态、不改实现**，留给后续单独开票。

## 非目标

- 不为任何插件写 Vue 组件或 Driver 装配入口（`plugins` 只负责加载脚本）；
- 不恢复 MapVGL 的支持，也不为通过门禁去动 SDK 的私有回调表；
- 不交付插件浏览器页（属 #43）、不改 SDK 加载与冲突域、不发布 Stable；
- 不修改 `#67` 分支留下的任何实现（该分支已停止合并，仅作旧实现副本保留）。

## 参考

- issue #25（M3A.3 默认切换，本 ADR 收口其 `M3A3-07` 保留项）
- ADR [Official-first：默认加载委托官方 Loader、标准 UI 委托官方 UI Kit](./2026-09-13-official-first-loader-and-ui-kit.md)
- ADR [删除 SDK 私有面嗅探](./2026-09-13-private-sdk-surface-removal.md)
- ADR [v4 required smoke 的交付形态与判定口径](./2026-09-13-v4-required-smoke.md)（决策 2 的隔离口径、已知限制里的插件页欠账）
- `docs/zh-CN/contributing/plugin-compat-inventory.md`（生成物）、`docs/zh-CN/contributing/capability-matrix.md`
- 同源参考实现 `huiyan-fe/react-bmap`：本轮用它的 `src/drivers/capabilityMatrix.ts` /
  `src/drivers/unsupported.ts` 核对「一个官方封装如何落能力清单」，并据此确认**它也不提供
  MapVGL / TrackAnimation / DrawingManager / GeoUtils 的封装**——同源封装同样把这四个留在外面，
  说明「不自研、也不假装支持」是对的，但**必须把结论写出来**，这正是本 ADR 的由来。
