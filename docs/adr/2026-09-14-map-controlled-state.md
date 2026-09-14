# ADR 2026-09-14：Map 视野的受控 / 非受控模型（多 `v-model` 与状态归属）

- 状态：已接受（Accepted）
- 日期：2026-09-14
- 计划键：`M4-STATE`（issue #27，追踪 #12，前置 #26）
- 取代（**只取代下列具体决策，不整份取代**）：
  - [ADR 2026-09-11 v4 Map Facet](./2026-09-11-jsapi-v4-map-facet.md)「迁移影响」表中
    `getHeading()` 行的处置「不要用 heading 做 round-trip 判断」——该条是当时「状态属 #28」的
    排期声明；视野状态由本 ADR（`M4-STATE`）承接，heading 的往返判定改为
    **环绕等价**（`-90 ≡ 270`）而不是禁止（见决策 3）。
- 相关：`packages/baidu-map-gl-vue/src/components/map/BMap.vue`、
  `packages/baidu-map-gl-vue/src/composables/useControllableState.ts`、
  `packages/baidu-map-gl-vue/src/core/utils/equality.ts`、
  `docs/zh-CN/components/map.md`、`tests/behavior/v3-bmap.test.ts`
- 对照物：官方 React 封装 `huiyan-fe/react-bmap@2.0.1`
  （`src/components/Map/Map.tsx`、`src/utils/pointEquals.ts`、`src/utils/useLatest.ts`）

## 背景

`<BMap>` 的 `center` / `zoom` / `heading` / `tilt` 原先只是「有默认值的 props + 四个 watch」：

1. `withDefaults` 给了 `center` 与 `zoom` 默认值 ⇒ **无法区分「父级传了」与「父级没传」**，
   于是谈不上受控 / 非受控，也没有 `v-model`（用户拖拽后父级拿不到回执）；
2. 四个 watch 各自手写 `===` / `lng === oldLng` 判等 ⇒ 真实 SDK 读回带浮点差时会产生一次
   多余的写命令；`heading` 更严重：v4 的 `setHeading(270)` 之后 `getHeading()` 返回 `-90`，
   线性判等会把同一个朝向判成「不一致」；
3. 初始化与后续更新混在同一个 prop 语义里（`initd` 时应用一遍、之后 watch 再应用一遍），
   没有「初次视野只执行一次」这条显式约束；
4. 没有 `defaultXxx`，想让父级只管初值、之后由内部状态接管是做不到的。

这个模型一旦发布就很难改（参考实现 `huiyan-fe/react-bmap` 的 `MapProps` 也是这么定型的），
因此本 ADR 先冻结规范与状态表，再由组件实现。

## 决策

### 1. 三态模型：受控值 > `default*` > 库默认视野

`center` / `zoom` / `heading` / `tilt` 共用一套优先级与判定：

| 模式 | 判定 | 生效值 | 用户交互 | `default*` 后续变化 | 受控值后续变化 |
| --- | --- | --- | --- | --- | --- |
| 受控 | 该 prop 为 `!== undefined` | 外部值 | 回写**内部状态**（model 镜像）+ `emit update:*` | 不适用 | 与地图当前值不一致时写 SDK |
| 非受控 | 该 prop 缺失，`defaultXxx` 存在 | 内部状态 | 同上 | **不生效**（dev 告警一次） | 不适用 |
| 缺省 | 两者都缺失 | 内部状态（初值 = 库默认视野） | 同上 | 不适用 | 不适用 |

注意「生效值」一列在受控模式下是**外部值**：用户交互只更新内部镜像并上报，最终以父级的值为准
（`ControllableState.value` 在受控模式下读外部值；`internal` 是镜像）。

库默认视野 = `center { lng: 116.403901, lat: 39.915185 }`、`zoom 14`、`heading 0`、`tilt 0`
（与 v2/v3 的 props 默认值一致）。因此**「什么都不传」的行为与旧版完全一致**，
但视野四字段从 `withDefaults` 里移除——`undefined` 是「非受控」的唯一判定依据。

`default*` 与 `center` 同时传入时**以受控值为准**（受控优先在所有路径上一致：`default*` 只影响
「首次解析」的兜底）。这里与官方参考实现**不同**：`react-bmap` 的首次视野取
`defaultCenter ?? center`（`Map.tsx:187`），两者同时传入时是 **default 胜出**；本库不跟随——
「受控值恒优先」是一条更容易讲清、也更少意外的规则，而且它在「模式切换告警」那套规则下自洽。

### 2. 初始化与后续更新彻底分离

