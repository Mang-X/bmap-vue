# Clean-slate 1.0：删除 fork / 迁移 / 兼容包袱（#136）

- 状态：Accepted
- 日期：2026-09-25
- 关联：issue **#136**（本 ADR 的交付物）、**#134**（1.0 身份复位，决策 3「不增加 alias / shim /
  迁移兼容层」、非目标点名「删除 legacy 源码或迁移工具；这些工作由 #136 负责」）、
  **#26**（删除 `webgl-v1` / `jsapi-v3`，前置事实）、**#135**（公开 API 命名对齐官方风格，
  同为 clean-slate 票）、**#104**（ownership-first / evidence-before-abstraction 口径与存量审计表）
- 取代范围：**不取代任何已接受 ADR 的决策**，只**结算**其中「迁移期资产」的存废。
  `2026-09-14-remove-legacy-engine` 的决策原文、`2026-09-18-overlay-event-matrix`
  （集中弃用层的**设计**理由）与 `2026-09-19-custom-overlay-and-context-menu`
  （别名读取规则的**设计**理由）按仓库约定（已接受即冻结）不改写——它们记录的是
  「当时为什么这么建」，本 ADR 记录的是「1.0 为什么把它拆了」。

## 背景

本库从 `yue1123/vue3-baidu-map-gl`（JSAPI GL v1 / `BMapGL` 时代）迁移到 JSAPI 4.0 之后，
仓库里沉淀了一整套**只服务于「证明那次迁移完成了」**的资产。它们的共同特征是：
**没有生产消费者，只有一个迁移动机**。

#134 已把发布身份重置为 `bmap-vue@1.0.0-rc.0`，#135 已完成 API 命名对齐，但迁移期的机制本身
还完整地留在树里：一个集中弃用层（prop / event 兼容别名 + per-instance warner）、一套
`"alias"` 字段更新策略、三个兼容别名、两个 `@deprecated` 字段别名、一个 v2→v3 codemod、
三篇迁移指南、一道证明旧引擎不会回来的独立门禁、81 个 `v3-` 前缀测试文件，以及一个
`run: echo "..."` 的 CI 空步骤。

**继续保留它们有两个具体代价，都不是「不好看」这种审美问题**：

1. **假支持**。`InfoWindow` 的 `show`、`GroundOverlay` 的 `startPoint` + `endPoint`、
   `ContextMenu` 的 `menuItems`、`Marker` 的 `drag-end` 都在 props / emits 的**公开类型面**上。
   1.0 的读者无法从类型上区分「这是当前契约」与「这是迁移动机」——而 issue 的验收项要求
   「clean install + tarball 消费方在不知道旧项目存在的前提下完整可用」。
2. **门的空转**。`check:no-bmapgl` 的唯一职责是证明 #26 的删除不可回退——而 #26 早已合并、
   单引擎基线早已稳定（#126 还把能力目录的引擎维度整个删了）。一道只能证明历史的门，
   与没有门对「未来是否回退」的判别力相同，但它要占一个 CI step 与一份独立脚本。

## 决策

**1 —— 使命完成的机制直接删除，不留「以后可能有用」的兼容层。**

删除：集中弃用层整层（`core/deprecations/**` 及其两个公共出口）、旧 prop / event 名
（含 `initd`）、`OverlayFieldUpdate` 里的 `"alias"` 策略、`BMapClient.version`、Fake SDK 的
`stats` 别名、`createBMapPlugin` 的 `globalProperties` 映射与告警、v2→v3 codemod、
三个失效 npm 脚本、三篇迁移/破坏变更文档、CI 空步骤与两条 v2 墓碑注释、`v3-` 测试文件前缀。

**`initd` 与 `MAP_EVENT_EMIT_ALIASES` 的区别**（本次唯一需要判别的一对）：`initd` 是**上一个库版本
的事件名**（旧版用它表达就绪），文档里一直标 deprecated；`MAP_EVENT_EMIT_ALIASES` 是**同一个 SDK
事件的无损双拼写**（`style_loaded` ↔ `style-loaded`），双方都还在上游活着，删任一边都会让用户
收不到事件。前者是迁移包袱，后者是当前契约——所以前者删、后者留。

