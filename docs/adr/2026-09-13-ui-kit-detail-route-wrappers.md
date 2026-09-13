# ADR 2026-09-13：`./ui-kit` 的详情 / 路线 Vue 封装与「上游声明了但没实现」的处置

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`UIKIT-02`（issue #75，追踪 #12，收口目标 #25）
- 取代：ADR [2026-09-13 `./ui-kit` 子路径、宿主桥与「不消费上游类型入口」的类型边界](./2026-09-13-ui-kit-subpath-and-type-boundary.md) 的**决策 7**（「详情与路线：不提供 Vue 封装」）。该 ADR 的其余决策（子入口、类型自持与 `paths` 占位、宿主桥与释放顺序、换 Map 重建、布尔 props 显式默认值、CSS 显式引入）**继续有效**，本次不改写。
- 前置：ADR [2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)（决策 3、4、8）、ADR [2026-09-13 `./ui-kit` 子路径](./2026-09-13-ui-kit-subpath-and-type-boundary.md)
- 相关：`packages/baidu-map-gl-vue/src/integrations/ui-kit/**`、`tests/behavior/v3-ui-kit-place-detail.test.ts`、`tests/behavior/v3-ui-kit-route-plan.test.ts`、`tests/behavior/v3-ui-kit-widget-contract.test.ts`、`docs/zh-CN/guide/ui-kit.md`、`docs/zh-CN/contributing/official-packages.md`

## 背景

#73 把 `PlaceAutocomplete` / `PlaceSearch` 做成了薄封装，并**明确决策 7**：`PlaceDetail` /
`RoutePlan` 本轮不给 Vue 组件，只经公开的 `loadUiKit()` 逃生口原生使用。理由是当时它们
「没有经过 Vue 层的生命周期与事件契约设计」。

#75 要补齐这两格，让**四个标准 UI 都委托官方 UI Kit**。前一轮的架构（子入口 / 宿主桥 /
类型自持）已经验证可用，因此这一轮的工作量集中在两件事上：把两个 widget 的公开面**逐个
成员核实**后接进同一套桥；以及处理「上游声明了、产物里却没有实现」的选项 —— 这是 #73
没有遇到过的类型问题。

## 依据：锁定版本 `1.1.2` 的实测结论（发布产物，不是文档转述）

运行方式与完整表见 [`official-packages.md`](../zh-CN/contributing/official-packages.md)；
这里只列**决定本次设计**的那几条，全部可在 `node_modules/@baidumap/jsapi-ui-kit/dist/**`
里逐字复现。

| # | 结论 | 依据 | 对本次设计的影响 |
| --- | --- | --- | --- |
| 1 | `PlaceDetailOptions` 声明了 `layout?: 'default' \| 'compact'`，但 ESM 与 IIFE 两个产物里 `layout` / `compact` 各出现 **0 次** | 产物全文检索；声明在 `dist/types/options.d.ts` | **不暴露 `layout`**（决策 3） |
| 2 | `setPlace(uid)` 找不到该 uid 时不抛错、**也不发任何事件**：`fetchDetailByUid()` 里 `!n` 分支直接 `return`，`emit("load")` 在它之后 | `dist/jsapi-ui-kit.esm.js` 的 `fetchDetailByUid` | 文档与用例都写明「没有 `load` 事件」是合法结果；本库**不合成**一条空详情（决策 5） |
| 3 | `PlaceDetail` 没有错误出口：`fetchDetailByUid()` 无 `catch`，返回的 Promise 被丢弃 | 同上 | **不伪造 `error` 事件**；如实记录为已知限制（决策 5） |
| 4 | `RoutePlan` 的 `enabledTypes` 硬编码 `["driving"]`、`showTabs: false`；`switchType("walking"\|"riding"\|"transit")` 是 no-op + `console.warn('路径规划类型 X 未启用')` | 产物里的归一化函数 `Wa()` | **不暴露 `switchType()`**；`typechange` 转发但不可达（决策 4） |
| 5 | `search()` 先 `emit("error", e)` 再 `throw e`（同一个对象）；事件与拒绝对上游是同一件事 | `searchByType()` | 本库包成 `BMapError` 后也必须维持「同一条」（决策 6） |
| 6 | `result` **事件**载荷是 `{ type, start, end, plans }`，而 `search()` 的**返回值**是 `{ routeType, start, end, plans }` | 两处源码 | 本库统一成 `type`，并把这个改名单独写进类型注释（决策 6） |
| 7 | `RoutePlanSearchOptions.start` / `end` / `waypoints` 要的是**引擎原生点**（上游直接塞进请求） | 上游 `RoutePlanService` 入参 | 坐标一律经 Driver 的 `toRawPoint()` 转换，组件不碰 raw SDK（决策 7） |

