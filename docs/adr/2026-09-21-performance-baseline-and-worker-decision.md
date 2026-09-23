# 性能基准与预算；Worker 不进实现（M6-PERFORMANCE / #37）

- 状态：Accepted
- 日期：2026-09-21
- 关联：issue #37（`M6-PERFORMANCE`）、#12（总追踪）、#34（批量点与 GeoJSON 适配）、#35 / #36（被基准
  考察的两个数据图层票）、#104（ownership-first 存量审计）、#98 / #99 / #101（「先取证、再决定要不要
  抽象」的三条先例）
- 取代范围：**不取代**任何 ADR。对两处**欠账**做收口：`2026-09-18-data-layer-manager-and-point-collection.md`
  与 `2026-09-19-native-point-layers-and-cluster.md` 都写过「不做 Worker 预计算与性能预算（#37）」——
  现在「预算与基线」已建立，「Worker」按证据判定**不引入**（下面决策 2）。

## 背景

issue #37 在 2026-09-19 被**开工前纠偏**过一次，那次纠偏决定了本票的形状：

> 顺序改为「**先证明主线程瓶颈，再决定是否需要 Worker**」，不先建设一个通用 preprocessing platform。
> ……如果没有任何一个预处理步骤达到需要迁出主线程的阈值，本票允许在阶段 A 收口，**不实现 Worker**。

因此本票的交付物不是「一个 Worker 基础设施」，而是**一套能回答那个问题的证据 + 一条会响的绊线**：

1. 固定数据集与 `100 / 1k / 10k / 50k` 基准；
2. 分步骤测（适配 / 过滤 / 聚合 / 组件路径），并记录机器、SDK（Fake）、数据集版本；
3. 保留内存、资源、包体趋势；
4. 把关键预算接进 CI（趋势门禁）并产出可读报告。

## 决策

### 1. 阶段 A 的交付形态：数据集 + 分步骤基准 + 报告 + 趋势绊线

| 落点 | 职责 |
| --- | --- |
| `tests/performance/dataset.ts` | 固定种子（LCG）的确定性数据集，前缀稳定（`makeItems(1000)` 是 `makeItems(50k)` 的前缀），80% 点聚在 32 个中心附近 ⇒ 聚合桶是真实存在的 |
| `tests/performance/preprocess.perf.test.ts` | 纯函数步骤：`scanValidItems`（过滤）/ `adaptPoints`（GeoJSON 适配）/ `cluster`（fallback 聚合）+ 校准工作量 + 坏数据路径 |
| `tests/performance/component-path.perf.test.ts` | 组件路径：挂载 / 换引用 / 样式 / 卸载 + 100 次替换的保留内存与资源趋势 + 响应式形态对照 + **四类原生图层 × 四种规模的 setData / style / 卸载矩阵**（§6，`#36` 交办的「大数据 setData/style/资源清理」欠账）。§6 的断言是**增量式**的：换引用必须恰好 `+1` 次 `setData` 且下发的是新那份引用；样式更新按 kind 正证（专页图层 `setStyleOptions` + `doOnceDraw`、扩展 API `setOptions`）——`includes()` 会被挂载阶段的调用满足，样式也要走 `style` prop（散成顶层字段只会落进 attrs），这两条都是评审第 2 轮指出的假绿 |
| `tests/performance/vitest.config.ts` | 基准专属配置：独立范围、**串行**、`--expose-gc`（理由见决策 5 与已知限制） |
| `tsconfig.tests.json` + `pnpm typecheck:tests` | 测试代码的类型门禁（评审 4）：`tests/**` 此前不在任何 typecheck 的编译范围里，`vitest` 只转译不检查类型 ⇒ 一个 `TS2554` 从 PR 里漏了过去。范围**只覆盖 `tests/performance/**`**（传递纳入 test-utils / src）；`tests/behavior/**` 与 `packages/**/*.test.ts` 有大量既存错误，全量纳入是另一张票的工作量 |
| `scripts/collect-performance-baseline.mts` | 采集 → 报告（含环境/数据集/包体/worker chunk）→ 与提交基线做趋势对比 |
| `tests/performance/baseline.json` | 提交的基线（归一化值 + 本机绝对读数 + 记录环境） |
| `.github/workflows/quality.yml` 的 `performance` job | 先 `build:v3`（包体读数前置），再跑同一条命令 |

