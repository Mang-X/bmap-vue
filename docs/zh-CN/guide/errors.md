# 错误码与排障

> v3 运行时通过统一的 [`BMapError`](../../packages/baidu-map-gl-vue/src/core/errors/BMapError.ts) 报告错误。
> 所有错误携带 `code`(稳定标识)、`message`、可选 `cause`/`mapId`/`component`/`plugin`。

## 错误码总览

| code | 分类 | 可重试 | 触发场景 |
|---|---|---|---|
| `BMAP_SDK_LOAD_FAILED` | SDK 加载 | ✅ | 官方 Loader 注入入口脚本失败(网络/拦截/CSP),或脚本就绪但全局命名空间缺失/不完整 |
| `BMAP_SDK_LOAD_TIMEOUT` | SDK 加载 | ✅ | 脚本注入超过 `timeout` 未回调 |
| `BMAP_SDK_CONFIG_CONFLICT` | SDK 配置 | ❌ | 进程级 SdkRegistry 检测到冲突配置 |
| `BMAP_PROVIDER_ABORTED` | Provider | ✅ | 加载被 AbortSignal 中止 |
| `BMAP_RUNTIME_DISPOSED` | 运行时 | ❌ | 在 MapRuntime 销毁后访问 |
| `BMAP_PARENT_CONTEXT_MISSING` | 上下文 | ❌ | 子组件未挂在 `BMap` 内(缺少 map context) |
| `BMAP_RESOURCE_CREATE_FAILED` | 资源 | ❌ | Overlay/Control/Layer 创建失败 |
| `BMAP_PLUGIN_LOAD_FAILED` | 插件 | ✅ | 插件脚本加载或初始化失败 |
| `BMAP_SERVICE_FAILED` | 服务 | ✅ | 服务调用失败：SDK 公开状态码非 0、或服务端在 `timeout` 内未回包 |
| `BMAP_INVALID_ARGUMENT` | 参数 | ❌ | 参数与官方 API 契约不符（例如 `<BInfoWindow open>` 没给 `position`） |
| `BMAP_INVALID_POINT` | 参数 | ❌ | 传入非法坐标(缺 lng/lat) |
| `BMAP_UI_KIT_UNAVAILABLE` | 依赖/环境 | ❌ | `./ui-kit` 在无 DOM 环境被调用，或未安装 optional peer `@baidumap/jsapi-ui-kit` |

## 错误对象结构

```ts
interface BMapErrorLike {
  code: BMapErrorCode
  message: string
  cause?: unknown
  mapId?: symbol | string
  component?: string
  plugin?: string
  toJSON(): Record<string, unknown>
  retryable: boolean
}
```

- `retryable === true` 的错误(加载/配置类)可以重试。
- `toJSON()` 输出结构化上下文,便于上报面板/日志。

## 逐个排障

### `BMAP_SDK_LOAD_FAILED`

**原因**:官方 Loader 无法注入入口脚本(默认路径从 `api.map.baidu.com/api?v=4.0` 取),或脚本已执行但
`BMap` 命名空间缺失 / 不完整(至少需要 `Map` / `Point` / `Marker`)。
**排查**:
- 检查网络能否访问 `api.map.baidu.com/api`。
- 检查 CSP `script-src` 是否放行。
- 检查 AK 是否有效。实测（真实 AK 档，见 [ADR 2026-09-13 v4 required smoke](/adr/2026-09-13-v4-required-smoke)
  的「已知限制」）：**无效 AK 仍会注入脚本并挂上命名空间**，但地图对象是半初始化的，这类失败表现为 Driver
  在读 SDK 时抛 `TypeError`，**不是**本错误码 —— 也就是说它无法与实现回归区分，当前按保守的 `fail` 处理。
