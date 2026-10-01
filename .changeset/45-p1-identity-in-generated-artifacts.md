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

## 补充 · 补上 `./volar` 出口（评审 P1）

文档教用户写 `"types": ["@mangax/bmap-vue/volar"]`，而 `exports` 里**没有** `./volar`。
用仓库当前包形状 + TypeScript 5.8.3 + `moduleResolution: bundler` 实测复现：

```
error TS2688: Cannot find type definition file for '@mangax/bmap-vue/volar'.
```

加上 `"./volar": { "types": "./volar.d.ts" }` 后 TS2688 消失。这正是 issue #158 当初标注的
「Volar 可能是假承诺」的物理成因——文档承诺了自动补全，而那个承诺在真实消费侧不成立。

同时新增 `tests/behavior/doc-subpath-exports.test.ts`：扫全量文档里出现的每个
`<pkg>/<subpath>`，断言它在 `exports` 里可解析。将来文档再写一个新子路径而忘了开出口，
会立刻变红。文档里的 specifier 是契约，不是散文。

## 补充二 · 消除跨 worker 的 `volar.d.ts` TOCTOU 竞态（评审 P2）

上一轮加 `ensureVolarDts()` 只是**缩小**了窗口：`ensure` 返回之后另一个 worker 仍可能
`rmSync` 同一文件（`manifest-check.test.ts` 会这么做来验证「缺失时也能重新生成」），
于是 `existsSync` 仍会随机得到 false。给每个读者加「ensure exists」不提供互斥。

按职责隔离收口，不再有 test file 共享写该文件：

- `doc-subpath-exports.test.ts` —— 只断言 manifest 形状（出口在、指向 `./volar.d.ts`、
  `files` 声明了它），不读文件；
- `export-surface-freeze.test.ts` —— 纯 `types` 出口只断言 manifest 形状，不读文件；
- `manifest-check.test.ts` —— unit 层**唯一**生成 / 删除 / 验证该文件的 test file；
- `check:pack-contents` + package job —— 继续负责「真实 tarball 里文件确实存在」。

「文件真的在包里」这条判据因此移到了不受测试调度影响的路径上。三文件并行跑 10 轮，
0 失败。`ensureVolarDts` 随之没有消费者，已删除（不留「以后可能有用」的扩展面）。

## 补充三 · 用真实 tarball 验证 Volar 类型解析（评审非阻塞项）

`verify:package` 新增一步：另起一份最小 tsconfig，只放
`"types": ["@mangax/bmap-vue/volar"]` 与一个空输入文件，跑 tsc。**不改** consumer 的
`types: []`（那是有意的配置）。

此前 `check:api` / `publint` / `attw` 都看不出 TS2688——它们不解析 `compilerOptions.types`。
注入回归实测：移除 `./volar` 出口后重打包，该步精确报出

```
error TS2688: Cannot find type definition file for '@mangax/bmap-vue/volar'.
```

加上出口后同一命令输出 `Volar 类型解析 OK`。这条把曾经真实发生的消费侧失败锁死在
发布路径上。
