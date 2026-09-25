# 项目来源与致谢

## 来源

`bmap-vue` 源自开源项目
[yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl)。

感谢原作者 **yue1123** 以及历史上所有贡献者。本项目在原作基础上继续演进，
原作的 MIT 许可与版权声明原样保留在仓库的 `LICENSE` 文件中：

> Copyright (c) 2021 yue1123

## 1.0 做了什么

1.0 是一次面向百度地图 JSAPI 4.0 的重构发布。它改了包的身份、API 命名与运行时架构，
但**没有**改写 git 历史，也没有抹掉原作的贡献。

- **包身份**：`bmap-vue`。
- **只支持 JSAPI 4.0**：不做多引擎分派。
- **API 命名对齐**：组件去掉 `B` 前缀（旧名 → `Map` / `Marker` / `InfoWindow` …），
  命名向官方 React 参考实现靠拢，方便双向迁移。
- **架构**：SDK 交互收在 Driver 边界内，组件与 composable 只依赖项目自己的领域类型；
  服务的回调归属按「可验证的身份」判定，不按到达顺序猜。

::: warning 1.0 不提供迁移路径
1.0 是 clean-slate：**没有**兼容别名、**没有**弃用 shim、**没有**迁移工具。
如果你从 2.x 升级，`usePoint` 这类已移除的 API 不会保留别名，需要按各页面改写。
:::

## 许可与声明

- 许可：MIT（见 [LICENSE](https://github.com/Mang-X/bmap-vue/blob/main/LICENSE)）。
- 来源与归属：[NOTICE.md](https://github.com/Mang-X/bmap-vue/blob/main/NOTICE.md)，
  随 npm 包一起发布。
- 百度地图 JSAPI 本身是百度的产品，本仓库只做封装，其许可与配额由百度地图开放平台决定。

## 参与贡献

见 [CONTRIBUTING.md](https://github.com/Mang-X/bmap-vue/blob/main/CONTRIBUTING.md)。
用法讨论走 [Discussions](https://github.com/Mang-X/bmap-vue/discussions)，
安全问题按 [SECURITY.md](https://github.com/Mang-X/bmap-vue/blob/main/SECURITY.md) 私密上报。
