---
"bmap-vue": patch
---

# #160 结清后被 #165 回归：五个出口的身份集合基线重新归零

`pnpm check:api` 的**未导出类型身份集合基线**此前是 3 / 2 / 3 个名字（`./advanced` /
`./composables` / `./plugins`），#160 的验收标准是**五份全为 `[]`**（零容忍）。现在重新归零，
并堵住让回归发生的那条路径。

## 三个名字的处置（全部走「升为公共导出」，ADR 2026-09-25 二选一的第一条）

| 名字 | 声明处 | 出现在哪些已导出签名里 | 走哪条路 |
| --- | --- | --- | --- |
| `MarkerLabelInput` | `driver/types/overlays.ts` | `MarkerOptions.label`（Marker / 聚合图层 / 组件 props） | 导出 |
| `OverlayAnchorName` | `driver/types/overlays.ts` | `LabelOptions.anchor`、控件 props 的 `anchor` | 导出 |
| `ViewportOptions` | `driver/types/services.ts` | `LocalSearchRenderOptions.viewportOptions`、`RouteRenderOptions.viewportOptions`、`MapDriver.setViewport/getViewport` | 导出 |

判据仍是「**消费方能不能为它命名**」：三个都是 props 上公开可传的形状 / 命令面参数，
调用方组装时要的就是这个类型，导出的是**已有形状**，没有新增任何值导出，也没有第二份定义
（仍是 `export type … from "<单一模块>"` 的转出）。

导出面：**只增类型导出**，三个出口各自转出，不新增任何值导出。

- `./advanced`：`MarkerLabelInput` / `OverlayAnchorName`（`./driver/types/overlays`）+
  `ViewportOptions`（`./driver/types/services`）
- `./composables`：`MarkerLabelInput` / `OverlayAnchorName`（`ViewportOptions` 该出口早已导出）
- `./plugins`：三者全导出

根入口已有 props 口径的别名 `MarkerLabelSpec` / `OverlayAnchor`，**未改动** ——
别名与声明处名字并存不构成两份定义，AE 也能正确折叠（见 `etc/index/bmap-vue.dts.md` 的
`export { MarkerLabelInput as MarkerLabelSpec }`）。

派生门禁：`generate:api-diff:check` 的对照表因此多一行（`OverlayAnchorName`，口径
`other`，与官方 React 参考无同名交集），本库根入口导出数 440 → 441、「仅本库有」324 → 325。
该表由 `pnpm generate:api-diff` 生成，已随本次一并更新。

## 根因：`generate:api` 能把新欠账洗成基线

上一张表里的三个名字**不是**「有意接受的存量」，而是回归：#165 为它们做了处置，却只做了
**根入口**那一半（`src/index.ts` 按 props 口径导出别名，`src/types/components.ts` 里还写了注释说
「这三个**必须**是公共导出」），另外三个子入口的 export 面没跟上。于是 `check:api` 当时是**红的**，
处置没做完的地方被 `pnpm generate:api` 一次性写进了基线 ——

> `writeForgottenBaseline()` 原先**无条件**把当前集合写回基线。`check:api` 逐出口比对身份集合、
> 方向对称（新增与清理都红），但那份严格性只在「**没跑生成器**」时存在；跑一次
> `generate:api`，红线就变成了基线，此后 `check:api` 全绿、再无人提。

判据偏弱的地方在于：门禁严格、生成器宽松，而**修门禁的常规动作恰好是跑生成器**。
`forgottenBaselineFailure()` 的提示里写着「别用生成器盖过去」，但那只是一句提示，
生成器本身并不会拦 —— 于是这一步是「建议」而不是「约束」。

## 修补：生成器拒绝对「新增」方向自动落盘

判据抽成纯函数放进新文件 `scripts/api-forgotten-boundary.mts`
（`collectForbiddenAdditions()` / `newForbiddenForgottenExports()` / `FORGOTTEN_EXEMPTIONS` /
`forbiddenForgottenMessage()`），`check-api.mts` 的 `--local` 路径分两阶段调它：

- **第一阶段 `preflight()`**：对五个出口**全部**跑 AE 分析（`localBuild=false`，AE 此时
  **不写** report，对 `etc/` 纯只读），再用 `collectForbiddenAdditions()` 一次性收集
  **所有**出口的 forbidden additions。非空 ⇒ 抛错退出，**本次命令一个基线都没写**。
