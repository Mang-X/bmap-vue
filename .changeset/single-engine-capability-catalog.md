---
"bmap-vue": minor
---

单引擎能力目录收口（#126）：删除 `engines` 维度，`engine-unsupported` 改名 `unlisted-capability`

`#26` 删除 `webgl-v1` / `jsapi-v3` 之后，能力目录每条描述符的 `engines` 都恒为全集 `["jsapi-v4"]`：
对已收录的能力它不产生任何区分力，判定链里的白名单分支恒为真；唯一还可达的拒绝路径是
「目录未收录该 id」，而它报出的 reason 名叫 `engine-unsupported`——名字与实际发生的判定不一致。
按 issue #126 给出的判据（**能否为它写出一条会变红的用例**：写不出来 ⇒ 按
Evidence-before-abstraction 删掉），选择**删列**。决策与依据见 ADR
[`2026-09-24-single-engine-capability-catalog`](../docs/adr/2026-09-24-single-engine-capability-catalog.md)。

**破坏性变更**（当前 `1.0.0-rc.0`，beta 阶段按 `minor` 发布）：

| 变更 | 之前 | 现在 |
| --- | --- | --- |
| `CapabilityDescriptor.engines` | 公共类型上的引擎白名单字段，63 条描述符恒为 `["jsapi-v4"]` | **已删除**（含 63 行赋值与只服务它的 `JSAPI_V4` 常量）。描述符现在只表达「能力是什么 / 什么状态 / 怎么探测」 |
| `CapabilityReason` 的 `"engine-unsupported"` | 名字指引擎，事实只由「描述符缺失」一条路径可达 | 改名 **`"unlisted-capability"`**（**移除** `"engine-unsupported"` 这个取值）：单引擎下旧取值已不可达，保留它等于多一个永不为真的分支；改后每个取值都有名字与实际判定一致的可达路径 |
| `CapabilityRegistry.supports()` 判定链 | 显式 override → 声明状态 → **engine 白名单** → raw member 存在性 | 显式 override → **目录是否收录** → 声明状态 → raw member 存在性（删掉恒真的白名单分支） |
| 生成的能力矩阵（`docs/zh-CN/contributing/capability-matrix.md` + `docs/.vitepress/capability-catalog.json`） | Markdown 有 `jsapi-v4` 引擎列，JSON 有顶层 `engines` 与每条的 `engines` | **不再输出引擎维度**（两份产物已由 `pnpm generate:capability-matrix` 重生成，63 条能力数量不变），矩阵正文新增一句单引擎基线说明。生成器**手工编辑被禁止**的约定不变 |

**保留**（`engine` 并非全部删除）：引擎身份在 `CapabilityExplanation.engine`、
`UnsupportedCapabilityError.engine` 及其错误信息里仍有真实消费者（诊断与 `require()` 报错），
保留原样。`BMapEngine` 类型本身与 `CapabilityFamily` / `CAPABILITY_FAMILIES` 不动（#126 非目标）。

**将来若真引入第二个引擎**：那是一个有判别力的变化（届时新引擎下部分能力不再恒真），必须
重新引入引擎维度与判定分支，并新增 ADR——今天的实现刻意不在空壳上为它预留。

**用例同步**：`registry.test.ts` 与 `tests/behavior/v3-capability-catalog.test.ts` 里
「每条能力必须声明当前引擎」断言改为「描述符**没有** `engines` 属性」（`not.toHaveProperty`），
「目录未收录」用例改断言 `unlisted-capability`。
