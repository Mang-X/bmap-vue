import type { PwaOptions } from "@vite-pwa/vitepress";

export const pwa: Partial<PwaOptions> = {
  outDir: ".vitepress/dist",
  registerType: "prompt",
  includeManifestIcons: false,
  manifest: {
    id: "/bmap-vue/",
    name: "bmap-vue",
    short_name: "bmap-vue",
    description:
      "面向 Vue 3 的百度地图组件与 hooks 库，基于百度地图 JavaScript API 4.0（WebGL 渲染，支持 3D 视角）。",
    theme_color: "#F72C30",
    start_url: "/bmap-vue/",
    lang: "zh-CN",
    dir: "ltr",
    orientation: "natural",
    display: "standalone",
    display_override: ["window-controls-overlay"],
    categories: ["development", "developer tools"],
    icons: [
      {
        src: "icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "maskable-icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        // 之前指向 `home.jpg` 却声明 `1200x630`，而那张图实际是 1920×1920——
        // manifest 里的 `sizes` 必须与真实像素一致，否则安装横幅会拿到错误尺寸的资源。
        src: "screenshots/og-cover.jpg",
        sizes: "1200x630",
        type: "image/jpg",
        label: "面向 Vue 3 的百度地图组件与 hooks 库，基于百度地图 JavaScript API 4.0。",
        form_factor: "wide",
      },
      {
        src: "screenshots/site-home.jpg",
        sizes: "1600x1000",
        type: "image/jpg",
        label: "bmap-vue 文档站首页。",
      },
    ],
    handle_links: "preferred",
    launch_handler: {
      client_mode: ["navigate-existing", "auto"],
    },
    edge_side_panel: {
      preferred_width: 480,
    },
  },
  experimental: {
    includeAllowlist: true,
  },
  workbox: {
    cacheId: "bundle-prefetch",
    maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    globPatterns: ["**/*.{css,js,html,svg,png,ico,txt,woff2,json}"],
    globIgnores: ["*.cdr", "*.glb"],
    runtimeCaching: [
      {
        urlPattern: /^https:\/\/raw\.githubusercontent\.com\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "animated-images-cache",
          expiration: {
            maxEntries: 15,
            maxAgeSeconds: 60 * 60 * 24 * 365, // <== 365 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /^https:\/\/img\.shields\.io\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "dynamic-images-cache",
          expiration: {
            maxEntries: 15,
            maxAgeSeconds: 60 * 60 * 24, // <== 1 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "jsdelivr-images-cache",
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 7, // <== 7 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /^https:\/\/api\.github\.com\/.*/i,
        handler: "NetworkFirst",
        options: {
          cacheName: "github-api-cache",
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 1, // <== 7 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
      {
        urlPattern: /\.glb$/i,
        handler: "CacheFirst",
        options: {
          cacheName: "3d-model-cache",
          expiration: {
            maxEntries: 10,
            maxAgeSeconds: 60 * 60 * 24 * 365, // <== 7 days
          },
          cacheableResponse: {
            statuses: [0, 200],
          },
        },
      },
    ],
  },
};