`PlaceDetail` / `RoutePlan` 的构造前提与另两个 widget 一致：`options.map` 必传
（缺则 `X: options.map is required.`），且**构造之后不再读地图** —— 因此本库沿用「等 Map
ready 再构造、换 Map 重建」，但**不**为详情 / 路线承诺视野联动。

## 决策

### 1. 两个新组件沿用 #73 的全部形状，不引入第二套桥

`BPlaceDetail` / `BRoutePlan` 与另两个组件共同使用 `useUiKitWidget()`：独立 SFC、强类型
props、`ResourceScope` 释放、`generation` + `AbortController` 的异步窗口守卫、
「先逐条 `off` 再 `destroy()`」的释放顺序、`/ui-kit` 子入口导出（不进 manifest / resolver）。
**不建立 UI Driver / Runtime / EventBus 总体系**（沿用 Official-first 决策 3）。

**顺手把两件「四个组件共有」的事收回桥/模块，不留在 SFC 里各写一份**（都是 #75「四组件收口」
的一部分，语义不变、只是不再重复）：

| 事项 | 原来 | 现在 |
| --- | --- | --- |
| 「构造期输入变化 → 重建」的稳定串比对与 `watch` | 四个 SFC 各写一份 `constructorOptions` + `constructionKey` + `watch` | 桥接收 `constructorOptions()`，自己算稳定串并 watch。改重建口径只改一处，新组件也不会漏 |
| 上游失败 → `BMapError` 的映射（含 `ak=` 脱敏与「同一条错误」缓存） | `BRoutePlan.vue` 里约 45 行 | `routePlan.ts` 的 `createRoutePlanErrorMapper(component)` 工厂（缓存的生命周期仍跟组件实例走），SFC 只剩绑定 |

### 2. 构造期输入与运行期输入必须逐个成员分类，并且分类要写在 props 上

| 组件 | 构造期（变更即重建） | 运行期（有 setter，不重建） |
| --- | --- | --- |
| `BPlaceDetail` | `display` | `uid`（→ `setPlace()` / `clear()`） |
| `BRoutePlan` | `drivingOptions` | 无 |

`uid` **不是**构造选项，因此「挂载时就带 uid」这一最常见的情形必须由**构造完成后的镜像**
补上 —— 只 `watch(uid)` 会完全漏掉它。桥 watch 的是 `[widget, uid]` 组合，并用一个
`appliedUid` 记账：widget 换实例（重建 / 释放）时清零，避免「新 widget 是空的」「重复调用
同一个 uid」这两类错误。

`uid` 由「有值」变回「未设置」走 `clear()`，而**不是**重建。这与 `location` 的处理不同，
原因是上游的：
`PlaceDetail.clear()` 是有明确定义的公开方法（#70 已实测），而 `setLocation("")` 的语义未知。
**能否重建只取决于上游有没有公开入口，不取决于本库觉得哪种更好。**

### 2.1 驾车策略：自持一份「名字 → 数字」的常量表，而不是裸数字联合

`RoutePlanDrivingPolicy` 既是类型也是值（与 TS 枚举同形），调用方写
`RoutePlanDrivingPolicy.AVOID_CONGESTION` 而不是 `5`。理由：类型层只能挡住「取值集合」，
**挡不住「哪个名字对应哪个数字」**（`AVOID_CONGESTION: 4` 是类型合法的，运行时却把用户的策略
悄悄换掉），所以用一条契约测试把上游 `.d.ts` 枚举的成员解析出来逐项比对。

### 3. 上游声明了但产物里没有实现的选项，一律不暴露

`PlaceDetailOptions.layout` 有类型、没有读取点（依据表 #1）。**接收后忽略属于假支持**，
所以本库不提供该 prop，并在文档的「不支持项」里点名。这条由发布产物形状锁守着：
将来上游真把它做出来，`v3-ui-kit-widget-contract.test.ts` 会先红（同一用例还带正证守卫 ——
上游哪天把它从声明里删掉，也会红，避免我们继续讲一个不存在的东西）。