判据分两类，**都不使用「单次本机毫秒」当硬阈值**（issue 非目标第 2 条）：

- **机器无关的比值**（真门禁）：`cost(50k) / cost(1k)` 相对纯线性（50×）给 8× 容差 ⇒ 抓 O(n²) 一类
  结构性超线性；`deepReactive / markRaw` 的替换成本比 ≥ 1.5 ⇒ 保住决策 2 的对照结论；
- **极宽的绝对上界**（绊线）：`PATHOLOGICAL_CEILING_MS`（预处理 500ms / 组件路径 2s），只抓数量级回归；
- **读进而非判据**：是否越过浏览器 50ms 长任务线（`*.exceedsLongTask`）、每项成本、包体、worker chunk。

### 2. 不引入 Worker（结论 + 证据）

**结论：按本票的判据（单次同步耗时是否**稳定**越过 50ms 长任务线）三个纯预处理步骤都不需要迁出
主线程；越过这条线的是「组件路径在 50k 上的整段交付（挂载 / 替换数据）」——而它的代价主体不是我们的
算法，是**在响应式上下文里读这份大数组**（决策 2 的对照与决策 4）。因此不实现 Worker、不定义消息
协议、不加 startup / queue / stale-result 治理。**

下表给**两台机器**：CI（GitHub runner：INTEL XEON 8573C × 4 / linux，**下表 CI 列读数的来源**）与
开发机（Apple M4 / darwin；这台机器常被别的会话压满，load 到过 260 所以给了区间）。
两台的结论一致，绝对值差 2 ~ 6 倍——这正是下面决策 5「跨平台不做门禁」的由来。

| 步骤（50k 项） | CI（linux/x64）min / max | 开发机（darwin/arm64）min / max | 越过 50ms 线 |
| --- | --- | --- | --- |
| `scanValidItems`（过滤） | 7.6 / 13.3ms | 3.3 ~ 4.9 / 6.2 ~ 12.5ms | 否 |
| `adaptPoints`（GeoJSON 适配） | 15.4 / 46.0ms | 9.1 ~ 24.0 / 19.5 ~ 49.9ms | 否（都在线下，极载时逼近） |
| `cluster`（fallback 像素网格聚合） | 6.8 / 7.4ms | 6.6 ~ 7.1 / 8.0 ~ 15.4ms | 否 |
| `BPointCollection` 挂载（含适配 + 首次 `setData`） | 95.6 / 109.6ms | 46.6 ~ 67.5 / 56 ~ 122ms | **是** |
| 数据替换（宿主用 `ref([...])`，深响应） | 214 / 229ms | 97 ~ 217 / 103 ~ 413ms | **是** |
| 数据替换（同一份数据 `markRaw` / `shallowRef`） | 19.5 / 34.9ms | 13.6 ~ 25.7 / 16.8 ~ 49.2ms | 否 |
| 100 次替换 @10k（保留内存 / 实例 / 订阅增量） | 0.15MB / 0 / 0 | **0.03MB / 0 / 0**（5 次一致） | —— |

**四类原生图层（GeoJSON 直通）在 50k 下的读数**（§6 的矩阵，CI 档）：挂载 1.1 ~ 2.3ms、
换数据 0.2 ~ 0.4ms、样式更新 0.3 ~ 0.6ms、卸载 0.1 ~ 0.6ms（line / fill / heatmap / track-line 四类，
每个组合都断言「1 个 SDK 资源 / 0 个逐要素覆盖物 / 换数据不换实例 / 卸载后归零」）。
把它们与 `BPointCollection` 的 47 ~ 68ms 挂载放在一起看，就是本票「成本在**适配层 + 响应式读取**、
不在图层内核」这句话的直接证据：同一份 50k 数据，直通路径比走适配层的路径便宜一个数量级。

