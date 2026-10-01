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
        "@mangax/bmap-vue": resolve(import.meta.dirname, "../packages/bmap-vue/src/index.ts"),
        // 站点内部 alias 跟随发布身份改名；旧名 `bmap-vue` 是 npm 上他人所有的包，留着会让
        // 文档站自己 import 到一个不存在的身份（docs:brand 的 retired-scope 会抓到）
      },
    },
  };
});
