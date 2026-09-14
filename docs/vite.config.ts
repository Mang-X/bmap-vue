import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig(() => {
  return {
    optimizeDeps: {
      exclude: ["@vueuse/core", "vitepress"],
    },
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