口径三条，缺一条都会把表读错：

1. **绝对值受机器负载影响（近 2 倍）**，所以基线比较用的是**归一化后的比值**，`min` 与 `max` 都只是
   读数；「越过 50ms 线」这一列也因此是**读数**而不是判据（预处理那套里它以 `*.exceedsLongTask`
   出现在报告里；极载时 `adaptPoints@50k` 确实翻成过 `yes`）。
2. **比值是稳的**（这是门禁只用比值的原因）：同一轮里「深响应 / `markRaw`」的比值在开发机上是
   7.2× ~ 8.4×、在 CI 上是 **11.0×**（同一份代码，同一份数据）；「50k 每项成本 / 1k 每项成本」在
   开发机安静档 2.8×、极载档 5.4×（这条就是 `SLOPE_TOLERANCE = 12` 的来历）。
3. **每项成本**按安静档算，用于「这个步骤贵不贵」的直觉；它不参与门禁。

**为什么「组件路径越线」也不该用 Worker 解决**（三条，缺一条结论都不成立）：

1. **纯 JS 步骤远低于长任务线**（最大 24ms，安静档 9ms）：把它们迁到 Worker 的收益上限会被
   `postMessage` 的结构化克隆 + 线程 startup 吃掉；
2. **越线的代价是「读这份数据」**：同一份 50k 数据、同一个 `adaptPoints`，普通 / `markRaw` 输入是
   13 / 12ms，而深响应输入在组件路径里实测到 90 ~ 133ms（Vue 的 Proxy 读取 + 依赖收集；
   `component-path` §5 的常驻对照就是这条）。换 `markRaw` 之后整条替换路径从 ~120ms 掉到 ~14ms
   （比值 4.5 ~ 8.4×）。**Worker 也必须先把数据读出来再送过去**（`postMessage` 会遍历同一棵树），
   迁走不减这份成本；
3. **渲染本身不在读数内**（Fake 只记账、无真实浏览器），而 issue 的非目标明确禁止把 SDK 实例传进
   Worker ⇒ 用 Worker 换不到「重绘」那一块的时间。

**重新评估的条件**（满足任意一条就该重开这张票）：

- 某个**纯预处理步骤**在**同一台机器**上连续多次的 50k 单次耗时（不是某一次被抢占的采样）稳定越过
  50ms —— 报告里的 `*.exceedsLongTask` 连续为 `yes` 且 max 不再是孤立的离群点；
- 出现**有明确消费者**的新预处理 workload（例如线 / 面几何简化），且它的 before/after 数据表明收益
  大于 startup + 序列化 + chunk 体积成本；
- 真实浏览器档（非 Fake）证明 SDK 侧的 `setData` / 重绘是长任务主因，而官方的分片入口不够用。
  —— **#123 本轮已核（Apple M4 / Chrome 154 headless / JSAPI 4.0 / dataset v1 / 50k，#131
  评审后分窗口径，一次实跑；跑数时 load ≈ 186，绝对值偏高）**：
  Fake 对照窗（`setItems` → settle）`line` `setData` 1345ms、`fill` 7331ms，与同轮原生
  `prototype.setData` 返回墙钟 **1250 / 7228ms** 同量级 ⇒ **在分窗之后**才能说差值主体在
  SDK 返回；long task 主体在**另记的 `redraw` 窗**（最长 15.4s / 20.9s，不进 Fake 对照）。
  逐图层首帧：point 394ms、line 21.6s、fill 29.8s（独立 mount，高负载下）。
  **前半条已成立；「官方分片入口不够用」本轮未测**（本套只打读数、不评估官方分片 API）⇒
  整条**部分满足、待复核**——若要按本条重开 Worker 票，须先补「官方是否提供且不够用」的取证。

