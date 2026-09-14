---
title: 配置
lang: zh-CN
---

# 配置

本章节将为你讲述如何配置 ak、apiUrl 与插件。v3 通过 Client 定义表达 SDK 加载，
只有 `app.use()`（默认定义）、`<BMapProvider>`（子树覆盖）与 `<BMap>` 自身 props 三处入口。

## Client 查找顺序

`<BMap>` 按以下顺序解析 SDK Client，命中即停：

1. 显式 `client` prop（已创建好的 `BMapClient`）
2. 显式 `definition` prop（`createBMapClientDefinition({ provider, loadOptions })`）
3. 显式 `provider/ak/apiUrl` props（就地组装定义）
4. 最近的 `<BMapProvider>` 提供的 Client 上下文
5. `app.use(createBMapPlugin(...))` 提供的默认定义
6. 否则报错（默认**不读取任何全局**；宿主自己加载了 SDK 的场景请显式传 `provider: existingGlobalV4Provider()`）

服务类 hooks（如 `useBMapGeocoder`）只需要 Client，可在 `<BMap>` 或 `<BMapProvider>` 子树内直接使用，无需地图实例。

## 配置方式

目前支持三种方式：全局 `app.use` 默认定义、`<BMapProvider>` 子树覆盖、组件 props 传入。
当同时指定时，按上面的查找顺序，就近优先。

### Driver 选择与默认加载器

3.0 只有**一个引擎**（`jsapi-v4`）：组件默认路径（`app.use` / `<BMapProvider>` / `<BMap>`）
直接交给 `createBMapClient`，由默认的 `jsapiV4DriverFactory` 装出 v4 Driver。默认 Provider 是
`baiduJsapiV4Provider()`——`createBMapPlugin()` 不传 `provider`、`<BMap>` 只给 `ak`、以及
`<BMapProvider>` 未覆盖时，用的都是它；它内部真的调用官方 `@baidumap/jsapi-loader`
（精确锁定 `1.0.0`）。决策与回滚见
[ADR 2026-09-13 默认在线路径委托官方 Loader](/adr/2026-09-13-default-online-loader-cutover)；
旧引擎（`webgl-v1` / `BMapGL`）与迁移期的 engine 分派已在 `#26` 删除，见
[ADR 2026-09-14 删除旧引擎](/adr/2026-09-14-remove-legacy-engine) 与
[从 WebGL v1 迁移到 4.0](./migration-v1-to-v4)。

::: warning 默认路径的配置面
默认路径只表达官方 Loader 支持的配置：`ak`、`version`（只接受 `'4.0'`）、`timeout`（`0` = 不超时）、
`serviceHost`（代理模式，与 `ak` 二选一；用它隐藏 `ak` 时需另给 `window.BMAP_AUTHENTIC_KEY` 供 UI Kit 使用）。

`nonce` / `integrity` / `crossOrigin` / `referrerPolicy` / `apiUrl` / `language` 在上游**没有入口**，
传了会在加载前显式报 `BMAP_INVALID_ARGUMENT`（不再静默忽略）。替代路径：

- 自托管 / 非标准资源入口 → `customScriptV4Provider(scriptSrc)`；
- 宿主自己加载 SDK / 需要 `nonce` / SRI → 外部预加载后 `existingGlobalV4Provider()`。
:::

`./advanced` 的 `createBMapClient()` 与组件默认路径同一条收口：**只接受 `jsapi-v4` 的加载结果**，
`provider` 必须是结构化的 `BMapProviderLike`——`load()` 返回 `LoadedSdk`，也就是
`LoadedJsapiV4`（`engine` + `version` + `namespace` + **必填的 `load` metadata**）。

**绝大多数场景不需要自己写 Provider**：`baiduJsapiV4Provider()`（默认）/ `customScriptV4Provider(scriptSrc)`
（自托管入口）/ `existingGlobalV4Provider()`（宿主已加载 SDK）已经覆盖，它们内部就是下面这段。
只有自研加载器才需要手工构造结构化结果——用公开的 `createLoadedJsapiV4()`，**不要手写
`{ engine, version, namespace }` 字面量**（`load` metadata 是必填的，手写会少字段，也会丢掉
AK / userinfo 脱敏）：