- **初始化**：`MapRuntime.doMount()` 调 `driver.map.initializeView()`，一次性写下
  `centerAndZoom`（+ `setHeading` / `setTilt`），这也是 `resetView()` 复用的快照；
- **后续**：只允许 `setCenter` / `setZoom` / `setHeading` / `setTilt` 四个字段级命令。

**禁止**在后续更新里再用 `centerAndZoom`：它在已初始化的地图上语义接近「重置视野」，
会把 `zoom` 一起改掉（旧的实现已经避开了这一点，本 ADR 把它写成不变量并用断言锁住：
`callLog` 里 `centerAndZoom` 恰好出现一次）。

**禁止 deep watch / 引用比较 `center`**：父级传内联对象字面量时引用每次都变，受控写入会空跑。
watch 源是 `lng,lat` 两个标量（字符串形态取整串，并加 `s:` / `p:` 前缀避免两种形态互相碰撞）。

### 3. 回环抑制靠「读回现值 + 容差判等」，不靠来源标记

受控写入前**读回地图当前值**做容差判等，一致就不下命令；SDK 事件回写时，若读回值与应用后的
内部状态相等则不上报（不 `emit`）。由此得到两条自然收敛的闭环：

- 自身写入 → SDK 事件 → 读回值 == 刚写入的值 → 不上报；
- 用户交互 → 上报 → 父级 `v-model` 回写同一值 → 读回值 == 外部值 → 不下命令。

「读回再判等」这半步与官方参考实现**同源**（`react-bmap` 的四个受控 effect 同样先
`getCenter()` / `getZoom()` 再判等，见 `Map.tsx:265` / `:281`）。真正的差异在**事件侧**：

- `react-bmap` 额外维护 `internalUpdateRef` 布尔标记（写入前置位、`requestAnimationFrame`
  复位），SDK 事件回调在标记生效期间直接 `return`；本库**不用**这个标记——事件侧同样靠
  「读回值 vs 内部状态」判等收敛。
- 理由是标记把正确性绑在「事件是否恰好在某一帧内到达」上，而且它的失效方式是**静默**的
  （标记被提前复位 → 往返抖动，测试只看得到「命令数」这个间接读数）。判等则是领域事实。
- 代价：本库在「自身写入后 SDK 回读值确实变了」这种情况会如实上报一次
  （例如真实 SDK 把中心点吸附到别处，或 `setHeading(270)` 读回 `-90`——后者由**环绕判等**
  吸收，见下），而 `react-bmap` 会因标记生效而沉默一次。前者是真实状态差异，上报更诚实。

容差集中在 `core/utils/equality.ts`：

| 字段 | 判定函数 | 容差 | 依据 |
| --- | --- | --- | --- |
| `center` | `centerEquals`（逐坐标；字符串整串；跨形态永不相等） | `1e-7` 度（≈1.1cm） | 远小于任何真实视野差，大于 double 往返误差 |
| `zoom` | `numbersEqual` | `1e-6` | 用户可见的级别差至少 1e-3 |
| `heading` | `anglesEqual`（**360 环绕**取最小差） | `0.01` 度 | v4 `getHeading()` 返回带符号角（`270 → -90`） |
| `tilt` | `numbersEqual`（无环绕） | `0.01` 度 | tilt 合法范围 0..90，环绕会算错取值关系 |

非有限值（`NaN` / `±Infinity`）**不参与容差比较**（只有严格相等才算等），否则
`numbersEqual(NaN, NaN) === true` 会把「引擎读不出值」伪装成「值一致」。

**读回失败怎么办（评审第一轮 P2 修正）**：只忽略**明确允许**的错误码——资源已销毁
（`BMAP_RESOURCE_DISPOSED` / `BMAP_RUNTIME_DISPOSED`）或该能力在本引擎不可用
（`BMAP_CAPABILITY_UNSUPPORTED`），此时**不写下一条命令**（写命令只会抛同样的错）。
其余 `BMapError`（`BMAP_SDK_CALL_FAILED` / `BMAP_INVALID_ARGUMENT` / `BMAP_INVALID_POINT` /
`BMAP_HANDLE_FOREIGN`）与非 `BMapError` 的编程错误**一律上抛**：把「读错」归零成「读不到」
就是静默失效。原先的实现只写了注释（「读不到就不写」），代码却仍会往下调 setter——
注释与实现不一致比没有注释更糟。

### 4. `default*` 只读一次；模式实时判定；切换只告警不拒绝

