# 性能基准与预算

本页是「性能读数怎么采、怎么读、门禁管什么」的操作说明。决策与依据见
[ADR 2026-09-21](/adr/2026-09-21-performance-baseline-and-worker-decision)。

## 一句话结论（阶段 A）

`100 / 1k / 10k / 50k` 四个规模下，**预处理三步（过滤 / GeoJSON 适配 / fallback 聚合）在 50k 时单次
同步耗时最长 24ms**（开发机 3 ~ 24ms、CI runner 7.6 ~ 15.4ms），明显低于浏览器 50ms 长任务线，
因此本库**不引入 Worker**。

越过这条线的是**组件路径在 50k 上的整段交付**（一次性挂载 47 ~ 68ms、换数据 97 ~ 217ms），但它的
代价主体不是我们的算法，而是**在响应式上下文里读这份大数组**：同一份数据换 `markRaw` / `shallowRef`
之后，换数据从 ~120ms 掉到 14 ~ 26ms（基准里 `component-path` §5 的常驻对照读数，比值 4.5 ~ 8.4×）。
Worker 也要先把数据读出来再送过去，所以它解决不了这条。

**四类原生图层（GeoJSON 直通）在 50k 下的读数**（`component-path` §6 的矩阵）：挂载 1.1 ~ 2.3ms、
换数据 0.2 ~ 0.4ms、样式更新 0.3 ~ 0.6ms、卸载 0.1 ~ 0.6ms（line / fill / heatmap / track-line，
每个组合都断言「1 个 SDK 资源 / 0 个逐要素覆盖物 / 换数据不换实例 / 卸载后归零**、换引用恰好 `+1`
次 `setData` 且下发的是新那份引用、样式更新按 kind 触发它那条 SDK 路径**（专页图层
`setStyleOptions` + `doOnceDraw`；扩展 API `setOptions`））。断言一律用**增量**，不用
`includes()`——后者会被挂载阶段的调用满足。同一份 50k 数据
经 GeoJSON 直通比走 `Item[]` 适配路径便宜一个数量级 ⇒ 成本在**适配层 + 响应式读取**，不在图层内核。

⚠️ 机器负载会把绝对值推高近 2 倍（本机被别的进程压满时 `adaptPoints@50k` 的 min 从 9ms 升到 24ms，
`max` 甚至逼近 50ms 线）——这正是**只把比值当门禁、把「是否越过 50ms」当读数**的原因。

## 命令

```bash
pnpm test:performance              # 只跑基准（自带判据：超线性 / 泄漏 / 保留内存）
pnpm typecheck:tests               # 测试代码的类型门禁（tests/performance/**；vitest 不做类型检查）
pnpm build:v3 && pnpm perf:baseline # 采集 + 报告 + 趋势门禁（CI 跑的就是这条）
pnpm perf:baseline --update        # 同时刷新提交的基线（换机器 / 换数据集时才做）
pnpm perf:baseline --tolerance=5   # 临时放宽阈值
pnpm perf:baseline --metrics-dir=.artifacts/perf/metrics  # 复用已有指标，只重出报告
```

产物：`.artifacts/perf/report.json`（机器可读）与同一份内容的人读表格（打印到 stdout，CI 日志里可见）。

## 真实浏览器档

Fake + happy-dom 那套测不到真实 SDK 重绘与帧调度（ADR「已知限制」1）。**#123** 把这块读数
单独采出来，入口与产物刻意与 smoke / Fake 基线分开（**无阈值**：只出读数，不作门禁——本档
**永不返回退出码 `1`**）：

```bash
BAIDU_MAP_AK=<ak> pnpm perf:baseline:live
# 可选：--port=5214 --out=… --log=… --timeout=300000 --keep（保留 vite/chrome 排障）
```

- **入口**：`pnpm perf:baseline:live` → `scripts/collect-live-performance.mts` + 独立页
  `tests/browser/live-performance/**`（与 smoke 的 `tests/browser/jsapi-v4/**` 只共享
  `official-probe/cdp.mts` + `readiness.mts` 两块，编排胶水按仓库既有口径刻意重复）。