`initd` 删掉后，组件级事件别名的整条通道（`BMAP_COMPONENT_EVENT_ALIASES` /
`BMAP_COMPONENT_EVENT_EMIT_ALIASES` / `MapComponentEventAliasName` / `MapComponentEmitName`）
空掉且零消费者，按 #104「没有消费者的扩展面一律删除」一并删，不留一张恒空表。

判据沿用 #104 的 **Evidence-before-abstraction** 倒过来用：判据退化成常量、没有消费者、
或官方已提供抽象的，一律删除。这批资产全部命中，且**没有一个有生产消费者**。

**2 —— 旧引擎残留门禁不是删除，是并入。**

`check:no-bmapgl` 被删掉了，但它的三份覆盖**一份都不能跟着消失**。审计发现它比初判更关键：
`check:raw-sdk --src` 对 `driver/**`、`client/**`、`core/loader/**`、`plugins/**` 是 skip 的；
`check-public-dts` **不**禁 `"webgl-v1"` / `"jsapi-v3"` 字面量；`check-raw-sdk` **没有**
「扫描范围为空即失败」的守卫。三者合起来意味着：合并前若直接删掉那道门，
**白名单目录里的 `BMapGL`、发布产物上的 engine 取值、目录配错导致的静默放行**会同时失守。

因此先把「旧引擎残留」这条能力**下沉进 `check-raw-sdk`**（`collectLegacyViolations()` +
`--declarations` 相位 + `scanned === 0` fail-closed），跑绿，再删旧脚本与旧测试。
测试**移植**进已有的 `raw-sdk-scanner.test.ts`，不新建文件——按 #104 的 Ownership-first，
新建一份只为「覆盖刚被删掉的门」的文件是纯冗余。

其中最关键的一条实现约束：`namespace-declaration` 是**双用途**规则（同时覆盖 `namespace BMapGL`、
`namespace BMap` 与 `declare global`），按规则**名字**过滤会静默漏掉 `namespace BMapGL`。
必须像旧门禁那样**从 AST 节点重新判定**。这条已由「白名单路径里的 `namespace BMapGL`」
的回归用例钉死。

**3 —— 官方事实与工程史一律保留。**

以下关键词即使与「旧引擎」字面相关，也**不是**本票的包袱，因为它们描述的是当前事实：

| 关键词 | 为何仍需要 |
| --- | --- |
| `BMapGLLib`（`plugins/builtins.ts` 的 CDN URL 与全局解析） | 官方 4.0 时代仍在用的插件库命名空间（`BMap-JavaScript-library`） |
| `BMapGL` 作为 JSAPI 4.0 的**同对象别名** | 官方 4.0 入口自己挂的；`namespace.ts` 只认 `BMap` 正是**因为**它存在；Fake 按真实形状镜像 |
| `check:raw-sdk` / `check:public-dts` 里的 `BMapGL` 违规标记 | 列进 `RAW_SDK_NAMESPACES` 正是**为了让它翻红** |
| `verify-package.mts` 的 `['baidu-map-gl-vue','3.0.0']` 拒绝表 | #134 发布身份重置的落地门禁 |
| `addDistrictLayer` / `addTileLayer` 的 `@deprecated` | **上游官方**弃用，不是本库包袱 |
| `MAP_EVENT_EMIT_ALIASES`（`style_loaded` ↔ `style-loaded`） | **同一个 SDK 事件**的无损双拼写，双方都还活着；与 `initd`（旧库版本的事件名）性质不同 |
| `loadOptions.version` / `LoadedJsapiV4.version` | 百度 **SDK** 版本（`4.0`），不是库版本线 |
| `docs/adr/**` 全部历史 | 仓库工程史。已接受的 ADR 一律不改写 |
| `NOTICE.md` / `README.md` 来源章节 / `LICENSE` 的 `Copyright (c) 2021 yue1123` | #134 决策 4 的归属义务——**本票只在其上补一句「1.0 不提供旧版迁移路径」，不删来源声明** |
| `CHANGELOG.md` 的 2.x 历史 | 发布记录 |
| `PointCollection` 注释里的「v3 的 `BMap.PointCollection`」 | 指**上游 SDK 类**的名字，不是本库版本线 |

