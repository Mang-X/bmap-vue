# ADR 2026-09-11：LoadedSdk 客户端收口与迁移期 Driver 分派

- 状态：已接受（Accepted）
- 日期：2026-09-11
- 计划键：`M3A1-CLIENT`（issue #18，追踪 #12）
- 取代：无
- **后续（2026-09-14，issue #26）**：本文决策 1 / 2 / 3 里「`LoadedSdk` 是判别联合 + 三条迁移期
  归一入口（`normalizeMigrationProvider` / `legacyDriverFactory` / `withMigrationDriver`）」的部分
  **已被 [ADR 2026-09-14 删除旧引擎](./2026-09-14-remove-legacy-engine.md) 取代**：旧引擎删除后
  `LoadedSdk` 就是 `LoadedJsapiV4` 的别名，`assertLoadedSdk` 是唯一收口点，宽松 Provider 形状
  不再存在。本文其余决策（Client 不接收裸 `unknown`、`driver` 注入点、metadata 三维度分离、
  插件注册由 Manifest 驱动）仍然有效。
- 相关：`packages/baidu-map-gl-vue/src/core/loader/loaded.ts`、`packages/baidu-map-gl-vue/src/client/**`、`packages/baidu-map-gl-vue/src/plugins/createBMapPlugin.ts`

## 背景

#16 把底层加载能力收敛进 `ScriptLoader` / `SharedLoadTask`，#17 让 v4 Provider 返回结构化的 `LoadedJsapiV4` 并统一进程级 `BMap` 冲突域。但 **Client 这一层还停留在旧契约**：

- `BMapProviderLike.load()` 声明为 `Promise<unknown>`，Client 只能拿到裸全局对象；
- `createBMapClient` 用 `detectEngine(loaded)` **运行时猜测** engine，猜错就静默走到别的 Driver；
- `BMapClient.version` 一个字段同时承担「组件库版本」「SDK 运行时版本」两种语义；
- 组件默认路径（`<BMap>` / `<BMapProvider>` / `createBMapPlugin`）直接拼 definition，没有统一的迁移期归一；
- `createBMapPlugin` 维护一份**手写组件数组**，与 Manifest 生成的 `components/index.ts` 存在漂移风险（手写数组确实漏了 `BMarkerList`）；
- 旧 `app.config.globalProperties.$baiduMapAk` 映射没有任何迁移提示。

这三处问题的共同点是「**契约不可判别**」：调用方无法从类型或运行时结构上知道「Provider 到底加载了什么、Client 该用哪个 Driver」。

## 决策

1. **加载结果结构化，且是判别联合。** `LoadedSdk = LoadedJsapiV4 | LoadedLegacySdk`，判别字段是 `engine`：
   - `LoadedJsapiV4` 携带 engine / version / namespace / load metadata（#17 已有）；
   - `LoadedLegacySdk` 只携带 `namespace` + `engine: "webgl-v1"`：**版本由 Driver 创建时探测**（`detectVersion`），Loader 不代为声明——这正是「默认路径不得猜测 engine」的具体表现。
2. **`createBMapClient` 默认只接受 `jsapi-v4`，并默认注入 `createJsapiV4Driver`。** `CreateBMapClientOptions.driver` 是 Driver 工厂注入点；默认值 `jsapiV4DriverFactory` 在内部先做 `assertLoadedJsapiV4`，因此「默认只接受 jsapi-v4」的判定点唯一且可测。
   - `driver/jsapi-v4/` 是**类型边界目录**（官方声明 augmentation），按 ADR 2026-09-10-bmap-raw-sdk-boundary 不得进入发布声明，因此 v4 驱动工厂落在 `driver/createJsapiV4Driver.ts`。
   - v4 Facet Driver 本体属 M3A.2（#19~#23）：本 Issue 只落默认注入点与 engine 收口，未实现时**明确失败**（`BMAP_CAPABILITY_UNSUPPORTED`），不提供「看似可用」的 Driver。
