import vue from "@vitejs/plugin-vue";
import { defineConfig, type Plugin } from "vite";

/**
 * 插件脚本加载通道探针页的 dev server 配置（issue #121）。
 *
 * 与 `tests/browser/jsapi-v4/vite.config.ts` 同样的三条约束：
 * - 绑 `localhost`：百度 AK 的 Referer 白名单按**主机名**匹配，`127.0.0.1` 不放行（实测）；
 * - **回显本轮的 `PROBE_RUN_ID`**：orchestrator 用 `x-probe-run` 响应头确认「响应来自本轮实例」——
 *   端口被别的会话占着时会读到旧页面，而报告会看起来是本轮的；
 * - 页面用**相对路径** import 组件库源码：探针驱动的是候选提交的源码，而不是上一次构建的产物
 *   （同时避免「别名只存在于这个 vite.config」这类只在别处暴露的问题）。
 */

/** 本轮标识：orchestrator 注入；手工 `vite --config …` 打开页面时给个明确提示。 */
const runId = process.env.PROBE_RUN_ID ?? "";
if (!runId) {
  console.warn("[plugin-load-channel] 未设置 PROBE_RUN_ID：本轮页面不会被探针认可");
}

/**
 * 「建立连接但永不响应」的地址：`/__hang/*` 接受连接后**不写响应、也不关闭 socket**。
 *
 * 为什么用中间件而不是让进程 `sleep`：`<script>` 的 pending 必须**确定性**地一直不结算，
 * 既不能靠外网（也不该靠），也不能依赖某种超时抖动。这样「挂起」是构造出来的事实，
 * 而其余环节（注入脚本、读全局导出、注册表 / 宿主记账）全部是候选提交里的真实代码路径。
 */
const hangEndpoint: Plugin = {
  name: "plugin-load-channel-hang-endpoint",
  configureServer(server) {
    server.middlewares.use("/__hang", (_req, res) => {
      // 刻意什么都不做：不 `end()`、不 `writeHead()`、不 destroy。
      // 连接保持打开，请求永不结算 —— 这就是要观察的「不响应」。
      res.socket?.setNoDelay(true);
    });
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [vue(), hangEndpoint],
  server: {
    host: "localhost",
    // 端口与 `smoke:v4`（5212）分开：两个 harness 同时在本机跑时不要互相抢端口。
    port: Number(process.env.SMOKE_PORT ?? "5213"),
    strictPort: true,
    headers: { "x-probe-run": runId },
  },
});
