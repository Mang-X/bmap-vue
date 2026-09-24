# 深响应大数组的更新路径：文档指引落地、`pauseTracking` 不落地（#124 深响应子问题）

- 状态：Accepted
- 日期：2026-09-24
- 关联：issue **#124**（本 ADR 只承接其**深响应子问题**）、**#37**（`M6-PERFORMANCE`，本 ADR 结算其欠账
  表的一行）、#134（#124 的前置，P0）、#34 / #35 / #36（数据组件与共享内核）、
  #104（ownership-first / evidence-before-abstraction 口径）
- 取代范围：**不取代任何 ADR**。**结算** `2026-09-21-performance-baseline-and-worker-decision`
  欠账表的「深响应输入在更新路径上的 ~100ms 长任务（50k）」一行（该行原指向 #124），并把该 ADR
  已知限制 3 的「落地见 #124」推进到本决策。原 ADR 按仓库约定（`README.md`：已接受即冻结）**不改写**，
  指向关系记在本文件。**范围限于「深响应大数组的读取成本」这一子问题**：#124 在 2026-09-23 被重新
  分类为 1.0 P1 / Stable 阻塞后新增的 Vue scheduler/batching 取证**不在**本 ADR（见背景与「非目标」），
  因此本文件**不**构成 #124 的整体收口。

## 背景

#37 的基准把一条越过浏览器 50ms 长任务线的路径测了出来：50k **深响应**数组（`ref([...])` 这类最常见
写法）换一次引用，组件路径要 97 ~ 217ms（开发机）/ 214ms（CI），而同一份数据换 `markRaw` 是
13.6 ~ 25.7ms / 19.5ms。ADR `2026-09-21-performance-baseline-and-worker-decision` 的已知限制 3 与
欠账表把落地交给 **#124**。

#124 的分层批注（2026-09-21）把范围钉死：

> 50k 深响应数组的长任务是真实性能欠账，但不应为了发布前“清零”贸然改变共享响应式语义。3.0 先明确
> 推荐 `shallowRef / markRaw + dataVersion` 的大数据用法；实现级优化必须有取证和回归后再落地。

**范围更新（2026-09-23，事实核对）**：#124 已被**重新分类**为
**1.0 Pre-release · P1 · Stable 阻塞：是**（前置 **#134**，P0，当前 open），并新增
**Vue scheduler/batching 取证**要求：对照 hot path 的 `flush:'sync'` vs 默认 pre vs post；在同一次
父更新同时修改 `data` / `style` / `visible` / `zIndex` 时记录 watcher callback / reconcile / SDK call /
recreate 次数；在这些取证之后再决定是否维持本文档结论。**那部分不在本 ADR 的范围** —— 本 ADR 只
结算旧版 #124 的「深响应大数组读取成本」子问题；#124 保持 open，直到 scheduler/batching 取证与结论
落盘。

本 ADR 就是那次「取证 → 决定」的落盘（限深响应子问题）。

## 取证（受控实验；Apple M4 / darwin / Node v24 / happy-dom，**不是提交基线**）

实验对象是 issue 指定的那条路径：`useNativeLayerResource.sync()` → `applyData()` →
`data.value(props)`（`BPointCollection` 家族里即 `adapt()`，一次 O(n) 的 `Item[] → FeatureCollection`
读取）。`pauseTracking()` / `resetTracking()` 只在**临时**变体里插入（包住 `data.value(props)`），
用同一个进程内交替的 A/B 读出来，实验后回退。

### 1. 成本分解（同一个 `adaptPoints`，50k 项）

