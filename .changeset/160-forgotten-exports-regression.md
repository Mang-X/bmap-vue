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
（`newForbiddenForgottenExports()` / `FORGOTTEN_EXEMPTIONS` / `forbiddenForgottenMessage()`），
`check-api.mts` 的写盘路径调它：

- **新增**（当前有、基线没有）：`generate:api` **抛错退出**，身份集合基线**一个字节都不动**，
  并**回滚该出口的 report 基线**（AE 是先落盘、后判成败，拒绝发生时 `etc/` 已是半写状态）。
  报错文案点名每个新名字并指向 ADR 的二选一 —— 处置方式是「把它导出」或「让引用消失」，
  两者都会让名字**从集合里消失**，而不是被记进基线；
- **清理**（基线有、当前没有）：照常写回。否则把名字真正导出之后基线永远更新不掉，
  门禁会因为「文件不是生成器的规范化形式」把「已修好」报成缺陷；
- **刻意接受某个欠账**：在 `FORGOTTEN_EXEMPTIONS` 里按 **(name, entry)** 显式登记并写明理由。
  该表**刻意为空**（1.0 立场）且**不提供任何默认豁免** —— 「没登记就是不允许」这条不变量
  只有靠空表才成立。按二元组匹配而不是按名字：同一个类型在 `./advanced` 被接受，不代表它在
  `./plugins` 也被接受，逐出口分析的引用点并不相同。

## 双向判别力实测

回退 `./advanced` 的导出修复、重新 build 后跑 `pnpm generate:api`：

```
[check-api] advanced: 生成器拒绝吸收 3 个**新增**未导出类型: MarkerLabelInput, OverlayAnchorName, ViewportOptions
```

退出码 1，`etc/advanced/forgotten-exports.json` 保持 `[]` 未被改动，**该出口的 report 基线也被
回滚成运行前的内容**（实测逐字节比对相同）。这正是 #165 当时的形状 —— 修复前该命令是
**静默绿**并把三个名字写进基线的。

新增 `tests/behavior/api-forgotten-exports-gate.test.ts`（14 条）：

- 新增方向拒绝（含多名字逐个点名、已在基线里的不误判）
- 清理方向照常写、集合没变时不误拦（两条反例，见上）
- `FORGOTTEN_EXEMPTIONS` 恒空、每条豁免都带 `reason` 与 `entry`
- 五份基线**恒等于 `[]`**（判据是「恒空」不是「比条数」：任何非空都是回归）
- CI 里 `check:api` 这一步真的存在且没有被 `continue-on-error` 架空

## 对消费方的影响

**无破坏性变更。** 只新增类型导出，没有删除或收窄任何已有的 export 名字，运行时行为一字未改。
原先拿不到这三个名字的消费方现在可以直接 `import type`；`MarkerOptions` / `LabelOptions` /
`ViewportOptions` 等既有类型的结构完全不变。
