# 与 `@baidumap/vue-bmap` 的同场景对照基准（#140）

- 状态：Accepted
- 日期：2026-09-25
- 关联：issue #140（`[1.0-PERF][P1]`）、#141（对外定位）、#37（既有性能基线与预算）、
  #123（真实浏览器档）、#104（ownership-first）
- 取代范围：**不取代**任何 ADR。补充 `2026-09-21-performance-baseline-and-worker-decision.md`
  的读数面：那条是**单库**趋势基线（与自己的上一次提交比），本条是**跨库**对照（与官方
  同版本比）。两者门禁口径不同，不可互相替代。

## 背景

issue #140 要求与官方 `@baidumap/vue-bmap` 在**同一环境、同一 JSAPI 4.0、同一数据集**下做
10 个场景的对照，并明确写了三条硬规则：

1. **不做营销排名**，只做可复现实验。简单 Marker / Map 若官方更轻，**如实记录**，不为了
   「赢」再加一层优化。
2. **不伪造官方等价物**。官方没有的场景单列为「本库扩展档」，不硬比较。
3. **benchmark 本身不成为为 benchmark 而改生产语义的理由。**

第 3 条对本仓库尤其要紧：本库正处在 #124 / #138 的 Vue-native 收口过程中，基准很容易被
当成「让读数好看」的杠杆。ADR 必须把它钉在**门禁层面**而不只是文档层面。

还有一个环境约束：**本环境没有 `BAIDU_MAP_AK`**，而票面同时要求「raw AK 绝不入库」。
因此「真实浏览器 + 真实 JSAPI」这一档在本轮拿不到数据。

## 决策

### 1. 交付分两档，Fake 同机档是主档

| 档 | 命令 | 本轮状态 |
| --- | --- | --- |
| **Fake 同机档**（主） | `pnpm perf:contrast` | ✅ 已跑，可复现，可入 CI |
| 真实浏览器档 | `pnpm perf:contrast:live` | ⛔ **未实跑**（无 AK）——页面与编排留骨架，不产出数据 |

Fake 档能成立，靠的是一个**已实测**的事实：`@baidumap/jsapi-loader@1.0.0` 的 `load()` 在检测
到已存在的 `window.BMap` 时**直接复用**（不插 script）。把本仓库的 Fake v4 挂到 `window.BMap`
上，官方库就能跑通——**无 AK、无网络、完全确定**。这是它能当门禁的前提。

**为什么主档必须是 Fake 而不是「等有 AK 再做」**：票面要求「可复现」，而 PR 门禁不能依赖
一个只有部分维护者有、且不该入库的密钥。Fake 档把「同一份数据、同一份 Vue、同一个进程」
这条最难满足的前提变成默认成立的。

### 2. 两侧同进程、但**不共用 Fake 账本**

跨进程各跑一次满足不了票面的「同环境」：两次的机器负载、JIT 状态、GC 时机都不同，差多少都
无法归因。所以两侧在**同一个 vitest 进程**里跑，共享同一份 Vue 与同一份确定性数据。

但两侧**各有各的 Fake 实例**：本库经 Facet Driver、官方经自己的 driver，写入的记账字段与
生命周期不同，混在一个账本上会让「谁创建了什么」无法归因。`window.BMap` 只给官方；本库走
provider 注入，不读全局。

### 3. 官方基线版本**精确锁定** `1.0.1`

不是 `^1.0.1`：对着别的版本出的数字不能叫「与 1.0.1 的对照」。`checkContrastEnvelope` 在
官方版本偏离时产出 `CONTRAST_OFFICIAL_VERSION_DRIFT`，门禁归为退出码 2（脚手架问题，不是性能
结论）。

### 4. 官方没有等价物的场景**单列**，不硬比较

`tests/performance/officialScenarios.ts` 把场景当**数据**登记，每条显式声明官方有没有公开的
等价契约。本轮三条是扩展档，依据都可核对：