3. **Client 不再接收裸 `unknown`。** `assertLoadedSdk` 是唯一收口：缺 `engine` 判别字段 → `BMAP_SDK_ENGINE_MISMATCH`「Provider 必须返回结构化的 LoadedSdk」。新增错误码 `BMAP_SDK_ENGINE_MISMATCH`（不可重试）。
4. **`BMapClient` 把三个版本维度分开报告：** `libraryVersion`（组件库版本，`src/version.ts`，与 `package.json` 有一致性测试）、`engine`、`sdkVersion`（v4 由 Provider 声明；legacy 由 Driver 探测）。`version` 保留为等价于 `sdkVersion` 的兼容别名并标注 `@deprecated`。
5. **迁移期提供显式 legacy 工厂，但绝不作为默认。** `client/migration.ts` 提供三个入口：
   - `normalizeMigrationProvider`：结构化结果透传，v2/v3-beta 的裸全局对象按 `webgl-v1` 包装（唯一被接受的宽松形状）；
   - `legacyDriverFactory` / `createLegacyBMapClient`：显式 legacy，只接受 `webgl-v1`；
   - `withMigrationDriver(definition)`：**组件默认路径**的归一——按**加载结果的 engine** 分派 Driver，未显式声明 `driver` 时注入 `migrationDriverFactory`。
6. **组件默认路径按 engine 分派而不是写死 legacy。** 这样 `createBMapPlugin({ provider: baiduJsapiV4Provider() })` 不会被「默认注入 legacy」破坏（v4 加载结果会被分派到 v4 工厂），符合「默认配置能够无破坏地指向 v4 Provider」。默认 cutover（把默认 Provider 换成 v4 家族）仍属 M3A.3（#25）。
    - **分派契约 ≠ 运行能力**：`jsapi-v4` 会被正确路由到 v4 工厂，但 Facet Driver 本体在 M3A.2，当前抛 `BMAP_CAPABILITY_UNSUPPORTED`（不静默降级）。
    - **归一的收口点是 `createClientContext`**（客户端 context 层），不是每个调用点：`<BMap>`、`<BMapProvider>`、插件默认 definition、`resolveMapContext` 全部经由此处创建 Client，因此「同一份 definition 换一个入口就报 `BMAP_SDK_ENGINE_MISMATCH`」在结构上不可能发生（评审 P2 修复）。只有构造 definition 时就接受宽松 Provider 的地方（`props.provider`、插件 `provider`、`bmapConfig.provider`）需要就地归一以满足 `CreateBMapClientOptions.provider` 的类型要求；`withMigrationDriver` 幂等，重复归一不会改变语义。
7. **engine 猜测退出默认路径。** `detectEngine` 保留在 `./advanced`（历史调用方与逃生口），默认 Client 不再调用它；`createDriver` 的 `jsapi-v4` 分支改为委派 `createJsapiV4Driver`。
8. **组件注册以 Manifest 生成物为单一事实源。** `createBMapPlugin` 改为遍历 `components/index.ts`（由 `scripts/generate-manifest-artifacts.mts` 依据 `src/manifest.ts` 生成，`generate:manifest:check` 阻止漂移），注册名取 manifest 组件名，与 resolver / `volar.d.ts` 同名；删除手写数组。
9. **插件默认版本对齐 `DEFAULT_VERSION`（`4.0`）**，不再硬编码 `1.0`。
10. **旧 `globalProperties` 映射保留但降级为显式迁移提示**：`$baiduMapAk` / `$baiduMapApiUrl` 仍写入（v2 组件兼容），同时 `logger.warn` 说明「迁移期兼容映射，将在 3.0.0 Stable 移除」，进程内只提示一次。
11. **`<BMapProvider>` 增加 `provider` / `loadOptions` 便捷 props**（与 `<BMap>` 的 `provider` prop 对称），内部同样走 `withMigrationDriver`；显式 `definition.driver` 优先级最高。
12. **根入口只新增 type-only 导出。** `LoadedSdk` / `LoadedLegacySdk` 从根入口导出，因为它们出现在根入口已有的 `BMapProviderLike.load()` 返回类型里——不导出则自定义 Provider 无法为返回值命名。这与「根入口不导出 engine **枚举值**」不冲突：`BMapEngine`（`"webgl-v1" | "jsapi-v3" | "jsapi-v4"`）自 M1 起已经是根入口的公开类型，本 Issue 未新增任何 engine 运行时值；Driver 工厂等实现仍然只在 `./advanced` / `./core`。
13. **`BMapClient` 不新增「完整加载结果」字段。** 规格只要求 metadata 区分 `libraryVersion` / `engine` / `sdkVersion`；把 `LoadedSdk`（含 `namespace`）整体挂到 Client 上会扩大 raw SDK 暴露面，而 `rawSdk` 逃生口已经存在。加载结果只在 Client 内部用于推导 `sdkVersion`。

## 后果