```ts
import type { BMapProviderLike } from 'baidu-map-gl-vue'
import { createLoadedJsapiV4 } from 'baidu-map-gl-vue/core'

const provider: BMapProviderLike = {
  id: 'my-loader',
  getCacheKey: () => 'my-loader',
  load: async () =>
    createLoadedJsapiV4({
      providerId: 'custom-script-v4',
      mode: 'load',
      version: '4.0',
      versionSource: 'declared',
      options: { ak: 'YOUR_AK' },
      fingerprint: 'my-loader',
      // 你的加载器把命名空间放在哪就读哪；这里用「字符串键」写法，
      // 因此**不依赖**官方类型包对全局 `BMap` 的声明
      namespace: (globalThis as { BMap?: unknown }).BMap,
    }),
}
```

`LoadedSdk` 现在就是 `LoadedJsapiV4` 的别名（旧引擎的 `LoadedLegacySdk` 已删除），
`assertLoadedSdk()` 是唯一收口点：缺 `engine`（裸全局对象）或 `engine !== "jsapi-v4"`
（旧引擎结果）都会以 `BMAP_SDK_ENGINE_MISMATCH` 失败，报错文案会指出原因。

`./core` 的 `createClientContext()` 走同一条路：**同一份 definition 在任何入口
（`<BMap>` / `<BMapProvider>` / 插件默认 definition / `resolveMapContext`）行为一致**；需要固定
Driver 实现时显式传 `definition.driver`。迁移期的 `withMigrationDriver` 归一已随旧引擎删除
（`#26`），definition 现在原样交给 Client。

### 1。通过全局注册配置 ak 与插件

全局注册 Options（`createBMapPlugin`）：

