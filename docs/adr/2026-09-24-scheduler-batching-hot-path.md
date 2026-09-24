# Vue scheduler/batching 取证：`flush:'sync'` 是深响应热路径的主因（#124 收口）

- 状态：Accepted
- 日期：2026-09-24
- 关联：issue **#124**（本 ADR 承接其 2026-09-23 重新分类后新增的 scheduler/batching 取证范围）、
  **#134**（1.0 身份重置，本 ADR 的前置，已完成）、ADR
  [`2026-09-24-deep-reactive-array-update-path`](./2026-09-24-deep-reactive-array-update-path.md)（深响应子问题）、
  ADR [`2026-09-21-performance-baseline-and-worker-decision`](./2026-09-21-performance-baseline-and-worker-decision.md)
- 取代范围：**不取代任何 ADR**。补齐 [`2026-09-24-deep-reactive-array-update-path`](./2026-09-24-deep-reactive-array-update-path.md)
  「非目标」里留给 #124 的 `flush` 对照与多字段同更新次数取证，并在其之上给出 scheduler 层的结论。原
  ADR 已接受冻结，不改写。

## 背景

#124 在 2026-09-23 被重新分类为 **1.0 Pre-release · P1 · Stable 阻塞：是**（前置 #134），新增要求：

- 对照 hot path 的 `flush:'sync'` vs 默认 pre vs post；
- 同一次父更新同时修改 `data`/`style`/`visible`/`zIndex`，记录 watcher callback / reconcile /
  SDK call / recreate 次数；
- 不因 benchmark 结果贸然使用 `pauseTracking`，先验证父级依赖 / 最终状态；
- 大数组继续以 `shallowRef`/`markRaw + dataVersion` 作为基线对照。

在此之前，[`2026-09-24-deep-reactive-array-update-path`](./2026-09-24-deep-reactive-array-update-path.md)
已结算「深响应大数组读取成本」子问题（结论：`pauseTracking` 不落地，用文档指引），但把 `flush` 对照
明确列为非目标、留在 #124。本 ADR 补齐这部分，并在新证据上复核那条文档结论是否仍成立。

## 取证（受控实验；Apple M4 / darwin / Node v24 / happy-dom，**不是提交基线**）

内核 `useNativeLayerResource` 的数据面 watcher 临时改为可切 `flush`（读 `globalThis.__BMAP_FLUSH__`），
并临时加了一组计数（watcher callback / `sync()` / `create` / `setData` / 字段写入）；实验后**全部回退**。

**如何复现**（本轮实际做法，便于后续复核）：

1. 把 `useNativeLayerResource.ts` 里那行 `watch(watchKey, () => sync(), { deep: false, flush: "sync" })`
   的 `flush` 改成读一个 `globalThis` 开关（sync / pre / post），需要精确的 callback / reconcile 次数
   时再加临时计数；
2. 在 `tests/performance/` 下放一个临时用例：真实挂 `BPointCollection`，50k 数据分别用深响应
   `ref([...])` 与 `shallowRef(markRaw(...))`，一次提交改 5 个字段，跑 `pnpm test:performance -t <段名>`；
3. 记录墙钟与次数后删除临时用例、`git checkout` 回退内核。

本 PR **不保留**这个开关（它会让「生产档 = sync」变成运行期可变，破坏 §7 的不变式前提）；因此
`pre` / `post` 两档的墙钟与次数**只存在于本 ADR**，生产档由 §7 常驻钉住。

### 1. hot path：50k 换一次引用的墙钟（深响应 vs `markRaw`）

| `flush` | 深响应输入 | `markRaw` 输入 |
| --- | ---: | ---: |
| `sync`（现状） | 112 ~ 128ms | ~10ms |
| `pre` | 36.5 ~ 37.6ms | ~10ms |
| `post` | 35.9 ~ 38.4ms | ~9.6ms |

（每档 5 次采样取 min，两轮交错；`setData` 调用次数三档一致 ⇒ 差异**不是**「多做/少做 SDK 调用」，
而是**同一次工作发生在哪个响应式上下文里**。）

### 2. 同一次父更新同时改 `data`/`size`/`color`/`visible`/`zIndex`（次数）

