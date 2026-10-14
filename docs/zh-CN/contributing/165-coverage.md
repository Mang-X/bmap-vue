# #165 收口：公共 API 覆盖记录

> 本页是 **G**（全库收口）的机制说明。它不重复逐条审计结论（那些在各审计文档里），
> 只回答一个可判定的问题：**「还剩多少公共 API 没有成员级核对？」**

## 为什么需要一份机器可读的记录

#165 的关闭条件要求「完整覆盖所有可发布入口、所有公开组件、所有 Composable 和相关公共类型；
**零未核对项**」。在引入本机制之前，这句话**无法判定**：结论散在若干篇审计文档的叙述里，
「已经全部对齐」与「还有很多没看」在文字上长得一样，也没有任何门禁会因为「漏了一批名字」而变红。

## 它怎么工作

| 环节 | 做法 | 事实源 |
| --- | --- | --- |
| **清单** | 入口从 **`package.json#exports`** 派生（带 `types` 的子路径，含只有声明的 `./volar`）；导出名用 **TypeScript AST** 解析 | 发布面就是清单（固定列表会漏掉新增入口；正则会漏掉 `export { type T }`） |
| **记录** | `docs/zh-CN/contributing/165-coverage.json`，键是 **`入口#名字`** | 人工判定，生成器**保留**已有结论 |
| **判据** | ①清单与记录**一一对应** ②`unaudited` **只许下降**（含**跨提交**比较）③已判定项必须有非空 `note` ④新增未判定项不可被抵消 ⑤已判定结论不可无痕回退 | `pnpm check:165-coverage` |

入口**不写死数目**：从 `packages/bmap-vue/package.json#exports` 里带 `types` 的子路径派生，例如
`.` / `./advanced` / `./components` / `./composables` / `./plugins` / `./resolver` / `./ui-kit` /
`./volar`（`./volar` 只有声明增强，同样是公开入口）。**这一页不列权威清单**——入口以 manifest 为准：
新增 / 删除子路径时清单与记录一起变，这页不需要（也不应该）跟着改。

## 六档处置

| 状态 | 含义 |
| --- | --- |
| `consistent` | **已核对且与官方一致**、无需改动（note 写核对依据：对照了官方哪些成员 / 声明位置）。与 #165 §4 的「已一致」对应 |
| `fixed` | 发现了差异并已修正（**note 必须写清 PR / commit / 依据**——门禁强制非空） |
| `retained` | **有意保留的差异**（note 写清技术事实与替代写法，依 #165 §3.7）。与 `consistent` 的区别是**有没有差异** |
| `not-applicable` | 官方成员，但有依据地不适用（note 写依据） |
| `deferred` | 已登记、明确延期（note 写等待什么裁决或哪张子票） |
| `unaudited` | **尚未核对** —— 唯一允许存量存在的一档 |

## 命令

```bash
pnpm generate:manifest:check  # 生成包根的 volar.d.ts（gitignore 的生成物，./volar 入口读它）
pnpm build:package            # 清单来自 dist，必须先构建
pnpm generate:165-coverage    # 写记录：保留已有结论、新名字落 unaudited、移除已消失的名字
pnpm check:165-coverage       # 门禁：一一对应 + unaudited 不超基线（跨提交比较见下）
```

> `pnpm build:package` **不会**生成包根的 `volar.d.ts`（它是 gitignore 的生成物，只由
> `generate:manifest*` 写）。干净 checkout 下漏掉第一步会以「读不到入口 ./volar 的声明文件」
> 报错并提示该命令 —— 错误信息里写了补救步骤。

判定某个名字后，直接编辑 `165-coverage.json` 把它的 `status` 从 `unaudited` 改成**五种已判定状态之一**
（`consistent` / `fixed` / `retained` / `not-applicable` / `deferred`）并写 `note`，
然后重跑 `generate:165-coverage`（它会下调基线）。**基线只降不升**：如果门禁报「未核对数上涨」，
说明有人把已判定的状态改回去了，或新增导出未判定。

## 进度怎么看

**本页刻意不写具体统计数字**（入口数 / 记录键数 / 已判定 / 未核对）。写下来就是第二份事实源，
而它必然漂移——本机制引入时，这页的数字就被评审抓到过两次。数字只有一个出处：

```bash
pnpm check:165-coverage
```

它在结尾逐行打印当前口径：`入口 N 个｜清单 M 个「入口#名字」`、
`未核对 x/上限 y｜consistent … / fixed … / retained … / n-a … / deferred …`。更细的逐名处置看
`docs/zh-CN/contributing/165-coverage.json` 本身——每条的 `status` 就是进度。

**尚未收口。** 存量未核对里有一部分其实在 #174 的 B/C/D/F 成员级审计与 E 的审计表里已经看过，
但那些结论是**模块粒度**的叙述，没有落到逐个名字上。把既有审计结论**迁移**成逐名处置，
是 G 剩余的主要工作量；迁移之外的新核对才需要重新对照官方声明。

## 与其它门禁的分工

| 门禁 | 管什么 |
| --- | --- |
| `check:api` | 声明面**形状**（API report / 未导出类型 / 签名基线）——它不知道官方对应项 |
| `generate:api-diff:check` | 与官方参考的**名称集合**对照表——只比名字，不判成员/签名/默认值/行为 |
| **`check:165-coverage`** | **每个公共名有没有人判过**，以及未核对数是否只降不升 |

三者互补：前两者保证「名字与形状没有漂移」，本门禁保证「没有名字被漏掉」。