- **读数**：4 类 × 3 图层（`BPointCollection` / `BLineLayer` / `BFillLayer`），数据集与 Fake
  基线同源（`tests/performance/dataset.ts`，固定 `DATASET_VERSION`，默认 50k）。计时协议见
  `tests/browser/live-performance/main.ts` 文件头表（改窗口必须同步本页与 ADR）：
  **首帧**（逐图层独立 mount → ready 后第一次 paint，**不含**之后的 200ms 稳定期）/
  **`setData`**（窗外预生成 → `setItems` → settle，**唯一进 Fake 对照的窗口**）/
  **`redraw`**（settle 之后 → 2×rAF）/ **`sdkSetData`**（原生 `prototype.setData` 进入 → 返回）
  + long task **长收短 flush 再按时间重叠分账**（页面级常驻 observer，窗末 `flush()` /
  `takeRecords()` 再 `countIn(start,end)`，不按窗末 `disconnect()` 丢 buffer）+ 真实 FPS
  （frames/second）。Node 侧再与 `tests/performance/baseline.json` 的 Fake `min` 并排
  （delta **只**用 `setData` 族）。
- **产物**：`.artifacts/perf-live/report.json` + stdout 的人读表（**page 段** = 浏览器内读数，
  **node 段** = 信封 / 退出码 / Fake 对照；AK 全程经 `redactAk` 脱敏）。
- **退出码**：`0` 读数采齐、`2` 脚手架失败、`3` blocked（缺 AK / SDK 没 ready——**不是通过**）。
  没有 `1`：本票不设跨机器硬阈值。
- **CI**：nightly `live-performance` job 跑同一条命令并上传 `live-performance-report` artifact
  （AK 来自 `secrets.BAIDU_MAP_AK`）。
- **AK 渠道**：与 `docs/.vitepress/theme` 同一实践——**AK 不进本仓库新文件**，只经环境变量 /
  URL 查询参数注入，页面与 Node 打印两侧都过 `redactAk`。

页面内测量（rAF / `PerformanceObserver` / 原型包装）不进单测——只能真浏览器跑，由实跑读数
取证；纯函数与接线契约在 `tests/behavior/v3-live-performance-gate.test.ts`。

### 实跑读数（2026-09-23，#123 · 评审 #131 第二轮后口径）

> 2026-09-23 · `pnpm perf:baseline:live` · exit **0** · 读数 **3/3** · 页面窗 **69.0s**
> （跑数时机器负载中等：load avg ≈ **40**——仍偏高，绝对值只作本机参考；与第一轮
> load ≈ 186 的读数不可比）。
>
> - **环境三元组**：Chrome **154**（headless）· Node **v24.18.0** / darwin **arm64**（Apple M4）·
>   数据集 **v1** / **50k** · SDK engine **jsapi-v4** / **v=4.0**
> - 报告：`.artifacts/perf-live/report.json`（含 `machine` / `sdk` / `dataset` 三元组字段）

计时协议（#131 第二轮）：`setData` = **窗外**预生成的 `setItems` → settle（与 Fake
`data.replace.*` / `setData.replace@*` 同边界，**唯一进对照表**）；`redraw` = settle 之后 →
2×rAF；`sdkSetData` = 原生 `prototype.setData` 进入 → 返回；`firstFrame` = **该图层独立**
mount → ready 后**第一次 paint**（**不含**之后 200ms 稳定期）。long task 用**页面级常驻
`PerformanceObserver` 长收、窗末 `flush()`（跨 macrotask + `takeRecords()`）再按时间重叠
`countIn(start,end)` 分账**——不是窗末 `disconnect()`（那会清 buffer，回调也另排 task）；
FPS = `frames / seconds`（真实帧率，不是 ÷60 比值）。被忽略的 SDK Worker `importScripts`
噪声写进 `report.notes`。

| 图层 | 族 | durationMs | long tasks | longest | FPS |
| --- | --- | ---: | ---: | ---: | ---: |
| pointCollection | firstFrame | 1125.9 | 4 | 681 | — |
| | setData | **411.9** | 1 | **984** | 2.49 |
| | redraw | 1631.4 | 2 | 1629 | — |
| | sdkSetData | **231.3** | — | — | — |
| line | firstFrame | **2236.4** | 4 | 1383 | — |
| | setData | **746.9** | 1 | **1601** | 1.4 |
| | redraw | **2137.2** | 2 | 2136 | — |
| | sdkSetData | **714.7** | — | — | — |
| fill | firstFrame | **11039.2** | 4 | 4810 | — |
| | setData | **5641.1** | 1 | **8655** | 0.71 |
| | redraw | **5359.9** | 2 | 5356 | — |
| | sdkSetData | **5575.4** | — | — | — |

