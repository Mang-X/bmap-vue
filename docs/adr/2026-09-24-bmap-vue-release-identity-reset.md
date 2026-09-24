# ADR 2026-09-24：bmap-vue 1.0 发布身份重置（#134）

- 状态：Accepted
- 日期：2026-09-24
- 关联：issue **#134**、#135、#136
- 影响范围：发布元数据、workspace 路径、构建与消费 fixture、版本来源、来源归属文档

## 背景

当前仓库同时承载旧的 `baidu-map-gl-vue` 发布身份和面向 JSAPI 4.0 的新实现，继续沿用旧的 `3.0.0-beta.x` 线会把历史兼容线误当成 1.0 发布线。项目源自 [yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl)，不能通过改名或 clean-slate 抹去原作者贡献与 MIT 许可。

2026-09-24 的发布环境检查发现 npm 上已经存在 `bmap-vue@1.5.0`；本地包身份重置不等于拥有该 registry 名称。正式发布前必须由维护者确认该包与本项目的归属关系及可用发布权限。

## 决策

1. 发布包统一命名为 `bmap-vue`，workspace 包目录改为 `packages/bmap-vue`；构建、打包和消费 fixture 使用中性命名。
2. 组件库版本从 `1.0.0-rc.x` 重新开始，当前预发布版本为 `1.0.0-rc.0`，正式版本线为 `1.0.0`。
3. 1.0 不提供旧 API 的无痛升级承诺，不在本决策中增加 alias、shim 或迁移兼容层；组件与 composable 的最终命名、legacy 代码清理分别由 #135 和 #136 负责。
4. 保留原 LICENSE 中的 `Copyright (c) 2021 yue1123`，并以 NOTICE 和 README 的来源章节记录项目延续关系。
5. 发布校验必须从 tarball 读取并校验 `name`、`version` 和 `exports`，构建版本常量、生成元数据和消费 fixture 使用同一 1.0 版本来源。

## 后果

- 使用者使用 `bmap-vue` 和 `1.0.0-rc.x` 识别新的发布线，不再从 `baidu-map-gl-vue` 或 `3.x` 推断兼容性。
- 旧 API 不因本次重命名自动获得兼容保证；需要迁移时以 #135/#136 的最终契约为准。
- Git 历史和原项目归属保持不变；clean-slate 只作用于发布面、API 面和文档面。
- 后续包元数据、CDN 全局名和文档入口不得重新引入旧发布身份。

## 非目标

- 不重写 Git 历史，不 squash 原作者提交。
- 不在本 ADR 中决定组件、Composable 或全局 API 的最终命名。
- 不在本 ADR 中删除 legacy 源码或迁移工具；这些工作由 #136 负责。