- 正面：加载结果可判别、engine 归属唯一且可测；组件库版本与 SDK 版本不再混用；组件默认路径与 `createBMapClient` 的严格默认**分离且各自可测**（`withMigrationDriver` 覆盖迁移期，`createBMapClient` 覆盖目标契约）；插件注册不再有清单漂移；旧 globalProperties 有明确退出路径。
- 负面 / 成本：`./advanced` 与 `./core` 的 Client/Provider 契约在 `3.0.0-beta` 内**直接变更、不保留兼容层**（见「迁移影响」）；`CreateBMapClientOptions` 新增 `driver` 注入点，任何自己拼 definition 的调用方必须显式选择 Driver（`withMigrationDriver` 或 `driver`）。
- 回滚：恢复「`BMapProviderLike.load(): Promise<unknown>` + `detectEngine` 猜测 + 单一 `version` 字段」即可回滚本决策；回滚不触及 raw SDK 边界、Capability Catalog 与 Provider 家族（#17）。

## 迁移影响（3.0.0-beta 内直接切换，不保留兼容层）

| 变更 | 影响 | 处置 |
| --- | --- | --- |
| `BMapProviderLike.load()` 返回 `Promise<LoadedSdk>` | 自定义 Provider 必须返回结构化结果 | 返回 `{ engine, version, namespace, load }`（v4）或 `{ engine: "webgl-v1", namespace }`（legacy） |
| `BMapPluginConfig.provider` / `CreateBMapPluginOptions.provider` 改为跨引擎 `AnyBMapProviderLike` | 类型更宽：v4 家族、legacy 家族与 v2/v3-beta 宽松形状都合法 | 无需改动；之前若因类型收窄而无法把 v4 Provider 传给插件，现在可以直接传 |
| `createBMapClient()` 默认只接受 `jsapi-v4` | 原来用裸 Provider + 默认 Client 的 webgl-v1 用法会失败 | 改用 `withMigrationDriver(definition)` 或显式 `createLegacyBMapClient()` |
| `CreateBMapClientOptions.engine` 移除 | 显式 engine override 不再用于选 Driver | 注入 `driver` 工厂，或使用内置的 legacy / v4 工厂 |
| `BMapClient.version` 语义拆分 | 依赖 `version` 表示 SDK 版本的代码语义不变（仍等于 `sdkVersion`） | 需要组件库版本时用 `libraryVersion` |
| 内置 legacy Provider 返回结构化结果 | 读取 `await provider.load()` 直接当 SDK 用的代码会拿到包装对象 | 读 `.namespace`，或改用 `createLegacyBMapClient()` |
| `app.config.globalProperties.$baiduMapAk` | 保留但会 warn | 改用 `createBMapPlugin({ ak })` / `<BMapProvider>` |

## 非目标

- 不在本决策中完成默认 cutover（组件默认仍走 `withMigrationDriver`，M3A.3 / #25 切换）。
- 不实现 v4 Facet Driver（M3A.2 / #19~#23）。
- 不删除 webgl-v1 Driver、`types/BMapGL` 与 legacy Provider（M3A.3 / #26）。
- 不让组件/Composable 读取 `LoadedSdk.namespace`（raw SDK 仍只在 Driver/Client 边界）。

## 已知限制（显式接受）

- **`withMigrationDriver` 是迁移期唯一的宽松入口**：裸全局对象会被当作 `webgl-v1`。这是显式接受的迁移契约而不是猜测——它只在组件默认路径与显式 legacy 工厂内生效，默认 `createBMapClient` 仍然拒绝裸值。
- **v4 默认路径在 M3A.2 之前会明确失败**：`createJsapiV4Driver` 尚未实现，默认 `createBMapClient` 调用会抛 `BMAP_CAPABILITY_UNSUPPORTED`。这是刻意的（避免「看起来能用」），M3A.2 落地后自动变为可用。
- **`libraryVersion` 是手工常量**：`src/version.ts` 与 `package.json` 的一致性靠单测保证（`version.test.ts`），不是构建期注入（构建期 `__VERSION__` 在测试环境下与发布版本不一致）。

## 参考

- issue #18 `[M3A.1] 以 LoadedJsapiV4 收口 BMapClient、Provider 组件和插件默认配置`
- issue #17 `[M3A.1] 实现进程级 SDK Registry 与 JSAPI 4.0 Providers`
- issue #12 `[Roadmap] baidu-map-gl-vue v3：JSAPI 4.0 前置迁移与 Stable 发布`
- ADR [2026-09-10 冻结 JSAPI 4.0 单引擎基线](./2026-09-10-jsapi-v4-only-baseline.md)
- ADR [2026-09-10 BMap / raw SDK / 公共声明边界与 Capability Catalog](./2026-09-10-bmap-raw-sdk-boundary.md)
- ADR [2026-09-10 进程级 SDK 冲突域与迁移期分阶段域划分](./2026-09-10-sdk-conflict-domain.md)
