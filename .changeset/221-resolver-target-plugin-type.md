---
"@mangax/bmap-vue": patch
---

修 `./resolver` 的公开类型与目标插件不兼容（#221）。

## 问题

`BMapResolver()` 承诺「给 `unplugin-vue-components` 做组件自动导入」，但
`ComponentResolverLike.type` 是**可选**（`type?`），而目标插件 `Options.resolvers` 要求
`ComponentResolverObject`（`type` **必填**）。于是消费者的标准写法

```ts
import Components from 'unplugin-vue-components/vite'
Components({ resolvers: [BMapResolver()] })
```

会被 TS 拒绝（**`type?` 不可赋给必填 `type`**）——**尽管运行时返回的对象确实带 `type`**。
类型把可用的东西挡在门外。只对照本库声明面（或只看生成表 / CI 绿）看不出这一条。

## 改动

- `ComponentResolverLike.type` 由 `type?` 改为**必填**（`type: "component" | "directive"`），
  对齐目标插件的 `ComponentResolverObject`。仍只做结构兼容，不 import 该包
  （它是可选**工具链集成**，不是本 run-time peer —— 原先的「可选 peer」表述也不实，已更正）。
- `docs/zh-CN/expand/resolver.md`：示例由 `unplugin-auto-import` 改为
  `unplugin-vue-components` 的 `Components({ resolvers: [...] })`（前者的 `vueTemplate` 默认
  `false`，根本不处理 `<template>`，与文档宣称的模板自动导入不符）；并补一句说明。
- API 基线（`./resolver` 与根入口）随之重生成。

## 判别力

两侧都加了证据：

- **单测**（`tests/behavior/resolver-consumer-contract.test.ts`）：用真实插件的类型声明编译
  `Components({ resolvers: [BMapResolver()] })`，要求零诊断；再配一条**反例**——把 `type`
  写回可选、放同一位置，**必须报错**。
- **消费端 fixture**（`fixtures/consumer/src/resolver.ts` + `unplugin-vue-components` 作 fixture
  devDependency）：走**发布包**（`bmap-vue/resolver` 子入口 → tarball 的
  `exports["./resolver"].types`）由 `verify:package` 的 `vue-tsc` 编译。单测对着 `src` 编译，
  抓不到 `dist/resolver.d.ts` 或 exports 的 `types` 回归；这条补上那一面。

突变验证：把 `type` 改回 `type?` ⇒ 正证用例翻红；恢复 ⇒ 通过。也就是说这条探针在修复前
**确实会报错**，不是恒真的空测试。

## 依赖

`unplugin-vue-components` 只作 **devDependency**（根：单测用；`fixtures/consumer`：消费端探针用），
不进 `peerDependencies`、不进运行期。
