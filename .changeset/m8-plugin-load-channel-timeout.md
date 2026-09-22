---
"baidu-map-gl-vue": patch
---

修复**四个内置插件**脚本「服务器不响应时永久挂起」：内置工厂现在有 60 秒默认超时（#121）。

**问题**：`plugins/builtins.ts` 的脚本加载通道（第三条加载实现，与官方 Loader、显式高级路径的
`ScriptLoader` 并列）只有 `<script>` + 全局导出短路 + `AbortSignal`，**没有超时**。脚本服务器
「建立连接但不响应」时：

- `whenPlugin(name)` **永久挂着**（live 探针实测：25s 窗口内 `PluginRegistry.inspect()` 一直是
  `status: "loading"`、`consumers: 1`）；地图本身照常 `ready`（这条隔离是成立的）；
- 同一个 `plugins` 列表里**后面的插件永远不会被请求**（列表是顺序 `await`，实测后一个插件的
  `attempts` 恒为 0）；
- 那个永不响应的 `<script>` 一直留在文档里。

**现在**：`BUILTIN_PLUGIN_SCRIPT_TIMEOUT_MS = 60_000`，**只作用于四个内置插件**（`TrackAnimation` /
`Mapvgl` / `DrawingManager` / `GeoUtils`）。超时按「作废」结算：

- 该插件以 `plugin-error` 回执，错误文本形如 `plugin load timed out after 60000ms: <url>`（可归类为
  超时，排查时有抓手），注册表状态转 `error`；
- 与取消走同一条清理：清计时器、清 abort 监听、**摘掉 `<script>`**；失败条目仍会被宿主移除，可重试；
- 同一列表里**后面的插件继续加载**（最多多等一个超时窗口）；
- 四个内置插件都是 optional（`required: false`），所以「插件没就绪」不会让地图失败。

**取值依据**：四个内置脚本实测 4.9 KB / 41.7 KB / 5.8 KB / **621 KB**（`Mapvgl`）。621 KB 在
20 KB/s 的链路上仅传输就要约 31s，而计时器还覆盖响应头、`response.text()` 与解析执行 ⇒ 取 **60s**
（约 2× 余量，对应约 10 KB/s 仍能过）。

**公共 API 与超时语义不变（评审 2026-09-22 P1 的修正）**：`urlPluginDefinition` 从根入口与 `./plugins`
双导出，是本库承诺给第三方的脚本插件工厂（`fixtures/v3-consumer/src/advanced-adapter.ts`、
`scripts/verify-package.mts` 都在用）。超时**不再**加在共用的 `loadScriptWithExport` 上，
**公共工厂的超时语义与本版之前一字不差：不设超时**（调用方仍可 `{ required: true }` 并自己决定等多久；
需要超时请在自己的 `load(context, signal)` 里包一层）。超时是本库对**自己那四个内置插件**的决定，
走内部入口 `createUrlPluginDefinition(name, url, exportGetter, options, timeoutMs)`。
因此本版**没有破坏性变更、也没有新增公开配置面**。

⚠️ 需要收窄的一处表述（评审第二轮 P2-2）：**「不变」只指 API 与超时语义**。下面第三条行为变更
（取消后的迟到写入）在**共用的**加载器里，所以它对用 `urlPluginDefinition` 构造的第三方 URL 插件
**同样生效**（尤其 URL 命中 `mapvgl` 分支时：从「已 reject 但迟到 `fetch` 仍 append」变成「reject 后不再写入」）。
这是修 bug，不是回退，但影响面要按这条说，不能写成「第三方完全不受影响」。

**顺带修掉一个同族的洞**：`Mapvgl` 分支的脚本是异步插入的（先 `fetch` 再 `appendChild`），
旧实现在这段窗口里取消只对「还没进文档的元素」调 `remove()`，于是**迟到的 `fetch` 回来时照样把内联
脚本插进文档**。现在用一个 `settled` 标记挡掉所有「已作废之后」的写入。

**行为变更（三处）**：

1. **内置插件**从「永远 `loading`」变成「60s 后 `error`」（只作用于四个内置插件）；
2. **内置插件**在超时 / 取消之后不再残留脚本元素；
3. **共用加载器**：取消 / 超时之后不再有「迟到的写入」⇒ 这条**同时覆盖**用 `urlPluginDefinition`
   构造的第三方 URL 插件（原先是「已经 reject 但迟到的 `fetch` 仍把内联脚本插进文档」）。

既有的 `error` 事件 / 「脚本加载成功但没暴露全局」/ `fetch` 失败三条路径的元素处理**未改**
（元素仍留在文档里），以便本票的行为增量可核对。

决策、判据（为什么**不**复用 `ScriptLoader`、为什么**不**给公开 options 加 `timeout`）与 live 读数见
[ADR 插件脚本加载通道的超时与取消语义](../docs/adr/2026-09-21-plugin-load-channel-timeout.md)。