**4 —— 版本线中性化。**

`v3-` 前缀承载三种含义（真功能测试 / CI 门禁自测 / 迁移证明），**无一有判别力**，因此整批
重命名（含 `quality.yml` 的 `v3` job id 与 8 个 step 名）。`v3-typecheck-gate.test.ts`
硬编码了那个 job id 与 3 个 step 名——改 workflow 必须同时改它，这是本次最容易漏的一处。
标题与文件头里「迁移验证」「v3 行为说明」这类措辞一并中性化。

## 后果

- **公共 API 破坏性变更**（1.0 clean-slate 正确）：弃用层 7 个符号、`InfoWindow.show`、
  `GroundOverlay.startPoint` / `endPoint`、`ContextMenu.menuItems`、`Marker` 的 `drag-end`、
  `<Map>` 的 `initd` 事件与组件级事件别名机制 4 个符号、`BMapClient.version`、`"alias"` 字段策略、
  `createBMapPlugin` 的 `globalProperties` 写入。
  全部记入 `major` changeset。`OverlayFieldMap` / `InfoWindowFieldMap` 是**穷尽**映射，
  删 prop 与删映射项必须同提交（`GROUND_OVERLAY_DESCRIPTOR_KEYS` 不是穷尽的，漏删只留死键；
  `ContextMenuFieldMap` 声明在内联匿名类型上，**无编译保护**，必须手工删）。
- **门禁数量减少，覆盖不减少**：一道门拆成一道门的三种模式（默认 / `--src` / `--declarations`），
  外加 `check:public-dts`。CI step 从 2 变 2（删空步骤、拆声明相位）。
- **测试数量减少**（约 90 条只证明弃用机制存在的用例被删），**判别力不减**：
  `v3-` 前缀的 81 个文件里绝大多数是真功能测试，只改名不删。
- **不取代任何已接受 ADR**。本票的取舍记录在这里，而不是回写进那 37 篇历史。

## 非目标

- **不删除 2.x 分支、发布记录或来源归属**：`NOTICE.md` / `README.md` 的来源章节与
  `LICENSE` 的 `Copyright (c) 2021 yue1123` 是 #134 决策 4 的义务，不是本票的债。
- **不改写任何已接受的 ADR**。`2026-09-14-remove-legacy-engine` 里对迁移指南的引用就地
  标注「已随 #136 下线」，是因为那是**活链接**（会挂 `docs:build` 的死链检查），
  不属于决策原文的改写。
- **不删官方事实**：`BMapGLLib` 插件命名空间、JSAPI 4.0 挂的 `BMapGL` 同对象别名，
  以及 `addDistrictLayer` / `addTileLayer` 的上游官方 `@deprecated` 都不动。
- **不改能力目录、门禁的判别力与 raw SDK 边界**：本票只搬迁门禁的实现位置，不放宽任何一条。
- 不补一份「旧版迁移指南」到别处：1.0 不提供迁移路径，保留一份「怎么迁到 1.0」的新文档
  与本票的命题相反。被删文档的内容已由 `CHANGELOG.md` 与本 ADR 承载。

## 参考

- issue **#136**（本 ADR 的交付物）
- [ADR 2026-09-14 删除旧引擎（webgl-v1 / BMapGL）与迁移期归一](./2026-09-14-remove-legacy-engine.md)——
  决策 5 的 `check:no-bmapgl` 在本票中**被并入** `check:raw-sdk`（不是取消）
- [ADR 2026-09-24 单引擎能力目录收口](./2026-09-24-single-engine-capability-catalog.md)——
  `engines` 维度删除后，「旧 engine 判定」在本票范围内已无残留
- [ADR 2026-09-18 覆盖物事件矩阵](./2026-09-18-overlay-event-matrix.md)——集中弃用层的**设计**理由
- [ADR 2026-09-19 自定义覆盖物与 ContextMenu](./2026-09-19-custom-overlay-and-context-menu.md)——别名读取规则的**设计**理由
- `docs/zh-CN/contributing/architecture-ownership-audit.md`（#104 的存量审计表；本票结算其中若干行）