### 2b. 计划项与 issue 条目的映射（本票怎么对应 `M6-15` / `M6-16`）

本仓的计划键按票分段编号，每个键是本票**自己的一条范围项**。按范围纠正后的两阶段，本票的两个键
对应：`M6-15` = 阶段 A（性能预算与可重复基线，**已交付**）；`M6-16` = 阶段 B（Worker 协议与迁移，
**按证据不执行**，以决策 2 的结论收口）。

### 3. 不建通用 protocol / queue / adapter

issue 的验收补充要求「没有真实消费者的通用 queue/protocol/adapter 不进入公共或稳定内部契约」，
范围纠偏也点名禁止「先定义覆盖 GeoJSON/简化/过滤/聚类所有未来场景的通用 protocol 再去寻找消费者」。

本票因此**没有改动任何运行时源码**（`src/` 0 行改动）：没有消息格式、没有 TypedArray 布局、
没有 cancellation token、没有 queue/runtime。唯一的 `packages/**` 改动是**类型层**的四行修复
（`packages/test-utils` 里新门禁照出来的既存类型错误，见决策 1 的最后一行）——行为不变。真要迁移时，消息格式由**那一个**被证明有问题的
workload 决定（这也是 #104 的 ownership-first 口径：判据没有消费者就不建）。

### 4. 与官方 React 组件库（`huiyan-fe/react-bmap`）的对照

依据：`gh api repos/huiyan-fe/react-bmap`（描述即「官方 React 组件库」，`master`，2026-09-20 仍有提交）
的 tarball 全树 254 个文件：

| 维度 | 官方参考实现 | 本库 | 性质 |
| --- | --- | --- | --- |
| 有没有 Worker / 预处理线程 | **0 处**（全树大小写不敏感搜 `worker` 命中 0） | 同（本票结论） | 同源 |
| 有没有性能基准 / 预算 | 无（`scripts` 里没有 perf/bench 类入口） | 有（本票） | **本库更严** |
| 大数据的处理方式 | 图层组件直接吃 GeoJSON，`data` 变化 → `raw.setData()` | 同（`BLineLayer` 一族），另加一层 `Item[] → FeatureCollection` 适配 | 本库多一层 |
| 依赖面 | 只有 `@baidumap/jsapi-loader`（精确锁定见 ADR `2026-09-13-official-first-loader-and-ui-kit`） | 同 | 同源 |

对照的结论：**「不引入 Worker」这条结论与官方实现同向**（两家都把数据整包交给 SDK、都不做线程
卸载）；本库**比它多**的是两层：一层 `Item[] → FeatureCollection` 适配（`core/data/*`）与一套性能
预算（它没有）。那层适配恰好是本库唯一的逐项成本所在——同一份 50k 数据下，适配路径的每项成本是
GeoJSON 直通路径的 **19.6 ~ 36.6 倍**（`contrast.perItemRatio`，5 次采集；直通路径 0.03µs/项，
适配路径 0.18 ~ 0.48µs/项）。因此「要不要迁出主线程」在本库的真实形态是
**「适配层 + 响应式读取」**，不是「通用预处理平台」——这也解释了为什么本票不建平台。

### 5. 门禁口径：趋势是绊线，不冻结实现方式

- **归一化**：比较值是 `metric.min / calibration.min`（同一次运行里的固定校准工作量当分母），
  用来抵消机器速度差；绝对毫秒只进报告；
- **噪声地板**：归一化值低于 `0.1` 的指标（**0.1 是归一化单位**，绝对毫秒等价值 = `0.1 ×
  calibration.cpu`，随机器变：当前 CI 基线 32.83ms ⇒ ≈3.3ms、开发机 ⇒ ≈1ms；计时器分辨率 /
  单次调度量级）只进报告、不参与门禁——
  否则比 0.02ms 的读数只会得到假红。**同轮比值的两端也受同一地板约束**（拿亚毫秒读数当分母
  会把噪声放大成「形状变化」：实测 `adaptPoints@1k` 开发机 0.057ms / CI 0.29ms ⇒ 同一条比值差 3.3×）；