1. `default*` **只在首次解析时读一次**，之后**任何**写入都不生效（值改变、从无到有、从有到无），
   且都会告警一次（每字段至多一次）——否则「用户拖到 A、父级重算 default 得到 B」会把用户操作
   静默吃掉；
2. 模式按「当前受控值是否存在」**实时**判定，**不冻结**在首次解析——`:center="loaded ? spot : undefined"`
   这种「异步数据到达后才开始受控」的用法必须能工作；
3. 模式切换**只告警、不拒绝**，且只在「切换会造成事实源歧义」时告警：非受控 → 受控且外部值与
   当前内部状态冲突时告警一次；受控 → 非受控时内部状态接管（保留最后一次外部值）并告警一次。
   父级把 `update:*` 的值原样写回（`v-model` 的正常闭环）**不告警**——判据是「值与内部状态是否冲突」，
   而不是「prop 是否存在过」。

告警经 `core/logger` 的 `devWarn` 输出（带 `[baidu-map-gl-vue]` 前缀与 `field` context），每字段每
方向至多一次。

**判定留在消费方，不在库的发布构建里定死**（评审第二轮 P2 的核心）：`devWarn` 读
`process.env.NODE_ENV`，由**消费方的**打包器 / 运行时决定开发还是生产。三档产物的处理不同：

| 产物 | 处理 | 依据 |
| --- | --- | --- |
| ESM（`dist/*.mjs`，npm 消费方） | **原样保留** `process.env.NODE_ENV` | 消费方打包器折叠（本仓实测：Vite app 构建与 dev server 都折叠 → dev `"development"` / build `"production"`）；Node / SSR 下它是真实环境变量 |
| IIFE（`dist/index.global.js`，`<script>` 直引） | 由该档构建配置 `define` 成 `"production"` | 浏览器里没有 `process`，留着就是 `ReferenceError`（见 `vite.config.global.ts`） |
| 仓库内 app 型消费者（docs / playground / browser smoke） | 什么都不用做（Vite 自动折叠） | 实测 dev server 与 build 都会替换，因此原先为 `__DEV__` 加的那些 `define` 已撤掉 |

`scripts/verify-package.mts` 用三条断言锁住这条链：ESM 产物保留标记、IIFE 无裸 `process.env`、
同一个产物在 `NODE_ENV=development` 下告警 / `NODE_ENV=production` 下静默（真正的 package-consumer
验证，跑在安装了 tarball 的 `fixtures/v3-consumer` 里）。

**两次试错（都记下来，别重犯）**：

- `__DEV__`（仓库既有的构建期常量）：在**库发布构建**里就是 `false` ⇒ npm 消费方拿到的产物已被 DCE，
  自己的 dev server 里永远看不到告警。这正是评审第二轮 P2 抓到的问题。
- `import.meta.env.DEV`：它需要 `vite/client` 的**环境类型** ⇒ 任何编译本包源码的 program 都被迫
  带上这份环境声明，仓库门禁 `tests/behavior/v3-ui-kit-widget-contract.test.ts`（`types: []`）
  直接报 `TS2339: Property 'env' does not exist on type 'ImportMeta'`。
- 因此选了「模块内 `declare const process` + `process.env.NODE_ENV`」：不带环境类型依赖，
  又是所有打包器都认的**可折叠标记**。

`logger.warn` 自身保持无门禁——它承载的是运行时故障（能力不支持、服务失败…），那是运维与使用者
都该看到的。

### 5. 事件订阅面：只订阅结束事件，四个 `update:*`

| 事件 | 触发 | 载荷 |
| --- | --- | --- |
| `update:center` | `moveend` | `{ lng, lat }` |
| `update:zoom` | `zoomend` | `number` |
| `update:heading` | `headingchange` | `number`（可能为负，`-90` ≡ `270`） |
| `update:tilt` | `tiltchange` | `number` |

**不订阅** `moving` / `zooming` 等中途事件：逐帧回写会让父级每帧重渲染，并与受控写入来回打架；
松手回弹（`dragend` 后 SDK 自己收敛）在中途事件上根本无法表达。订阅与是否受控无关——
非受控模式下这是「内部状态跟随用户操作」的唯一入口，`v-model` 的首次回写也走这里。

订阅经 `runtime.resources`（`ResourceScope`）记账，随组件卸载/`dispose()` 释放；订阅本身
复用 `EventDriver` 的「同 target+type 只有一个 raw 绑定」语义，因此受控更新与事件回写都**不重绑**。

### 6. `useControllableState` 作为公开 composable

