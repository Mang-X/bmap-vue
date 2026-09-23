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
  **`firstFrame`（#123 目标 1）**（首次原生 `setData` 进入 → ready 后第一次 paint；
  未捕到起点 ⇒ fatal，**不回退** `app.mount`；**不含**之后的 200ms 稳定期）/
  **`mountToPaint` 旁路**（`app.mount` → 同一次 paint，建图 / ready 成本，**不是**目标 1）/
  **`setData`**（造数跨 macrotask 隔离后 → `setItems` → 跨 macrotask + `nextTick` 的
  **近似 settle**（与 Fake `flushPromises` 同型，task source 可能不同），**唯一进 Fake 对照**）/
  **`redraw`**（settle 之后 → 2×rAF）/
  **`sdkSetData`**（原生 `prototype.setData` 进入 → 返回）
  + long task **长收短 flush、按时间重叠取窗口交集**（页面级常驻 observer，窗末 `flush()` /
  `takeRecords()`；`longest` = 交集时长，不是整条 `entry.duration`）+ **更新后** FPS
  （redraw 后再采 1s 的 `postUpdateFps`，不是 setData 期间帧率）。Node 侧再与
  `tests/performance/baseline.json` 的 Fake `min` 并排（delta **只**用 `setData` 族，
  且只作**量级参考**——Fake 在另一台 CI 机器上，不能单独证明「差值 ≈ 原生返回」）。
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

### 实跑读数（2026-09-23，#123 · 评审 #131 第四轮后口径）

> 2026-09-23 · `pnpm perf:baseline:live` · exit **0** · 读数 **3/3** · 页面窗 **60.7s**
> （跑数时机器负载较低：load avg ≈ 12——绝对值仍只作本机参考；与更早轮次
> load ≈ 186 / 40 的读数**不可比**）。
>
> - **环境三元组**：Chrome **154**（headless）· Node **v24.18.0** / darwin **arm64**（Apple M4）·
>   数据集 **v1** / **50k** · SDK engine **jsapi-v4** / **v=4.0** · report **version 2**
> - 报告：`.artifacts/perf-live/report.json`（含 `machine` / `sdk` / `dataset` 三元组字段）

计时协议（#131 第四轮）：`firstFrame` = **首次原生 `setData` 进入** → ready 后第一次 paint
（#123 目标 1；未捕到起点 ⇒ fatal，**不回退** `app.mount`）；`mountToPaint` = `app.mount` →
同一次 paint（建图 / ready 旁路，**不是**目标 1）；`setData` = **造数跨 macrotask 隔离后**
的 `setItems` → 跨 macrotask + `nextTick` 的**近似 settle**（与 Fake `flushPromises` 同型、
task source 可能不同）；`redraw` = settle 之后 → 2×rAF；`sdkSetData` = 原生
`prototype.setData` 进入 → 返回。long task 用**页面级常驻 `PerformanceObserver` 长收、
窗末 `flush()` 再按时间重叠取窗口交集**（`longest` = 交集，不是整条 task duration）；
`postFps` = redraw **之后** 1s 的 `postUpdateFps`。被忽略的 SDK Worker `importScripts`
噪声写进 `report.notes`。

| 图层 | 族 | durationMs | long tasks | overlap | postFps |
| --- | --- | ---: | ---: | ---: | ---: |
| pointCollection | firstFrame | **1739.2** | 4 | 1327 | — |
| | mountToPaint | 1800.1 | — | — | — |
| | setData | **598.3** | 2 | **542.9** | — |
| | redraw | 951.9 | 2 | 941 | 1.36 |
| | sdkSetData | **263** | — | — | — |
| line | firstFrame | **1651** | 4 | 869 | — |
| | mountToPaint | 1664.8 | — | — | — |
| | setData | **2763.7** | 2 | **1791** | — |
| | redraw | **3232.4** | 2 | 3228 | 1.08 |
| | sdkSetData | **916.4** | — | — | — |
| fill | firstFrame | **6603.2** | 4 | 4857.8 | — |
| | mountToPaint | 6667.9 | — | — | — |
| | setData | **9279.7** | 2 | **7077.9** | — |
| | redraw | **527.6** | 2 | 526 | 0.75 |
| | sdkSetData | **6759.7** | — | — | — |

**Fake 对照**（`tests/performance/baseline.json`，CI runner / EPYC，只作**量级参考**、
不作同机比、也**不能**单独证明「差值 ≈ 原生返回」；delta 只来自 `setData` 族）：

| 图层 | live setData | Fake min | delta | live sdkSetData |
| --- | ---: | ---: | ---: | ---: |
| pointCollection | 598.3 | 253.8（`setData.replace@50000`，含深响应读取） | +344.5 | 263 |
| line | 2763.7 | 0.61（`data.replace.line@50000`） | **+2763.1** | 916.4 |
| fill | 9279.7 | 0.43（`data.replace.fill@50000`） | **+9279.3** | 6759.7 |

**这批读数改变了什么**（回填 ADR 已知限制 1 与「重新评估条件」第三条）：

1. **`firstFrame` 起点改到原生 `setData`（#123 目标 1）**：point 1739 / line 1651 /
   fill 6603——不再混入 `app.mount` → ready 的建图等待；同轮 `mountToPaint` 旁路
   1800 / 1665 / 6668（`firstFrame ≤ mountToPaint` 合理：起点更晚、终点相同）。
   旧口径「mount → paint」读数**不可与本表联合比较**。
2. **long task 归属 = 窗口交集，且造数与测量窗已隔开**：overlap 542.9 / 1791 / 7077.9
   **均 ≤ duration** 598.3 / 2763.7 / 9279.7（第二轮曾出现整条 duration ≈2× 窗口的假长）。
3. **line / fill 的 `setData` 对照窗仍远大于 Fake 直通**：delta `+2763 / +9279`；同轮
   `sdkSetData` **916 / 6760**——fill 同量级、**line 的 delta 明显大于原生返回**
   （窗口还含 Vue 调度 + 近似 settle 边界）。因此**只能说量级参考**，
   不能把整段 delta 写成「≈ SDK 内部成本」；要压成本仍优先看渲染路径（`redraw` 窗
   long task overlap 941 / 3228 / 526）。
4. **pointCollection 两侧都有显著成本**：`setData` 598.3、`sdkSetData` 263 ≈ delta 344.5
   的同量级旁路——同轮原生返回约占窗口一半；历史 Fake 253.8 在**另一台机器**上。
   **不能**仅凭跨机 Fake 断言「瓶颈只在适配层 + 响应式」；适配/响应式与 SDK 同步
   `setData` **两侧都存在显著成本**，主导侧需同机对照才能判。
5. **`postUpdateFps`（更新后 1s）**：1.36 / 1.08 / 0.75 fps——是 redraw **之后**的环境
   诊断，**不是** setData 期间帧率；headless + `--disable-gpu` 下 rAF 被节流，只记录。
6. **「官方分片入口不够用」本轮未测** ⇒ ADR 重开条件第三条标**部分满足、待复核**，不自动重开
   Worker 票。
7. **settle 措辞收窄**：live 侧 `setTimeout(0)+nextTick` 与 Fake `flushPromises`
   （Node 通常 `setImmediate`）**同为跨 macrotask 后再 `nextTick` 的近似边界**，
   task source 不必相同——不再写「完全同边界」。

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
