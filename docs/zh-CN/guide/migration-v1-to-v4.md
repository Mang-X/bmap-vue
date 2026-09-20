# WebGL v1 → JSAPI 4.0 迁移指南

> 面向两类使用者：
> - **`baidu-map-gl-vue@2.x` 用户**：2.x 的 SDK 基线是百度地图 JavaScript API **GL 版**
>   （`type=webgl&v=1.0`，全局 `BMapGL`）。3.0 改为 JSAPI **4.0**（全局 `BMap`），
>   且**不提供 `BMapGL` 回退开关**。
> - **`3.0.0-beta` 用户**：已经在 4.0 上，但用过迁移期入口（`baiduCdnProvider()`、
>   `withMigrationDriver()`、`<BMap allowExistingGlobal>` 等）。这些入口已随旧引擎删除。
>
> 决策与依据：[ADR 2026-09-14 删除旧引擎](/adr/2026-09-14-remove-legacy-engine)、
> [ADR 2026-09-10 冻结 JSAPI 4.0 单引擎基线](/adr/2026-09-10-jsapi-v4-only-baseline)。

## 0. 先判断你在哪一类

| 你的现状 | 建议 |
| --- | --- |
| 用 `baidu-map-gl-vue@2.x`，短期不能改代码 | **留在 2.x**。2.x 分支与产物继续维护（安全 / 关键修复），3.0 不提供 `BMapGL` 回退 |
| 用 `baidu-map-gl-vue@2.x`，准备升到 3.0 | 读本页第 1、2 节；SDK 世代的差异是主要工作量 |
| 用 `3.0.0-beta`，只用了默认路径（`createBMapPlugin({ ak })`） | 大概率不用改：默认路径在 R25 阶段就已经是 v4 + 官方 Loader |
| 用 `3.0.0-beta`，显式传过 legacy Provider / 用过宽松 Provider / 用过 `allowExistingGlobal` | 读本页第 3 节（逐条对照） |

> npm 包名始终是 **`baidu-map-gl-vue`**。仓库已迁到 `Mang-X/bmap-vue`，但**仓库改名不自动改
> 包名**，你不需要改 `import` 的包名。

## 1. 加载方式：从「自拼 URL / 自管回调」到官方 Loader

3.0 的默认路径把加载整段委托给官方 `@baidumap/jsapi-loader`（精确锁定 `1.0.0`）。
它负责入口 URL、script 单例、JSONP 回调、超时、同页版本 / AK 冲突与「复用页面已有全局」；
本库只负责配置口径校验、冲突域记账、按消费者取消等待与 `LoadedSdk` 归一化。

```ts
// 2.x / v3-beta：自己拼 CDN 入口（有的版本还允许 apiUrl 换入口）
app.use(createBMapPlugin({ ak: 'YOUR_AK', version: '1.0' }))

// 3.0：只需要 ak（版本默认就是 4.0，且只接受 '4.0'）
app.use(createBMapPlugin({ ak: 'YOUR_AK' }))
```

**默认路径不表达的配置**会在加载前**显式报错**（不是静默忽略）：

| 配置 | 3.0 行为 | 替代路径 |
| --- | --- | --- |
| `version`（除 `'4.0'`） | 报 `BMAP_INVALID_ARGUMENT` | 删掉它 |
| `apiUrl` / `<BMap api-url>` | 报 `BMAP_INVALID_ARGUMENT` | `customScriptV4Provider(scriptSrc)`（自托管 / 非标准入口） |
| `nonce` / `integrity` / `crossOrigin` / `referrerPolicy` | 报 `BMAP_INVALID_ARGUMENT` | 外部预加载 SDK 后 `existingGlobalV4Provider()` |
| `language` | 报 `BMAP_INVALID_ARGUMENT` | 上游 Loader 没有这个入口，暂不支持 |
| `timeout` | 支持；`0` = **不超时** | 需要截止时间就显式给毫秒数 |

v4 的 Provider 家族在 `baidu-map-gl-vue/core`：

```ts
import { baiduJsapiV4Provider, customScriptV4Provider, existingGlobalV4Provider } from 'baidu-map-gl-vue/core'
```

## 2. SDK 世代差异：`BMapGL` → `BMap`（4.0）

这是 2.x 用户的主要工作量。下面每条都有对应的 ADR / inventory 作为依据。

