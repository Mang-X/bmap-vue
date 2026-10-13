---
"@mangax/bmap-vue": patch
---

让 #165 覆盖门禁的**跨提交判据真正可被验证**（#215 第六轮评审的遗留项）。

## 问题

`scripts/check-165-coverage.mts` 把「取输入」与「判定」写在一段里，判定读的是模块级常量
（`record` / `entryPoints` / 闭包里的 `base`）。于是 ②④⑤ 三条**只在 `base.kind === "found"`
下才执行**的判据**无法被测试驱动**：

- 本仓首次引入覆盖记录时，CI 走的全是 `base = absent`（目标分支还没有那份 JSON），
  所以这三条判据在真实环境里**从未被执行过**；
- 单测只能覆盖 `coverageDrift` / `unjudgedNewKeys` / `regressedJudgedKeys` 各自的纯函数，
  抓不到「判据在某个形态下恒真」这一类失效——列表比对必须在**门禁整体**上做。

第六轮评审明确指出：「合并后第一张 G 子票应专门验证 `base=found` 下的完整门禁」。

## 改动

- `coverage-inventory.mts` 新增 **`evaluateCoverage(input)`**：纯函数、无 I/O，把
  「清单 / 当前记录 / base（found | absent | unavailable）」当参数吃进来，返回
  `{ problems, notes }`。判定逻辑**只有这一处**实现。
- `check-165-coverage.mts` 只负责组装输入（读清单、读记录、`git show` 取 base）再调它。
  行为不变：对真实记录的输出与重构前逐字一致。
- 顺带补一条 **fail-closed 守卫**：清单里公开名为 0 时判失败——否则「没有名字要查」与
  「全部查过了」在判定上不可区分，所有判据恒真。

## 证据

新增 `tests/behavior/165-coverage-gate.test.ts`（10 条），在 `base = found` 下驱动**整套**
判定：② 基线上涨、④ 新增未判定被净额抵消、⑤ 已判定回退，各配正反例 + 迁移豁免边界 +
fail-closed 守卫。

**突变验证**（把判据逐一敲掉，确认对应用例真的翻红）：

| 突变 | 结果 |
| --- | --- |
| ② `raised && !migrationFresh` → 永假 | 1 failed |
| ④ `undecided` → 恒空 | 1 failed |
| ⑤ `regressed` → 恒空 | 1 failed |
| 整个 `base=found` 分支跳过 | 4 failed |

恢复后 10 passed。也就是说三条跨提交判据从「CI 里没跑过」变成「有力、且当场证明有力」。

## 验证

- `pnpm test:unit`：全绿（含新增 10 条）。
- `pnpm check:165-coverage`：对当前记录输出与重构前一致（8 入口 / 1265 键 / 未核对 1246/1246，`base(HEAD^)`）。
