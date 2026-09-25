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
| 包体档 | `pnpm perf:contrast:bundle` | ✅ 已跑，确定性字节门禁 |

### 1a. 真实浏览器档**尚未完成双边对照**，因此本 PR 不关掉 #140

首轮评审指出：live 档的 `measureOfficial()` 恒返回 `null`，唯一的场景是「本库扩展档」，
于是那一档虽然能 `exit 0`，却**没有任何官方侧读数**。一个「可 exit 0、但没有 official
侧」的骨架若在 PR 上写 `Closes #140`，就会把 issue 的验收项提前关掉。

因此：

- **本 PR 不使用 `Closes #140`**，改用 `Refs #140` + 一条明确的 follow-up issue 接手
  「真实浏览器档的双边对照」（拿到 AK 之后做）；
- live 档的已知缺口写进 `tests/browser/official-contrast/main.ts` 的注释与本 ADR，
  不用「骨架已完成」的措辞。

这不是拖延：票面要求的「与官方同场景对照」在 Fake 档（主档）已经真的做了，live 档补的是
Fake 测不到的 long task / 重绘 / FPS / 堆增长——它需要真实 AK，本轮拿不到。把两件事混成
一件会让主档的可复现性被 live 档的「不可跑」拖住。

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

### 7. 计时窗只包住「动作」，且**两侧切分必须逐场景对称**

每个场景拆成 `setup → act → teardown`，只有 `act` 进计时窗。但「切在哪」必须**按场景性质**
定，并且**两侧一致**（首轮评审第 2 条）：

| 场景类型 | 切分 | 理由 |
| --- | --- | --- |
| **挂载型**（§1/§2/§6/§7/§9） | 挂载留在 **act** | 动作**就是**挂载。放进 setup 会让 `act` 变空、`recreates` 恒读 0——基准空转 |
| **更新 / 生命周期型**（§3/§4/§5/§8/§10） | 挂载与 ready 等待移进 **setup** | 被问的是「换数据 / 改状态」，首挂是准备 |

此前官方侧在 §3/§4/§5/§8 把 `mountOfficial()`（含 ready 等待）留在 act 里，而本库侧在
setup 里挂——官方侧的时长 / 重建数 / 渲染数把「首挂 1 000 个 Marker」一起吃进去，两侧量的
不是同一件事。这不是理论风险：修之前 §3 官方侧读到 `recreate=1001 / render=1001`，把
1k **换位置**读成了 1k **挂载**。修之后是 `setPosition=1000 / recreate=0`。

对齐 ready 口径时打开了 Fake 的 `emitTilesLoadedOnFirstView`（夹具开关，不是官方语义）：
官方 ready 从 ~500ms 降到 ~8ms。否则「本库立即 ready / 官方 500ms 后 ready」会被读成两库
的性能差。

**更新场景必须断言「真的更新了」**（首轮评审第 1 条）。§3 的渲染闭包此前捕获 `first`
而不是读 `data.value`，于是换引用不触发任何重渲染，而「0 次重建」在 no-op 下**恰好也是 0**
——两件方向相反的事互相抵消，基准全绿。现在 §3 钉住语义前提：`setPosition` 恰好 1 000 次、
重建恰好 0 次；§4/§5 的 `setPath` 断言同理由 `sdkCallKind` 带上具体调用面名。

### 8. benchmark 不得成为改生产语义的理由 —— 门禁化，但**只对 benchmark PR 生效**

这条不写成文档提醒，而是**门禁**：`tests/behavior/official-contrast-gate.test.ts` 断言
**本 PR 的 base 相对 HEAD 没有动过 `packages/bmap-vue/src`**。要让对照跑绿就去改 `src/`，
门禁会红。

⚠️ 比的基准必须是 `base…HEAD` 三点语法，**不是** `HEAD`（首轮评审第 5 条）：`git diff HEAD
-- src` 在**干净的 CI checkout 上恒为空**（工作区 = HEAD），哪怕本 PR 的提交里真的动了 `src/`。

⚠️⚠️ 但这条约束是「**#140 这张 benchmark PR** 的属性」，不是「仓库从此禁止任何 PR 改 src」
（二轮评审第 2 条）。做成无条件永久 `test:unit` 用例的后果是：#156 合并后，下一张**任何**正常
修改 `src/**` 的 PR 都会在 Unit & behavior tests 里红；push 分支还会拿
`github.event.before…HEAD` 做同样限制。因此它是**显式 opt-in**：

