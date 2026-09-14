import { defineConfig } from "vitepress";
import { head, nav, sidebarConfigZh, mdPlugin, pwa } from "./configs/index.ts";
import { withPwa } from "@vite-pwa/vitepress";

export default withPwa(
  defineConfig({
    lang: "zh-CN",
    title: "Vue3 Baidu Map Gl",
    description:
      "基于百度地图 JSAPI 4.0（使用 WebGL 对地图、覆盖物等进行渲染，支持 3D 视角展示地图）封装设计的 Vue3 组件/hooks 库，默认通过官方 @baidumap/jsapi-loader 加载 SDK。",
    lastUpdated: true,
    base: "/bmap-vue/",
    cleanUrls: true,
    /**
     * 组件库源码里的构建期常量（`src/core/logger.ts` 的 `devWarn`）。
     *
     * 文档站直接把组件库**源码**编进 bundle（见 `docs/vite.config.ts` 的 alias 与示例的
     * 相对 import），因此这份配置必须注入同一个常量：漏了就会在运行时读到一个不存在的
     * 全局标识符。取值按 Vite 的惯例——`build` 为 `false`（生产静态消除），`dev` 为 `true`。
     */
    vite: {
      define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== "production") },
    },
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
      i18nRouting: true,
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
        //   indexName: 'baidu-map-gl-vue-zh'
        // }
      },

      footer: {
        message: "Released under the MIT License.",
        copyright: "Copyright © 2022-present dh and all contributors",
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
