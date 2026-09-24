import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { versionDefine } from "../../../scripts/vite-version-define.mjs";

/**
 * 真实浏览器档性能页的 dev server 配置（#123）。
 *
 * 与 `tests/browser/jsapi-v4/vite.config.ts` 相同的三条约束：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行；
 * - 回显 `PROBE_RUN_ID`：orchestrator 用 `x-probe-run` 判断响应来自本轮实例；
 * - 页面用相对路径 import 组件库源码（驱动候选提交，而不是旧构建产物）。
 *
 * 端口默认 5214：与 smoke（5212）、plugin-load-channel（5213）错开。
 */
const runId = process.env.PROBE_RUN_ID ?? "";
if (!runId) {
  console.warn("[perf:baseline:live] 未设置 PROBE_RUN_ID：本轮页面不会被采集脚本认可");
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue()],
  define: versionDefine,
  server: {
    host: "localhost",
    port: Number(process.env.SMOKE_PORT ?? "5214"),
    strictPort: true,
    headers: { "x-probe-run": runId },
  },
});