| 触发条件 | 行为 |
| --- | --- |
| PR 打了 `benchmark-no-src-change` 标签 | CI 注入 `CONTRAST_DIFF_BASE` + `CONTRAST_ASSERT_NO_SRC=1`，门禁断言 src 零改动 |
| 没有该标签 | 门禁**不适用**（不是「通过」）；`test:unit` **不再**被注入 base |

两个环境变量必须**成对出现**（用例会校验），否则无法区分「本该断言」与「不适用」——只注入 base
会让正常源码 PR 误伤，只注入 flag 则让这条门禁永远不跑。接线（标签门控 + 不在 `test:unit`
里）由另一条用例单独钉住，防止它被悄悄删掉后没人发现。

### 9. AK 绝不入库，且**不进任何会被别人读到的通道**

Fake 档与包体档根本不需要 AK（官方侧 provider 传的是字面量 `"fake"`）。真实浏览器档的 AK
**只从 `BAIDU_MAP_AK` 环境变量读**，并由编排脚本经 **CDP** 注入页面。门禁断言代码里没有写死的
AK 字面量。

「不入库」是最低要求，**不够**：AK 还要不进**别的进程、日志与产物能读到的地方**。四条常见
路径各自被否掉，各有理由：

| 路径 | 为什么不行 |
| --- | --- |
| `import.meta.env.VITE_*` | vite 会把它**内联进构建产物**——AK 落进可能被上传的 `.artifacts` |
| 页面 URL 查询串 | URL 是 chrome 的**命令行参数**，因此进 `ps`（同机器任何进程可无凭据读）；它同时是 vite 的一次请求 URL，而 vite 的 info 级请求日志会写进 stdout——**CI 里 stdout 就是 job log**，读者范围比 secrets 大得多 |
| `--ak=` 命令行 | 同上，且它进的是**本进程**（`ps` 同样看得到）。环境变量至少不进 OS 进程表 |
| 子进程继承父 env | vite 会把 env 内联进产物（见第一行）；chrome 继承则让 AK 进入浏览器进程的整份环境，而浏览器进程是**会被崩溃报告 / 调试器附加 dump** 的那一类 |

因此：**编排不接受 `--ak=`**（只读 `BAIDU_MAP_AK`）；**vite 与 chrome 都拿一份
`BAIDU_MAP_AK` 被显式删掉的净化 env**（`childEnvWithoutAk()`）；AK 只走 **CDP**（本进程持有的
内存 socket），页面用 `window.__CONTRAST_AK_TAKEN__` **领一次**、领完自删（不留给后续
`Runtime.evaluate` 读走）；vite 配置 `logLevel: "silent"` 让它根本不打请求行；编排**不接受**
`--verbose`。报告里只有 `akUsed` 布尔，**没有 AK 字段**。`redactAk` 仍保留在 stdout 与落盘
JSON 两条出口——按「页面错误消息可能含敏感串」处理，不当第一道防线。

（`scripts/collect-live-performance.mts` 里仍是 URL 传 AK 的旧写法；那是 #123 的既存文件，
本票不改它，另票处理。）

### 10. 包体档（指标 8）**不判谁比谁小**，只判本库相对自己的基线

票面的第 8 项指标是「bundle / tarball 入口大小」。这一档的结论与前两档**方向相反**：
本库的基本路径**比官方大**（入口 194 704 B vs 107 055 B）。如实记，不为了「赢」去加优化层。

之所以不判胜负，是因为两库的**打包形态根本不同**：本库是多 chunk、根入口重导出全部
组件 / composable / 图层 / 服务并静态引了官方 loader（Official-first 的默认在线路径）；
官方是**单文件**产物（`dist/index.js` 一处装全，`sideEffects: false` 但没有可摇的粒度）。
这是上游事实，不是谁更强——把它做成门禁等于用别人的打包形态当标尺。

三道防止这条读数被做假的约束：

1. **两侧入口形状必须逐项相同**（`BMapProvider` / `Map` / `Marker` / `InfoWindow`），并且这是
   **门禁**：从两个入口文件解析出具名 import 集合断言相等。挑轻量面（少 import 一个）就能把
   包体差做小——这是这条读数最容易被操纵的地方，所以钉在代码上而不是钉在约定上。