- **宽容阈值**：默认 5×（同平台内的机器差异 + 共享 runner 噪声的余量），它拦的是「一个数量级」的
  回退（例如新增一遍 O(n) 全量遍历）。**精细回归的审查**按 issue 的分工交给人工：每次 CI 都会把完整
  报告（含比值列）打进日志并留档为 artifact，审查节奏与责任人属维护者决定，本 ADR 只规定「看什么」
  （比值列 + 关键读数），不发明流程；
- **跨平台 / 跨 SKU 不做门禁**（评审 2 修准）：归一化比值**仍然不可比**——(a) 开发机与 CI runner
  之间差 2 ~ 6 倍；(b) **同一个 `ubuntu-latest` label 的两次连续推送**实测就是不同 SKU
  （`INTEL(R) XEON(R) PLATINUM 8573C` → `Intel(R) Xeon(R) 6973P-C`），连校准量都从 30.19ms 变成
  21.99ms（27%）；而且**校准量吸收不掉**（纯数字循环的 `min` 能在被抢占的间隙里找到空闲时刻，
  而分配密集的 workload 会整体退化）。实测反证：把基线冒充成本机录制时
  `replace.markRawArray@50000` 报出 39× 的**假回退**。
  ⇒ 判据取 **`platform + arch + cpuModel`**：与基线一致**才**做门禁；不一致时打印比值但只出报告，
  并在报告里记 `comparison.skipped`（不是静默跳过）。**5× 宽阈值不能把「不可比」变成「可比」。**
- **基线维护规则**（由上面那条推论出来，写进文档页）：**基线录在与门禁同一台/同一规格的机器上**。
  当前的提效基线是 CI 录制的那一份（机器身份记在 `baseline.json` 的 `machine` 字段与报告「机器」行里）；
  runner 换了 SKU 时，CI 会打印
  「本次不做趋势门禁」并继续出报告 —— 此时由维护者在**那台机器**上跑 `pnpm perf:baseline --update`
  重录（或决定改用固定规格的 runner）。**宁可明说不可比，也不要一个看起来生效的门禁。**
- **不把「有没有 Worker」写成判据**：验收补充明确要求「性能门禁关注趋势和回退，不把实现方式
  （Worker 与否）冻结成需求」。报告里记录 worker chunk 与运行时 `new Worker(` 的出现次数，但它们是
  **读数**——将来若按上面的重新评估条件引入 Worker，门禁不应该因此变红；
- **四态退出码**（「没跑」不能当成「通过」）：`0` 通过 / `1` 超阈值回退 / `2` 脚手架或判据失败 /
  `3` blocked（例如没有 `dist` ⇒ 包体读数无法采集）。CI 的 `performance` job 先 `build:v3`，
  因此 `3` 在 CI 里就意味着门禁没跑完。

## 已知限制

1. **Fake 档的重绘成本不在读数内**（本条只约束 Fake + happy-dom 那一套）：SDK 是 Fake
   （`setData` 只记引用）、环境无布局/合成/帧调度，读数**不能**外推成「50k 点在页面上要多久」
   （报告 `notMeasured` 与文档页同口径）。**真实浏览器档已取证（#123，2026-09-23 实跑，
   #131 分窗口径）**：`pnpm perf:baseline:live`（Apple M4 / Chrome 154 headless / JSAPI 4.0 /
   dataset v1 / 50k；跑数时 load ≈ 186）——逐图层首帧 394ms / 21.6s / 29.8s；Fake 对照窗
   `setData`：point 230ms（≈ Fake 254）、line 1345ms、fill 7331ms，同轮原生
   `prototype.setData` 返回 **0 / 1250 / 7228ms**（line/fill 的 delta 几乎由原生返回解释）；
   **long task 主体在独立 `redraw` 窗**（line/fill 最长 15.4s / 20.9s）。**无阈值**（0/2/3），
   nightly 上传 `live-performance-report` artifact。
