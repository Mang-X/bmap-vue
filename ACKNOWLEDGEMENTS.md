# ACKNOWLEDGEMENTS

`bmap-vue` 源自开源项目
[yue1123/vue3-baidu-map-gl](https://github.com/yue1123/vue3-baidu-map-gl)。

## 原作者与历史贡献者

感谢原作者 **yue1123**，以及 `vue3-baidu-map-gl` 历史上的所有贡献者。
原项目的 MIT 许可与 `Copyright (c) 2021 yue1123` 声明原样保留在
[LICENSE](./LICENSE) 与 git 历史中。完整的来源说明见 [NOTICE.md](./NOTICE.md)。

## 1.0 之后

1.0 是一次面向百度地图 JSAPI 4.0 的 clean-slate 重构发布，包身份、公开 API 命名与
运行时架构都做了重整。重构与后续维护由 `bmap-vue` 的维护者与贡献者完成。
具体做了什么，见[项目来源与致谢](https://github.com/Mang-X/bmap-vue/blob/main/docs/zh-CN/about.md)。

参与贡献见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 上游与周边

- **百度地图 JavaScript API 4.0**——本库只做封装。许可、配额与服务条款由
  [百度地图开放平台](https://lbsyun.baidu.com/) 决定。
- [`@baidumap/jsapi-loader`](https://www.npmjs.com/package/@baidumap/jsapi-loader)——
  默认在线加载路径直接使用它。
- [`@baidumap/jsapi-ui-kit`](https://www.npmjs.com/package/@baidumap/jsapi-ui-kit)——
  建议、结果列表、翻页、路线面板、详情面板与主题等**标准 UI** 由官方包提供，
  本库不复制官方 UI。
- [`@baidumap/jsapi-v4-types`](https://www.npmjs.com/package/@baidumap/jsapi-v4-types)——
  类型边界的对照来源。
- [`huiyan-fe/react-bmap`](https://github.com/huiyan-fe/react-bmap)——
  官方 React 参考实现，公开 API 命名向它对齐。