2. **入口必须写成顶层副作用**：只有 `export const` 的入口会被摇成 0 字节，量到的「包体」
   是「什么都没打包」。脚本另有 `BUNDLE_EMPTY_PROBE` 守卫。
3. **打包条件进报告**（`external[vue] minify=true target=es2020`）：换任何一项数字就换意义。
   `vue` 是 peer 依赖由应用提供所以 external；`@vueuse/core` 与 `@baidumap/jsapi-loader`
   **不** external——剔掉它们会把真实的消费方成本藏起来。

**发布物字节排除 `.map` 与 `.d.ts`**：两侧发不发 sourcemap 是发布偏好（本库 17 张 map 共
5.6 MB，官方 0 张），算进去量到的是「谁更爱发 sourcemap」而不是「库有多大」；`.d.ts` 只在
编译期被读，浏览器一行都不下载。压缩后的 tarball 体积不属于这一档——那是 `verify-package` /
npm 的账。

**基线是独立文件** `tests/performance/bundle-baseline.json`，**不**混进 `baseline.json`：
后者是运行时指标集且有一��双向校验，混进去会让它炸掉；更要紧的是「运行时回退」与「包体回退」
的失败处理不同——前者跨机不可比、只出报告，后者是确定性字节差、可以当门禁。

### 11. 指标**按它实际量的东西命名**，票面量不到的原口径进 `notMeasured`

首轮评审第 8 条指出两处列名与票面原词不符。处理原则是**宁可改名，不可让列名冒充它量的
东西**——名不副实的读数比没有读数更坏：

| 票面指标 | 本档实测量 | 处理 |
| --- | --- | --- |
| 「SDK 调用次数」 | **某一个调用面**的次数（`listen` / `setPosition` / `setPath`） | 报告带 `callKind` 名字，票面「总数」进 `notMeasured`（真实与 Fake 都没有单一计数器） |
| 「watcher 回调次数」 | **组件渲染**次数（devtools `perf:start`，dev-only） | 列名写明是渲染，票面「watcher 回调」进 `notMeasured`（Vue 3 无公开 watcher 计数面） |

`notMeasured` 是这套 benchmark 的一等公民：它让「哪些票面项本档真的没量」变成报告里的显式
清单，而不是靠读者猜。`formatContrastReport` 末尾另有一节「口径注记」，提醒读者别把
`listen`/`render` 读成票面原词。

### 12. 「采齐了没」数**真测到的**场景，且可比场景缺一侧要被报出来

报告的 `buildScenarioReadings()` 永远按场景表逐条产出一行（没跑到的填 `ours: null`），因此
`report.scenarios.length` **恒等于**场景表条数——拿它判「采齐了没」是一条恒真的假绿路径
（首轮评审第 6 条）。编排因此数 `ours !== null` 的行，并额外要求：每条声明了官方等价物
（可比较）的场景**真的**拿到官方侧读数（`officialSide !== null`），否则报
`INCOMPLETE: 可比场景缺官方侧读数`。缺一侧不是本库的失败，但它**不是**「已对照」。

同理，**基准红了不等于脚手架坏了**（首轮评审第 7 条）：不变式被破坏时 vitest 非零退出，编排
**按报告自身判定结算**（可能是 1），只有报告缺失 / 读不出来才归 2。文档里写的「1 = 不变式被
破坏」在唯一正式入口 `pnpm perf:contrast` 上必须真的可达。

⚠️⚠️ **反方向那条假绿更严重（二轮评审第 1 条）**：基准里有大量**普通 `expect`** 不写进
`invariants` 判定模型（§3 的 `setPosition` / `recreates`、卸载残留归零、§6/§7 的资源构成、
§10 的不重建……）。其中一条挂掉时 vitest 非零退出，而 `afterAll` 仍会写出一份
`done=true` / 10-10 / 不变式全 PASS 的报告 ⇒ 判定 **0**。若把判定原样写进
`process.exitCode`，**测试失败就被吞成通过**。

因此结算规则是：报告判 **1/2/3** 就原样透传；**只有「报告判 0 而进程非零」这一组合归 2**，
并打上 `VITEST_FAILED_UNMODELLED` 说明归因。实测（临时注入一条失败 expect、跑完整 10 场景）：