| `flush` | watcher callback | reconcile(`sync()`) | `setData` | `setStyleOptions` | `doOnceDraw` | `setVisible` | `setZIndex` | recreate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `sync` | **5** | **5** | 1 | **2** | **2** | 1 | 1 | 0 |
| `pre` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 |
| `post` | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 |

读法：`flush:'sync'` 下**每个被改的 prop 各自触发一次 watcher**（一次提交 5 个字段 → 5 次回调 /
5 次 reconcile），其中样式被写了 2 次（多字段分批到达、去重指纹只让**最终值**落盘）；`pre`/`post`
把一次提交合并成 **1 次**回调 / 1 次 reconcile。**三档 recreate 都是 0**：换数据 / 改样式 / 改显隐 /
改层级都不重建实例（重建只由构造期项 / 字段撤回 / 重新可见触发）。

### 3. 最终状态

三档一致：下发的是新数据（要素数 1000）、图层仍在图上（`attached=1`）、`visible`/`zIndex` 落到最终值、
无重建。⇒ batching 改变的是**次数与时机**，不改变**收敛结果**。

### 4. 父级依赖 / 最终状态（`pauseTracking` 采用前的前置条件）

已在深响应子问题 ADR 中验证并保留：被 `adapt` 收集的是「恰好处于活动状态的那个 effect」上的**伪
依赖**（原地改元素会让它重跑），父级 / 引用 / `dataVersion` 依赖不受影响（父级 effect 恒 `1→1`）。
本轮进一步确认：把整次更新移出活动 effect（`pre`/`post`）后**不需要** `pauseTracking` 就能拿到同一
档收益 ⇒ 「用 `pauseTracking`」这条候选被本证据**取代**，不再是必要手段。

## 决策

### 1. 维持 `shallowRef` / `markRaw` + `dataVersion` 的文档结论（复核通过）

新证据不推翻它、反而加强它：即使把 `flush` 降到 `pre`/`post`（消除依赖收集），深响应输入仍要
~36ms 而 `markRaw` 只要 ~10ms —— 剩下的是 **Proxy get 本身**，只能靠「数据别进深响应」消除，不能靠
调度。所以 [`2026-09-24-deep-reactive-array-update-path`](./2026-09-24-deep-reactive-array-update-path.md)
的使用引导（`docs/zh-CN/components/data.md`「大数据量」+ `BMapDataProps.data` 注释）**原样保留**。

issue 要求的基线对照两半都在：**性能那半**由 `component-path` §5 常驻（深响应 vs `shallowRef(markRaw)`
比值 ≥ 1.5）；**`dataVersion` 逃生口那半**是契约而非性能项，由行为用例覆盖（`v3-component-scenarios`
的「原地改坐标 + 不换引用 + 递增 `dataVersion`」与「不递增 ⇒ 不下发」两组），本轮不新增性能读数。

### 2. 本次不改 `flush:'sync'`（记录为新确认的主因 + 明确的重开条件）

`flush:'sync'` 是**既有语义**而非疏忽，但**要分清两处内核**：

- **Overlay / 路径类**（`useOverlaySpec.ts`）有显式理由：「沿用 v3 既有语义：路径更新要与父级渲染同一次
  提交内落地」——那条注释针对的是 `path` / `controlPoints` 这类大数组 watcher。
- **原生批量数据图层**（`useNativeLayerResource.ts:751`）**没有**单独记录「为什么选 sync」的注释；它可
  观察的行为是「逐字段 mutate 会触发多次 `sync()`」，这一点被
  `useNativeLayerResource.test.ts` 的文件头明确记录、并被其夹具设计（所有 props 从同一个 `ref` 派生，
  一次赋值 ⇒ 一次 `sync()`）所依赖。

改 `pre`/`post` 会改动**共享内核的时序契约**（影响五个原生数据图层组件 + 与 Map 销毁的竞争关系），
且会改变上述被测试依赖的「逐字段多次 sync」行为，需要自己的回归面与 ADR，不在本票的取证范围内合入。

**重开条件**（满足任一）：有真实消费者反馈 `pre`/`post` 时序可接受；或 1.0 性能预算把「单次更新 reconcile
次数」列为指标。重开时至少要覆盖的回归面：`useNativeLayerResource.test.ts`（其夹具依赖「一次赋值 ⇒
一次 `sync()`」来测 `unknown` 期间的收敛）、`component-path` §7 的次数/最终值不变式、以及「更新与 Map
销毁的竞争」路径。