**反向的同类判断**（刻意**不**加约束）：`setPlace()` 的 POI 模式必须原样转发上游对象，
本库不为它的内部结构（`ext.detail_info.*`）背书。公共类型是
`string | PlaceDetailPlaceObject`，其中 `PlaceDetailPlaceObject` 就是 `object` 加一段文档 ——
**不收窄成 `Record<string, unknown>`**：调用方手上是 SDK 的 `LocalResultPoi` 这类 interface
（没有隐式索引签名），收窄会挡掉唯一现实的用法，却仍然挡不住「传了个错的 POI」。
一个既误伤正确用法、又拦不住错误的类型不是强类型。

### 4. `RoutePlan` 只开放驾车：不暴露 `switchType()`，`typechange` 照常转发

`switchType()` 在锁定版本里的每一种调用要么 no-op（`driving`）要么只 warn（其余），
暴露它就是给调用方一个做不到的承诺。但 `typechange` **照样绑定与转发** —— 事件是上游的
信息出口，本库不替调用方决定「这个事件你不需要」；它在锁定版本下不可达这一事实写进类型
注释与文档。

四类路线的 headless 能力（issue #39）**不受**这条限制，本库不得用 UI Kit 的驾车限制绑架它。

### 5. 不合成上游没有的信号：`PlaceDetail` 没有 `error` 事件

依据表 #2 / #3：uid 找不到 → 没有 `load`；请求失败 → 上游把 Promise 丢掉，没有任何出口。
本库的处置是**如实记录**：

- 文档写明「`setPlace(uid)` 是**发起**而不是**完成**；完成信号是 `load` 事件」；
- 「uid 找不到时不发事件」写成用例（对着发布产物的 `!n` 分支顺序锁定）；
- 「请求失败没有出口」写进本 ADR 的已知限制，**不**造一个 `error` 事件。

同理，`BRoutePlan` 的 `search()` 在**回包形状无法识别**时拒绝（`BMAP_SERVICE_FAILED`），
而不是返回一个空计划表 —— 「形状变了」与「真的没有路线」必须能分辨。

### 6. 事件载荷是自持的纯数据；同义字段只留一个名字

- 全部 DTO 自持（不引用 `@baidumap/jsapi-ui-kit` 类型），坐标统一 `{ lng, lat }`；
- `routeType` / `type` 归一成 `type`（依据表 #6）；
- `error` 事件的载荷与 `search()` 的拒绝是**同一条** `BMapError`（依据表 #5），
  用 `WeakMap` 按上游错误身份缓存，而不是「记住最近一次错误」这种会被并发覆盖的状态；
- `cause` 只挂**脱敏副本**（保留 `name` 与过了一遍 `redactAk` 的 `text`）：UI Kit 的请求 URL
  里带 `ak=`，而 `cause` 是对外出口（`toJSON()`、上报工具都会读），原样挂上游 Error
  等于把「已经脱敏的 message」再漏回去。

### 7. 坐标转换一律走 Driver

`start` / `end` / `waypoints` 由调用方给纯数据坐标或字符串；纯数据坐标经桥的
`toRawPoint()`（内部 `client.driver.geometry`）转成引擎原生点后再交给上游。
组件与 `integrations/**` 仍然不出现任何 raw SDK 符号（`pnpm check:raw-sdk` 把关）。

### 8. 「同源官方实现」当对照物，但只取可核对的结论

