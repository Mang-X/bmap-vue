---
"bmap-vue": patch
---

Map/model Vue-native 收口审计（#137）：四项逐条取证，**无公开行为语义变更**（两处内部对象改为惰性创建）

#137 的口径是「Vue owns Vue state; Core owns SDK state」，问内部是否还在用 React 的
controlled/uncontrolled 词汇与手写调度器。四项逐条核过，**结论是保留接线并把依据落到证据上**
——多数被怀疑的状态是外部资源状态或有冻结契约，Vue-native 覆盖不到。唯一改掉的是两处
**没人用的对象**（`isControlled`、告警去重 `Set`）的**分配时机**：公共返回类型一字未改，
告警次数一字未改，只是没人用到就不建。

**逐项结论**

| 项 | 结论 | 依据 |
| --- | --- | --- |
| ① Map model（`useControllableState`） | **保留接线，不迁 `defineModel` / `useModel`**；另把零消费者的 `isControlled` 与用不到的 `warned` Set 改为**惰性创建** | 父↔子那一腿**已经是** Vue-native（`value: () => props.center` 是对 props 的 getter + 普通 `emit`，即 `v-model` 展开形态，全库统一）；组件↔SDK 那一腿 `useModel` **不保存最后一次外部值**（受控 prop 摘掉后读到 `undefined`），也没有 `default*` 只读一次 / 容差相等 / `copy` / `reset` ⇒ 维持冻结语义**必须补 bridge state**。**复审补做真实原型并提交进仓库**（`mapModel.prototype.test.ts`，常驻 CI）：原型把 `useModel` 的**读、档位、写**三处限制各测成可复现的行为差异——真实非受控用法（`zoom` key 完全省略，`hasVModel=false`）下，`useModel` 读到的 `localValue` 是 Vue 自己的局部状态（读错、档位判错），且 `reset()` 无法同步它 ⇒ setter 的全局去重会把 reset 后的下一次真实交互**整个吞掉**（不 emit）。**没有公开 API 能补**：读、档位改取外部 prop；写按档位分流——**整个非受控档直接 `emit`**（一次性 flag 只修「reset 后恰好写回旧值」这个特例，序列 `11 → reset → 10 → 11` 仍漏）。即便如此，**把剩下的 `useModel` 写通道也换成直接 `emit`、再删掉它的声明，11 条行为用例仍全过**——它换不到任何可观察行为。且在**同等冻结契约**下每个 number 字段实际注册的 `ReactiveEffect` 是 **3 vs 2**（口径 `getCurrentScope().effects.length`）——**没有更省，反而多 1 个**。措辞纪律：这只能推出「没减少 effect」，**推不出**「更贵」。ADR `2026-09-14-map-controlled-state` §6.1 / §6.2 |
| ② MapRuntime retry / boot | **逐符号保留** | `mountStarted` / `bootTask` / `nextBootWaiters` / `deferredWaiters` / `containerUsableWaiters` / `assembledMap` / `whenMapCreated` 全部记**外部资源状态**（WebGL 句柄、0×0 容器、KeepAlive 下 `onUnmounted` 不触发），每个都有可翻红的行为用例。ADR `2026-09-14-map-handle-container-and-visibility` §5.1 给出逐符号消费者表 |
| ③ batching | **无缺陷可修** | 实测：一次父提交同改 center+zoom+heading+tilt ⇒ 4 个独立 `flush:'post'` watcher 与「单个四元组 watcher」**都是 4 次写入**。四个字段是**四条不同 SDK 命令**，批处理省不掉；`flush:'post'` 已拿到全部可得收益。ADR `2026-09-24-scheduler-batching-hot-path` §2.1 |
| ④ KeepAlive / 暂停 | **保留** | `onActivated` / `onDeactivated` 直接驱动 `keep-alive` 原因增删，本来就是 Vue-native；`disposed` 终态原因与容器门禁有真实 WebGL / 0×0 语义 |

**代码改动**（无公开行为语义变更）

- `useControllableState.ts` 文件头写清**归属边界**：「父↔子」归 Vue、「组件↔SDK」归本文件，
  并记录 `useModel` 对照取证的结论。
