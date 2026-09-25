import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { versionDefine } from "../../../scripts/vite-version-define.mjs";

/**
 * 官方对照真实浏览器档的 dev server 配置（issue #140，档位二）。
 *
 * 与 `tests/browser/live-performance/vite.config.ts` 相同的三条约束：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行；
 * - 回显 `x-probe-run`：编排脚本用 `x-probe-run` 判断响应来自本轮实例；
 * - 页面用相对路径 import 组件库源码（驱动候选提交，而不是旧构建产物）。
 *
 * 端口默认 5215：与 smoke（5212）、plugin-load-channel（5213）、live-performance（5214）错开。
 *
 * ⚠️ 本档**不设**任何 AK 环境变量：走 `import.meta.env` 会被 vite **内联进产物**，
 * 等于把 AK 写进可能被上传的构建输出。AK 由编排脚本经 **CDP** 注入页面
 * （见 `main.ts` 与 `collect-official-contrast-live.mts` 的说明）。
 *
 * ⚠️ `logLevel: "silent"` 是**安全措施**，不是洁癖：vite 的 info 级日志会把每个请求的
 * URL 原样写进 stdout，而 CI 里 stdout 就是 job log——保留它的读者范围比 secrets 大得多
 * （任何人有仓库读权限就能看，且日志常被镜像到聚合器）。脚本的 stdout 出口虽然过了
 * `redactAk`，但**子进程**的输出不经过那个出口；让 vite 根本不打这行是最短路径。
 */
const runId = process.env.CONTRAST_RUN_ID ?? "";
if (!runId) {
  console.warn("[perf:contrast:live] 未设置 CONTRAST_RUN_ID：本轮页面不会被采集脚本认可");
}

export default defineConfig({
  root: import.meta.dirname,
  logLevel: "silent",
  plugins: [vue()],
  define: versionDefine,
  server: {
    host: "localhost",
    port: Number(process.env.SMOKE_PORT ?? "5215"),
    strictPort: true,
    headers: { "x-probe-run": runId },
  },
});
