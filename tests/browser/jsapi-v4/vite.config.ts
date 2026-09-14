
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

/**
 * v4 required smoke 页的 dev server 配置。
 *
 * 四个必须项：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行（实测）；
 * - **回显本轮的 `PROBE_RUN_ID`**：orchestrator 用 `x-probe-run` 响应头判断「响应到底来自
 *   本轮的 Vite 实例」——端口被旧实例占着时会读到旧页面，而报告里的版本却来自当前工作区；
 * - **页面用相对路径 import 组件库源码**（不设别名）：smoke 驱动的是候选提交的源码而不是上一次
 *   构建的产物，同时避免「别名只存在于这个 vite.config，`tsc` 解析不了」这类只在别处暴露的问题；
 * - `fixture` 档零外部请求：Fake 命名空间让整轮不发任何跨域请求。
 */
const runId = process.env.PROBE_RUN_ID ?? "";
if (!runId) {
  // 只在 orchestrator 里会带上；手工 `vite --config ...` 打开页面时给个明确提示。
  console.warn("[smoke:v4] 未设置 PROBE_RUN_ID：本轮页面不会被 smoke:v4 认可");
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  server: {
    host: "localhost",
    // 端口由 orchestrator 经 `SMOKE_PORT` 传入（`--port` 才能同时作用于 URL 与 dev server）；
    // 手工 `vite --config ...` 时落到默认 5212。
    port: Number(process.env.SMOKE_PORT ?? "5212"),
    strictPort: true,
    headers: { "x-probe-run": runId },
  },
  // 官方 UI Kit 是 CJS/UMD + ESM 混合发布，预打包让页面拿到的形状与 bundler 消费一致。
  optimizeDeps: { include: ["@baidumap/jsapi-ui-kit"] },
});