### 3. 可执行门禁：多字段同更新的次数与不变式

`tests/performance/component-path.perf.test.ts` §7 固定一次父更新同时改 `data`/`size`/`color`/
`visible`/`zIndex`，钉住**与 `flush` 无关**的不变式：换数据不重建、`setData` 恰好一次、下发的是新那份
（用不同规模区分）、样式/显隐的**最终值**真的落到位、`visible`/`zIndex` 各写一次。各字段写入次数作为
**读数**进报告（当前 `sync` 档下 `setStyleOptions@1000=2`），使 §2 的现象跨版本可对照、不可被静默改写。

**分工**（哪些是常驻门禁、哪些是本 ADR 的取证存证）：

| 读数 | 归属 |
| --- | --- |
| `setData` / `setStyleOptions` / `doOnceDraw` / `setVisible` / `setZIndex` / recreate 次数 + 最终值 | **§7 常驻**（每次 `pnpm test:performance` 都跑） |
| watcher callback / reconcile 次数（sync 5 / pre 1 / post 1） | **本 ADR 取证**（需临时插桩，未常驻） |
| 三档墙钟（sync 112 ~ 128ms / pre ~36ms / post ~36ms） | **本 ADR 取证**（需临时插桩，未常驻） |

## 后果（含回滚）

- 深响应大数组仍是本库最贵的用法；`flush:'sync'` 是**已确认的主因**（依赖收集），已写进 perf 文档供
  维护者与 1.0 预算参考。
- 一次改多字段会触发多次 reconcile（`sync` 档）——这是既有语义（字段去重后最终值正确），不是回归；
  §7 的读数把它显式化，避免「以为只有一次」。
- **提交基线待重录（必须在门禁机做）**：§7 新增了 `multiUpdate.*@1000` 这组 readout，而
  `tests/performance/baseline.json` 的 `readouts` 段还没有它们。`collect-performance-baseline.mts` 的
  key-set 双向校验**只比较 `metrics`**（`readouts` 合并进报告但不参与校验），所以 CI **不会**因为基线
  落后而红——这正是「静默落后」，必须显式记账。
  **不能在开发机 `--update`**：门禁键是 `platform + arch + cpuModel`，用本机（darwin/arm64）重录会让
  CI（linux/x64）判定不可比并 `comparison.skipped` 静默跳过趋势门禁 —— 正是
  [`performance-baseline.md`](../zh-CN/contributing/performance-baseline.md) 明令避免的「一个看起来
  生效的门禁」。正确做法：在门禁机（CI `performance` job）跑 `pnpm perf:baseline --update`，或用该 job
  的 `perf-report` artifact 里的 `report.json` 重录。**本票不把「基线已同步」写成已完成。**
- **回滚**：本 ADR 的产物是 §7 用例（测试）+ 文档；回滚 = 移除 §7 与 perf 文档段落并把本 ADR 标
  `Superseded`，不动任何运行时源码（本次取证用的 `flush` 开关已回退）。

## 非目标

- 不引入 Worker（#37 ADR 决策 2）；
- 不改 `flush` / 不改共享内核时序（决策 2）；
- 不动「`data` 按引用比较 + `dataVersion` 表态」既有契约；
- 不把 §7 的次数读数升级为「必须等于 1 次 reconcile」的硬门禁——那是 `flush` 决策的产物，属决策 2。

## 参考

- issue #124（scheduler/batching 取证要求）、#134（1.0 身份重置，前置，已完成）
- ADR [`2026-09-24-deep-reactive-array-update-path`](./2026-09-24-deep-reactive-array-update-path.md)（深响应子问题）、
  [`2026-09-21-performance-baseline-and-worker-decision`](./2026-09-21-performance-baseline-and-worker-decision.md)、
  [`2026-09-17-layer-spec-and-registry.md`](./2026-09-17-layer-spec-and-registry.md)
- 取证代码：`tests/performance/component-path.perf.test.ts` §5（深响应对照）/ §7（多字段次数）
- 官方参考实现：`huiyan-fe/react-bmap`（无同类 scheduler 取证）
