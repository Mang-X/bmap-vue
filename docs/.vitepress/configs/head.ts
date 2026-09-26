import type { HeadConfig } from "vitepress";

export const head: HeadConfig[] = [
  ["link", { rel: "dns-prefetch", href: "//api.map.baidu.com" }],
  [
    "link",
    {
      rel: "icon",
      type: "image/png",
      sizes: "16x16",
      href: `/bmap-vue/logo.svg`,
    },
  ],
  ["meta", { name: "msapplication-TileColor", content: "#F72C30" }],
  ["meta", { name: "theme-color", content: "#F72C30" }],
  [
    "meta",
    {
      name: "description",
      content:
        "Vue 3 百度地图组件库：基于 Vue 3 与百度地图 JSAPI 4.0，默认通过官方 jsapi-loader 加载 SDK，方便开发者快速构建地图应用。",
    },
  ],
  [
    "meta",
    {
      name: "keywords",
      content:
        "vue3,vue component,baidu map,baidu map gl,baidu jsapi 4.0,bmap-vue,bmap vue,百度地图,组件库,vue3组件库,vue百度地图",
    },
  ],
  // Open Graph / 分享卡。站点此前**没有任何 og:*** —— 分享到社交平台只有裸标题。
  // 图片用站点绝对路径（部署在 /bmap-vue/ 下，写相对路径会解析到错误位置）。
  ["meta", { property: "og:type", content: "website" }],
  ["meta", { property: "og:title", content: "bmap-vue · Vue 3 的百度地图组件与 hooks" }],
  [
    "meta",
    {
      property: "og:description",
      content:
        "面向百度地图 JSAPI 4.0 的 Vue 3 组件与 hooks 库：覆盖物、控件、原生批量图层、headless 服务与官方 UI Kit 集成。",
    },
  ],
  ["meta", { property: "og:image", content: "/bmap-vue/screenshots/og-cover.jpg" }],
  ["meta", { property: "og:image:width", content: "1200" }],
  ["meta", { property: "og:image:height", content: "630" }],
  ["meta", { property: "og:locale", content: "zh_CN" }],
  ["meta", { name: "twitter:card", content: "summary_large_image" }],
];

if (process.env.NODE_ENV === "production") {
  head.push([
    "script",
    {},
    `
        var _hmt = _hmt || [];
        (function() {
          var hm = document.createElement("script");
          hm.src = "https://hm.baidu.com/hm.js?e4de65f9c92f179b3e32b0c28b0e299b";
          var s = document.getElementsByTagName("script")[0]; 
          s.parentNode.insertBefore(hm, s);
        })();
        `,
  ]);
}
