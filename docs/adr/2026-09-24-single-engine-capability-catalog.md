# 单引擎能力目录收口：删除 `engines` 维度，`engine-unsupported` 改名 `unlisted-capability`（#126）

- 状态：Accepted
- 日期：2026-09-24
- 关联：issue **#126**（本 ADR 的交付物）、**#26**（删除 `webgl-v1` / `jsapi-v3`，前置事实）、
  **#134**（1.0 身份复位，前置票）、**#104**（ownership-first / evidence-before-abstraction 口径与
  存量审计表）、#44（能力清单属公共面冻结范围）
- 取代范围：**不取代任何已接受 ADR 的决策**，只**结算**
  [`2026-09-14-remove-legacy-engine`](./2026-09-14-remove-legacy-engine.md) 已知限制第 4 条
  （「能力矩阵的 `engines` 维度退化」——该条写明「是否移除整个维度属独立决策，形状变更留给下一张票」）。
  原 ADR 按仓库约定（已接受即冻结）不改写，指向关系记在本文件。

## 背景

#26 把 `BMapEngine` 收敛成单取值 `"jsapi-v4"` 之后，能力目录里每条描述符的 `engines` 字段都恒为
全集 `["jsapi-v4"]`：

- 对**已收录**的能力，这个字段不产生任何区分力——判定链里
  `descriptor.engines.includes(engine)` 恒为真，「按引擎区分」是恒真的分支；
- 唯一还可达的拒绝路径是**目录未收录的 id**（例如外部字符串 / `as Capability` 探针进来的
  `does.not-exist`），而它报出的 reason 名叫 `engine-unsupported`——名字与实际发生的判定
  （描述符缺失）**不一致**。

**基线核对**：#126 的「第一步」要求先跑 `pnpm generate:capability-matrix:check` 拿基线，并写作
「62 条能力」。实测本票开工时树上是 **63 条**——差的这一条是 `layer.mvt`，由 **#109 / #133**
（`7ec0440`，2026-09-23）在 #104 审计删除它之后带真实消费者重新加入。本票以**实测基线 63** 为准，
且不改动能力 id 集合（本票前后都是 63 条）；票面写的 62 是它成文时的历史数字。

这个退化在 #26 时被如实登记为「已知欠账」，并明确交给 #126 决定。#126 给出的判据是
Evidence-before-abstraction：**能否为这个维度写出一条会变红的用例**。事实核对结论是写不出来——
单引擎下「每条能力都声明当前引擎」这类断言（`registry.test.ts` 原先有）对任何目录内容恒真，
删掉它不减覆盖；留着它则把字段与断言一起变成「为未实现的多引擎留位」，并让公共类型
（`CapabilityDescriptor` 字段 / `CapabilityReason` 取值）与生成的能力矩阵带着一个恒真维度进入
1.0 冻结面。

## 决策

**删列。** 落在四层，缺一则形状不完整：

1. **类型与数据**（`driver/capability/catalog.ts`）：删掉 `CapabilityDescriptor.engines` 字段与
   63 条描述符上的 `engines: JSAPI_V4` 行，以及只为这个字段存在的 `JSAPI_V4` 常量与
   `BMapEngine` 导入。挂在字段上的两段历史注记（#20 `map.pixel-conversion` / #22
   `layer.district` 的 engines 放宽）随之删除——对应的决策在
   [`2026-09-11-jsapi-v4-map-facet`](./2026-09-11-jsapi-v4-map-facet.md) 与
   [`2026-09-11-jsapi-v4-control-layer-facets`](./2026-09-11-jsapi-v4-control-layer-facets.md)
   里仍然有效，目录不再需要复述它们。
2. **判定链**（`driver/capability/registry.ts`）：删掉引擎白名单分支；`evaluate()` 的第一顺位
   变成「目录是否收录该 id」，`CapabilityReason` 的 `"engine-unsupported"` 改名为
   **`"unlisted-capability"`**（issue 允许的「改名让名字与唯一可达路径一致」那一支），
   判定链文档同步为「override → 目录是否收录 → 声明状态 → raw member 存在性」。
3. **生成物**：`scripts/generate-capability-matrix.mts` 不再输出引擎列——Markdown 矩阵
   「引擎矩阵」节改名为「能力矩阵」并写明单引擎基线，JSON 不再输出顶层 `engines` 与每条的
   `engines`；两份生成物由 `pnpm generate:capability-matrix` 重生成（63 条能力，数量不变）。