- **两处零消费者 / 用不到的对象改为惰性创建**（本票仅有的 runtime 收口）：
  - **`isControlled`**：库内零消费者，公共返回类型 `ControllableState.isControlled:
    ComputedRef<boolean>` **一字未改**（公共消费者照旧 `state.isControlled.value`），但 `get`
    取用时才建 ⇒ `<Map>` 这条路径不再为它分配。起因是复审八轮指出：「公共 API 必须保留该成员」
    与「`<Map>` 必须为它实例化 runtime」是两件被混成一件的事。
  - **`warned` 去重 `Set`**：唯一作用是「某条告警真的发生后记住 key」。正常生命周期里没有档位
    冲突、没有 `default*` 后续写入 ⇒ 一次都不会被碰；`<Map>` 四个视野字段等于每次实例化白扔
    **4 个 Set**。改为 `warnOnce` 里 `??= new Set()`。**告警行为是冻结的，不等于去重容器必须在
    构造期分配** —— 与 `isControlled` 同一条推理（复审九轮）。
  两条的用例都**直接数分配次数**，不数行为 / 不数 effect（`computed` 与「无告警」都数不出来）：
  只断言「缓存命中」或「告警次数」时，eager 版照样全过；改回 eager 实测均变红。
- `Map.vue` 四个视野模型调用点加注释：为什么刻意不用 `defineModel`。
- Fake v4 harness 新增两个领域读数：`interactions()`（开关当前状态）与 `interactionWrites()`
  （按 props 名的写入计数），供 ③ 的用例断言「同一次父更新里交互开关恰好下发一次」；
  `interactionWrites` 的名字归并对照 `FAKE_V4_INTERACTIONS` 封闭词表取交集（不从前缀猜），
  词表外的调用不会虚增计数。

**新增常驻行为用例**（三条，全部可翻红）

- `v3-component-scenarios` 的「同一次父更新同时改 center/zoom/交互开关：每项恰好下发一次、
  最终值一致」—— 改动的字段各恰好一次写入、未改动字段不跟着重写、同值重提交零新增命令。
  可翻红：把 `syncEnableProps` 多调一次 ⇒ 交互计数 +2 ⇒ 实测变红。
- `useControllableState.vsUseModel.test.ts`（A1–A5）—— 把「不迁 `useModel`」的依据从断言变成
  **会红的用例**：打的是本仓库已安装的 Vue（无网络、无凭据、进 CI），断言受控 prop 撤回后
  `useModel` 读到 `undefined`（⇒ 必须补 bridge state）、写「数值不同但在本库容差内」的值仍 emit
  （`hasChanged` 精确比较 ⇒ 无容差相等）等。Vue 升级若补上这些能力，用例变红 ⇒ ADR §6.1 必须重审。
  **可翻红**：A4 把判定换成容差相等、A3 反转断言，均实测变红。
- `mapModel.prototype.test.ts`（#137 的 Map model prototype，**提交进仓库**）—— 三条线路
  （A 现状 / B₀ 只 `useModel` / B `useModel` + 最小桥接）都手写 `defineProps`/`defineEmits`、
  props 形状一致，真实挂载后比较：① 唯一计数口径（`getCurrentScope().effects.length`，由 Vue
  自己记账，纠正了早先手数表漏掉 `useModel` 内部 `watchSyncEffect` 的问题）② A=2 / B₀=1 / **B=3**（补齐告警契约后）
  ③ A 与 B 的五项可观察行为逐项同构。
  **变异验证**（每条都在用例在场时做）：读改回 `model.value`、档位 watcher 改回 `model.value`、
  去掉 reset 边界的 emit 绕过——三条各让一条「`zoom` key 完全省略」的真实非受控用例变红。
  同理，**读值来源**也钉住：把读改回 `model.value` 或把档位 watcher 改回 `model.value`，
  各有一条「`zoom` key 完全省略」的真实非受控用例变红（`reset()` 归位、档位告警恰好一次）——
  `useModel` 的 `hasVModel` 看的是 vnode raw props 的 key 存在性，省略 key 时它读到的
  `localValue` 是 Vue 自己的局部状态，不是受控值。**写通道的 reset 边界**也钉住：去掉
  「`reset()` 后直接 `emit`」的绕过 ⇒ 该用例变红（A 收到两次 `update:zoom`，B 只收到一次）。
  序列 `11 → reset → 10 → 11` 那条 gate 另由两次变异各自钉住：写一律走 `useModel` ⇒ 上一条
  reset 用例红；退回一次性 flag ⇒ gate 序列红。
  ⚠️ 最后一个变异是**反面读数**且已写进 ADR：把剩下的 `useModel` 写通道也换成直接 `emit`、再删掉
  它的声明，**11 条行为用例仍全过**（只有 2 条 effect 计数变红）——所以现在的结论**不是**
  「B 是可用的 Vue-native 路线」，而是「`useModel` 无法作为完整写通道复现冻结的 reset 语义，
  改完之后它也不再是承重构件」。

**公共面不变**：`useControllableState` 的签名 / 返回形状、`<Map>` 的 props 与 `update:*` 事件、
ADR 决策 6 冻结的模型语义均未改动；`pnpm generate:api-diff:check` 与
`pnpm generate:capability-matrix:check` 均无漂移。