| 场景 | 官方 1.0.1 的事实 | 依据 |
| --- | --- | --- |
| PointCollection 50k | `BMap.PointCollection` 在 4.0 **整体移除**（`@removed 4.0，仅 v3`） | `@baidumap/jsapi-v4-types@4.0.4` 无此声明 |
| Native Point 50k | 官方 v4 的批量点是**扩展 API**，官方 binding 没有组件封装 | 官方 `dist/index.d.ts` 的组件清单 |
| KeepAlive 切换 | 官方库**没有任何 KeepAlive 语义**（无 `onActivated` / `onDeactivated`） | `dist/index.js` 全文无这两个钩子 |

它们进报告的「本库扩展档」一节，**永不**与任何官方数字并排，也不进差值列。

### 5. 唯一能判失败的是**不变式**，不是快慢

| 退出码 | 含义 |
| --- | --- |
| `0` | 采齐、信封自检通过、不变式未破 |
| `1` | **不变式被破坏**——本库侧的架构预期没了（唯一能返回 1 的原因） |
| `2` | 脚手架失败（基准没跑起来 / 报告缺失 / 官方版本漂移） |
| `3` | blocked——**不是通过** |

绝对毫秒**只作读数**：Fake 没有真实渲染，跨机器本就不可比。刻意**没有**「比官方慢就算回退」
这一条，那正是票面禁止的营销式排名。

本轮钉的不变式只有两条（本库侧）：
- 父级改一个与 path 无关的状态 ⇒ **0 次** `setPath` 重发（场景 4 的核心）；
- 换一份 10k path ⇒ 恰好 **1 次** `setPath`、**0 次**重建覆盖物（场景 5）。

同一场景在**官方侧**也记一条，但 `side: "official"`——它只是**读数**。官方没做到某件事不构成
本库的回归，拿它卡门禁等于用别人的缺陷判本库失败；而 `holds: false` 仍会显式出现在报告里。

### 6. 渲染次数怎么数：devtools `perf:start`，不是 `component:updated`

Vue 3 删掉了 Vue 2 的 `app.on("app:renderTriggered")`，公开观测口只剩 devtools 全局钩子。
选 `perf:start`（`type === "render"`）而不是 `component:updated`，原因是**覆盖面**：后者只在
**更新**路径上 emit，首次挂载不计数，而票面一半场景量的正是挂载——那样会恒读 0。

两个必须踩准的实现事实（都写进 `tests/performance/vueRenderCounter.ts` 文件头）：
- `baseCreateRenderer` 在**模块求值**时读一次 `__VUE_DEVTOOLS_GLOBAL_HOOK__`，之后不再重读 ⇒
  钩子必须由一个**先于 `vue` 求值**的模块装上，`beforeAll` 里装太晚；
- `createDevtoolsPerformanceHook` 的 emit 下标是 `[app, uid, instance, type, time]`，**组件
  实例是 `args[2]`**，不是 `args[0]`；
- 计数桶必须在**根组件的 `setup()` 里**建立。挂载型场景整棵树在 `mount()` 内部建完，事后建桶
  永远读到 0（官方侧因为要等 ready、注册发生在动作之前，会出现「一边 0 一边 103」）。

### 7. 计时窗只包住「动作」

每个场景拆成 `setup → act → teardown`，只有 `act` 进计时窗。官方 `Map` 的 ready 信号在 Fake
上要等它自己的兜底定时器（**夹具差异**，不是性能差），把它算进动作会让场景 1/2/8/9 的读数
变成「谁等得久」而不是「谁建的资源多」。残留读数取**卸载之后**的快照——挂载型场景在动作窗口
结束时资源本来就还挂着，那是动作本身，不是泄漏。

对齐 ready 口径时打开了 Fake 的 `emitTilesLoadedOnFirstView`（夹具开关，不是官方语义）：
官方 ready 从 ~500ms 降到 ~8ms。否则「本库立即 ready / 官方 500ms 后 ready」会被读成两库
的性能差。

### 8. benchmark 不得成为改生产语义的理由 —— 门禁化

这条不写成文档提醒，而是**门禁**：`tests/behavior/official-contrast-gate.test.ts` 断言
`git diff HEAD -- packages/bmap-vue/src` 为**空**。要让对照跑绿就去改 `src/`，门禁会红。
本档对生产源码的改动量必须是**零**。

