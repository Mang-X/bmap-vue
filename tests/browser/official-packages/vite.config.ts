import { defineConfig } from "vite";

/**
 * 官方包探针页的 dev server 配置。
 *
 * 两个必须项：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行；
 * - 依赖从工作区根 `node_modules` 解析（root 只切页面目录，不隔离 node_modules）。
 */
export default defineConfig({
  root: import.meta.dirname,
  server: { host: "localhost", port: 5211, strictPort: true },
  // 官方两个包是 CJS/UMD + ESM 混合发布，预打包让页面拿到的形状与 bundler 消费一致
  optimizeDeps: { include: ["@baidumap/jsapi-loader", "@baidumap/jsapi-ui-kit"] },
});
