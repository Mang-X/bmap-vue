---
"@mangax/bmap-vue": patch
---

修掉发布身份在**生成物**与**构建期注入**里的三处遗漏（#45 评审 P1）

包名迁移只改了 manifest、脚本与文档，但有三处「用户直接消费」的地方仍写着旧身份。
它们的共同点是**漏掉也不报错**——各自的单测断言的正是那个旧值，于是 CI 全绿。

## 1. `BMapResolver` 返回的组件 `from`

`resolve('Map')` 仍返回 `{ from: 'bmap-vue/components' }`。unplugin-vue-components 会把这句话
**原样写进用户的源码**——所以后果不是「找不到包」：npm 上无 scope 的 `bmap-vue` 恰好属于
另一位作者，用户的项目会 import 到**别人的包**。

改为 `${LIBRARY_PACKAGE_NAME}/components`。包名在**构建期**从 `package.json#name` 注入
（`scripts/vite-version-define.mjs` 的 `__PKG_NAME__`）——不能在运行时读：resolver 会被打进
浏览器 bundle，没有 `node:fs`。

## 2. 随包发布的 `volar.d.ts`

生成器写死 `typeof import('bmap-vue')`。这份 d.ts 跟着包发出去（它在 `files` 里），写死的旧名
会让用户的 Volar 去解析 npm 上另一位作者的同名包，与安装说明里的 `@mangax/bmap-vue`
自相矛盾。改为从 manifest 读（112 处引用全部更新）。

## 3. `check:api` 签名基线的 header

7 份签名基线的 header 记录着已不存在的身份。基线是要长期当契约守的，记录一个废弃身份让
它失去意义。改为从 manifest 派生后重新生成——**7 份各只改 header 一行，签名内容零变化**。

## 新增门禁

`tests/behavior/release-identity-generated.test.ts`：直接从生成产物与构建期常量读真值，
断言三处一致。之所以不能靠原有单测，是因为它们断言的正是那个旧值。

注入回归实测：resolver 改回硬编码 → 用例变红；还原 → 绿。

## 一处判据自身的踩坑

第一版写 `expect(from).not.toContain('bmap-vue')` —— 恒红，因为 `@mangax/bmap-vue`
**本身含** `bmap-vue` 子串。已改为全等比较。这正是本仓「判据要有区分力」那条纪律，
在断言写法层面同样适用。

验证：`pnpm test:unit` 208 files / 3775 tests passed；`verify:package` ALL PASSED；
13 道静态门禁 + `docs` job 四步 + `playground:build` 全绿。