**Fake 对照**（`tests/performance/baseline.json`，CI runner / EPYC，只作量级参照、不作同机比；
delta 只来自 `setData` 族）：

| 图层 | live setData | Fake min | delta | live sdkSetData |
| --- | ---: | ---: | ---: | ---: |
| pointCollection | 411.9 | 253.8（`setData.replace@50000`，含深响应读取） | +158.1 | 231.3 |
| line | 746.9 | 0.61（`data.replace.line@50000`） | **+746.3** | 714.7 |
| fill | 5641.1 | 0.43（`data.replace.fill@50000`） | **+5640.7** | 5575.4 |

**这批读数改变了什么**（回填 ADR 已知限制 1 与「重新评估条件」第三条；对照第一轮旧口径读数）：

1. **long task 归属修了**：第一轮窗末 `disconnect()` 丢 buffer，`setData` 窗 long task 全 0
   而 `sdkSetData` 有 1250 / 7228ms——本轮长收短 flush 后，`setData` 窗记到 1 / 1 / 1 个
   （最长 984 / 1601 / 8655），与同轮 `sdkSetData` **231 / 715 / 5575** 一致。
2. **line / fill 的 `setData` 对照窗 ≈ 纯原生返回**：delta `+746 / +5641` 与同轮
   `sdkSetData` **715 / 5575** 同量级（差额是 settle 对齐与包装误差）——在**分窗 + 正确
   long task 归属之后**才说「差值主体在 SDK `prototype.setData` 返回」。
3. **重绘尾巴另记 `redraw`**：line / fill 的 long task 主体（最长 2136 / 5356）在 paint 窗，
   **不进 Fake 对照**；要压的是渲染路径，不是我们这一侧的 prop 转发。
4. **pointCollection 不同**：`setData` 411.9、`sdkSetData` 231.3，与 Fake 253.8 同量级——瓶颈仍在
   **适配层 + 响应式读取**（与阶段 A 一致），不是同步 SDK 解析大头。
5. **首帧逐图层独立、不含稳定期**：point 1125.9ms、line 2236.4ms、fill 11039.2ms（各自 map
   ready + 第一次 paint；**不要**与旧口径联合首帧 396ms 或含 200ms 稳定期的第一轮读数比，
   也不要在未控负载时外推）。一次性初始化，不改变「不引入 Worker」。
6. **FPS**：headless + `--disable-gpu` 下真实帧率 0.71 ~ 2.49 fps（rAF 被节流）——只记录、
   不解读；有头/有 GPU 再采一档才能谈帧率。
7. **「官方分片入口不够用」本轮未测** ⇒ ADR 重开条件第三条标**部分满足、待复核**，不自动重开
   Worker 票。

⚠️ SDK Worker 偶发 `importScripts` NetworkError 是**可恢复噪声**（同 URL curl 200）：页面
`error` / `unhandledrejection` 过滤该形态、不记 fatal；地图 ready 仍由 `READY_MS` 负责（复跑
实测：不过滤会整轮 0 读数 exit=2）。

机器不同 + 本跑负载极端 ⇒ **绝对毫秒不进任何门禁**（本档本就无阈值）；nightly 同机连续跑才有
趋势意义。

## 报告怎么读

- **归一化列**：`min / calibration.cpu`。校准工作量是一次固定的纯计算，用来抵消机器速度差；
  跨机器只比这一列，绝对毫秒只作参考。
- **比值列**：与提交基线 `tests/performance/baseline.json` 的归一化比值。默认阈值 5×。
  ⚠️ **跨平台 / 跨 SKU 不做门禁**：可比性判据是 `platform + arch + cpuModel`。实测两件事决定了这条：
  ① 开发机与 CI runner 之间归一化比值差 2 ~ 6 倍；② **同一个 `ubuntu-latest` label 的两次连续推送**
  就是不同 SKU（Xeon 8573C → Xeon 6973P-C，连校准量都差 27%）。不一致时脚本会打印比值但**只出报告、
  不做门禁**，并在报告里记 `comparison.skipped`——**5× 宽阈值不能把「不可比」变成「可比」**。
  **基线维护规则**：基线录在**与门禁同一台/同一规格的机器**上（本项目录在 GitHub runner）；
  runner 换 SKU 时 CI 会打印「本次不做趋势门禁」，由维护者在那台机器上跑一次
  `pnpm perf:baseline --update` 重录；也可以直接下载 CI 那个 `performance` job 的 `perf-report`
  artifact（`gh run download <run> -n perf-report`），用里面的 `report.json` 重录。
  要在**本机**启用门禁同理。**改了指标准入口径（例如某个动作从「父级重渲染」变成真的走 SDK 路径）
  也要重录**：那不是性能回退，但比值会动。
