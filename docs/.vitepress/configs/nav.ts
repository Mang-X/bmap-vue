import type { DefaultTheme } from "vitepress";
import { version } from "../../../package.json" with { type: "json" };

export const nav: DefaultTheme.Config["nav"] = [
  {
    text: "文档",
    activeMatch: "/guide|components|hooks/",
    items: [
      {
        text: "指南",
        link: "/zh-CN/guide/introduction",
        activeMatch: "/guide/",
      },
      {
        text: "组件",
        // 指向组件总览而不是某一个具体组件：总览页按族分组，是「我在找哪个组件」的入口。
        link: "/zh-CN/components/index",
        activeMatch: "/components/",
      },
      {
        text: "Hook",
        link: "/zh-CN/hooks/useMarkerIcons",
        activeMatch: "/hooks/",
      },
      {
        text: "服务",
        link: "/zh-CN/guide/services",
        activeMatch: "/guide/services",
      },
    ],
  },
  {
    text: "相关链接",
    items: [
      {
        text: "百度拾取坐标系统",
        link: "https://api.map.baidu.com/lbsapi/getpoint/index.html",
      },
      {
        text: "百度地图开放平台",
        link: "https://lbsyun.baidu.com/index.php?title=%E9%A6%96%E9%A1%B5",
      },
      {
        text: "个性化地图编辑器",
        link: "https://lbsyun.baidu.com/index.php?title=open/custom",
      },
      {
        text: "百度地图开发资源下载",
        link: "https://lbsyun.baidu.com/index.php?title=open/dev-res",
      },
    ],
  },
  {
    text: `v${version}`,
    items: [
      {
        text: "CHANGELOG",
        link: "https://github.com/Mang-X/bmap-vue/blob/main/CHANGELOG.md",
      },
      {
        text: "V1",
        link: "https://Mang-X.github.io/bmap-vue/v1/",
      },
      {
        text: "历史版本",
        link: "https://github.com/Mang-X/bmap-vue/releases",
      },
    ],
  },
];
