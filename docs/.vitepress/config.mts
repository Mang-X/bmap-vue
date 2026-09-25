import { defineConfig } from "vitepress";
import { head, nav, sidebarConfigZh, mdPlugin, pwa } from "./configs/index.ts";
import { withPwa } from "@vite-pwa/vitepress";

export default withPwa(
  defineConfig({
    lang: "zh-CN",
    title: "bmap-vue",
    description:
      "基于百度地图 JSAPI 4.0 的 Vue 3 组件与 hooks 库，默认通过官方 @baidumap/jsapi-loader 加载 SDK。",
    lastUpdated: true,
    base: "/bmap-vue/",
    cleanUrls: true,
    head,
    markdown: {
      config: (md) => mdPlugin(md),
    },
    pwa: pwa,
    // locales: {
    //   text: '语言',
    //   items: [{ text: '简体中文', link: '/zh-CN/' }]
    // },
    themeConfig: {
      returnToTopLabel: "top",
      logo: "/logo.svg",
      nav,
      outlineTitle: "目录",
      outline: [2, 5],
      search: {
        provider: "local",
        // provider: 'algolia',
        // options: {
        //   appId: 'RT4OHPUGD1',
        //   apiKey: '76ba0d807534197fb89a2644c412240b',
        //   indexName: 'bmap-vue-zh'
        // }
      },

      footer: {
        message: "Released under the MIT License.",
        copyright: "Copyright © 2021 yue1123; 2022-present MangMax and contributors",
      },
      socialLinks: [{ icon: "github", link: "https://github.com/Mang-X/bmap-vue" }],
      sidebar: sidebarConfigZh,
      editLink: {
        pattern: "https://github.com/Mang-X/bmap-vue/edit/main/docs/:path",
        text: "Edit this page on GitHub",
      },
    },
  }),
);