- **第二阶段**：preflight 全绿后才进写盘。写盘阶段仍保留逐出口回滚（AE 的 `_writeApiReport`
  早于 success 判定，磁盘满 / 权限这类**写盘**失败同样会留下半写状态）。
- **清理**（基线有、当前没有）：照常写回。否则把名字真正导出之后基线永远更新不掉，
  门禁会因为「文件不是生成器的规范化形式」把「已修好」报成缺陷。
- **刻意接受某个欠账**：在 `FORGOTTEN_EXEMPTIONS` 里按 **(entry, name) 两层**登记并写明理由。
  该表**刻意为空**（1.0 立场）且**不提供任何默认豁免** —— 「没登记就是不允许」这条不变量
  只有靠空表才成立。

### 事务边界（评审 P1）

第一版只回滚**被拒的那个出口**，跨出口仍是半写的：`advanced` / `composables` 写成功、
`plugins` 被拒时，前两个出口的新 report 留在工作树，而且后面的签名基线循环根本没跑到 ——
「report 已更新、对应 `bmap-vue.dts.md` 未更新」的组合会被提交出去。这与本 PR 声称的
「`etc/` 不留半写状态」有差距。改成 preflight 后，任何一个出口有 forbidden addition 都在
**写任何文件之前**失败。

`collectForbiddenAdditions()` 刻意**不短路**：一次报出全部待处置出口，省掉「改一个跑一轮」，
同时让不变量与遍历顺序无关（只看最终结果）。

### 豁免表的键（评审 P2）

第一版是 `Record<name, { entry, reason }>` —— 键只有名字，`entry` 在 value 里，于是**同一个符号
无法在两个出口各自登记**（第二条覆盖第一条）。而一个类型同时出现在多个出口恰恰是常态：
本 PR 处置的三个名字就同时出现在三个出口。改成按出口分层：
`Record<entry, Record<name, { reason }>>`，同名符号可在各出口分别登记、分别写理由。

## 双向判别力实测

回退 `./advanced` 的导出修复、重新 build 后跑 `pnpm generate:api`：

```
[check-api] 生成器拒绝吸收 1 个出口上的**新增**未导出类型:
  advanced（3 个）: MarkerLabelInput, OverlayAnchorName, ViewportOptions
  …
  五个出口已全部判定完毕，本次命令**没有写任何基线** —— 处置完上面每个名字后重跑即可。
```

退出码 1，`git status packages/bmap-vue/etc/` **完全干净**（不只是被拒的出口）。
两个出口同时被拒时一次报出两条。这正是 #165 当时的形状 —— 修复前该命令是**静默绿**并把三个
名字写进基线的。

新增 `tests/behavior/api-forgotten-exports-gate.test.ts`（19 条）：

- 新增方向拒绝；多个出口的 forbidden additions **一次报全**（反例：短路实现会红）
- 清理方向照常写、集合没变时不误拦；豁免只放行被登记的那**一个**名字
- 豁免按 `(entry, name)` 匹配：同名可在多个出口各自登记、未登记的出口仍然拒绝
- `FORGOTTEN_EXEMPTIONS` 恒空
- 五份基线**恒等于 `[]`**（判据是「恒空」不是「比条数」：任何非空都是回归）
- CI 里 `check:api` 这一步真的存在且没有被 `continue-on-error` 架空

跨出口那条**刻意写成纯函数用例**而不是真跑 `generate:api`：那条路要改源码 + 重新 build `dist/`，
而 `dist/` 正是 `export-surface-freeze` / `core-surface` / `doc-props-gate` 等**并行**读的对象 ——
实测会让那几个文件随机变红（本条最初就是这么写的，13 个用例挂了 11 个）。跨出口的「一个都不写」
由「先 preflight、判据全绿后才进写盘阶段」这条**结构**保证，用例钉住它的前提。

## 对消费方的影响

**无破坏性变更。** 只新增类型导出，没有删除或收窄任何已有的 export 名字，运行时行为一字未改。
原先拿不到这三个名字的消费方现在可以直接 `import type`；`MarkerOptions` / `LabelOptions` /
`ViewportOptions` 等既有类型的结构完全不变。