| 状态 | 修复前 | 修复后 |
| --- | --- | --- |
| 10 场景全测到 + 不变式全 PASS + 一条普通 `expect` 挂 | **0（假绿）** | 2 + `VITEST_FAILED_UNMODELLED` |

### 13. 卸载/销毁是**独立计时窗口**，与动作窗口分开

票面指标 5 写的是「mount/unmount time」——两个动作。合成一个数字就无法归因「慢在挂载还是慢在
卸载」；只报一个数字则会让读者以为两个都测了——而场景名恰恰同时含两个动作（"mount / destroy"、
"mount / unmount"），此前 `durationMs` 只包 `act()`、teardown 完全在窗外，销毁成本没有任何读数
（二轮评审第 5 条）。因此 `SideReadings` 带 `teardownMs`，报告里渲染成 `act=…ms teardown=…ms`，
差值列也带 `teardownΔ`。**不合并**：合并后时长不再可归因，而这正是这套基准唯一在意的维度。

### 14. 两套基准**执行范围隔离**，共用一个指标目录是不许的

#37 单库趋势基线与 #140 跨库对照是**两件不可互相替代的东西**，指标集形状也不同（前者固定
一列参与 `baseline.json` 双向校验，后者 `*.ours` / `*.official` 成对出现且随场景表增减）。
曾���只有一份 vitest 配置（include 覆盖 `tests/performance` 全部 `.test.ts`），于是
`perf:baseline` 顺带跑了对照基准，把 `map.lifecycle.ours` / `marker100.mount.official` ……
写进**同一个** `PERF_METRICS_DIR`，基线的指标集合校验随之确定性红（二轮评审第 3 条，
Actions run 36092344781 实锤）。

隔离**做在配置层**，不靠「记得别跑那条命令」：基线配置 `exclude` 掉对照基准，对照基准有自己的
`official-contrast.vitest.config.ts`（从基线配置**派生**并覆盖 `include` / `env`，共享项不许
手抄漂移），并把 `PERF_METRICS_DIR` 钉到基线目录**之外**的绝对路径。

把跨库指标录进 `baseline.json` 是有害的：场景表一改就红，且官方侧的毫秒会挡住本库自己的趋势。

### 15. 报告形状守卫**验到元素**，且住在**纯模块**里而不是编排脚本里

「报告读不出来」必须按**脚手架失败 2** 结算，而 1 在本脚本的合同里专指「本库不变式被破坏」——
把两者搞反是**误报方向反了**（三、四轮评审第 1、2 条）。但「能 `JSON.parse`」不等于「能用」：
`checkContrastEnvelope` 会解引用 `report.envelope.runId`、`measuredScenarioCount` 会读
`entry.ours`、`decideContrastExit` 会读 `invariant.holds`——这些都是**裸解引用**，遇到形状不对
的 JSON 会抛 TypeError；它从顶层 `await main()` 逃出去后，Node 默认以 **1** 结束。垃圾报告于是
又被报成「不变式回退」。

⚠️ **验到元素这一层不是洁癖**（四轮评审第 1 条，P1）：`scenarios: [null]` 能过「是数组」那一关，
随后 `entry.ours` 解引用 `null` 崩掉。实测修复前 `pnpm perf:contrast` 对这种报告正是 **exit 1**。
所以判据是「**下游会不会解引用它**」，一路验到数组元素（元素为 `null` / 数组同样会崩），不做
全字段校验。

⚠️ **守卫住在纯模块**（`official-contrast/report.mts`）**而不是编排脚本**里：住脚本里就只能用
「文件文本断言」钉，于是断言与被钉的代码各改各的——上面那个 P1 正是这么漏过去的。移进纯模块
后门禁对**合成输入**断言（包括 `scenarios: [null]` 这条），不再是正则。已实测 10 种畸形报告
（截断 / `{` / `[]` / `null` / `"s"` / `envelope:null` / `envelope:"x"` / `scenarios:{}` /
`scenarios:[null]` / `invariants:[null]`）全部按 **2** 结算，且消息指名具体哪一条不对。

### 16. 读数**入库**为「快照 / reference result」，刻意**不叫 baseline**，也**不判漂移**

