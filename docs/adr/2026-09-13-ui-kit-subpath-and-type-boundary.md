# ADR 2026-09-13：`./ui-kit` 子路径、宿主桥与「不消费上游类型入口」的类型边界

- 状态：已接受（Accepted）
- 日期：2026-09-13
- 计划键：`R25-D`（issue #73，追踪 #12，收口目标 #25）
- 取代：无。本 ADR 是 ADR [2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md) 决策 3 / 4 / 8 在 `./ui-kit` 这一格上的**落地细化**，不改变其结论。
- 前置：ADR [2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)（决策 3、4、8 与「已知限制」）、ADR [2026-09-10 raw SDK 边界](./2026-09-10-bmap-raw-sdk-boundary.md)
- 相关：`packages/baidu-map-gl-vue/src/integrations/ui-kit/**`、`packages/baidu-map-gl-vue/types/ui-kit/upstream.d.ts`、`scripts/raw-sdk-boundary.mts`、`tests/behavior/v3-ui-kit-*.test.ts`、`docs/zh-CN/guide/ui-kit.md`

## 背景

#70 把官方 UI Kit 的发布契约（版本、入口形状、四个 widget 的构造前提与释放路径）钉死之后，
#73 要把 `PlaceAutocomplete` / `PlaceSearch` 做成 Vue 薄封装。三件事立刻变成了必须定的架构问题：

1. **上游类型入口在本仓库不可消费。** `@baidumap/jsapi-ui-kit@1.1.2` 的 `types` 指向
   `dist/index.d.ts`，其链路上有 `/// <reference types="bmapgl-browser" />`，而
   `@types/bmapgl-browser` 只是上游**自己的 devDependency**。本仓库 `tsconfig.build.json` 用
   `skipLibCheck: false`，把上游声明拉进 Program 后实测直接报：
   `TS2688 Cannot find type definition file for 'bmapgl-browser'` 与一串
   `TS2833 Cannot find namespace 'BMapGL'`。
2. **上游包是 optional peer，且 import 即崩。** 它在模块求值期访问 `document`；
   消费方如果没有安装它，任何把它拉进产物图的静态 import 都会变成「打包期报错」。
3. **两个组件的公共类型与事件载荷不得泄漏 `BMap.* / BMapGL`。** `check:public-dts` 会拦，
   消费者也不该为了用我们的声明去装官方类型包。

此外实现阶段踩到两个具体陷阱，值得连同决策一起冻结：Vue 对 `Boolean` 类型 prop 的
「缺省即 `false`」转换，以及「卸载发生在两次 `await` 之间」的竞态。

## 决策

### 1. `./ui-kit` 是独立子入口，根入口不重导出 UI

两个组件**只**从 `baidu-map-gl-vue/ui-kit` 导出，不进入 `src/components/index.ts`（即 manifest →
`components/index.ts` → `Vue3BaiduMapGlResolver` 这条链），因为那条链还会被根入口与 resolver 引用。

判据是可测的，不是「约定俗成」：从 `dist/index.mjs` 出发遍历**相对导入闭包**，
闭包里不得出现 `@baidumap/jsapi-ui-kit`、UI Kit 运行代码标记或 `bmap-ui-` 样式
（`tests/behavior/v3-ui-kit-entry.test.ts`）。

代价是这两个组件**不受 `.vue` 自动导入（resolver）覆盖**（文档已显式说明）。
同时把 `integrations` 加进 `scripts/raw-sdk-boundary.mts` 的 `FORBIDDEN_SRC_DIRS`
（默认 `pnpm check:raw-sdk` 的扫描范围），使它与 `components` / `composables` 同属禁区，
避免「边界单一事实源」与 `AGENTS.md` 的表述漂移。

配套约束：`@baidumap/jsapi-ui-kit` 在库构建里**必须 external**。若把它打进 `dist`，
所有消费者都会被塞进一份 UI Kit 运行时，「不装也能用根入口」当场失效。

### 2. 依赖策略：exact optional peer + 运行时动态 import

- `peerDependencies` 精确锁定 `1.1.2`（无 `^` / `~`），`peerDependenciesMeta` 标记 `optional: true`；
- `dist/ui-kit.mjs` 里只留一个**字面量**的 `import("@baidumap/jsapi-ui-kit")`。
  specifier 写成变量会让打包器无法静态分析，产物里留下一个运行期解析的 bare specifier ——
  消费方既不会把它当 external，也不会打进产物，最终在浏览器里解析失败。
- 「optional」只意味着**不使用 UI 的消费者可以不安装**，不意味着它缺失时可以改走自研 UI。

### 3. 公共类型自持；**构建期不消费上游类型入口**

`src/integrations/ui-kit/types.ts` 用**结构化最小接口**描述我们真正调用到的成员，
坐标统一归一为 `{ lng, lat }`，事件载荷是纯数据 DTO。

构建期把 `@baidumap/jsapi-ui-kit` 用 `tsconfig.build.json` 的 `paths` 映射到一个空占位文件
（`types/ui-kit/upstream.d.ts`）。运行时行为完全不变，只是让「上游声明自身不可消费」不污染本包的类型检查。

