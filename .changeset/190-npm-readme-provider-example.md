---
"@mangax/bmap-vue": patch
---

npm README 的 Provider 示例修正 + 入包 README 纳入文档门禁（#190）——**无公开 API 变更**

## 缺陷

真正发到 npm 的那份 README（`packages/bmap-vue/README.md`，`files` 里声明的就是它）教读者写：

```vue
<BMapProvider :ak="ak">
```

而 `BMapProviderProps` 只有 `client` / `definition` / `provider` / `loadOptions` / `autoLoad`
——**没有 `ak`**，`<BMapProvider>` 也不据它创建 definition。干净应用（没有父 context、
没有 `app.use(createBMapPlugin(...))` 默认定义）照抄这段，建不出可用 Client。

**为什么一直没人发现**：`pnpm check:doc-props` 扫根 `README.md` / `docs/zh-CN` / `docs/examples`，
**独独漏掉真正入包的那一份**。同一个错误示例在根 README 里被改正、在入包 README 里静静留着，
门禁全程绿。

## 修正

- 入包 README 按**当前已实现**的面重写 Provider 两段示例：复用应用级默认（不传 `ak`），
  以及子树显式定义（`:provider` + `:load-options`，`baiduJsapiV4Provider` 从 `./advanced` 导入）。
  所用变量与 import 全部给出，不依赖读者未配置的全局默认值。
  `loadOptions` **只在同时传了 `provider` 时**被读取——单独传它静默无效，已在示例旁写明。
- `scripts/check-doc-props.mts` 的扫描面加入入包 README（路径抽成导出常量
  `PACKAGE_README`，扫描面抽成导出的 `scanTargets()`，并有用例断言「入包 README 真的在
  扫描面里」+「往真实文件注入坏 prop 即红」）。
  复用既有机制，未新增通用 Markdown 执行框架，未新增兼容 alias，未改动 Provider API。

## 三处示例面同步（**刻意不弱化** `check:snippet-consistency`）

`check:snippet-consistency` 要求 README / 入包 README / quick-start 三处示例的标识符集合
**完全相等**。入包 README 补上完整 Provider 示例后它立刻红——指出的是真实的漂移：
另两处还停留在「不传任何定义」的写法。

处置是**把示例补齐到三处**（`provider` + `loadOptions` + `baiduJsapiV4Provider` 一并给出），
而不是放宽判据。收尾后三处一致，判据覆盖的标识符从 7 个变成 **8 个**，区分力只增不减：

- 根 README 的 `app.use` 片段原先 `createApp(App)` 里的 `App` 是未定义标识符，
  一并补上 import 与 `app.mount('#app')`，README 中不再有「照着敲但跑不起来」的片段。

> 起草时曾把该门禁的「形状一致」判据收窄到「首图段」，好让入包 README 单方面多带一个进阶
> 示例。**那是错的**：实测把 `<BMapProvider>` 示例从根 README 删掉（另两处保留）后，
> 收窄版门禁照样绿——而它本该抓的正是这种「某一处没跟上」的回潮。已回退为原判据。
> 记录在此是因为「为迁就文档而放宽门禁」是个容易重犯的诱因。

## 消费验证

- `fixtures/consumer/src/npm-readme-examples.vue`：README 三段示例的消费方对照，由
  `pnpm verify:package` 对**真实 tarball** 跑 `vue-tsc`。它挡的是 import 路径 / 变量 /
  类型标注在发布产物上不成立（例如把只存在于 `./advanced` 的 `BMapLoadOptions` 写成从根入口导入）。
  只做一处必然改写：包名 `@mangax/bmap-vue` → `bmap-vue`（`verify-package.mts` 在拷贝出来的
  副本里换回真实身份）。
- `tests/behavior/npm-readme-provider-init.test.ts`：用 Fake v4 验**运行层**——干净应用
  （无任何隐藏默认定义）下 Provider / Map 的初始化路径，以及「无定义来源时必须明确报错」。

⚠️ 实测记录：`vue-tsc` **挡不住** `<BMapProvider :ak>` 这类缺陷——未声明的 prop 落进 `$attrs`，
Vue 不报错、退出码为 0。所以文本层的 `check:doc-props` 是这个缺陷的**主防线**，不是冗余。

来源、LICENSE / NOTICE / ACKNOWLEDGEMENTS 的引用原样保留。
