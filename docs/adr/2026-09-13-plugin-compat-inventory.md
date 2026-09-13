# ADR 2026-09-13：插件兼容 inventory 与「必需功能不依赖插件脚本」的隔离口径

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`M3A3-07`（issue #25，追踪 #12）
- 相关：`packages/baidu-map-gl-vue/src/plugins/compat-inventory.ts`、`scripts/generate-plugin-inventory.mts`、`scripts/probe-plugin-compat.mts`、`tests/behavior/v3-plugin-compat-inventory.test.ts`、`docs/zh-CN/contributing/plugin-compat-inventory.md`、`packages/baidu-map-gl-vue/src/driver/capability/catalog.ts`
- 与既有决策的关系：不改动 [Official-first](./2026-09-13-official-first-loader-and-ui-kit.md) 与 [默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)；本文只补它们没有覆盖的一角——**第三方插件脚本**（`plugins: [...]` 加载的那四个）在 JSAPI 4.0 上的状态与隔离口径。

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

本机没有 AK / WebGL，因此「真实 4.0 运行时」这一档证据本轮**取不到**。本 ADR 要解决的不是
「凑一条证据出来」，而是让状态**如实**：查过的写成查过的，没跑的写成没跑的，并且把「怎么复现」
交给下一个人。

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
| `declaration` | 与官方 `@baidumap/jsapi-v4-types@4.0.4` 的**逐成员**核对（同一条命令的第二个落点） |
| `runtime` | 真实 JSAPI 4.0 运行时观察（需 AK + WebGL，仅 nightly / 手动） |

没跑过的档位不写进依据。这条是刻意的：把「声明面没缺口」说成「兼容」，是把结论说得比证据强。

### 3. 结论取值三种，`no-declaration-gap` **不等于**兼容

| 结论 | 含义 |
| --- | --- |
| `incompatible` | 有决定性依据说明它在 4.0 上不可用（必须给出决定性的私有面，见决策 4） |
| `no-declaration-gap` | 脚本引用的 SDK 成员在 4.0.4 声明里没有缺口、也没有私有面 |
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

### 5. 内置插件一律 optional

四个内置插件的 `required` 恒为 `false`：**必需功能不得依赖任何插件脚本**。插件脚本失败只发
`plugin:error` 事件，不抛给地图。

`required: true` 在 `PluginRegistry` 里是「失败即抛」，所以把它留给真正「没有它就不该继续」的
插件定义——目前一个内置插件都不属于这类。inventory 的 `required` 字段标成字面量类型 `false`，
把它改回必需必须同时改数据与用例，不会是一次悄悄的一行改动。

### 6. 能力与清单**双向互锁**

Catalog 里被标为 `unsupported` 的插件类能力，必须在 inventory 里有对应条目（否则「不支持」是一句
没有依据的话）；反过来，条目声明的能力必须真实存在于 Catalog。两个方向都由behavior 用例钉住，
并要求那些 `description` 指向 `plugin-compat-inventory` 而不是继续写「待定」。

### 7. 证据生成器需要网络，因此不进 PR 门禁

`pnpm probe:plugin-compat` 从锁定 URL 拉真实产物，抽三列（引用的 SDK 命名空间成员 / 私有面 /
副作用标记）、与官方声明逐成员核对、再与 inventory 比对。判定与退出码沿用
`scripts/probe-official-packages.mts` 的口径：

| 结论 | 触发 | 退出码 |
| --- | --- | --- |
| `pass` | 抽取结果与 inventory 完全一致 | 无 |
| `fail` | 不一致，或锁定 URL 返回 4xx | 1 |
| `blocked` | 网络 / CDN 不可用、超时、5xx | 3 |
| 脚手架失败 | 读不到数据模块 / 类型包 | 2 |

**`blocked` 不是通过**，只有 `0` 放行。它放在 nightly / 手工执行；PR 门禁只跑无网络的 `--check`。

### 8. 「插件页」仍归 #43，本轮不越界

[ v4 required smoke ](./2026-09-13-v4-required-smoke.md) 决策 2 已经定下「可选插件的噪声靠单独页面
隔离」，并把这个页面记成由 #42 / #43 承接。本轮交付的是**结论与隔离口径**，不是那个页面；
把插件脚本塞进 `tests/browser/jsapi-v4/main.ts` 会让跨域脚本异常直接染红必需链路，方向正好相反。

## 后果

- 读者打开 `docs/zh-CN/contributing/plugin-compat-inventory.md` 能看到：四个插件各自的
  锁定 URL、应暴露的全局、引用的 SDK 成员、私有面、副作用标记、关联能力、结论、依据档位与残余风险；
  以及一条可复现命令。
- 脚本换版本（URL 变化）时，`probe:plugin-compat` 会比对三列并变红，逼着 inventory 跟着更新——
  「某人曾经读过一遍 minified 源码」不再是一次性的。
- 隔离变严：插件脚本失败不再能把地图带崩。代价是**失败变得更安静**（只有 `plugin:error` 事件与
  `getStatus() === 'error'`），迁移者如果原来「靠抛错发现插件没加载」，需要改成监听事件。
- `plugins: ['GeoUtils']` 开始真的加载脚本（此前是静默空实现）。对既有使用者是行为变化：
  原先它什么都不做也不会失败，现在它会插一个 `<script>`，失败时发 `plugin:error`。

**回滚**：本条决策只影响插件层的数据、文档与 `required` 标志。回滚方式是把
`compat-inventory.ts` 与生成物删除、`builtins.ts` 的 `required` 改回原值，并回滚 catalog 的两条
`description`——不涉及 SDK 加载路径、公共类型与发布契约。`GeoUtils` 名字表条目如需回滚，
删除该条目即可（其余行为不变）。

## 已知限制

- **运行时档位仍然缺席**：四个插件的 `runtime` 依据本轮**一条都没有**。声明面与产物面都指向
  「没有硬缺口」，但真实 4.0 上的行为（尤其 DrawingManager 的 `new BMapGL.Overlay` 与
  TrackAnimation 的 `ViewAnimation` 私有成员）尚未证实。这属于 #43 的范围。
- **插件加载没有超时**：`urlPluginDefinition` 的 `loadScriptWithExport` 只认 `AbortSignal`
  （`scope.signal`），脚本服务器「不响应也不报错」时 `whenPlugin` 会一直挂着。本轮只保证
  「失败被隔离」，**不保证**「挂起被隔离」。加超时属于加载层语义，需要单独决策。
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