**解决**:使用自定义 Provider(自托管脚本),见[配置指南](./config.md#client-查找顺序)。

### `BMAP_SDK_LOAD_TIMEOUT`

**原因**:脚本注入后 `callback` 未在 `timeout` 内触发。
**排查**:AK 是否正确、网络是否缓慢、是否被广告拦截。
**解决**:提高 `timeout`,`provider` 注入更可控。

### `BMAP_SDK_CONFIG_CONFLICT`

**原因**:同一进程内多个不同配置请求同一 SDK。
**解决**:统一 Provider/AK;或使用独立 SDK Registry key。

### `BMAP_PROVIDER_ABORTED`

**原因**:组件卸载或用户取消导致加载中止。
**解决**:无需处理(预期行为),重试时会重新加载。

### `BMAP_RUNTIME_DISPOSED`

**原因**:Map 已卸载/销毁后仍调用 `whenReady` 等。
**解决**:在 `onUnmounted` 前完成异步逻辑,或监听 `unload` 事件。

### `BMAP_PARENT_CONTEXT_MISSING`

**原因**:`BMarker`/`BCircle` 等子组件未包裹在 `BMap` 内，且上层也没有 `<BMapProvider>` 提供 Client 上下文。
**解决**:将子组件放在 `<BMap>` 的默认插槽中；纯服务 hooks（`useBMapGeocoder` 等）可放在 `<BMapProvider>` 子树内。

### `BMAP_RESOURCE_CREATE_FAILED`

**原因**:SDK 对象创建失败(参数非法、SDK 方法不存在)。
**解决**:检查 props 是否符合组件文档;查看 `cause`。

### `BMAP_PLUGIN_LOAD_FAILED`

**原因**:插件脚本加载或 `load()` 失败。
**解决**:插件插件版本是否与 SDK 兼容;检查 `plugin` 字段;使用 `urlPluginDefinition` 固定版本。

### `BMAP_SERVICE_FAILED`

**原因**：服务调用没有得到可用结果，且**能给出公开的原因**：

- `Geolocation#getStatus()` 返回非 0 的 `BMAP_STATUS_*`（权限被拒、服务不可用、定位超时等）；
- `Convertor#translate` 的回包 `status ≠ 0`（如坐标超出范围）；
- `... timed out after 15000ms`：服务端 15s 内没有回包，检查网络后重试。

**关于「配额用尽 / Referer 白名单拦截」**：百度 JSAPI 在这类失败时只回**空结果**，官方没有公开的错误码入口（错误码在它的私有回调表里，本库**不**去嗅探——见 [ADR 2026-09-13](../../adr/2026-09-13-private-sdk-surface-removal.md)）。因此：

- `useBMapGeocoder` / `useBMapGeocodeDetail` 等服务在服务端失败时**不会报错**，而是以 `status === 'empty'` 结算（`data` 为 `null`、`error` 也是 `null`）——它与「真的查无结果」在公开面上**不可区分**；
- 「动作恒 resolve」：所有服务动作返回 `Promise<ServiceResult<T>>`、不 reject，失败/超时/取消都在返回值里（`status` 是 `failed` / `timeout` / `canceled`）；
- 需要区分时只能按业务口径处理（重试、提示、或换 AK / 查 Referer 白名单），并在自己的埋点里记录调用上下文。

**解决**：按 `error.message` 与你的业务上下文处理；`status` 为 `empty` 时按「没有结果」展示，同时留意配额与白名单这两个最常见的环境原因。

:::tip `unsupported` 与 `failed` 不是一回事

`status === 'unsupported'` 表示**当前引擎没有这个能力**：一次请求都没有发出（同时 `supported` 为
`false`）。把它按 `failed` 处理会误导用户去「重试」。

### `BMAP_INVALID_ARGUMENT`

**原因**：调用与官方 API 的契约不符，最典型的是**打开气泡没给位置** —— `<BInfoWindow open>` 没有
`position`。官方 4.0 的 `Map#openInfoWindow(infoWnd, point)` 要求 `point`，`InfoWindow` 实例也没有
公开的 `openInfoWindow()`，因此没有「用一个默认位置打开」的语义；组件不会打开气泡，而是把这条错误交到
内部诊断总线（见下方[统一捕获](#统一捕获)）。

**解决**：给 `<BInfoWindow>` 传 `position`。气泡挂到 Marker 上的「目标级打开」属后续里程碑。

### `BMAP_INVALID_POINT`

**原因**:position/center 等缺少 `lng`/`lat`。
**解决**:传入 `{ lng, lat }` 合法对象。

### `BMAP_UI_KIT_UNAVAILABLE`

**原因**:`./ui-kit` 的官方 UI Kit 依赖不可用。两种情形：

1. **无 DOM 环境**（SSR / Node）调用了 UI 组件：上游 UI Kit 的入口在模块求值期就访问 `document`，
   本库在 `loadUiKit()` 里前置判掉，因此拿到的是这条可读错误，而不是上游的模块崩溃；
2. **未安装** `@baidumap/jsapi-ui-kit`（它是 optional peer），或加载失败。

**排查/解决**:
- 服务端渲染时不要渲染 `BPlaceAutocomplete` / `BPlaceSearch`（只渲染地图即可，UI 部分等挂载后再渲染）；
- 确认已安装 `@baidumap/jsapi-ui-kit@1.1.2`：`pnpm add @baidumap/jsapi-ui-kit@1.1.2`。

**可重试性**:标记为❌ —— 它不是「加载/配置类」错误，而是**环境或依赖未满足**；
在同一个环境里重试不会有不同结果。修复环境/装好依赖后重新触发即可
（本库不缓存这次失败，下一页/下一次调用会重新尝试加载）。

## 统一捕获

`BMap` 通过 `@error` 事件接收加载错误；各子组件的创建失败经内部诊断总线 `resource:error` 上报，
可在 `<BMap>` 子树内订阅：

```ts
import { useBMapContext } from 'baidu-map-gl-vue'

const ctx = useBMapContext() // 须在 <BMap> 子树内调用
ctx.events.on('resource:error', (e) => {
  console.error(e.error.code, e.error.toJSON())
})
```

> v2 迁移:错误处理从 `initd` 回调切换到统一错误事件/`BMapError`,见[迁移指南](./migration-from-v2.md)。
