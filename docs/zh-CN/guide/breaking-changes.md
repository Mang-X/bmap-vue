# Breaking Changes

## v1 to v2

所有组件名字增加 `B` 前缀，避免与其他组件库冲突 [#24](https://github.com/Mang-X/bmap-vue/issues/24)

## v2 / v3-beta to v3（JSAPI 4.0 默认切换）

默认 SDK 从「自研 JSONP 加载 CDN 脚本」改为**委托官方 `@baidumap/jsapi-loader` 加载 JSAPI 4.0**
（决策见 [ADR 2026-09-13 默认在线路径委托官方 Loader](/adr/2026-09-13-default-online-loader-cutover)）。
对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| `version` | 任意字符串（例如 `'1.0'`） | 只接受 `'4.0'`，其它值在加载前抛 `BMAP_INVALID_ARGUMENT` | 删除 `version`（默认就是 `4.0`）或显式写 `'4.0'` |
| `apiUrl` / `<BMap api-url>` | 静默用于自建入口 | 默认路径**没有**这个入口，传入即报 `BMAP_INVALID_ARGUMENT` | 改用 `customScriptV4Provider(scriptSrc)` 或 `existingGlobalV4Provider()` |
| `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` / `language` | 静默忽略 | 显式报 `BMAP_INVALID_ARGUMENT` | 外部预加载 SDK 后走 `existingGlobalV4Provider()`（上游 Loader 不接收这些参数） |
| `timeout` | 语义模糊 | 官方支持：`0` = **不超时** | 需要截止时间就显式配一个毫秒数 |
| 显式自定义加载器 | `baiduCdnProvider()` 等 legacy 工厂 | 默认已是 v4；显式传 legacy 仍可用（随 #26 删除） | 新代码用 `./core` 的 v4 Provider 家族 |
| 插件失败 | `TrackAnimation` 标成必需，失败即抛 | 内置插件一律 optional，失败只发 `plugin-error` | 依赖「抛错发现插件没加载」的代码改为监听 `plugin-error` |

同一批变更的完整依据见 [官方包契约](../contributing/official-packages) 与
[插件兼容 inventory](../contributing/plugin-compat-inventory)。