票面验收第一条要「数据与脚本入库」。`.artifacts` 被 `.gitignore` 排除，跑完的读数默认不留痕。
因此采集编排带一个**显式** flag `--record-reference`，把当轮读数整形成稳定 schema 写进
`tests/performance/official-contrast/recorded-result.json`；它带着 **provenance**：
`sourceCommit`（真 SHA，**不是** `HEAD~1` 这类引用，也不是 `unknown`）、`recordedAt`、
机器身份（`platform`/`arch`/`cpuModel`/`node`/DOM）、`datasetVersion` 与两个库版本。
只有 `recordedAt` 的话，几年后只剩一个日期，对不上代码——所以 SHA 是必填。

⚠️ **它不是 baseline，名字与语义都刻意避开那个词。** #37 的 `tests/performance/baseline.json`
是**真基线**：后续运行会拿它做趋势判定，带 normalizer / tolerance / 机器身份比较。本机制
**不做**这件事，也不该被后来的人加上——票面明说「不做谁整体更快的营销排名」，毫秒在 GitHub
runner 与开发机上完全不可比。一旦快照参与漂移判定，维护者迟早会补上 tolerance、runner 换 SKU
处理、跨机归一化，那正是本票要避免的机制。落地口径：

```text
perf:contrast
  ├─ 产当前 report
  ├─ 用 invariants 判 CI（1 / 2 / 3 / 0）
  └─ **不**与 recorded-result.json 做任何毫秒比较
```

编排**只写不读**快照（判据是「有 `writeFileSync(REFERENCE_PATH)`、无 `readFileSync(REFERENCE_PATH)`」，
由门禁断言）。`runId` / `startedAt` / `finishedAt` / `durationMs` 这些一次性编排字段**不录**：
每次都变，录进去只制造无谓 diff，掩盖「读数真的动了」。

**保鲜门禁有两条，且刻意都不是性能门禁**：

1. **场景 ID 必须与场景表完整一致**（不多、不少、不重）——场景表改了却没重录，读数会静默对不上票面；
2. **envelope 合法**：schema `version` / `datasetVersion` / 官方 `1.0.1` / `sourceCommit` 是真 SHA /
   扩展档带官方跳过原因。

**明确不做的**：断言「当前毫秒接近快照毫秒」。那会把快照变成基线，正是上面要避免的。

**人读视图是生成物，不是手抄的第二份数字。** A+B 最大的坑是两份事实源漂移：JSON 一套数字、
Markdown 又手抄一套，下次更新快照忘了更新文档，两边慢慢对不上且**没有任何门禁会响**。因此
`docs/zh-CN/contributing/performance-baseline.md` 里那段是
`pnpm generate:official-contrast:reference` 生成的，`…:check` 按字节比对；渲染措辞写死在
`referenceReport.mts` 里（不排序、不给百分比/倍数、毫秒必带「非跨机阈值」那句），改文案等于改代码。
渲染刻意分两节，对应验收第二条点名要「**解释**」的两件事：简单路径**如实给同轮原始读数**（不预设
谁更贵——上一版曾把「本库的抽象是有成本的」写死在渲染里，而同一份快照的表显示本库更快，一句
硬编码结论被自己生成的数据当场否掉）；高级路径讲**结构差**（`recreate` / 调用面 / 残留）而不是倍数。

### 17. 「本档测的到底是什么」写进**数据**，并由渲染层据此加限定语

票面对照版本写「本库最终 1.0 RC tarball」、环境写「同 JSAPI 4.0」。本档两条都达不到，且
**达不成就得写出来**：

- 组件场景导入 `packages/bmap-vue/src/**`，而快照同时记 `oursVersion: 1.0.0-rc.0`
  （读自 `package.json`）。两者都真，但**合起来是误导**——provenance 说的那个构建从未被加载；
- 无 AK ⇒ 没有真实 JSAPI。官方库经 `jsapi-loader` 复用已存在的 `window.BMap`（本仓库 Fake v4）。

因此快照带 `engine { kind, version, oursUnderTest }`（三字段缺任一条即门禁红），渲染层**据此**
加限定语：被测对象写成「本库**源码**……**不是**打包产物」、引擎写成「Fake v4 替身……**不是**
真实 JSAPI」。⚠️ 这段必须是**数据驱动**的：`engine` 改成 `dist` / `real` 时文案要跟着变，
否则它只是装饰。上一版只列机器身份，表格照旧摆出一张「同 JSAPI 4.0」模样的表——落在那节
的人会把源码读数当成发布物读数。

