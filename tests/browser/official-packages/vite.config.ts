import { defineConfig } from "vite";

/**
 * 官方包探针页的 dev server 配置。
 *
 * 三个必须项：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行；
 * - 依赖从工作区根 `node_modules` 解析（root 只切页面目录，不隔离 node_modules）；
 * - **回显本轮的 `PROBE_RUN_ID`**：orchestrator 用这个响应头判断「响应到底来自本轮的 Vite 实例」。
 *   端口被上一个探针或别的 worktree 占着时，旧进程回显的是它自己那一轮的 id，于是新进程
 *   启动失败不会被误判成「就绪」（评审第 2 轮）。
 */
const runId = process.env.PROBE_RUN_ID ?? "";
if (!runId) {
  // 只在 orchestrator 里会带上；手工 `vite --config ...` 打开页面时给个明确提示。
  console.warn("[official-probe] 未设置 PROBE_RUN_ID：本轮页面不会被 probe:official 认可");
}

export default defineConfig({
  root: import.meta.dirname,
  server: {
    host: "localhost",
    port: 5211,
    strictPort: true,
    headers: { "x-probe-run": runId },
  },
  // 官方两个包是 CJS/UMD + ESM 混合发布，预打包让页面拿到的形状与 bundler 消费一致
  optimizeDeps: { include: ["@baidumap/jsapi-loader", "@baidumap/jsapi-ui-kit"] },
});