issue #27 的目标写的是「实现**通用** `useControllableState`」，而 `src/composables/**` 是本库公开
composable 的唯一 barrel（`src/index.ts` → `composables/index.ts`，每个文件都在导出）。因此本 ADR
明确把它当作**公开 API 的一部分**（与 `useSdkResource` / `useBMapAsyncTask` 同级的通用原语）：
「通用」只有能被业务侧复用时才成立，而业务侧唯一的入口是包入口。配套动作是文档页
（`docs/zh-CN/hooks/useControllableState.md` + 侧边栏）与根入口导出用例。

**这是一步不可逆的承诺**（公共 API 不能悄悄收回），这也是它需要 ADR 的原因；反过来，
`BMap` 与业务侧自建受控字段共用同一套规则，比让每个调用方自己写一遍三态判定更安全。

它只负责状态语义（`value` / `internal` / `isControlled` / `initial` / `syncExternal` / `commit`），
**不碰 SDK**；写命令由组件在 watcher 里完成。

### 7. 与官方参考实现 `huiyan-fe/react-bmap@2.0.1` 的对照

| 维度 | `react-bmap` | 本库 | 处置 |
| --- | --- | --- | --- |
| 字段集合 | `center/zoom/heading/tilt` + `defaultCenter/…` | 同 | 同源（互相印证） |
| 加载器 | `@baidumap/jsapi-loader ^1.0.0` | 同（精确锁 `1.0.0`，见 #71 ADR） | 同源；本库锁精确版本 |
| 同时传受控值与 `default` | `defaultCenter ?? center`（**default 胜出**，`Map.tsx:187`） | 受控值优先 | **本库更严**：受控优先在所有路径一致（决策 1） |
| 初始化 | `centerAndZoom(...)` 一次；缺省 zoom `?? 11` | `initializeView` 一次；缺省 zoom 14 | 本库**保持既有默认 14**（不因引入模型而改默认值） |
| 后续更新 | 分开的 effect，`setCenter` / `setZoom` / `setHeading` / `setTilt` | 同 | 同源；本库把「不得用 `centerAndZoom`」写成断言 |
| 写入前的判等 | 先 `driver.getCenter()` / `getZoom()` 读回再比（`Map.tsx:265` / `:281`） | 同（读回 + 容差判等） | 同源（互相印证） |
| 事件回写的抑制 | `internalUpdateRef` 布尔标记 + `requestAnimationFrame` 复位 | 无来源标记：事件侧同样靠「读回值 vs 内部状态」判等 | **本库更严**：不依赖帧时序、失效可被测试抓到；代价见决策 3 |
| `center` 判等 | `pointEquals(1e-7)` | `centerEquals`（点容差 + 字符串整串 + 跨形态不等） | 同源（容差一致），本库补了字符串形态的判别 |
| `heading/tilt` 判等 | `Math.abs(a - b) > 0.01`（线性） | `anglesEqual`（heading 环绕）/ 线性（tilt） | **本库更严**：线性判等会为自身写入发出假的 `-90` |
| 对外通知 | `onCenterChange` / `onZoomChange` / … props | `update:center` / … + `v-model` | 框架语义差异（Vue 用 emit），不照搬 |
| 「加载期间（SDK 就绪前）到达的受控值」 | 建图 effect 在 `status === 'ready'` 时才运行，闭包里读到的是**当时**的 props ⇒ 天然不丢 | 初值在 setup 阶段被冻结成快照 ⇒ 会丢；由 ready 之前的 `syncControlledView()` 收敛（决策 8） | **本库补了这一步**（评审第一轮 P1） |
| 「用户交互后是否回退到受控值」 | 否 | 否 | 同源；写进「已知限制」 |

### 8. 加载窗口内的受控值：ready 之前按当前 props 收敛

四个 watcher 在 `map` / `client` 未就绪时会跳过写入（那时没有 map 可写），而首次视野用的是
**setup 阶段冻结**的快照。父级在「SDK 加载中」改 prop 是文档明确支持的用法
（`:center="loaded ? spot : undefined"`）：那次写入会被丢掉，之后 prop 不再变化 ⇒ watcher 不会
重跑 ⇒ 地图永远停在旧初值。因此 `boot()` 在 `runtime.mount()` 返回后、emit `ready` / `initd`
**之前**执行一次 `syncControlledView()`。

参考实现不存在这个问题：它在 `status === 'ready'` 时才建图，effect 闭包里读到的是**当时**的
props（没有 setup 期冻结的快照）。本库的快照是必要的（`initializeView` 与 `resetView()` 共用
同一份「首次视野」，见决策 2），所以用一次显式收敛把差距补回来——而不是把快照改成每次都读
当前 props（那会让 `resetView()` 失去「回到初值」的语义）。

