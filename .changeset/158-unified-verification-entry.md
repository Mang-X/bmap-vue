---
"@mangax/bmap-vue": patch
---

统一消费验证入口，并让被验证的 tarball 带上**打包来源**（#158 工作包 E）。

## `pnpm pack:package` 写下来源记录

打包的**同一时刻**写下 `<tarball>.build.json`：`sha256`、打包时的 commit、是否脏树、打包时间。
`verify:package` 读它并与当前 HEAD 比对，在跑任何档位之前打印：

```
[verify-package] 被验证产物：@mangax/bmap-vue@1.0.0-rc.0 sha256=425a1a56… commit=eb1bc28…-dirty packedAt=… file=…tgz
```

判据三条：**缺来源记录**（例如直接 `pnpm --filter bmap-vue pack` 产出的包）→ fail-closed；
**摘要不符**（文件被替换 / 损坏）→ 失败；**commit 不符** → 失败。

第三条正是「在 commit A 打包、切到 B 后不重新打包就验证」的拦截面：以前那种情况下日志会把 A
的产物记成 B 的（验证时才 `git rev-parse HEAD`），现在记录的是**打包时**的 commit，与当前 HEAD
不一致直接拒绝。

> 说明：原先设想的「`.artifacts` 里多个同身份 tarball 时失败」在真实路径上不可达 ——
> `isOwnTarball` 是**文件名全等**，同一目录不可能有两个同文件名。真正会发生的失效是同名旧包，
> 由来源记录拦截。

## CI 两个 job 走同一个入口、同一个打包入口

`quality` job 那一步原先直接跑 `scripts/verify-package.mts`，与 `package` job 的
`pnpm verify:package` 分叉。现在两处都经 `pnpm verify:package`，两处的打包也都经
`pnpm pack:package`（否则没有来源记录，验证会 fail-closed）。

## 步骤编号

`verify-package.mts` 里几个步骤的注释编号原先互相重复，按执行顺序重排为 `5a`–`5g`，不影响行为。