2. **归一化只在同一「机器身份」内可比**：跨平台或跨 SKU（`platform + arch + cpuModel` 任一不同）
   **不做绝对值门禁**，只出报告（决策 5，实测差异 2 ~ 6 倍）；同轮比值层不受此限。基线的绝对值是**参考读数**，不是发布事实——同一台机器自己的读数在负载高低
   之间也有近 2 倍的差（见决策 2 的表），这是阈值取 5× 的原因。
3. **深响应数组的更新路径仍是长任务**（50k：开发机 97 ~ 217ms / CI 214ms；同一份数据换 `markRaw`
   是 13.6 ~ 25.7ms / 19.5ms）：本票只把它测出来并留下对照读数，落地见 **#124**。
4. **`路径简化` / 用户谓词过滤在本库不存在**（没有实现、也没有消费者）：因此没有它们的基准——不为
   凑清单先造一个能力（issue 的步骤清单里那两项按此登记）。
5. **保留内存只在 `--expose-gc` 下可信**：缺 `gc()` 时基准**直接失败**而不是静默降级——不强制 GC 的
   读数是未回收垃圾（实测 230MB+），会把「GC 还没跑」读成泄漏。
6. **`cluster` 基准测的是 fallback 聚合**（`core/data/gridCluster`）：原生聚合在 SDK 内部，
   它的成本不在本套范围内（也不该由本库负责）。
7. **泄漏门禁覆盖的是 Fake 记账的资源**：真实 SDK 往 `document` 上挂的监听由浏览器 smoke 覆盖
   （`2026-09-13-v4-required-smoke.md`、#74），两者不可互相替代。

## 欠账

| 欠账 | 依据 | 去处 |
| --- | --- | --- |
| 深响应输入在更新路径上的 ~100ms 长任务（50k） | 本票 §5 读数：同一函数对同一份数据，深响应输入 90 ~ 133ms（整条替换路径 97 ~ 217ms）vs `markRaw` 11 ~ 13ms（整条 13.6 ~ 25.7ms） | **#124**（第一步取证：在 `flush: "sync"` 的 watcher 里读深响应数组的依赖收集成本；候选方案 `pauseTracking` 或文档化 `markRaw` / `shallowRef` 指引）。**本票不做**：它改的是共享内核在响应式 effect 里的读取语义，需要自己的证据与回归面 |
| 50k 的**首次交付**本身就越过 50ms 线（挂载 46.6 ~ 67.5ms；线图层直通只 1.3 ~ 3.4ms） | 本票读数：一次性初始化成本，本票不做门禁（它是「一次性」而不是每次交互） | 若将来要支持更低端机器上的 50k 量级，优化的对象是这条（拆批 / 让宿主决定何时交付），不是 Worker |
| `<BMap>` 每次挂载两条开发期告警（`restrictCenter` 已丢弃 / `setTraffic` 已忽略） | 本票顺带观察：`restrictCenter` / `enableTraffic` 是布尔 prop，Vue 的「缺省即 false」转换让驱动侧看到 `false` 而非 `undefined` | 新票（`{ default: undefined }` 或驱动侧把 `false` 视为「未表态」）。本票不做：与性能无关，且属地图组件的选项语义 |
| 大数据量在**真实浏览器**里的重绘读数 | 本套只有 Fake + happy-dom | **#123 已闭环**（2026-09-23 实跑 `exit=0`，#131 分窗后复跑）：`pnpm perf:baseline:live` + nightly `live-performance` job；读数已回填已知限制 1 与文档页「真实浏览器档」——**setData / sdkSetData / redraw 三窗分账**，后续若要优化 line/fill 重绘须另开票（本票只读不写） |
| `packages/test-utils` 的 `id_changed` 事件载荷**形状未建模**（官方是字符串，替身按对象展开成字符下标字段） | 新门禁 `typecheck:tests` 照出来的既存类型错误之一；现无消费方读该载荷，因此按「不猜上游形状」留原样 + 显式注释 | 需要时再取证（要动它先量真实事件形状）；登记在此以免被当成已建模 |
| `size:baseline` 指向不存在的 `scripts/collect-package-size.mts` | 既有死脚本（本票把包体读数并进 perf 报告，未复用该脚本名） | 清理欠账：与其它死脚本条目一并处理 |