**收敛必须同时覆盖非受控档**（评审第二轮 P1）：`apply*FromProps` 对 `undefined` 直接 return，
而加载窗口里也可能发生**受控 → 非受控**（内部状态接管、保留最后一次外部值），此时 watcher 之后
不会再跑 ⇒ 「内部状态 = A、地图 = 首次快照」永久分叉，正好违反决策 4 的第 3 条规则。
`convergeViewToState()` 因此把**生效值**（受控时外部值、非受控时内部状态）也写进地图：

- 判定用的是**可证明的前提**：调用点紧接 `initializeView`，而加载窗口内没有 map 可写 ⇒ 期间没有
  任何视野写入落地，因此「与首次快照相同的字段」一定已经在地图上（短路即可）。这条短路同时挡掉
  「字符串中心点无法与读回值判等」造成的假写入（`defaultCenter: "北京市"` 不会多出一条命令）。
- 它只跑在 ready 之前那一次：**watcher 路径不放宽**。非受控档在 ready 之后不会再分叉
  （内部状态由 `commit` 跟随 SDK），因此不需要——也不应该——让每次 prop 变化都写一遍。
- **ready 收敛只有这一条路径**（第三轮 P2）：早先的实现先跑四个 `apply*FromProps` 再跑
  `convergeViewToState`，字符串 `center` 会被写两次（字符串无法与读回的点判等，两次判等都失败）。
  现在 `syncControlledView()` = 四个 `syncExternal`（同步模式与镜像）+ `convergeViewToState()`，
  每个字段**至多写一条命令**。所谓「幂等」在字符串形态下本来就不成立（读回是点），因此判据换成
  更强的「与首次快照相同则短路」。

三个约束：

- 收敛走**字段级命令**（`setCenter` / `setZoom` / …），不是重跑 `centerAndZoom`——初始化仍然只
  发生一次，「后续 center 变化不重置 zoom」这条不变量在加载窗口里同样成立；
- 两条收敛路径都是幂等的（读回判等），所以「加载期间没变过」不会产生额外命令；
- 它只覆盖**视野**。`mapType` / 样式 / 交互开关 / 插件在 `boot()` 里已经是「按当前 props 应用」
  （`applyMapType` / `applyStyleProps` / `syncEnableProps`），不受这个窗口影响。

**相邻缺口（本 ADR 显式不覆盖）**：`defineExpose().retry()` 直接透传 `runtime.retry()`，重挂之后
既不会重跑 `applyMapType` / `syncEnableProps` / `bindViewEvents`，也不会做这次收敛。它属于
「重试 = 重新装配」这个更大的问题（重试后事件订阅也要重建），留给后续 issue，不在 #27 的面。

### 9. 可变值不共享引用：`copy` 是状态的一部分

`center` / `defaultCenter` 是**可变对象**。父级拿到自己的对象后原地改一个字段
（`spot.lng = 5`）不会触发 props 变化，却会顺着引用改到状态内部：初值、内部镜像、以及
`resetView()` 用的「首次快照」都会被一起改掉——「resetView 回到首次值」与「default 只读一次」
两条语义就此被绕过（更隐蔽的一种：内部状态被改成 X 之后，用户真的拖到 X 会被判成「没变化」，
于是**不 emit**）。

因此 `useControllableState` 增加 `copy` 选项（默认恒等），并在三处落库时使用：首次解析的初值、
`syncExternal`、`commit`。`<BMap>` 对 `center` 传 `cloneCenter`（字符串不可变，原样返回）。
另外，暴露的 `initial` 与内部 `internal` 也各自持有独立拷贝——前者会被组件当作长期快照持有，
共享同一对象会让其中一方的原地修改影响另一方。

「props 请换引用更新」是 Vue 的常规语义，组件不打算为原地 mutation 做补偿（那需要 deep watch，
本 ADR 明令禁止）；这里要做的是**让 mutation 不会静默污染内部状态**。

### 10. 「回到初值」的命令必须同时重置状态（`reset()`）

`resetView()` 是一个**命令**：它把地图视野移回首次快照。但它最初只管地图，四个 `ControllableState`
不动——而非受控档下内部状态就是事实源，于是出现（第三轮评审 P1）：

