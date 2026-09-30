# Changelog

## bmap-vue 1.0

`bmap-vue` 目前处于 `1.0.0-rc` 预发布阶段，变更记录由 [changesets](https://github.com/changesets/changesets)
在发版时生成。1.0 是一次面向百度地图 JSAPI 4.0 的 clean-slate 重构发布：包身份、公开 API
命名与运行时架构都做了重整，**不提供**从旧版迁移的路径。

1.0 做了什么，见[项目来源与致谢](./docs/zh-CN/about.md)。

## 历史版本（上游 `vue3-baidu-map-gl`）

本项目源自 [yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl)。
它作为本项目的前身发布到 `2.6.5`，其变更记录**原样保留**在
[`docs/changelog/vue3-baidu-map-gl.md`](./docs/changelog/vue3-baidu-map-gl.md)。

::: warning 不要把两者的版本号混为一谈
上游也有一个 `1.0.0`（2022-11-22），那是 `vue3-baidu-map-gl` 的版本，
与本项目的 `bmap-vue@1.0` **没有任何关系**。两者的组件命名、导出面与 SDK 版本都不同。
:::
