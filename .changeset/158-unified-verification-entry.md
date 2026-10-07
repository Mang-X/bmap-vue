---
"@mangax/bmap-vue": patch
---

统一消费验证入口并记录被验证产物的身份（#158 工作包 E）。

## 记录被验证的 tarball

`verify:package` 在所有档位跑之前打印一条**身份记录**：包名 + 版本 + `sha256` + 打包时的
commit（工作树有未提交改动时带 `-dirty`）。版本号不足以标识产物（同版本重打包内容会变），
commit 回答「这次验证对应哪次提交」，摘要回答「是不是同一个包」。

## 多个同身份 tarball 时**失败**，不再静默挑一个

原先 `findTarball` 在同身份候选里取排序最后一个 —— `.artifacts` 里同时存在多个时，会静默换
一个包去验证，而所有断言仍然可能通过。现在多于一个候选直接失败，并把候选全部列出；要消歧
就显式清掉旧产物（CI 里本来就是 `rm -rf .artifacts`）。

## CI 两个 job 走同一个入口

`quality` job 里那一步原先直接跑 `scripts/verify-package.mts`，与 `package` job 的
`pnpm verify:package` 分叉（前者少了 `.artifacts` 清理）。现在两处都经 `pnpm verify:package`；
门禁自测会逐个检查「真正执行该入口的步骤」不得被 `continue-on-error` 架空。

## 步骤编号

`verify-package.mts` 里几个步骤的注释编号原先互相重复（两个 `5a`、`5b` 出现在不同位置）。
按执行顺序重排为 `5a`–`5g`，不影响行为。