```
defaultCenter=A → 用户拖到 B   ⇒ 地图 = B、内部状态 = B、emit B
resetView()                    ⇒ 地图 = A、内部状态仍是 B
用户再次从 A 拖到 B              ⇒ commit(B) 判等为「没变化」⇒ 不 emit（真实操作被吃掉）
```

因此 `useControllableState` 增加 `reset()`：把内部状态恢复为 `initial`（经 `copy`），**刻意不 emit**
——重置是命令方决定的，不是用户交互或 SDK 回写。`resetView()` 在地图重置之后调用四个 `reset()`。

顺带冻结一条语义：**重置之后「受控 → 非受控」接管的是重置值**（而不是重置前的外部值），因此地图
不会被拉回重置前的位置。`resetView()` 是公开方法，这条语义与「命令方拥有最终决定权」一致：
命令执行后，状态与地图同源。

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 新增 `defaultCenter` / `defaultZoom` / `defaultHeading` / `defaultTilt` | 纯新增 | - |
| 新增 `update:center` / `update:zoom` / `update:heading` / `update:tilt` 事件 | 纯新增 | - |
| 新增公开 composable `useControllableState` | 纯新增（根入口） | 文档：`docs/zh-CN/hooks/useControllableState.md`；changeset 记为 `minor` |
| 视野四字段不再走 `withDefaults` | **无行为变化**：缺省档用同一组库默认视野 | 由测试锁定「什么都不传 ⇒ 库默认视野」 |
| prop 变化判定从严格相等改为容差 + 读回 | 极少写命令，可能少一次「看似必要」的写 | 属修正（`±1e-9` 抖动不再触发写） |
| SDK 加载期间到达的受控值现在会生效 | 之前会丢（地图停在旧初值），现在 ready 前收敛一次 | 属修正（评审第一轮 P1），无 API 变化 |
| 用法告警只出现在开发构建 | 生产产物里没有这几条提示 | 属修正（评审第一轮 P2） |
| `useControllableState` 新增 `copy` 选项 | 纯新增（可选） | 传可变对象时应当提供，见决策 9 |

**无破坏性变更**：公共 props / 事件的既有语义与默认表现保持不变。

### 回滚

回滚 = 撤销本 PR：`withDefaults` 恢复默认值、删除四个 watcher、`syncControlledView()` 与
`bindViewEvents` 调用、`core/logger.ts` 去掉 `devWarn`、`composables/index.ts` 去掉导出。
新增的 `default*` / `update:*`、`useControllableState`（含 `copy` 选项）若已发布，回滚需要按
破坏性变更处理（这也是它需要 ADR 的原因）。

## 已知限制（显式接受，带归属）

1. **不做「用户交互后强制回退到受控值」**。受控 = 外部变化驱动地图，不是「地图必须随时等于外部值」。
   代价：父级收到 `update:*` 却不更新自己的状态时，地图停在用户操作后的位置，直到该 prop 下次变化。
   官方参考实现同样如此；要「严格受控」需在中途事件上持续写回，与用户手势冲突。
2. **字符串 `center`（城市名）在用户交互后会被具体坐标取代**：`update:center` 的载荷永远是点。
3. **字符串 `center` 无法与读回值做等价性判定**：`getCenter()` 只给出点，而字符串要么是城市名、
   要么需要地理编码。因此字符串形态下读回守卫**恒不成立**，每次字符串值变化都会下发一次
   `setCenter`（这是「不假支持」的代价：我们并不知道自己是否已经在那座城市）。点形态不受影响。
4. **`heading` 的环绕容差是 0.01 度**：真实朝向差小于 0.01 度时不会写回（视觉上不可分辨）。
5. **`resetView()` 仍回到「首次解析快照」**，不跟随之后的受控值变化——这是既有语义
   （`resetCenter` 的 deprecated 别名也指向它）。
6. **未覆盖 Map 事件全集**（`moving` / `zoomstart` / 右键…）：属 issue #27 的非目标，
   由后续 issue 处理。
7. **`retry()` 之后不重跑装配**：`defineExpose().retry()` 只透传 `runtime.retry()`，重挂之后
   `applyMapType` / `syncEnableProps` / `bindViewEvents` / 视野收敛都不会重新执行（见决策 8 末段）。
8. **IIFE 档（`<script>` 直引）固定按生产处理**：那一档在构建时就把 `process.env.NODE_ENV` 折叠成
   `"production"`（浏览器里没有 `process`），因此它的使用者看不到用法告警。要按环境区分就得多发一个
   dev 文件（Vue 的 `vue.global.js` / `vue.global.prod.js` 做法），本库暂不引入。

## 验证

