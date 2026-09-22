---
"baidu-map-gl-vue": patch
---

修复插件脚本「服务器不响应时永久挂起」：插件通道现在有 30 秒默认超时（#121）。

**问题**：`plugins/builtins.ts` 的脚本加载通道（第三条加载实现，与官方 Loader、显式高级路径的
`ScriptLoader` 并列）只有 `<script>` + 全局导出短路 + `AbortSignal`，**没有超时**。脚本服务器
「建立连接但不响应」时：

- `whenPlugin(name)` **永久挂着**（本轮 live 探针实测：25s 窗口内 `PluginRegistry.inspect()` 一直是
  `status: "loading"`、`consumers: 1`）；地图本身照常 `ready`（这条隔离是成立的）；
- 同一个 `plugins` 列表里**后面的插件永远不会被请求**（列表是顺序 `await`，实测后一个插件的
  `attempts` 恒为 0）；
- 那个永不响应的 `<script>` 一直留在文档里。

**现在**：`PLUGIN_SCRIPT_TIMEOUT_MS = 30_000`（模块常量，取值依据是四个内置脚本的体积 —— 最大的是
`Mapvgl` 的 621 KB）。超时按「作废」结算：

- 该插件以 `plugin-error` 回执，错误文本形如 `plugin load timed out after 30000ms: <url>`（可归类为
  超时，排查时有抓手），注册表状态转 `error`；
- 与取消走同一条清理：清计时器、清 abort 监听、**摘掉 `<script>`**；失败条目仍会被宿主移除，可重试；
- 同一列表里**后面的插件继续加载**（最多多等一个超时窗口）；
- 四个内置插件都是 optional（`required: false`），所以「插件没就绪」不会让地图失败。

**顺带修掉一个同族的洞**：`Mapvgl` 分支的脚本是异步插入的（先 `fetch` 再 `appendChild`），
旧实现在这段窗口里取消只对「还没进文档的元素」调 `remove()`，于是**迟到的 `fetch` 回来时照样把内联
脚本插进文档**。现在用一个 `settled` 标记挡掉所有「已作废之后」的写入。

**行为变更（仅两处，均可预期）**：① 挂起的插件从「永远 `loading`」变成「30s 后 `error`」；
② 超时 / 取消之后不再残留脚本元素。既有的 `error` 事件 / 「脚本加载成功但没暴露全局」/ `fetch` 失败
三条路径的元素处理**未改**（元素仍留在文档里），以便本票的行为增量可核对。

**不新增公开配置面**：`plugins: string[]` 不接受逐插件选项，`urlPluginDefinition` 也不是公开导出，
因此超时值目前不可按站点配置（记为已知限制）。

**与 SDK 入口的 `timeout` 无关**：那个参数是官方 Loader 的参数（`0` = 不超时），插件通道**不复用**；
也**没有**改默认 SDK 加载路径（`2026-09-13-official-first-loader-and-ui-kit` 的契约不变）。

决策、判据（为什么**不**复用 `ScriptLoader`）与 live 读数见
[ADR 插件脚本加载通道的超时与取消语义](../docs/adr/2026-09-21-plugin-load-channel-timeout.md)。
