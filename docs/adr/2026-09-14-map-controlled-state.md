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

### 4. `default*` 只读一次；模式实时判定；切换只告警不拒绝

1. `default*` **只在首次解析时读一次**，之后变化不覆盖内部状态（否则「用户拖到 A、父级重算
   default 得到 B」会把用户操作静默吃掉），失效时 dev 告警一次；
2. 模式按「当前受控值是否存在」**实时**判定，**不冻结**在首次解析——`:center="loaded ? spot : undefined"`
   这种「异步数据到达后才开始受控」的用法必须能工作；
3. 模式切换**只告警、不拒绝**，且只在「切换会造成事实源歧义」时告警：非受控 → 受控且外部值与
   当前内部状态冲突时告警一次；受控 → 非受控时内部状态接管（保留最后一次外部值）并告警一次。
   父级把 `update:*` 的值原样写回（`v-model` 的正常闭环）**不告警**——判据是「值与内部状态是否冲突」，
   而不是「prop 是否存在过」。

告警经 `logger.warn` 输出（带 `[baidu-map-gl-vue]` 前缀与 `field` context），每字段每方向至多一次。

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
| 「用户交互后是否回退到受控值」 | 否 | 否 | 同源；写进「已知限制」 |

## 后果

### 迁移影响（对调用方可见）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| 新增 `defaultCenter` / `defaultZoom` / `defaultHeading` / `defaultTilt` | 纯新增 | - |
| 新增 `update:center` / `update:zoom` / `update:heading` / `update:tilt` 事件 | 纯新增 | - |
| 新增公开 composable `useControllableState` | 纯新增（根入口） | 文档：`docs/zh-CN/hooks/useControllableState.md`；changeset 记为 `minor` |
| 视野四字段不再走 `withDefaults` | **无行为变化**：缺省档用同一组库默认视野 | 由测试锁定「什么都不传 ⇒ 库默认视野」 |
| prop 变化判定从严格相等改为容差 + 读回 | 极少写命令，可能少一次「看似必要」的写 | 属修正（`±1e-9` 抖动不再触发写） |
| dev 期新增 3 类告警 | 只在开发期控制台 | 每字段每方向至多一次 |

**无破坏性变更**：公共 props / 事件的既有语义与默认表现保持不变。

### 回滚

回滚 = 撤销本 PR：`withDefaults` 恢复默认值、删除四个 watcher 与 `bindViewEvents` 调用、
`composables/index.ts` 去掉导出。新增的 `default*` / `update:*` 与 `useControllableState` 若已发布，
回滚需要按破坏性变更处理（这也是它需要 ADR 的原因）。

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

## 验证

- `tests/behavior/v3-component-scenarios.test.ts`：M4-STATE 一组 11 条用例覆盖三态、初次视野只执行
  一次、`centerAndZoom` 不复发、0/0 与边界 zoom、相同值不写 SDK、浮点抖动、用户交互回写与父级
  回写闭环、heading 环绕、四个 `default*` 的失效、模式切换告警、受控值优先、不重绑与卸载归零。
  **放置理由**：issue 的「预计变更区域」把测试指向 `tests/behavior/v3-bmap.test.ts`，而
  `AGENTS.md` 明确要求「单一引擎的组件级场景写在 `v3-component-scenarios.test.ts`，用例只写领域
  语言、不碰字段名」。二者冲突时按 `AGENTS.md` 执行（预计区域是提示），为此
  `packages/test-utils/fake-v4-harness.ts` 补了四个领域读数：`view()` / `viewWrites()` /
  `simulateUserView()` / `subscribedEvents()` / `listenActivity()`。
- `packages/baidu-map-gl-vue/src/core/utils/equality.test.ts`：容差、环绕、`centerKey` 的 23 条单测；
- `packages/baidu-map-gl-vue/src/composables/useControllableState.test.ts`：三态与告警规则的 9 条单测；
- `tests/behavior/v3-entry.test.ts`：根入口导出 `useControllableState`；
- 单点反证（改坏一行即红）：把 heading 判等换回线性、去掉 `center` 的读回守卫，三条例
  （相同值不写 SDK / v-model 闭环 / heading 环绕）立即失败并已还原；
- 门禁：`typecheck:v3` → `build:v3` → `check:public-dts` → `check:no-bmapgl` → `check:raw-sdk:tree`
  → `test:unit` → `smoke:v4:fixture` → docs 三件套 → `playground:build` → `verify:package`。

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