- `tests/behavior/v3-component-scenarios.test.ts`：M4-STATE 一组 **29 条**用例覆盖三态、初次视野只
  执行一次、`centerAndZoom` 不复发、0/0 与边界 zoom、相同值不写 SDK、浮点抖动、用户交互回写与
  父级回写闭环、heading 环绕、四个 `default*` 的失效、模式切换告警、受控值优先、不重绑与卸载归零，
  以及三轮评审补的九条：**加载窗口内的受控更新**、**加载窗口内「受控 → 非受控」**、
  **受控 center 原地 mutation**、**`defaultCenter` 原地 mutation**、**读回错误白名单**、
  **`resetView()` 状态同步**、**resetView 后的模式切换语义**、**字符串 center 的两条命令计数**。
  **放置理由**：issue 的「预计变更区域」把测试指向 `tests/behavior/v3-bmap.test.ts`，而
  `AGENTS.md` 明确要求「单一引擎的组件级场景写在 `v3-component-scenarios.test.ts`，用例只写领域
  语言、不碰字段名」。二者冲突时按 `AGENTS.md` 执行（预计区域是提示），为此
  `packages/test-utils/fake-v4-harness.ts` 补了领域读数：`view()` / `viewWrites()` /
  `simulateUserView()` / `subscribedEvents()` / `listenActivity()` /
  `deferredProvider()` + `releaseProvider()` + `mapsCreated()`。
- `packages/baidu-map-gl-vue/src/core/utils/equality.test.ts`：容差、环绕、`centerKey` 的 23 条单测；
- `packages/baidu-map-gl-vue/src/composables/useControllableState.test.ts`：三态、告警规则、`copy` 与
  `reset` 语义的 13 条单测；
- `packages/baidu-map-gl-vue/src/core/logger.test.ts`：`devWarn` 在 `NODE_ENV=development` 下输出、
  `production` 下静默的 2 条单测；
- `scripts/verify-package.mts`：**package-consumer** 三步验证（在安装了 tarball 的
  `fixtures/v3-consumer` 里跑）——ESM 产物保留 `process.env.NODE_ENV`、IIFE 产物无裸 `process.env`、
  同一个产物在 `NODE_ENV=development` 下输出告警 / `production` 下静默；
- `tests/behavior/v3-entry.test.ts`：根入口导出 `useControllableState`；
- **单点反证**（改坏一处即红，逐条实测并已还原，共 9 组）：
  1. heading 判等换回线性 + 去掉 `center` 的读回守卫 → 3 条例（相同值不写 SDK / v-model 闭环 /
     heading 环绕）失败；
  2. 去掉 ready 之前的 `syncControlledView()` → 2 条加载窗口用例失败；
  3. 去掉 `convergeViewToState()` → 1 条「受控 → 非受控」用例失败；
  4. 去掉 `copy: cloneCenter` → 2 条原地 mutation 用例失败；
  5. 把读回错误白名单放宽成「所有 `BMapError`」+ 读不到仍调 setter → 读回白名单用例失败；
  6. 在 `vite.config.build.ts` 里 define `process.env.NODE_ENV` → `verify-package` 的 consumer
     验证失败（development 下不再告警）；
  7. 去掉 `resetView()` 里的四个 `reset()` → 2 条 resetView 用例失败；
  8. 把 ready 收敛改回「两条路径叠加」→ 2 条字符串 center 用例失败；
  9. `default` watcher 恢复成「`previous === undefined` 直接 return」→ 「从无到有」单测失败；
- 门禁：`typecheck:v3` → `build:v3` → `check:public-dts` → `check:no-bmapgl` → `check:raw-sdk:tree`
  → `test:unit` → `smoke:v4:fixture` → docs 四件套 → `playground:build` → `pack:v3` + `verify:package`。

## 评审修正（2026-09-14 第一轮）

维护者评审给出 2 条 blocking + 2 条 P2，全部按事实核对后处理（对照见 PR #87 的回复）：

