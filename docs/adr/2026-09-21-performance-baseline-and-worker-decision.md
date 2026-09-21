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
| `tests/performance/component-path.perf.test.ts` | 组件路径：挂载 / 换引用 / 样式 / 卸载 + 100 次替换的保留内存与资源趋势 + 响应式形态对照 |
| `tests/performance/vitest.config.ts` | 基准专属配置：独立范围、**串行**、`--expose-gc`（理由见决策 5 与已知限制） |
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

下表是同一台 Apple M4 / Node 22.22 / happy-dom / Fake v4 / 数据集 v1 上 **5 次采集**的区间
（这台机器同时被别的会话压满时 load 到过 260，所以区间宽）：

| 步骤（50k 项） | 单次 min 区间 | 单次 max 区间 | 越过 50ms 线 | 每项成本（安静档） |
| --- | --- | --- | --- | --- |
| `scanValidItems`（过滤） | 3.3 ~ 4.9ms | 6.2 ~ 12.5ms | 否 | 0.07µs |
| `adaptPoints`（GeoJSON 适配） | 9.1 ~ 24.0ms | 19.5 ~ 49.9ms | 否（极载时逼近） | 0.18µs |
| `cluster`（fallback 像素网格聚合） | 6.6 ~ 7.1ms | 8.0 ~ 15.4ms | 否 | 0.13µs |
| `BPointCollection` 挂载（含适配 + 首次 `setData`） | 46.6 ~ 67.5ms | 56 ~ 122ms | **是**（临界 ~60ms） | 0.93µs |
| 数据替换（宿主用 `ref([...])`，深响应） | 97 ~ 217ms | 103 ~ 413ms | **是** | —— |
| 数据替换（同一份数据 `markRaw` / `shallowRef`） | 13.6 ~ 25.7ms | 16.8 ~ 49.2ms | 否 | —— |
| 100 次替换 @10k（保留内存 / 实例 / 订阅增量） | **0.03MB / 0 / 0**（5 次采集一致） | —— | —— | —— |

口径三条，缺一条都会把表读错：

1. **绝对值受机器负载影响（近 2 倍）**，所以基线比较用的是**归一化后的比值**，`min` 与 `max` 都只是
   读数；「越过 50ms 线」这一列也因此是**读数**而不是判据（预处理那套里它以 `*.exceedsLongTask`
   出现在报告里；极载时 `adaptPoints@50k` 确实翻成过 `yes`）。
2. **比值是稳的**：同一轮里「深响应 / `markRaw`」的比值在安静档与极载档分别是 7.2× 与 8.4×；
   「50k 每项成本 / 1k 每项成本」在安静档 2.8×、极载档 5.4×（这条就是 `SLOPE_TOLERANCE = 12` 的
   来历）。因此门禁只用比值。
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

### 2b. 计划项与 issue 条目的映射（本票怎么对应 `M6-15` / `M6-16`）

本仓的计划键按票分段编号，每个键是本票**自己的一条范围项**。按范围纠正后的两阶段，本票的两个键
对应：`M6-15` = 阶段 A（性能预算与可重复基线，**已交付**）；`M6-16` = 阶段 B（Worker 协议与迁移，
**按证据不执行**，以决策 2 的结论收口）。

### 3. 不建通用 protocol / queue / adapter

issue 的验收补充要求「没有真实消费者的通用 queue/protocol/adapter 不进入公共或稳定内部契约」，
范围纠偏也点名禁止「先定义覆盖 GeoJSON/简化/过滤/聚类所有未来场景的通用 protocol 再去寻找消费者」。

本票因此**没有改动 `packages/**` 的任何运行时源码**（`src/` 0 行改动）：没有消息格式、没有 TypedArray
布局、没有 cancellation token、没有 queue/runtime。真要迁移时，消息格式由**那一个**被证明有问题的
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
- **噪声地板**：归一化值低于 `0.05` 的指标（计时器分辨率量级）只进报告、不参与门禁——否则跨机器
  比 0.02ms 的读数只会得到假红；
- **宽容阈值**：默认 5×。基线录在一台机器上、门禁在另一台（CI 共享 runner）上跑，跨机器与共享
  runner 的噪声实测量级在「百分之几十 ~ 2 倍」，5× 让这层噪声不可能染红门禁，同时仍拦得住
  「一个数量级」的回退（例如新增一遍 O(n) 全量遍历）。**精细回归的审查**按 issue 的分工交给人工：
  每次 CI 都会把完整报告（含比值列）打进日志并留档为 artifact，审查节奏与责任人属维护者决定，
  本 ADR 只规定「看什么」（比值列 + 关键读数），不发明流程；
- **不把「有没有 Worker」写成判据**：验收补充明确要求「性能门禁关注趋势和回退，不把实现方式
  （Worker 与否）冻结成需求」。报告里记录 worker chunk 与运行时 `new Worker(` 的出现次数，但它们是
  **读数**——将来若按上面的重新评估条件引入 Worker，门禁不应该因此变红；
- **四态退出码**（「没跑」不能当成「通过」）：`0` 通过 / `1` 超阈值回退 / `2` 脚手架或判据失败 /
  `3` blocked（例如没有 `dist` ⇒ 包体读数无法采集）。CI 的 `performance` job 先 `build:v3`，
  因此 `3` 在 CI 里就意味着门禁没跑完。