| 维度 | WebGL v1（`BMapGL`） | JSAPI 4.0（`BMap`） | 你要做什么 |
| --- | --- | --- | --- |
| 全局命名空间 | `window.BMapGL` | `window.BMap`（4.0 入口同时把 `BMapGL` 作为**同一对象的别名**挂上） | 不要读 `BMapGL`；宿主预加载场景用 `existingGlobalV4Provider()` |
| 一次设定中心 + 级别 | 有 `setView` | **没有** `setView`；用 `centerAndZoom(center, zoom, options)` | 把 `setView` 用法换掉（本库的 `initializeView` 已封装该语义） |
| `restrictCenter` | 生效 | **无声失效**（4.0 没有对应开关） | 需要限制范围时自行实现（这是最难排查的一类迁移问题，见 [map facet ADR](/adr/2026-09-11-jsapi-v4-map-facet)） |
| 批量数据图层 | 没有统一的 `addLayer`，图层混在 `map.overlays` 里 | `map.layers` + `addLayer`；8 种原生 kind（含 `track-line`） | 用 `driver.nativeLayers`（v4 独有面）而不是逐点 Marker |
| 事件点位 | WebGL 路径下是**米制 BD09MC**，需要墨卡托逆投影换算成度 | 直接是经纬度 | 不要照搬换算逻辑（[driver foundation ADR](/adr/2026-09-11-jsapi-v4-driver-foundation)） |
| 服务调用 | 回调式（自己包 Promise） | 归一化调用面 `ServiceCall<ServiceResult>`（`driver.services`） | 用调用面，别自己包 |
| 全景 | `{ supported }` 占位 | viewer / service 的 Handle 与生命周期 | 用 `driver.panorama` |
| 私有面 | — | `_rd` 私有回调表、`qt=` 私有请求码、`getSeckeyAndSign` 等**一律禁止** | 需要的能力若只有私有面可选，按「不支持」处理（[私有面删除 ADR](/adr/2026-09-13-private-sdk-surface-removal)） |

逐能力清单（哪些是 `native` / `extended` / `experimental` / `unsupported`）看
[Capability Catalog 能力矩阵](/zh-CN/contributing/capability-matrix)；插件（`BMapGLLib` 系列）
在 4.0 上的逐项实测结论看[插件兼容 inventory](/zh-CN/contributing/plugin-compat-inventory)：

- `TrackAnimation` / `DrawingManager` / `GeoUtils`：声明面无缺口，**最小运行时路径已验证**，
  完整链路未验证；
- `MapVGL`：**不兼容**（依赖 `_rd` 私有回调表 + 视图容器挂载路径在 4.0 上不成立）；
- 其余（DistanceTool / AreaRestriction / InfoBox / RichMarker / LuShu）：未内置，未评估。

> 已知限制（3.0 现状，见 [ADR 2026-09-14](/adr/2026-09-14-remove-legacy-engine) 的「已知限制」）：
> `useBMapTrackAnimation` 已于 #104 删除（它在 v4 上只会从 Driver 拿到
> `BMAP_CAPABILITY_UNSUPPORTED`，自有播放状态机因此永远不可达）；4.0 的对应能力是原生图层
> `track-line`，插件迁移结论属 M8 / #43。
>
> `BContextMenu` 的挂载目标自 M5 / #33 起**已实测可用**：`map` 与 `marker` 两个目标都能挂
> （`Marker#addContextMenu` 是 4.0 的**运行时扩展成员**——官方类型包只在 `Map` 上声明它，真实
> 运行时存在且可用，读数见 [ADR 2026-09-19](/adr/2026-09-19-custom-overlay-and-context-menu)）。
> 其余目标（`overlay` / `clusterer` / 旧层组件下的菜单）**没有入口证据**，会**显式报错**而不是
> 悄悄挂到地图上。

## 3. `3.0.0-beta` 用户：被删除的迁移期入口逐条对照