| 评审意见 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1]** SDK ready 前的受控更新会被丢掉 | **成立**：watcher 在未就绪时 return，初值是 setup 期冻结的快照，之后 prop 不再变化 ⇒ 永不重跑 | 决策 8：ready 前 `syncControlledView()` + 2 条延迟 Provider 用例 |
| **[P1/P2]** `initialViewSnapshot` / `defaultCenter` 没冻结 point 值 | **成立**：`initial` / `internal` 直接持有父级对象引用，原地 mutation 可改到快照与内部状态 | 决策 9：新增 `copy` 选项 + `cloneCenter` + 2 条 mutation 用例 |
| **[P2]** `readLiveView` 吞掉所有 `BMapError`，且读不到仍调 setter | **成立**：注释写「读不到就不写」，代码却会继续 setter | 决策 3 补充：白名单（disposed / capability）+ 显式 `return` + 1 条白名单用例 |
| **[P2]** 文档/PR 声称 warning 是 dev-only，但实现不是 | **成立**：`logger` 无 production gate | 决策 4 补充：告警改走 `devWarn`（`import.meta.env.DEV`，生产产物静态消除）——**改实现而不是改文档**，因为这几条是面向库使用者的用法提示，不该出现在最终用户 console |

评审未提、本轮一并记录的相邻缺口：`retry()` 之后不会重跑 `apply*` / `bindViewEvents` / 收敛
（见决策 8 末段，留给后续 issue）。

### 评审修正（第二轮，`<本次提交>`）

第二轮给出 1 条 blocking + 1 条 blocking-from-consumer-view，都成立：

| 评审意见 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1]** 加载窗口内「受控 → 非受控」后地图与内部状态分叉（`state.value = A` 但地图 = 首次快照） | 成立：`apply*FromProps(undefined)` 直接 return，ready 收敛只覆盖受控档 | 决策 8 补 `convergeViewToState()`（收敛目标 = 生效值）+ 1 条四字段用例（含「状态与地图一致」正证） |
| **[P2]** `devWarn` 对正常 npm 消费者永远不会出现（发布构建把 `__DEV__` 定死成 `false`） | 成立：`dist/*.mjs` 是发布产物，消费方的 dev server 拿到的是已 DCE 的代码 | 决策 4 改为「判定留在消费方」（`process.env.NODE_ENV`）+ `verify-package` 的 package-consumer 三步验证 + 2 条单测 |

第二轮同时确认：上一轮的 defensive copy / 读回白名单 / ready 前受控档收敛 / dev-only 方向都已修正。

### 评审修正（第三轮，`<本次提交>`）

第三轮给出 1 条 blocking + 2 条 P2，都成立：

| 评审意见 | 事实核对 | 处置 |
| --- | --- | --- |
| **[P1]** `resetView()` 只重置地图、不重置非受控内部状态 ⇒ 重置后再拖回同一值不 emit | 成立：只调了 `initializeView`，四个 `internal` 不动（`commit` 随后判等为「没变化」） | 决策 10：新增 `useControllableState.reset()`，`resetView()` 同步四个状态（不 emit）+ 2 条用例（含「接管的是重置值」语义） |
| **[P2]** 受控字符串 `center` 在 ready 收敛阶段被写两次 | 成立：`apply*FromProps` 与 `convergeViewToState` 叠加，而字符串无法与读回的点判等 | 决策 8：ready 收敛统一为**一条路径**（快照短路），每字段至多写一条 + 2 条字符串用例 |
| **[P2]** `default: undefined → defined` 被忽略时没有告警 | 成立：watcher 对 `previous === undefined` 直接 return，而文档承诺「default 失效会告警」 | 决策 4 §1 改为「任何后续写入（含从无到有 / 从有到无）都告警一次」+ 1 条单测 |
| PR 正文仍保留上一轮的 `__DEV__` / docs-playground define 描述 | 成立（描述与实现不一致） | 正文同步为「消费方 `process.env.NODE_ENV`」的最终形态 |

## 非目标

- 不在本 Issue 完成全部 Map events（本 ADR 只定义「视野回写」这一组）；
- 不暴露 raw `BMap.Map`；
- 不使用 deep watch 比较中心点；
- 不改 `centerAndZoom` 之外的 SDK 视野初始化路径（`MapRuntime.initializeView` 的语义不动）。

## 参考

- issue #27（`M4-STATE`，追踪 #12：稳定版阻塞项）
- 官方 React 封装 `huiyan-fe/react-bmap@2.0.1`：`src/components/Map/Map.tsx`（受控 effect 与
  `internalUpdateRef`）、`src/utils/pointEquals.ts`（`1e-7` 容差）
- JSAPI 4.0 `BMap.Map`：`centerAndZoom` / `setCenter` / `setZoom` / `setHeading`（返回带符号角）/
  `setTilt` 语义见 [ADR 2026-09-11 v4 Map Facet](./2026-09-11-jsapi-v4-map-facet.md)
- [ADR 2026-09-13 默认在线路径委托官方 Loader](./2026-09-13-default-online-loader-cutover.md)（加载器对照）