4. **用例**：`registry.test.ts` 与 `tests/behavior/v3-capability-catalog.test.ts` 里
   「每条能力必须声明当前引擎」断言改为「描述符**没有** `engines` 属性」（`not.toHaveProperty`），
   「目录未收录」用例改断言 `unlisted-capability`；`descriptor()` 完整性用例不再要求 engine 列。

   `not.toHaveProperty` 是**故意**钉住缺席：它沿用 #104 判定为 REMOVE 时的既有门禁形状
   （`tests/behavior/v3-core-surface.test.ts` 的「被判定 REMOVE / 内部化的名字不得出现在公共面」
   就是同一种「名字不许回来」的断言）。这样「将来真要引入第二引擎」时，这条断言会**先红**，
   提醒那是一个需要新增 ADR 的有判别力变化，而不是字段被无声地加回来。

**保留 `engine` 的其余位置**：引擎身份在 `CapabilityRegistry` / `CapabilityExplanation` 的
`engine` 字段、`UnsupportedCapabilityError` 的 `engine` 属性与错误信息里**有真实消费者**
（诊断与 `require()` 的报错文案），删的只是目录里恒真的那一列。`BMapEngine` 类型本身不动
（#126 的非目标）。

**改名而不是新增取值**：`engine-unsupported` 在单引擎下已不可达，保留它只会多一个
永不为真的分支取值，违反同一口径。改名是等价的破坏面（beta 阶段按 minor 发布，changeset 已写明），
但让每个取值都有名字与实际判定一致的可达路径。

## 后果

- 公共类型面收窄两个名字：`CapabilityDescriptor` 少一个字段、`CapabilityReason` 少一个取值换一个
  取值。#44 冻结公共面之前完成，冻结的是与当前语义一致的名字。
- 能力矩阵的「按引擎区分」信息**消失**（Markdown 少一列、JSON 少两个字段）。这是如实反映：
  单引擎下这一列每一格都相同。矩阵里新增一句基线说明，指明为什么没有引擎列。
- 判定链少一个恒真分支，`explain()` 对未收录 id 的 reason 变得**可读**（读代码的人看到
  `unlisted-capability` 就知道目录没这条，而不是以为某个引擎不支持它）。
- 将来若真引入第二个引擎：必须同时重新引入 `engines` 维度（或等价的引擎能力矩阵）与它的
  判定分支。那是一个**有判别力的**变化（届时新引擎下部分能力不再恒真），届时应新增 ADR——
  而不是在今天的空壳上预留。

### 回滚

改动是单向的但可机械回滚：恢复 `catalog.ts` 的 `engines` 字段与 63 行赋值、`registry.ts` 的
白名单分支与 `engine-unsupported` 取值、生成器与生成物（重跑 `generate:capability-matrix` 即可），
以及两处用例——**包括把 `not.toHaveProperty("engines")` 改回「必须声明当前引擎」**（这条缺席断言
会在回滚时先红，是刻意的）。ADR 一经接受即冻结，回滚须新增 ADR 说明理由。

## 非目标

- 不动 `CapabilityReason` 其余取值（`not-implemented` / `upstream-missing` 一类真实依据）、
  `CapabilityFamily` 与 `CAPABILITY_FAMILIES`（有真实消费者，#104 R10 已定过）。
- 不新增引擎、不建引擎抽象、不引入 per-engine 矩阵机制。
- 不改 `BMapEngine` 类型与任何引擎标识的运行时来源。
- 不动能力 id 的集合（本票前后都是 63 条）。

## 验证

- `pnpm generate:capability-matrix:check`：无漂移（重生成后的 Markdown / JSON）。
- `tests/behavior/v3-capability-catalog.test.ts`（含生成物无漂移与「无 `engines` 属性」断言）+
  `packages/bmap-vue/src/driver/capability/registry.test.ts`。
- `pnpm typecheck:package` / `typecheck:tests` / `test:unit` / `check:raw-sdk` / `check:no-bmapgl` /
  `check:public-dts`。

## 参考

- issue #126（判据与两条路径的选择）、#26（单引擎事实）、#104（存量审计表登记的这条欠账）、
  #44（公共面冻结范围）
- [ADR 2026-09-14 删除旧引擎](./2026-09-14-remove-legacy-engine.md)（已知限制第 4 条，本 ADR 结算）
- [Ownership-first 存量审计表](../zh-CN/contributing/architecture-ownership-audit.md)（第 86 行登记项）