「Fake 4.0 的 `v=4.0`」这类含糊说法也一并去掉：引擎版本就是 `fake-v4` 这串字符串，**如实记下**
测的是哪套引擎，而不是让 `4.0` 指代一个从未加载过的官方 SDK。

### 18. 简单/高级分档住在**场景表**，且缺读数**必须说出来**

票面要人读报告「**解释**」简单路径成本与高级路径收益，这个分档因此是**叙事结构**，不是排版细节。
上一版把它写成渲染器里两个**硬编码 id 数组**，代价有两处：分档没有数据来源；更糟的是
`if (!entry) continue` 让「场景表里的某行没读到 / 被删掉」**只少一行、不报错**——静默少报，
正是 decision 15 为 `report.mts` 修掉的那一类。

改法：`ContrastScenario` 加 `tier: "simple" | "advanced"`（分档落在**事实源**里），
渲染器按档取**可比较**（`official !== null`）的行，缺读数走显式提示行而不是 `continue`。

⚠️ 这条改动**当场抓到一个真实漏报**：`router-remount` 的读数此前**从没被打印过**（不在硬编码
列表里），重构后自动出现。另有一个坑：扩展档（`official === null`）本就无官方读数，列进对照表
再报「缺读数」是**自己造的假警报**——因此对照表只取可比较行，扩展档仍由「本库扩展档」一节交代。

「可复现的结构差」那句也从写死 `marker-100-mount` 改为**在简单档里选残留差最大的那一行**：
数字与场景都从上游来，场景改名或读数变化时它自己跟着走。

### 19. `.mts` 必须进 `tsconfig.tests.json`——不然类型错误只靠人眼发现

七轮评审的**唯一硬违规**：`reference.mts` 写着 `readonly engine: ReferenceEngine`，而
`ReferenceEngine` **全仓库没有声明**（单独 tsc 即报 `TS2304`）。`pnpm typecheck:tests`
之所以全绿：`tsconfig.tests.json` 只 include 了 `tests/performance/**/*.ts`，而 #140 的三个
模块（`reference` / `referenceReport` / `bundle`）都是 `.mts`——**整个 reference 快照机制
（最近两个 commit）此前完全不在类型门禁的编译范围里**。同一份 tsconfig 里
`tests/browser/official-contrast/**/*.mts` 那条恰好说明作者知道 `.mts` 要单列，只是漏了
`tests/performance` 这一侧。

⚠️ 这条教训比那个类型本身重要：**门禁只查「值」，类型错误没人看**，于是两轮评审、六次
mutation 测试全绿，一个从没声明过的类型就这么躺在被引用处。已补 `export interface
ReferenceEngine` + `"tests/performance/**/*.mts"`，并实测新覆盖面会红（往两个 `.mts` 各塞一个
类型错误，exit 2）。补覆盖时当场抓到我自己引入的 TDZ 排序错误——正是补上覆盖的价值。

### 20. `sourceCommit` 必须**真的**指向录出快照的那次跑

同上评审抓到：我上一轮在 `engine` / `tier` 改动**还没提交**时录了快照，`git rev-parse HEAD`
记下的是**父提交**——那个 commit 里的快照**没有** `engine` 字段。而渲染层把这个 SHA 当权威
来源印在表头。快照机制存在的全部意义就是「对得上代码」，这一条正是它要防的那件事，而**没有
任何门禁能抓到**：原判据只断言「是个 SHA」，假 SHA 一路照过。

判据因此改成「**那个 commit 里真的存在这份文件、且 schema 对得上**」。这不是门禁洁癖：
一个指向「没有这份快照」的 commit 的 SHA，是一份**假 provenance**，而它恰好印在最显眼的位置。

### 21. 简单路径的「成本」要**解释**，但方向不预设

验收第二条要人读报告解释「简单路径成本」。此前该节只有一句「方向由数据决定，本文不预设结论」
——那**不是解释**，是把解释的责任推给读表的人。补上结构成本（`listen` 调用面、渲染次数，
两者都跨机成立、可在别的机器上重跑复核），毫秒那两列仍由表说话。