- **低于噪声地板的指标**（归一化 < **0.1** —— 它是**归一化单位**，绝对毫秒等价值 = `0.1 ×
  calibration.cpu`，随机器变：当前 CI 基线 ⇒ ≈3.3ms、开发机 ⇒ ≈1ms）只进报告、不参与门禁：比 0.02ms 的读数
  只会得到假红。**同轮比值的两端也受同一地板约束**（拿亚毫秒读数当分母会把噪声放大成「形状变化」）。
- **`*.exceedsLongTask`**：该步骤 50k 的最长单次耗时是否越过 50ms。它是「要不要迁出主线程」的判据，
  但**依赖机器速度，因此只作读数**，不作门禁。
- **包体**：`运行时（ESM/CJS/CSS）` 是消费方真正下载的部分；`d.ts` 与 `sourcemap` 分开列。
  `worker chunk` 与运行时 `new Worker(` 的出现次数是**读数**：门禁不冻结实现方式。
- **本套（Fake 档）测不到**：真实 SDK 重绘、真实浏览器调度、跨平台差异。报告末尾会逐条打印，别把
  Fake 读数外推到「50k 点在页面上要多久」——那一档见上文「真实浏览器档」（#123，已实跑）。

## 退出码（「没跑」不等于「通过」）

| 码 | 含义 |
| --- | --- |
| `0` | 基准跑完、无超阈值回退（跨平台时也会返回 `0`，但报告里会写明「本次不做门禁」） |
| `1` | 有超阈值回退（门禁唯一想拦的东西） |
| `2` | 脚手架 / 判据失败（vitest 挂了、指标缺失、环境不一致） |
| `3` | blocked（前置缺失，例如没有 `dist` ⇒ 包体读数无法采集） |

CI 的 `performance` job 先 `build:v3`，因此 `3` 出现在 CI 里就意味着门禁没跑完，需要人工看一眼。

## 加一条基准

1. 数据集改动（生成规则）必须同时改 `tests/performance/dataset.ts` 的 `DATASET_VERSION`，
   并跑一次 `pnpm perf:baseline --update` 刷新基线；否则基线比较的是两份不同的数据。
   **指标集合是双向校验的**：新增 / 改名 / 删除任何一条指标都会让门禁以退出码 `2` 拒绝运行
   （而不是静默少测一项），确认合理后同样要 `--update` 重录。
2. 新指标写在既有的两个基准文件里（`preprocess` / `component-path`），命名带上规模后缀
   （如 `adaptPoints@50000`）；跨文件重名会被采集脚本直接判失败。
3. 判据优先选**机器无关的比值**；要用绝对毫秒时给极宽的上界（绊线），并在注释里写清它只抓数量级回归。
4. 需要「某件事没发生」的断言时，同时写一条正证守卫（否则门禁可能空转）。

## 不要把读数外推的地方

- 本套的 SDK 是 Fake（`setData` 只记引用），环境是 happy-dom：**没有渲染、没有布局、没有帧调度**。
- 保留内存只在 `--expose-gc` 下可信（基准配置里设了）；缺 `gc()` 时基准会**直接失败**，不静默降级。
- 单机单运行时：基线的绝对值只是**一份参考读数**，不是发布事实；跨平台或跨 SKU
  （`platform + arch + cpuModel` 任一不同）的比值也只在同一机器身份内可比，因此那种情况只出报告
  （同轮比值层不受此限）。
- 基线录在 CI runner 上（见上）；本机读数与它不可比是**预期**的，不是缺陷。
- 真实浏览器档见上文「真实浏览器档」（**#123** 已实跑并回填：`pnpm perf:baseline:live`）；
  深响应输入的长任务仍由 **#124** 承接；line/fill 的 SDK 内部重绘优化若有消费者另开票。
