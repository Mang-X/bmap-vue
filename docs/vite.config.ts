import { defineConfig } from "vite";
import { resolve } from "node:path";
import { versionDefine } from "../scripts/vite-version-define.mjs";

export default defineConfig(() => {
  return {
    define: versionDefine,
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
        // docs 引用库源码(dev 热更新;生产构建走 vp pack 产物)
        "bmap-vue": resolve(import.meta.dirname, "../packages/bmap-vue/src/index.ts"),
      },
    },
  };
});