维护者建议参考官方 React 组件库 [`huiyan-fe/react-bmap`](https://github.com/huiyan-fe/react-bmap)。
核对结论：它依赖 `@baidumap/jsapi-loader`，**不依赖** `@baidumap/jsapi-ui-kit`，
它的 `PlaceDetail` 封装的是 `BMapGL.PlaceDetail` **服务**（`setData(uid)` + marker 锚定），
与本库要封装的 UI Kit widget 不是同一个东西。因此：

| 对照项 | 结论 | 处理 |
| --- | --- | --- |
| `ctorKey`（构造期输入进 key、其余走 setter） | 同源 | #73 已采纳，本次沿用（决策 2） |
| `stableStringify` 做依赖 key | 同源 | 本库 `canonicalKey()` 同口径（已存在） |
| 详情面板 = `BMapGL.PlaceDetail` 服务 | **不同源**（它不用 UI Kit） | 不参考其 API 形状；本库以 UI Kit 发布产物为准 |
| 路线规划 | **它没有 RoutePlan 组件** | 同上 |

把它当「同源实现」直接抄 API 会得到一个与 UI Kit 无关的组件 —— 这正是本轮要记录的判断。
对照表写进本 ADR 而不是只写在 PR 回复里，下一次有人问「为什么不用官方那套写法」时答案在仓库里。

## 后果

- 正面：四个标准 UI 走同一套宿主桥、同一套 DTO 口径、同一套释放与门禁；「上游声明了但没实现」
  这类**类型问题**有了明确处置（不暴露 + 形状锁 + 正证守卫）；`routeType`/`type`、事件/拒绝
  同一条、坐标经 Driver 这些容易各写一套的地方被固定下来。
- 负面 / 成本：详情面板没有错误出口这一上游缺陷由使用者承担；`typechange` 绑了一个在锁定
  版本下不可达的事件（成本只是 6 条监听里的 1 条，收益是不丢上游事件）；投影代码需要按契约
  测试维护（上游新增字段会先红）。
- 回滚：删除两个 SFC、`routePlan.ts`、`readers.ts` 里的引用与子入口的导出，并把
  `docs/zh-CN/guide/ui-kit.md` 的「详情与路线」一节换回 `loadUiKit()` 原生用法说明；
  不影响另两个组件、Driver / Facet / Client 契约与包出口形状。

## 非目标

- 不自研 POI 详情 UI、路线绘制算法或第二套请求调度。
- 不通过私有字段 / 隐藏输入框 / `querySelector` 内部 DOM 绕过上游没有的能力。
- 不为 `RoutePlan` 的公交 / 步行 / 骑行自建 UI（那是 #39 的 headless 通道）。
- 不改 `PlaceAutocomplete` / `PlaceSearch` 的既有行为（本次只在测试与文档上收口）。
- 不把「原生 widget 在真实 v4 上验证过」当成「wrapper 验证过」（见已知限制）。

## 已知限制（显式接受）

- **本票的验收项「四个 wrapper 均有真实 v4 操作、事件和 destroy 证据」不在本 PR 内满足**：
  本次交付的是「四组件 + 假 widget 记账 + 发布产物形状锁」，真机（真实 AK + 真实 v4）验收
  由 #74 用同一候选提交统一收口。本 ADR 不把「原生 widget 验证过」当成「wrapper 验证过」；
  PR #79（#73）留下的同一句话继续适用。
- **未对齐 #29（`MapHandle` / `BMapExpose` 定型）**：issue #75 的「类型冻结依赖」写明
  「实施可先于 #29 完成开始」，因此本 PR 只保证四个 wrapper 建立在当前的 `MapHandle`
  （`unwrapRaw()` + `client.driver.geometry`）之上；#29 定型后需要回来对齐四个 wrapper 的最终类型。
  这是**有意的欠账**，不是遗漏。
- **详情请求失败没有事件出口**：上游 `fetchDetailByUid()` 无 `catch` 且丢弃 Promise，
  失败只会在页面里留下 unhandled rejection。本库不伪造错误信号；需要「加载超时」语义的
  调用方请自行对 `load` 事件设截止时间。
- **快速重复调用不做去重 / 不取消**：`PlaceDetail` 的 `load` 载荷与 `RoutePlan` 的回包都没有
  「这是第几次请求」的标识，上游自己按后到者改写面板与缓存。本库**只丢事件**会造成
  「面板 vs 事件/返回值」错配，因此如实转发并在文档里写明；要按当前 `uid` 过滤请比对载荷里的 `uid`。
- **`RoutePlan` 只开放驾车**：`enabledTypes` 硬编码；`typechange` 不可达。四类路线走 headless。
- **`typechange` / `navclick` 的真实载荷未经真实 AK 验证**：`navclick` 的微信 `wx-open-launch-app`
  路径会按需注入外部脚本并挂 `document` 监听（#70 未纳入探针）；本库只做形状投影。
- **`PlaceDetailOptions.layout` 在本库不可用**：上游声明了但没实现（依据表 #1）。
- **`RoutePlan` 的 `getLastResult()` 返回的是投影结果**：投影失败时拒绝（不返回 `null`），
  因为「没有结果」与「形状不认识」必须能分辨。

## 参考

- issue #75 `[UIKIT-02][P1] 完成官方 PlaceDetail / RoutePlan Vue 封装及四组件 API、样式与类型收口`
- issue #73（`./ui-kit` 与两个薄封装）、#70（官方包发布契约）、#74（同一候选提交重新验收）、#39（headless 四类路线）
- ADR [2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)（决策 3、4、8）
- ADR [2026-09-13 `./ui-kit` 子路径与类型边界](./2026-09-13-ui-kit-subpath-and-type-boundary.md)（决策 7 被本 ADR 取代）
- 契约表：[官方包发布契约](/zh-CN/contributing/official-packages)
- 使用文档：[官方 UI Kit（`./ui-kit`）](/zh-CN/guide/ui-kit)
- 对照物：[`huiyan-fe/react-bmap`](https://github.com/huiyan-fe/react-bmap)（官方 React 组件库；**不使用** UI Kit，见决策 8）

## 评审后修订（PR #82）

> 决策本身保持冻结、不改写历史；下面是**同一决策范围内**的修正，全部来自 PR #82 的评审意见。

### 1. 桥的新字段必须是**可选**的（公共 API 兼容性）

`useUiKitWidget` / `UseUiKitWidgetOptions` 从 #73 起就是公开导出，因此首版把
`constructorOptions` 加成**必填**是一处破坏性变更（已有调用方升级后直接类型报错，
而 PR 正文当时还写着「无破坏性变更」）。现在它是可选的，缺省时桥**不安装**重建 watch。

**刻意不做的**：缺省时回退去用 `buildOptions()`。`buildOptions()` 里包含**有 setter 的运行期选项**
（`BPlaceAutocomplete` 的 `location`），拿它当重建依据会让「改城市」也重建，
把输入值 / 焦点 / 下拉展开一起吃掉 —— 那会静默改变老调用方的语义。四个官方 wrapper 继续显式传它。

### 2. `UiKitModule` 的索引签名保留（它是公开逃生口）

`loadUiKit()` 的定位就是「用上游还没被本库封装的成员时自己构造」，删掉索引签名会让
`uiKit[someName]` 这类已有写法报错（同样是破坏性变更）。首版想用它解决「上游新增成员查不出来」，
但那个问题**不该靠收窄公共 API 解决**：现在由契约测试对着上游 `.d.ts` 逐成员校验我们依赖的四个具名成员，
索引签名只负责「其余导出保持可达」。

### 3. 整批投影失败 = 形状漂移，不能退化成「空结果」

原实现只校验 `plans` 是数组，然后逐项 `collect()`。上游把 `plans` / `segments` 换成全新形状时，
逐项丢弃会让结果变成 `plans: []` —— 调用方读到的是「成功，但没有路线」，**与决策 5／6
禁止的假信号是同一类**。现在补了守卫：

| 位置 | 守卫 |
| --- | --- |
| `toRoutePlanResultDTO` | `plans` 必须是数组；**非空进、空出** ⇒ 返回 `null`（事件不发 / 动作按「形状无法识别」拒绝） |
| `toRoutePlanDTO` | `segments` 必须是数组（上游声明里是必填）；非空进、空出 ⇒ 该方案无效 |
| `toRoutePlanNavClickDTO` | `null` / `undefined` 是**合法缺失**（还没搜索过就点导航）；**存在却解析不出来** ⇒ 整条不发，不降级成 `null` |

「坏项局部丢弃」保留不变（空数组仍是合法的「没有分段」/「没有路线」）。

### 4. 本票 scope 的收窄（`Closes #75` 的依据）

评审指出 `Closes #75` 与实际验收状态不一致。按「收窄本票 scope + 在承接方补欠账」处理
（#72 的同款做法），已把两笔迁移写进 issue #75 正文与承接方 #74：

- 「四个 wrapper 均有真实 v4 操作、事件和 destroy 证据」→ 由 **#74** 用同一候选提交验收；
- 「最终类型与 #29 一致」→ #29 定型后对齐（issue 原文已写明「实施可先于 #29 完成开始」）；
- 组件「resolver 收口」在本票的含义是**确认不放进 resolver 并把这条写进文档与门禁**
  （ADR 2026-09-13 `./ui-kit` 子路径决策 1 早已决定 UI 组件不进 manifest / resolver），
  而不是新增 resolver 条目。
