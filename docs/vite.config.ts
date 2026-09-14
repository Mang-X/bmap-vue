import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(() => {
  return {
    optimizeDeps: {
      exclude: ["@vueuse/core", "vitepress"],
    },
    // 组件库源码里的构建期常量（见 `src/core/logger.ts` 的 `devWarn`）。文档站/示例直接编源码，
    // 因此这份配置也要注入；`.vitepress/config.mts` 里另有一份（vitepress 用那份，这里兜底
    // 「有人直接拿这份 config 跑 vite」的场景）。
    define: { __DEV__: JSON.stringify(process.env.NODE_ENV !== "production") },
    server: {
      fs: {
        allow: [".."],
      },
    },
    resolve: {
      alias: {
        // docs 引用 v3 源码(dev 热更新;生产构建走 vp pack 产物)
        "baidu-map-gl-vue": resolve(
          import.meta.dirname,
          "../packages/baidu-map-gl-vue/src/index.ts",
        ),
      },
    },
  };
});