**评估过的另外两条路线与不采用的理由**：

| 路线 | 不采用的理由 |
| --- | --- |
| 安装 `@types/bmapgl-browser` | `@types/bmapgl-browser@0.0.3` 是第三方手发包（作者 Junior2ran；npm 上并不存在被声明对象 `bmapgl-browser`，tarball 内也没有标准的包布局）。为一个 peer 的类型引用引入一份额外的全局 `BMapGL` 命名空间，会与本仓库精心治理的 `@baidumap/jsapi-v4-types` + augmentation 边界重叠。 |
| 打开 `skipLibCheck` | 会顺手放过整个仓库的第三方声明检查，代价远大于收益。 |

**代价与补偿**：结构化接口失去编译器对着上游声明的背书，因此补了一条用 TypeScript
编译器 API 的契约测试（`tests/behavior/v3-ui-kit-widget-contract.test.ts`）：
把官方声明当真值，断言「真实实例可赋值给我们的接口」，并带两条反证（签名放宽、凭空多出成员）
必须被抓到。运行时可用性由 #70 的真实探针（`pnpm probe:official`）覆盖。
这条检查第一次跑就抓出了 `setTypes(types: string)` 比上游 `'all' | 'city'` 过宽。

### 4. 宿主桥的职责与释放口径

新增 `src/integrations/ui-kit/useUiKitWidget.ts` 作为**唯一**的宿主/生命周期桥，
不建立 UI Driver / Runtime / EventBus 总体系。它负责：

- **构造前提**：等 `whenReady()`，把 `MapHandle` 经 `unwrapRaw()` 取出作为 `options.map`；
- **异步窗口检查**：每个 `await` 之后都重新确认「本次创建仍是当前有效的那一次」（generation + scope）。
  从最后一个 `await` 到 widget 落地之间**不留 await**，因此不需要构造完再补一次检查；
- **释放顺序**：先逐条 `off` 我们注册的公开事件，再 `destroy()` widget
  （上游负责撤自己 DOM 与自身监听，但不会替我们摘掉我们的 handler）；
  事件是**逐条绑定、逐条记账**的，绑定中途失败时走同一条释放路径，不留「半绑定且看起来可用」的实例；
- **失败口径**：`resource:error` 的载荷与动作 reject 的是**同一条** `BMapError`
  （`BMAP_UI_KIT_UNAVAILABLE` 表示无 DOM / 未安装；`BMAP_RESOURCE_CREATE_FAILED` 表示构造失败；
  `BMAP_RESOURCE_DISPOSED` 表示组件已卸载）；
- **动作语义**：公开动作是 `async` 的，会等待就绪而不是静默 no-op。

### 5. 跟随 map handle 换代重建

桥 `watch` 地图上下文的 `map` ref：`<BMap>` 的 runtime 被重建（`retry()` / 重新初始化）时
handle 会换代，旧 widget 仍握着旧地图实例 —— 必须重建。重建是「先释放旧的、再构造新的」，
不并存。

### 6. 布尔 props 必须给与上游一致的显式默认值

Vue 的 `resolvePropValue` 对 `Boolean` 类型有 `isAbsent && !hasDefault → false` 的转换：
声明 `showSuggestion?: boolean` 而不给默认值，用户没传也会拿到 `false`，
照直透传就会把上游默认的 `true` 静默改掉。因此凡布尔 props 一律给显式默认值，
且默认值取上游默认值（`citylimit: false`、`showSuggestion: true`），并有专门用例锁定。

其余选项一律「显式给过才透传」：把 `undefined` 也传下去会覆盖上游自己的默认值。

### 7. 详情与路线：不提供 Vue 封装

`PlaceDetail` / `RoutePlan` 的原生可用性结论归 #70 的探针。本轮**不**给它们 Vue 组件，
也不用「看起来像组件」的壳子冒充完成；需要时经公开的 `loadUiKit()` 逃生口原生构造，
生命周期由使用者自己负责（文档给出示例与边界）。

### 8. CSS 由消费方显式引入

`./ui-kit` **不**自动引入官方样式表，也不把它塞进根入口；`UI_KIT_STYLE_PATH` 导出官方样式路径
供文档与代码共用，避免手写漂移。消费方需 `import "@baidumap/jsapi-ui-kit/dist/css/jsapi-ui-kit.css"`。

## 后果

- 正面：根入口的依赖面与 SSR 安全性完全不受 UI Kit 影响；公共类型自持、无 `BMap` 泄漏；
  三处最容易静默出错的点（卸载竞态、换 Map、布尔缺省）都有可观察计数支撑的用例；
  上游升级时契约测试会先红。
- 负面 / 成本：结构化接口需要按契约测试维护；`paths` 占位文件对本仓库之外的人不直观
  （已在文件头写明三条路线与取舍）；`./ui-kit` 的消费者必须自己引样式、自己装 optional peer。
- 回滚：删除 `./ui-kit` 入口与 `integrations/ui-kit` 目录、从 `package.json` 的 `exports` /
  `peerDependencies` 移除对应条目即可；不影响根入口、Driver/Facet/Client 契约。

## 非目标

