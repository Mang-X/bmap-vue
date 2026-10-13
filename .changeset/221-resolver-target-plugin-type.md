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

新增 `tests/behavior/resolver-consumer-contract.test.ts`：用**真实插件的类型声明**
（`unplugin-vue-components`，devDependency）编译 `Components({ resolvers: [BMapResolver()] })`，
要求**零诊断**；再配一条**反例**——把 `type` 写回可选、放在同一位置，**必须报错**。

突变验证：把 `type` 改回 `type?` ⇒ 正证用例翻红；恢复 ⇒ 通过。也就是说这条探针在修复前
**确实会报错**，不是恒真的空测试。

## 依赖

`unplugin-vue-components` 只作 **devDependency**（消费端类型探针用），不进 `peerDependencies`、
不进运行期。