| 之前怎么写 | 现在怎么写 |
| --- | --- |
| `import { useBMapTrackAnimation } from 'baidu-map-gl-vue'` | 已删除（#104）。它在 v4 上只会从 Driver 拿到 `BMAP_CAPABILITY_UNSUPPORTED`，自有播放状态机因此永远不可达。轨迹播放请等 M8 / #43 在原生 `TrackLine` 上给出的薄命令面 |
| `const { setKeyFrames, start, stop, proceed, status } = useBMapViewAnimation()` | 收窄为 `start(keyFrames)` / `cancel()` / `status`（#104）。`stop` / `proceed` 依赖 SDK 私有的 `_pause` / `_continue`，本库不再用私有面伪造暂停/继续；`status` 只剩 `idle` / `playing` 两个**观察值**，由公开事件写，命令不再乐观改它 |
| `driver.services.suggest(autocomplete, keyword)` | 已删除（#104）。`Autocomplete` 只有一条不带请求身份的 `onSearchComplete`，程序化检索的归属只能靠 keyword/FIFO 猜；改用 `createAutocomplete({ input, onSearchComplete })` 监听原生回包，或换 `useBMapLocalSearch` / 官方 UI Kit |
| `import { baiduCdnProvider, customScriptProvider, existingGlobalProvider } from 'baidu-map-gl-vue'` | 根入口**不再导出任何 Provider**；改用 `baidu-map-gl-vue/core` 的 `baiduJsapiV4Provider()` / `customScriptV4Provider()` / `existingGlobalV4Provider()` |
| `withMigrationDriver({ provider, loadOptions })` | 删掉这层包装，直接把 `{ provider, loadOptions }` 交给 `createBMapClient()` / `<BMapProvider :definition>`；`createBMapClient` 的默认 Driver 工厂已是 v4 |
| `createLegacyBMapClient({ provider })` | 已删除。旧引擎不在 3.0 里，请用默认 `createBMapClient()` |
| Provider 返回**裸全局对象**（`load: async () => window.BMap`） | 必须返回结构化结果（`LoadedJsapiV4`）。**优先用内置家族**（它们内部就返回结构化结果）；自研加载器用公开的 `createLoadedJsapiV4()` 构造，**不要**手写 `{ engine, version, namespace }` 字面量（`load` metadata 必填，手写会少字段） | 见[配置 → Provider 的返回值](./config)，那里有一段可直接抄的代码 |
| 根入口的 `BMapProvider` 类型 | 改用 `BMapProviderLike`（结构化 Provider 的形状） |
| `<BMap allowExistingGlobal>` / `createBMapPlugin({ allowExistingGlobal })` | prop 已删除；传 `provider: existingGlobalV4Provider()`（并且不再有「页面恰好有全局就用它」的隐式回退） |
| `./advanced` 的 `detectEngine()` / `createDriver({ engine })` | 只用 `createJsapiV4Driver({ rawSdk, version, unsupported })`（engine 猜测已删除） |
| 自己拼 `{ engine: 'webgl-v1', namespace }` 作为加载结果 | 会收到 `BMAP_SDK_ENGINE_MISMATCH`（旧引擎已删除） |
| Playground `VITE_BMAP_MODE=legacy-fake` | 该档与开关已删除；传了会被忽略并落到默认档 `fake-v4` |

## 4. 迁移检查清单

1. 升级到 `3.0.0-beta.x` 之后，先确认**只用默认路径**能否跑通：`createBMapPlugin({ ak })` +
   `<BMap>`，不传 `provider`。
2. 搜索 `BMapGL`：业务代码里对它的直接引用要全部清掉（3.0 不再提供它）。
3. 搜索 `baiduCdnProvider` / `withMigrationDriver` / `createLegacyBMapClient` / `detectEngine`：
   按第 3 节逐条替换。
4. 删除 `version: '1.0'` 之类的旧版本号；确认没有用 `apiUrl` 换入口（两者都会在加载前报错）。
5. 检查 `setView` / `restrictCenter` 的用法（第 2 节表格里最需要人工确认的两条）。
6. 自托管 / 宿主已加载 SDK 的场景改走 `customScriptV4Provider()` / `existingGlobalV4Provider()`。
7. 插件的现状先查[插件兼容 inventory](/zh-CN/contributing/plugin-compat-inventory)，
   不要假设 `BMapGLLib` 系列在 4.0 上等价可用。
8. 如果某个能力在 4.0 上没有入口，按[能力矩阵](/zh-CN/contributing/capability-matrix)的
   `unsupported` 语义处理，**不要**去访问 `_rd` 之类的私有面。