| `adaptPoints` 的输入 | 耗时 | 说明 |
| --- | ---: | --- |
| 原始数组（raw） | 5.7ms | 算法本身 |
| `toRaw(深响应 Proxy)` | 4.5ms | 绕开 Proxy 与依赖收集 |
| 深响应 Proxy（**无** effect 作用域） | 26.5ms | ≈ issue 要求的对照「把 `adapt()` 挪到 watcher effect 之外」；+ Proxy get 开销（约 21ms） |
| 深响应 Proxy（在 `effect()` 里） | **87.2ms** | 等价组件路径；+ 依赖收集 / 依赖链维护（约 61ms） |
| 深响应 Proxy（在 `effect()` 里 + `pauseTracking`） | **34.4ms** | 只剩 Proxy get + 算法 |

### 2. 组件路径 A/B（真实挂 `BPointCollection`、50k 换引用；5 次采样取 min）

| 轮次 | 基线 | `pauseTracking` | `markRaw` / `shallowRef` |
| --- | ---: | ---: | ---: |
| #1 | 94.6ms | 33.4ms | 8.8ms |
| #2 | 90.0ms | 33.9ms | 8.3ms |
| #3 | 82.3ms | 33.4ms | 8.4ms |

### 3. 依赖削弱检查（issue 点名的风险点）

`adapt` 的深层读取被记在「调用时恰好处于活动状态的那个 effect」（组件路径里是子组件的 render effect）
上，属于**伪依赖**：原地改一个元素会让它重跑（`1 → 2`）；但父级 / 引用（`data`）/ `dataVersion` 的
依赖不受影响（父级 effect 恒 `1 → 1`）。`pauseTracking` 只是不再收集这些伪依赖（`1 → 1`）。原地改内容
若不递增 `dataVersion`，地图本来也不会更新（watch 指纹 = 引用 + `dataVersion`），因此这条「被削弱的
依赖」不承载任何用户可见行为。

### 口径（三个比值不是同一件事）

- 组件路径 A/B 里 `pauseTracking` 的收益是 **~2.7×**（90 → 33ms）；
- 同一轮 A/B 的「深响应 / `markRaw`」约 **10×**，与提交基线 CI 的 `contrast.reactiveOverMarkRaw`
  = **10.03**（`replace.reactiveArray@50000` min 207.98ms / `markRawArray` min 20.74ms）同量级；
- 文档 / 性能页引用的 **4.5 ~ 8.4×** 是提交基线里开发机的比值。
  三者机器与轮次不同，不是矛盾。

## 决策

### 1. (b) 文档指引是落地形态

大数据量请用 `shallowRef` / `markRaw`，原地改内容靠 `dataVersion`。引导落在三处：

- `docs/zh-CN/components/data.md`「大数据量：`shallowRef` / `markRaw`」（含可复制示例与代价边界）；
- `BMapDataProps.data` 的类型注释（IDE 悬停可见，`BPointCollection` / `BMarkerList` / `BMarkerCluster`
  以及三个点图层共用它）；
- `docs/zh-CN/contributing/performance-baseline.md`「一句话结论」指向同一处。

### 2. (a) `pauseTracking` 包裹 `data.value()` **不落地**

1. **公开边界与模块身份耦合**：`pauseTracking` / `resetTracking` 只从 `@vue/reactivity` 导出，
   `vue` 顶层**不导出**；而 Vue 经 `@vue/runtime-core` 对 `@vue/reactivity` 是**精确版本**锁定
   （当前 `3.5.42`）。库若直接依赖 `@vue/reactivity`，就绑定了它的**模块身份**：消费方一旦解析出
   两份实例，`pauseTracking` 切的是另一份的 `shouldTrack` ⇒ **静默失效**（不报错、也没有收益）。
   这正是本库一贯拒绝的「假支持 / 静默 no-op」形态。（本仓实验里版本恰好对齐所以有效，但发布后无法保证。）
2. **收益不达验收目标**：`pauseTracking` 只去掉依赖收集（~2.7×，90 → 33ms），Proxy get 仍在，离
   `markRaw` 的 ~8.5ms 还差约 4×，达不到 issue 验收的「与 `markRaw` 同量级」。要达同量级须 `toRaw`，
   而 `toRaw` 会改变**交给用户回调与事件载荷的对象形态**（原始对象 vs 响应式代理）并要在多个组件里
   分散改造，超出本票「只针对数据组件的 data 转换这一条路径」的范围。
