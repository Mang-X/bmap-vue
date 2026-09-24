---
"bmap-vue": minor
---

视角动画的**启动窗口取证**与取消面收窄（#104 第二批，接 [存量审计 changeset](./architecture-ownership-evidence-first.md)）。

**为什么做这件事**：`MapDriver` 的动画簿记（`started` / `cancelRequested`、把取消推迟到
`animationstart` 之后的微任务、销毁时按「先取消再销毁」排序、0ms 兜底）整条正确性都建立在两条
**只有真实 SDK 能证伪**的前提上——而它们此前只有 `FakeV4ViewAnimation` 建模，是审计表 **F-1** 的
probe 债务。这一批用真实 AK + headless Chromium 把两条前提逐条实测，升级为 `PROBED`，并把读数
固化成 live 门禁 `view-animation-cancel-window`（required）：**官方哪天改了这个窗口，由 CI 发现，
而不是由用户发现**。读数与判据见
[Ownership-first 存量审计表](../docs/zh-CN/contributing/architecture-ownership-audit.md) 的 F-1 行。

**破坏性变更**（当前版本 `1.0.0-rc.0`，beta 阶段按 `minor` 发布；`MapDriver` 是根出口导出的类型，
所以这是一次**公共面**变更 —— 它正好落在 #104 实施步骤 6「#44 冻结前完成 API 复核」的范围里：
把「内部恢复机制」在被冻结成公共承诺之前先收掉）

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `MapDriver.stopViewAnimation(map)` | 取消**这张地图上所有**未结束的视角动画（自研的整图语义，理由是「与 webgl-v1 的 `map.stopViewAnimation()` 一致」） | **已删除**。取消只走官方形状的按实例命令 `cancelViewAnimation(map, animation)`（1:1 对应官方已声明的 `Map#cancelViewAnimation(viewAnimation)`，#105 引入）。删它的三条依据：零生产消费者（只有自身用例与注释）、其唯一书面理由随 #26 删除 webgl-v1 而失效、整图语义与按实例所有权直接冲突（「重试自己这一次取消」会牵连同一张图上别人的动画）。`destroy` 时对整图动画的清理不受影响——那仍是本库自己的销毁责任 |

**行为不变，但口径被读数精确化**（每一条都来自实测，不是语义变更）：

- 「`animationstart` 在内部 Animation 构造之前**同步**派发」里的「同步」只存在于**它与内部控制器
  构造之间**（同一个任务内、先派发后构造 ⇒ 派发期间取消必抛 `TypeError`）；相对
  `startViewAnimation()` 的**返回**它是**异步**的 —— `delay: 0` 实测 **5–120ms**、`delay: 900` 约 1.28s。
- 销毁路径上那个 0ms 兜底**几乎总是**先于动画启动到期，所以「先取消、再销毁」在真实运行时是针对
  **已在飞**的动画成立的；对**待启动**的动画，实际顺序是「兜底先推进销毁 → 迟到启动由记录自己的
  安全点收尾」。ADR 的已知限制按此改写（原先只在 `delay > 0` 下承认这一点）。
- 未显式取消就再起播一段时，SDK **不会替换旧动画**：旧动画照旧跑到自己的 `animationend`，
  两段在重叠期里**都在推进视角**（新动画的启动还被推迟到不可预期时刻，实测 +0.9~1.6s）。
  这是 `startViewAnimation` 起播前尽力清场的依据。
- **起播前的清场按两条路径交付，承诺的粒度不同**（#122 评审 P1 纠正了原先「起播前先清场」这句把两条
  路径写成同一种时序的说法）：**已启动**的旧段是**即时交付**（取消成功返回后才提交新段，实测相隔约
  70ms）；**待启动**的旧段此刻交付不了（SDK 取消必抛 `TypeError`）⇒ **新段先提交**，旧段的取消落在
  它自己的启动安全窗口（实测与它的 `animationstart` 相隔 0.0–0.3ms，且它来不及产生可观察的推进）。
  所以可依赖的承诺是「**在最早的合法时刻交付取消**」（调用方据此拿到 `deferred`），
  **不是**「提交新段之前图上一段不剩」；残余风险（那条安全窗口的取消失败时旧段会继续推进到重试为止）
  登记在 ADR 的已知限制里。
- 取消一个**已经结束**的动画不抛错（视图不变）；对一个**本 Driver 没有记录**的实例取消返回
  `"already-settled"` 且**不补发** SDK 命令（补发要假设 SDK 幂等，属 F-3 未证）。

`useBMapViewAnimation` 的公开面**不变**，它本来就只用按实例的取消；`status` 仍完全是观察值。