⚠️ 补的过程中**同一类错又犯了一次**：先写成「本库在简单路径上多付的正是这层抽象」，而同一段
里自己算出来的读数是本库 `listen` **少** 924、渲染**少** 99。这与更早那次被自己的表否掉的
「抽象是有成本的」是**同一个 bug**，所以结论句现在也钉成数据驱动：`oursHeavier` 为假时就不许
出现「多付」。已用「把本库读数改成 99999」验证措辞会跟着变。

### 22. 指标 6 可测的那半要进表；引擎 `kind`/`version` 要成对

- `retainedListeners` 是票面指标 6「heap delta / retained listeners」**可测的那半**（heap
  delta 本档测不到，已进 `notMeasured`）。它此前被结构摘要漏掉——**全为 0 时漏掉也看不出来**，
  正是最容易被静默丢的一列；
- `engine.kind` 配 `engine.version` **成对**校验：`kind: "fake"` 配 `version: "4.0"` 能过校验，
  而这组读数会冒充「跑在真实 JSAPI 4.0 上」——本票最忌讳的含糊，也是 AGENTS.md 对引擎取值那条
  要求的同一类。`ENGINE_VERSION_BY_KIND` 成为**唯一**配对表（编排取它、校验验它）。

## 后果（含回滚）

**得到的**：

- 一条**可复现、可入 CI** 的跨库对照（`.github/workflows/quality.yml` 的 `official-contrast`
  job，上传 `official-contrast-report` artifact）。job 只在**不变式破坏 / 脚手架坏 / 没跑成**
  时失败，不会因为 runner 快慢而红。
- 一份**可核对**的 10 场景清单（场景表是数据，报告逐条列出，未跑到的也留行）。
- 本轮如实记下的**架构差**：官方 `Marker` 卸载后 100/1000 个覆盖物仍挂着（`retained=100` /
  `1000`）；1k 位置更新两侧都复用实例（官方 `recreate=0`、本库 `recreate=0`，各发 1000 次
  `setPosition`），差别在**组件渲染**（官方 `render=1001`、本库 `render=2`）与**残留**
  （官方 1000、本库 0）；官方 `Polyline` 卸载后覆盖物未摘（`retained=1`）。这些是**读数**，
  不是攻击点，但它们是可复现的。

  ⚠️ 这里刻意**不再**写「官方 1k 更新重建 1001 个覆盖物」：那是计时窗修好**之前**的读数
  （把首次挂载误算进更新窗口），ADR 决策 7 已经记了那次误判。当前 CI 读数以报告为准，
  已确认失效的数字不再对外引用（第 2 轮评审第 4 条）。
- 报告与门禁读**同一个来源**（`recordInvariant` 只记录一次，判定与渲染都读它），不会出现
  「CI 说过了、报告说没说」的分叉。
- 一条**确定性**的包体门禁：本库基本路径入口相对**自己**的基线变大即 exit=1。与机器无关，
  可以像 CI 那样跑而不受 runner 快慢影响。首轮如实记下「本库比官方大」这个事实。

**代价 / 限制**：

- Fake 档**测不到**：long task、真实 SDK 重绘 / 帧调度 / FPS、堆增长、官方侧真实网络与 AK
  鉴权路径。报告的「本档测不到」一节逐条列出，**禁止把 Fake 读数外推到浏览器**。
- 包体档的「基本路径」是**四件套**（Provider + Map + Marker + InfoWindow），不是最小单组件。
  它也不覆盖路由 / 5 万点图层 / UI Kit 入口——那些是**别的场景**的口径，混进来会把能力差
  算成包体差。
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
- `tests/performance/official-contrast/bundle.mts`（包体档的判据与渲染，纯函数）
- `scripts/collect-official-contrast.mts`（编排：spawn → 读 JSON → 判定 → 退出码）
- `scripts/collect-bundle-contrast.mts`（包体档编排：两次真实打包 → 度量 → 对基线）
- `fixtures/consumer/shake/basic-{ours,official}.ts`（两侧同形状的「基本路径」入口）
- `tests/browser/official-contrast/**` + `scripts/collect-official-contrast-live.mts`（真实浏览器档骨架）
- `docs/zh-CN/contributing/performance-baseline.md` 的「官方对照档」一节
- `2026-09-21-performance-baseline-and-worker-decision.md`（单库趋势基线，与本条口径不同）