## 按 issue 的测试要求登记为「不适用」

issue 的「测试要求」有几条只在阶段 B（有 Worker）时才存在；本票按范围纠正在阶段 A 收口，因此它们
**不产生用例**，逐条登记如下（不静默省略）：

| issue 条目 | 处置 |
| --- | --- |
| Worker 取消和迟到结果 | 不适用：本票没有 Worker、也没有异步预处理任务。「cancellation / stale-result 只为实际异步任务存在」是验收补充第 4 条本身的要求 |
| 每个进入 Worker 的 workload 都有 before/after 数据 | 不适用：没有任何 workload 进入 Worker（阶段 B 未启动） |
| 10k/50k 数据主线程长任务对比 | 已交付：`preprocess.perf.test.ts` 的 `*.exceedsLongTask` 读数 + 每个规模的 `maxMs`；组件路径的 `mount.*.exceedsLongTask` 也在报告里 |
| 分开测「GeoJSON 解析 / 过滤 / 聚类 / **SDK setData / 重绘本身**」 | 前三项见 `preprocess.perf.test.ts` §1；**「SDK setData / 重绘本身」已由 #123 真实浏览器档取证**（#131 后分四窗：Fake 对照 `setData` / 原生 `sdkSetData` / paint `redraw` / 逐图层 `firstFrame`，delta 只用对照窗） |
| `#36` 交办的「四类原生图层的大数据 setData / style update / 资源清理」 | 已交付：`component-path.perf.test.ts` §6 的 line / fill / heatmap / track-line × 100 / 1k / 10k / 50k 矩阵（三个动作 + 卸载，逐个断言 1 个资源 / 0 个覆盖物 / 不换实例 / 归零）；`track-line` 的规模维度是**一条路径的顶点数**（官方只收单条 `LineString`） |
| 100 次数据替换后的资源 / heap 趋势 | 已交付：`component-path.perf.test.ts` §3（保留内存 0.03MB / 实例增量 0 / 订阅增量 0） |
| 包体与 worker chunk 体积 | 已交付：`perf:baseline` 的 bundle 段（dist 46 文件、运行时 787917 字节、worker chunk 0 个） |
| 性能脚本在 CI 环境稳定可复现 | 已交付：`quality.yml` 的 `performance` job 跑同一条命令；本机连续 5 次采集的比值在 5× 阈值内（`v3-performance-gate.test.ts` 守着「它真的在跑」） |

## 参考

- 基准与报告：`pnpm test:performance`（单跑基准）、`pnpm typecheck:tests`（测试代码的类型门禁）、
  `pnpm build:v3 && pnpm perf:baseline`（采集 + 报告 + 门禁）、`pnpm perf:baseline --update`（刷新基线）；
  说明见 [`docs/zh-CN/contributing/performance-baseline.md`](../zh-CN/contributing/performance-baseline.md)
- 承接票：**#123**（真实浏览器档的大数据读数）、**#124**（深响应输入的更新路径长任务）
- 官方参考实现：`huiyan-fe/react-bmap`（描述即「官方 React 组件库」，`master` 全树 254 个文件）——
  worker 关键词命中 0 处、`scripts` 里没有 perf/bench 入口；本库与它同为「数据整包交给 SDK」，
  多一层适配与一套预算
- 相关 ADR：[`2026-09-18-data-layer-manager-and-point-collection.md`](./2026-09-18-data-layer-manager-and-point-collection.md)、
  [`2026-09-19-native-point-layers-and-cluster.md`](./2026-09-19-native-point-layers-and-cluster.md)、
  [`2026-09-13-v4-required-smoke.md`](./2026-09-13-v4-required-smoke.md)
