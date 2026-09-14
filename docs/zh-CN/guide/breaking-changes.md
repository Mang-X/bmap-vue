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
| 显式自定义加载器 | `baiduCdnProvider()` 等 legacy 工厂 | 默认已是 v4；legacy 工厂与旧引擎**已删除** | 新代码用 `./core` 的 v4 Provider 家族（`baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider`） |
| 插件失败 | `TrackAnimation` 标成必需，失败即抛 | 内置插件一律 optional，失败只发 `plugin-error` | 依赖「抛错发现插件没加载」的代码改为监听 `plugin-error` |

同一批变更的完整依据见 [官方包契约](../contributing/official-packages) 与
[插件兼容 inventory](../contributing/plugin-compat-inventory)。

## 3.0.0-beta → 3.0（删除旧引擎：`webgl-v1` / `BMapGL`）

M3A.3 把旧引擎整份删除（决策见 [ADR 2026-09-14 删除旧引擎](/adr/2026-09-14-remove-legacy-engine)），
完整的迁移动作见 [WebGL v1 → JSAPI 4.0 迁移指南](./migration-v1-to-v4)。对调用方可见的变化：

| 变更 | 之前 | 现在 | 处置 |
| --- | --- | --- | --- |
| 根入口 Provider factory | `baiduCdnProvider()` / `customScriptProvider()` / `existingGlobalProvider()` | 根入口不再导出任何 Provider | 改用 `baidu-map-gl-vue/core` 的 v4 家族 |
| 迁移期归一 | `withMigrationDriver()` / `createLegacyBMapClient()` | 已删除；definition 原样交给 `createBMapClient` | 删掉那层包装 |
| Provider 形状 | `AnyBMapProviderLike`（结构化 + 裸全局对象） | 只有结构化 `BMapProviderLike` | `load()` 返回 `{ engine: "jsapi-v4", version, namespace, … }` |
| `<BMap allowExistingGlobal>` / 插件同名选项 | 显式 opt-in 复用已有全局（`BMap ?? BMapGL`） | prop 与选项都删除 | 传 `provider: existingGlobalV4Provider()` |
| 「页面已有全局」自动回退 | 有全局就回退并 warn | 已删除 | 同上 |
| `./advanced` 的 `detectEngine()` / `createDriver({ engine })` | 运行时 engine 猜测 + 多 engine 分派 | 只看 `createJsapiV4Driver({ rawSdk, version, unsupported })` | 显式给版本，不要再猜 engine |
| `LoadedSdk` | `LoadedJsapiV4 \| LoadedLegacySdk` 判别联合 | `LoadedJsapiV4` 的别名（`assertLoadedSdk` 唯一收口） | 删掉 legacy 分支处理 |
| Playground | `VITE_BMAP_MODE=legacy-fake` 对照档 | 该档与开关删除 | 无需配置 |
| 包文件清单 | `files: ["dist", "types", "volar.d.ts"]` | `files: ["dist", "volar.d.ts"]` | 无（`types/` 只剩构建期占位文件 `shared/` 与 `ui-kit/upstream.d.ts`，不再发布；`volar.d.ts` 是 Volar 提示产物，必须保留——`tsconfig` 里的 `"types": ["baidu-map-gl-vue/volar"]` 靠它） |