- 不重写输入建议、结果列表、键盘导航、详情与路线面板的内部 DOM（那是上游的实现）。
- 不建立 UI Driver / Runtime / EventBus 总体系。
- 不为 `PlaceDetail` / `RoutePlan` 提供 Vue 封装（见决策 7）。
- 不通过 fork / patch 绕开上游的 SSR 限制与类型入口缺陷。
- 不把「装上了依赖」当成「集成成功」：运行代码与样式都必须有生产构建级别的证据
  （`tests/behavior/v3-ui-kit-entry.test.ts` 的真实 Vite 构建）。

## 已知限制（显式接受）

- 结构化接口与实际成员的一致性由本仓库的契约测试保证，而不是编译器 —— 上游新增成员不会被自动发现，
  但只要它**改签名或删成员**，契约测试就会红。
- **本库 wrapper 没有「真实 AK + 真实 v4」的端到端 smoke**。#70 的探针证的是原生 widget；
  wrapper 的真机验收留待 #74（用同一候选提交重新验收）。本 PR 不把「原生 widget 验证过」
  当成「wrapper 验证过」。
- 公共动作比上游同名方法多一层 `async`（等待构造就绪），签名不完全对齐。
- `RoutePlan` 在 `1.1.2` 只开放驾车（结论来自 #70）；`./ui-kit` 本轮不封装它。
- 主题与多地图共享、代理模式下的端到端可用性仍未验证（沿用 #70 的口径）。

## 参考

- issue #73 `[R25-D][P1] 接入官方 UI Kit：ui-kit 子路径与自动补全 / 地点检索 Vue 薄封装`
- ADR [2026-09-13 Official-first](./2026-09-13-official-first-loader-and-ui-kit.md)
- ADR [2026-09-13 上游类型包大小写引用缺陷的补丁处置](./2026-09-13-upstream-types-case-patch.md)
- 契约表：[官方包发布契约](/zh-CN/contributing/official-packages)
- 使用文档：[官方 UI Kit（`./ui-kit`）](/zh-CN/guide/ui-kit)

## 评审后修订（2026-09-13）

> 决策本身保持冻结、不改写历史；下面是**同一决策范围内**的修正，全部来自 PR #79 的审核意见，
> 在 follow-up PR 里落地。

1. **`highlight` 事件按上游真实形状投影。** 决策 3 只说「事件载荷是纯数据 DTO」，没有钉住形状：
   首版按 `{ index, value }` 投影，而上游 `1.1.2` 的真实载荷是
   `{ from: HighlightItem | null, to: HighlightItem }`（`moveActive()` 里 emit），
   于是事件在真实运行时被静默丢弃 —— 更糟的是夹具照抄了同一个错误假设，测试全绿。
   现在公开 `PlaceHighlightChangeDTO { from, to }`，并新增**发布产物形状锁**
   （`v3-ui-kit-widget-contract.test.ts`）：事件形状必须对着上游实现断言，不能对着夹具自证。
2. **构造期输入变化 = 重建 widget。** 桥新增 `rebuild()`；组件把上游没有 setter 的选项
   （`placeholder` / `debounce` / `minLength` / `showSuggestion` / `suggestionCount` / `display`）
   合成一个 `ctorKey`（`canonicalKey()` 排序序列化，内容相同的内联对象不触发重建），
   key 变化即重建。口径取自官方
   [`react-bmap`](https://github.com/huiyan-fe/react-bmap)：构造期参数进 ctorKey、其余走 setter，
   并用稳定串做依赖 key。原文档里「构造期选项变更需重新挂载」的说法作废（`BPlaceSearch` 同理）。
3. **`location` 只对「有值 → 未设置」重建，不猜隐藏语义。** 上游没有公开、也没有被验证过的
   「清除城市限定」入口（`setLocation("")` 的语义未知）。反方向（`未设置 → 有值`）与
   `有值 → 有值` 一样走已验证的 `setLocation()` —— `location` 本身是**有 setter 的运行期选项**，
   在它身上重建会清掉输入值 / 焦点 / 下拉展开 / 高亮项，而「异步拿到城市后再赋值」是常见用法。
   `types` 则不同：它的默认值就是 `all`，「改回未设置」= 恢复默认，用 `setTypes("all")` 表达，
   同样不需要重建。
4. **expose 的 `status` 改为取值 getter。** `defineExpose` 会被 Vue 的 `proxyRefs` 解包，
   runtime 读到的本来就是取值；现在声明与 runtime 对齐（`status: UiKitWidgetStatus`）。
   附一条反驳意见：审核建议的 `InstanceType<typeof Comp>` 消费者侧 smoke **判不出**这件事 ——
   Vue 的公开实例类型本来就会解包 ref，`ref.value.status.value` 在修复前**已经是**类型错误。
   有牙齿的证据是直接读 `dist/ui-kit.d.ts` 的断言（`v3-ui-kit-entry.test.ts`）。
5. **文档措辞**：`PlaceSearch` 的翻页是**API 而不是内置 UI**（上游只提供
   `prevPage` / `nextPage` / `goToPage`，没有翻页控件），文档不再暗示会自动出现翻页按钮。