3. **共享内核语义**：它改的是共享内核在响应式 effect 里的读取语义；#124 的分层明确「不应为了发布前
   清零贸然改变共享响应式语义」。

**供将来重开**：上面的依赖检查证明 (a) 本身**只丢伪依赖、是安全的**；若将来有一条**不依赖
`@vue/reactivity` 模块身份**的干净入口（或 Vue 公开导出暂停追踪的 API），可按本节的读数与回归面
重新落地。

### 3. (c) 不是主要形态

(c) = (a) + (b)。本 ADR 取 (b)；(a) 因上一条不落地，因此 (c) 不构成落点。

## 后果（含回滚）

- 深响应大数组**不换写法**就仍是长任务（50k：开发机 97 ~ 217ms / CI 208ms min）。本 ADR 把它从
  「未解释的欠账」变成**可预期、可规避的使用约束**。
- §5 的常驻对照（深响应 vs `markRaw` 比值 ≥ 1.5）继续作为可证伪的绊线：一旦 Vue 让追踪变便宜、或
  实现不再在 effect 里读数据，这条会红，要求回头更新本决策。
- **`tests/performance/baseline.json` 不重录**：本决策没有运行时源码改动（无公共 API / 类型形状 /
  运行时行为变化），提交基线仍是 CI 录的那一份，机器身份可比性不受影响；本节的 M4 读数是取证存证。
- **回滚**：产物全部是文档与 JSDoc（无运行时、无依赖、无测试基线改动）。回滚 = 删除对应的文档段 /
  JSDoc 引导并把本 ADR 标 `Superseded`，不需要动任何运行时源码、`package.json` 或 `baseline.json`。
- 官方 React 参考实现 `huiyan-fe/react-bmap` 也没有这类优化——React 不经过 Vue 的代理与依赖收集；
  差距来自 Vue 响应式模型本身，用文档指引让使用者绕开它。

## 非目标

- **不引入 Worker**（#37 ADR 决策 2 已有论证）；
- 不顺带改造其它组件的响应式读取（本 ADR 只针对数据组件的 `data` 转换这一条路径；
  `BMarkerList` / `BMarkerCluster` 的逐项 diff 读取不在范围内）；
- 不动「`data` 按引用比较 + `dataVersion` 表态」的既有契约（#34 / #35）；
- **不新增 `@vue/reactivity` 依赖**（这正是 (a) 不落地的首要理由）；
- **Vue scheduler/batching 的取证与决定不在本 ADR**：`flush:'sync'` vs pre vs post、同一次父更新同时改
  `data`/`style`/`visible`/`zIndex` 的 watcher callback / reconcile / SDK call / recreate 次数读数，
  属 #124 2026-09-23 重新分类后的新增范围（1.0 P1，前置 #134），留在 #124。

## 参考

- 承接范围：**#124 的深响应子问题**（#124 整体仍为 open，见背景「范围更新」）；被结算的欠账：**#37** 的 ADR
  [`2026-09-21-performance-baseline-and-worker-decision`](./2026-09-21-performance-baseline-and-worker-decision.md)
  （已知限制 3、欠账表、决策 2）
- 使用引导：[`docs/zh-CN/components/data.md`](../zh-CN/components/data.md)「大数据量」、
  [`docs/zh-CN/contributing/performance-baseline.md`](../zh-CN/contributing/performance-baseline.md)
- 基准与门禁：`pnpm test:performance`（§5 常驻对照）、`pnpm perf:baseline`
- 相关 ADR：[`2026-09-18-data-layer-manager-and-point-collection.md`](./2026-09-18-data-layer-manager-and-point-collection.md)、
  [`2026-09-19-native-point-layers-and-cluster.md`](./2026-09-19-native-point-layers-and-cluster.md)
- 官方参考实现：`huiyan-fe/react-bmap`（无同类优化）