| 属性               | 说明                                             | 类型               | 默认值 |
| ------------------ | ------------------------------------------------ | ------------------ | ------ |
| ak                 | 百度地图 [ak](../guide/quick-start#申请-ak-密钥) | `string`           | -      |
| apiUrl             | 自建地图 api 资源地址（默认路径已不表达，见上方提示；请改用 `customScriptV4Provider`） | `string` | - |
| version            | SDK 版本                                         | `string`           | `4.0`  |
| provider           | 自定义加载器（默认 `baiduJsapiV4Provider()`，内部委托官方 Loader；类型 `BMapProviderLike`） | `BMapProviderLike` | - |
| plugins            | 需要注册的插件                                   | `string[]`         | -      |
| defaults           | 透传的加载选项（`BMapLoadOptions`，如 `timeout` / `serviceHost`） | `BMapLoadOptions` | - |
| client             | 完整自定义 Client 定义（覆盖以上组装）           | `CreateBMapClientOptions` | - |

```ts
import { createApp } from 'vue'
import App from './App.vue'
import { createBMapPlugin } from 'baidu-map-gl-vue'

const app = createApp(App)
app.use(createBMapPlugin({ ak: '百度地图ak' }))
app.mount('#app')
```

`plugins` 是可选的，且**内置插件一律 optional**：插件脚本加载失败只发 `plugin-error`，
不会让地图失败。要真的用某个插件，先确认它在 JSAPI 4.0 上的状态，见
[插件兼容 inventory](../contributing/plugin-compat-inventory)。

### 2。用 `<BMapProvider>` 覆盖子树默认

```vue
<template>
  <BMapProvider @ready="onReady" @error="onError">
    <template #loading>SDK 加载中…</template>
    <template #error="{ error, retry }">
      <button @click="retry">加载失败：{{ error.message }}，点击重试</button>
    </template>
    <RouterView />
  </BMapProvider>
</template>

<script setup lang="ts">
import { BMapProvider } from 'baidu-map-gl-vue'

function onReady() {}
function onError() {}
</script>
```

不传 `definition` / `provider` 时，Provider 复用 `app.use(createBMapPlugin(...))` 的默认定义，
也就是 `baiduJsapiV4Provider()`（官方 Loader）。只有子树需要用**别的入口**时才显式传：

```ts
import { customScriptV4Provider, existingGlobalV4Provider } from 'baidu-map-gl-vue/core'

// 自托管 / 非标准资源入口
const selfHosted = { provider: customScriptV4Provider('https://self.hosted/bmap.js') }
// 宿主页面自己加载好了 SDK，本库只消费全局
const hostLoaded = { provider: existingGlobalV4Provider() }
```

### 3。组件 `BMap` 传入 [`props`](/zh-CN/components/map#%E9%9D%99%E6%80%81%E7%BB%84%E4%BB%B6-props) 配置

<!-- prettier-ignore -->
```html
<BMap
  ak='百度地图ak'
/>
```

## 扩展插件 plugins

配置插件后，地图实例 ready 不会等待插件加载。请通过 [BMap 组件的 `plugin-ready` 事件](../components/map#v3-行为说明) 获取单个已加载插件的名称（载荷即插件名字符串）；插件加载失败通过 `plugin-error` 处理。v2 的 `pluginReady` 事件在 v3 已移除，请改用 kebab 写法 `@plugin-ready`。

**只有下表 `plugins` 列标 ✅ 的名字是内置的**，其余字符串会被当成未知插件、静默变成空实现
（不报错，也不会加载任何脚本）。每个内置插件的 JSAPI 4.0 状态与依据见
[插件兼容 inventory](../contributing/plugin-compat-inventory)。

| PluginId                                                                                 | 插件名称         | 描述                                                                               | `plugins` 内置 | JSAPI 4.0 状态                     |
| ---------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- | -------------- | ---------------------------------- |
| [TrackAnimation](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#视角轨迹动画) | 视角轨迹动画     | TrackAnimation 类提供视角轨迹动画展示效果。                                        | ✅             | 声明面无缺口；最小运行时路径已验证，完整链路未验证 |
| [Mapvgl](https://mapv.baidu.com/gl/docs/index.html)                                     | MapVGL 可视化    | 基于 WebGL 的点、线、面和热力图图层。                                              | ✅             | 不兼容（依赖 `_rd` 私有回调表）     |
| [DrawingManager](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file)              | 鼠标绘制工具条库 | 提供鼠标绘制点、线、面、多边形（矩形、圆）的编辑工具条的开源代码库。                | ✅             | 声明面无缺口；**最小运行时路径已验证**（构造 + 取绘制模式），完整绘制交互未验证；会自行注入两个脚本 |
| [GeoUtils](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#几何运算)           | 几何运算         | 提供若干几何算法                                                                   | ✅             | 声明面无缺口；**最小运行时路径已验证**（10 个静态成员 + `getDistance` 数值正确），各谓词签名语义未完整核对 |
| [DistanceTool](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#测距工具)       | 测距工具         | 测距工具类                                                                         | —              | 未内置，未评估                     |
| [AreaRestriction](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#区域限制)    | 区域限制         | 浏览区域限制类                                                                     | —              | 未内置，未评估                     |
| [InfoBox](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#自定义信息窗口)      | 自定义信息窗口   | 类似于 infoWindow，比 infoWindow 更有灵活性，比如可以定制 border，关闭按钮样式等。 | —              | 未内置，未评估                     |
| [RichMarker](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#富标注)           | 富标注           | 富 Marker 类                                                                       | —              | 未内置，未评估                     |
| [LuShu](https://github.com/huiyan-fe/BMapGLLib?tab=readme-ov-file#路书)                  | 路书             | 路书类，实现 Marker 沿路线运动                                                     | —              | 未内置，未评估                     |

### 更换插件资源链接

如果需要自建或其他地址的资源链接，请使用 `customScriptV4Provider(scriptSrc)` 构造 Provider，
再经 `createBMapPlugin({ provider })` 或 Client 定义传入：

```ts
import { createBMapPlugin } from 'baidu-map-gl-vue'
// v4 Provider 家族在 `baidu-map-gl-vue/core` 子入口公开
import { customScriptV4Provider } from 'baidu-map-gl-vue/core'

app.use(createBMapPlugin({
  provider: customScriptV4Provider('https://self.hosted/bmap.js'),
  defaults: { ak: '百度地图ak' }
}))
```

组件级的「换入口」不是传 `apiUrl`——默认路径下 `apiUrl` 会在加载前显式报
`BMAP_INVALID_ARGUMENT`（上游 Loader 没有这个入口）。要按组件覆盖，传 `provider`：

<!-- prettier-ignore -->
```html
<BMap :provider="selfHostedProvider" />
```

### 自定义插件定义

除了内置插件（`TrackAnimation` / `Mapvgl` / `DrawingManager` / `GeoUtils`，经 `plugins: ['xxx']` 声明，
均为 optional），
你还可以通过插件定义扩展。插件定义 shape 见 `BMapPluginDefinition`（`name/scope/dependencies/required/load/setup/dispose`），
用 `urlPluginDefinition` 或 `stringToPluginDefinitions` 构造，并在需要地图的组件内经 PluginRegistry 注册。
插件加载结果通过 `plugin-ready` / `plugin-error` 事件回执。

M8-PLUGIN-CORE（[#42](https://github.com/Mang-X/bmap-vue/issues/42)，决策见
[ADR 2026-09-14 插件 Catalog 与作用域](/adr/2026-09-14-plugin-catalog-scope-scheduling)）之后：

- **`scope` 决定资源归谁**：`'global'`（文档级脚本，跨地图共享、由进程级宿主持有，地图卸载**不**释放）
  或 `'map'`（随地图释放）。**手写 definition 不写 `scope` 就是 `'map'`** —— 自定义插件不会因为没写
  scope 就变成全局共享。内置四个插件都是 `'global'`。
  注意 `urlPluginDefinition(...)` 这个**脚本插件工厂**的缺省是 `'global'`（它加载的就是文档级脚本），
  需要按地图隔离时显式传 `{ scope: 'map' }`；两个缺省不一样是有意的，别当成一个。
  要清掉宿主缓存的全局状态（测试 / 热更新）用 `baidu-map-gl-vue/plugins` 的
  `disposeDefaultPluginHost()`。**它不是「回到没加载过」**：第三方脚本与 `window.BMapGLLib.*` 都留在
  原地，内置脚本插件下一次会命中「导出已存在」的短路、复用同一个全局对象（不重新拉脚本）。
- **未知名字明确失败**：`resolvePluginDefinition` / `stringToPluginDefinitions` 抛
  `BMAP_PLUGIN_UNKNOWN`（不再降级成永远成功的空实现）。`<BMap :plugins="[...]">` 在组件层逐个名字捕获，
  未知名字回执 `plugin-error`，**不阻断地图**；它不会在注册表留下记录，所以 `getStatus(name)` 是
  `undefined` 而不是 `'error'`。
- **取消只影响自己**：`whenPlugin(name, signal)` 的 signal abort 只会让本次等待以
  `BMAP_PROVIDER_ABORTED` 结束，共享的加载继续跑、结果留给后来的消费者。
- **状态可读**：`PluginRegistry.inspect(name)` 返回 `{ scope, required, status, attempts, consumers, error }`，
  比瞬时事件更适合做诊断（「试过几次」「还有几个消费者在等」）。
- **失败可重试**：失败会被登记成 `error` 并清掉缓存条目，再请求一次就真的重新加载；
  成功后 `getError()` 会被清空。

### dispose 之后晚到的结算不会复活记录

`PluginRegistry.dispose()` 会把记录收口成 `disposed`，并**丢弃此后才到达的加载结果**：晚到的成功不会
把状态改回 `ready`、也不再广播 `plugin:ready` / `plugin:error`（一次地图卸载之后才下载完的插件不该让
记录「复活」）。对 `map` 作用域的插件，那条晚到的实例此刻已经没有别的所有者，注册表会**就地调用
`definition.dispose`** 释放它；`global` 作用域的实例归宿主管，注册表不动它。

`setup` 也遵循同一条时间线：它只在「这次加载还算不算数」校验**通过之后**才执行，所以地图销毁后再下载完
的插件**不会**再产生一次 `setup` 副作用；反过来，`setup` 抛错时已经创建出来的实例会被释放掉（不会
出现「实例创建了、却因为 `setup` 失败而没人释放」）。`setup` 只由资源的**所有者**执行一次：`'map'`
插件的归注册表（disposer 进地图 scope），`'global'` 插件的归宿主（disposer 进宿主的纪元 scope）。

宿主侧同理：`PluginHost` 用**纪元号**区分「上一轮 dispose 之前的在飞任务」，旧纪元的结算不会写进新纪元
的条目、也不会按名字误删同名的新条目。旧纪元那条迟到的成功会先**挂起**，等这个名字下一次有确定结论
（新纪元条目 ready / 宿主 dispose）再按 identity 判定是否释放 —— 因为新纪元可能还在飞、并且可能拿到
**同一个**实例（自定义 definition 复用单例是允许的），当场按 `null` 比较会把它提前拆掉。