### 9. AK 绝不入库

Fake 档根本不需要 AK（官方侧 provider 传的是字面量 `"fake"`）。真实浏览器档的 AK 只走
`BAIDU_MAP_AK` 环境变量 / `--ak=`，全程经 `redactAk`。门禁断言代码里没有写死的 AK 字面量，
编排脚本也不读 AK。

## 后果（含回滚）

**得到的**：

- 一条**可复现、可入 CI** 的跨库对照（`.github/workflows/quality.yml` 的 `official-contrast`
  job，上传 `official-contrast-report` artifact）。job 只在**不变式破坏 / 脚手架坏 / 没跑成**
  时失败，不会因为 runner 快慢而红。
- 一份**可核对**的 10 场景清单（场景表是数据，报告逐条列出，未跑到的也留行）。
- 本轮如实记下的**架构差**：官方 `Marker` 卸载后 100/1000 个覆盖物仍挂着（`retained=100` /
  `1000`），1k 位置更新重建了 1001 个覆盖物而本库 0（用 `setPosition` 复用实例）；官方
  `Polyline` 卸载后覆盖物未摘（`retained=1`）。这些是**读数**，不是攻击点，但它们是可复现的。
- 报告与门禁读**同一个来源**（`recordInvariant` 只记录一次，判定与渲染都读它），不会出现
  「CI 说过了、报告说没过」的分叉。

**代价 / 限制**：

- Fake 档**测不到**：long task、真实 SDK 重绘 / 帧调度 / FPS、堆增长、官方侧真实网络与 AK
  鉴权路径。报告的「本档测不到」一节逐条列出，**禁止把 Fake 读数外推到浏览器**。
- 渲染次数的计数依赖 **dev 构建**的 devtools 钩子；生产构建下 `perf:start` 不发，本档读数
  在生产 bundle 上无意义（它只用于本档诊断）。
- `packages/test-utils` 的 Fake 多了一个 `emitTilesLoadedOnFirstView` 夹具开关。它**不是**可
  被断言的官方语义（真实 SDK 的 `tilesloaded` 由瓦片加载驱动，Fake 没有瓦片），`reset()`
  刻意不清它——它是「这份 Fake 扮演什么角色」的配置，不是「本轮发生过什么」。

**回滚**：删掉 `official-contrast` job 与 `perf:contrast` 入口即可；主档是**纯读数 + 不变式**，
没有任何生产代码依赖它，因此回滚不留下悬空引用。`emitTilesLoadedOnFirstView` 若无人使用，
应连同 `FakeMap.centerAndZoom` 里的那段延后派发一起删除（不留「以后可能有用」的扩展面）。

## 非目标

- **不做**跨机器的绝对毫秒阈值，不做统计显著性分析，不建基准平台（沿用 #37 的同一口径）。
- **不**为了让对照好看而给简单 Marker / Map 路径加优化层。票面明确：官方更轻就如实记。
- **不**伪造官方等价物，**不**用别的组件冒充缺失的场景。
- **不**在文档里写未经本票支持的百分比或「X 倍更快」。对外定位（#141）只引**可复现的结论**
  （实例重建数、SDK 写入数、残留资源数），不引绝对毫秒。
- **不**改 `packages/bmap-vue/src/**` 的任何生产语义（见决策 8）。

## 参考

- issue #140（票面：10 场景 / 8 指标 / 结果使用规则 / 验收标准）
- `tests/performance/officialScenarios.ts`（场景表，单一事实源）
- `tests/performance/officialContrastHarness.ts`（两侧装配、Fake 双账本、ready 口径）
- `tests/performance/vueRenderCounter.ts`（渲染次数的观测口与两个必须踩准的实现事实）
- `tests/performance/official-contrast/report.mts`（信封 / 退出码 / 人读报告，纯函数）
- `scripts/collect-official-contrast.mts`（编排：spawn → 读 JSON → 判定 → 退出码）
- `docs/zh-CN/contributing/performance-baseline.md` 的「官方对照档」一节
- `2026-09-21-performance-baseline-and-worker-decision.md`（单库趋势基线，与本条口径不同）