## 已知限制

1. **真实 SDK 的重绘成本不在读数内**：本套的 SDK 是 Fake（`setData` 只记引用），环境是 happy-dom
   （无布局、无合成、无帧调度）。读数**不能**外推成「50k 点在页面上要多久」；同一段话写进了报告
   （`notMeasured`）与文档页。
2. **只有本机一个运行时**：跨机器只保证归一化比值成立（阈值 5× 就是为它留的余量）。基线的绝对值
   是**参考读数**，不是发布事实——本机自己的读数在负载高低之间就有近 2 倍的差（见决策 2 的表）。
3. **深响应数组的更新路径仍是长任务**（50k 下 97 ~ 217ms；同一份数据换 `markRaw` 是
   13.6 ~ 25.7ms）：本票只把它测出来并留下对照读数，见欠账表。
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
| 深响应输入在更新路径上的 ~100ms 长任务（50k） | 本票 §5 读数：同一函数对同一份数据，深响应输入 90 ~ 133ms（整条替换路径 97 ~ 217ms）vs `markRaw` 11 ~ 13ms（整条 13.6 ~ 25.7ms） | 新票（第一步取证：在 `flush: "sync"` 的 watcher 里读深响应数组的依赖收集成本；候选方案 `pauseTracking` 或文档化 `markRaw` / `shallowRef` 指引）。**本票不做**：它改的是共享内核在响应式 effect 里的读取语义，需要自己的证据与回归面 |
| 50k 的**首次交付**本身就越过 50ms 线（挂载 46.6 ~ 67.5ms；线图层直通只 1.3 ~ 3.4ms） | 本票读数：一次性初始化成本，本票不做门禁（它是「一次性」而不是每次交互） | 若将来要支持更低端机器上的 50k 量级，优化的对象是这条（拆批 / 让宿主决定何时交付），不是 Worker |
| `<BMap>` 每次挂载两条开发期告警（`restrictCenter` 已丢弃 / `setTraffic` 已忽略） | 本票顺带观察：`restrictCenter` / `enableTraffic` 是布尔 prop，Vue 的「缺省即 false」转换让驱动侧看到 `false` 而非 `undefined` | 新票（`{ default: undefined }` 或驱动侧把 `false` 视为「未表态」）。本票不做：与性能无关，且属地图组件的选项语义 |
| 大数据量在**真实浏览器**里的重绘读数 | 本套只有 Fake + happy-dom | 与 #74 的浏览器 smoke 通道合并（nightly 档） |
| `size:baseline` 指向不存在的 `scripts/collect-package-size.mts` | 既有死脚本（本票把包体读数并进 perf 报告，未复用该脚本名） | 清理欠账：与其它死脚本条目一并处理 |

## 按 issue 的测试要求登记为「不适用」

issue 的「测试要求」有几条只在阶段 B（有 Worker）时才存在；本票按范围纠正在阶段 A 收口，因此它们
**不产生用例**，逐条登记如下（不静默省略）：

| issue 条目 | 处置 |
| --- | --- |
| Worker 取消和迟到结果 | 不适用：本票没有 Worker、也没有异步预处理任务。「cancellation / stale-result 只为实际异步任务存在」是验收补充第 4 条本身的要求 |
| 每个进入 Worker 的 workload 都有 before/after 数据 | 不适用：没有任何 workload 进入 Worker（阶段 B 未启动） |
| 10k/50k 数据主线程长任务对比 | 已交付：`preprocess.perf.test.ts` 的 `*.exceedsLongTask` 读数 + 每个规模的 `maxMs` |
| 100 次数据替换后的资源 / heap 趋势 | 已交付：`component-path.perf.test.ts` §3（保留内存 0.03MB / 实例增量 0 / 订阅增量 0） |
| 包体与 worker chunk 体积 | 已交付：`perf:baseline` 的 bundle 段（dist 46 文件、运行时 787917 字节、worker chunk 0 个） |
| 性能脚本在 CI 环境稳定可复现 | 已交付：`quality.yml` 的 `performance` job 跑同一条命令；本机连续 5 次采集的比值在 5× 阈值内（`v3-performance-gate.test.ts` 守着「它真的在跑」） |

## 参考

- 基准与报告：`pnpm test:performance`（单跑基准）、`pnpm build:v3 && pnpm perf:baseline`（采集 + 报告 +
  门禁）、`pnpm perf:baseline --update`（刷新基线）；说明见
  [`docs/zh-CN/contributing/performance-baseline.md`](../zh-CN/contributing/performance-baseline.md)
- 官方参考实现：`huiyan-fe/react-bmap`（描述即「官方 React 组件库」，`master` 全树 254 个文件）——
  worker 关键词命中 0 处、`scripts` 里没有 perf/bench 入口；本库与它同为「数据整包交给 SDK」，
  多一层适配与一套预算
- 相关 ADR：[`2026-09-18-data-layer-manager-and-point-collection.md`](./2026-09-18-data-layer-manager-and-point-collection.md)、
  [`2026-09-19-native-point-layers-and-cluster.md`](./2026-09-19-native-point-layers-and-cluster.md)、
  [`2026-09-13-v4-required-smoke.md`](./2026-09-13-v4-required-smoke.md)
