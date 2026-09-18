# v2 → v3 迁移指南

> 面向从 `baidu-map-gl-vue@2.x` 升级到 `3.0.0` 的使用者。
> 目标版本 `3.0.0-beta`(next) → `3.0.0`(stable)。
>
> SDK 世代的差异（v2 的 `BMapGL` → 3.0 的 `BMap`）单独成页：
> [WebGL v1 → JSAPI 4.0 迁移指南](./migration-v1-to-v4)。本页讲**组件 API**层面的迁移。

v3 的核心变化是**运行时架构**,不是组件 API 的推倒重来。绝大多数 v2 组件用法保持不变;
变化集中在「如何加载 SDK」「如何表达父子依赖」「如何承载大数据」。

---

## 1. 快速开始

### v2
```ts
import Vue3BaiduMapGl from 'baidu-map-gl-vue'
app.use(Vue3BaiduMapGl, { ak: 'YOUR_AK' })
```

### v3
```ts
import { createBMapPlugin } from 'baidu-map-gl-vue'
// ak 给 createBMapPlugin（或 definition.loadOptions）
app.use(createBMapPlugin({
  ak: import.meta.env.VITE_BAIDU_MAP_AK,
}))
```

> 不兼容：v2 的默认导出 `app.use(Vue3BaiduMapGl, { ak })` 在 v3 已移除，
> 请改用具名 `createBMapPlugin`。
>
> `version` 现在**只接受 `'4.0'`**（默认就是它）：默认路径由官方 `@baidumap/jsapi-loader` 加载
> JSAPI 4.0，传别的版本会在加载前抛 `BMAP_INVALID_ARGUMENT`。v2/v3-beta 里写的 `version: '1.0'`
> 必须删掉。见 [Breaking Changes](./breaking-changes)。

---

## 2. v2 → v3 API 对照

| v2 API | v3 处理 | 迁移动作 |
|---|---|---|
| `app.use(Vue3BaiduMapGl, { ak })`（默认导出） | 已移除，改用具名 `createBMapPlugin({ ak })` | 必须迁移 |
| 按需导入组件(`BMap` 等) | 保留组件名与根 named exports | 无需改动 |
| `@initd` | 保留并 **deprecate**,新增 `@ready` | 建议改为 `@ready` |
| `getMapInstance()` | 保留,返回 `MapHandle`（不再是 raw SDK 地图；raw 地图经 `./advanced` 的 `unwrapRaw` 获取）,新增 `whenReady()` | 涉及 raw 地图访问时迁移 |
| `apiUrl`(离线) | 默认路径已不接受（会报 `BMAP_INVALID_ARGUMENT`）；legacy 参数已随旧引擎删除 | 改用 `customScriptV4Provider(scriptSrc)` / `existingGlobalV4Provider()` |
| `plugins: string[]` | 保留适配；`ready` 不等待插件，使用 `plugin-ready` / `plugin-error` 监听插件状态 | 检查插件依赖时序 |
| `@pluginReady(map)`（旧驼峰事件，载荷为地图实例） | 已移除，统一为 `@plugin-ready`（载荷为插件名）；地图实例改用 `ready` 载荷、`whenReady()` 或组件 `ref.getMapInstance()` 获取 | 涉及插件回调取地图时迁移 |
| `v-model:show`(InfoWindow) | 保留 | 无需改动 |
| `modelValue`(InfoWindow) | beta 期保留 + warning | 改为 `open`/`v-model:open` |
| `usePubSub` | 已移除 | 改用 context/whenReady（`useBMap()` + `whenReady()`） |
| `getScriptAsync` | 已移除，改走 Provider/loader | 默认路径不用管（官方 Loader 自动加载）；显式场景用 `./core` 的 `baiduJsapiV4Provider` / `customScriptV4Provider` / `existingGlobalV4Provider` |
| 任意 `package/*` 深路径 | 不再保证;提供明确 exports | 改用子路径 |

---

## 3. 组件迁移

### 3.1 BMap

```vue
<!-- v2 -->
<BMap ak="xxx" :center="center" :zoom="14" @initd="onInit">
  ...
</BMap>

<!-- v3(等价,initd→ready；provider 只决定加载器，ak 走全局插件或 ak prop) -->
<BMap ak="xxx" :center="center" :zoom="14" @ready="onReady">
  ...
</BMap>
```

- `ready` 事件带 `{ client, map, container }`：`map` 为 `MapHandle`，`client` 提供 `driver` 领域接口；raw SDK 只经 `baidu-map-gl-vue/advanced` 的 `unwrapRaw()` 获取。
- `initd` 仍发出,内容与 `ready` 相同,标记 deprecated。
- 地图 `ready` 不表示 optional plugin 已完成；依赖插件的代码应监听 `plugin-ready`。
- `resetCenter()` **已移除**（它是「名字说重置中心、实现重置整个视野」的废弃别名），改用
  `resetView()` 恢复初始视角。
- `<BMap ref>` 拿到的是定型后的命令面 `BMapExpose`：常用 get / set / pan / fit、
  `checkResize()`、`supports(capability)` 与方法表里的容器 / 生命周期 / 暂停入口。
  未就绪时读命令给 `null`、写命令是空操作（不排队）。
- **容器拿到非零尺寸之前不建图**：Tab / Drawer / 折叠面板展开前 `status` 停在 `idle`，
  用 expose 的 `isContainerReady()` 或 `#loading` 插槽的 `containerReady` 与「SDK 在加载」区分。
  容器尺寸变化默认会自动重设（`enableAutoResize`，默认 `true`），传 `false` 回到手动调 `checkResize()`。
- `suspend()` / `resume()` 按**原因**记账：`resume(reason)` 只摘掉一个原因，页面恢复可见
  （`document`）不会顺手解除用户的手动暂停（`user`）；全部原因清空才恢复并补偿一次 `checkResize()`。

### 3.2 BMarker

```vue
<!-- v2 与 v3 用法一致 -->
<BMarker :position="{ lng: 116.4, lat: 39.9 }" @click="onClick" />
```

v3 修复:
- position 变为**字段级更新**(lng/lat 分开,不再 deep watch)。
- `visible` 切换幂等。
- 0 坐标有效(不再用 truthy 判断)。
- 初始 `visible`、`icon`、`rotation`、`zIndex` 和拖拽状态会在 Marker 创建时直接应用。

> 大量点请勿堆叠独立 BMarker,改用 `BMarkerCluster` / `BMarkerList`。`BPointLayer` 仍可用，但只是 `BMarkerList` 的 deprecated alias。

### 3.3 BInfoWindow

```vue
<!-- 推荐 -->
<BInfoWindow v-model:open="open" :position="pos" title="北京">
  内容
</BInfoWindow>
```

v3 修复:
- 开放状态用明确状态机,prop 与 SDK 事件不再相互拉扯。
- `modelValue` 保留一个 beta 周期并给出 warning。
- slot 内容变化会触发受控 redraw，观察器会在组件卸载时断开。

---

## 4. 大数据(千级点)

v3 引入三档渲染模型:

| 场景 | 组件 | 说明 |
|---|---|---|
| 少量、逐点交互 | `BMarker` | 一 V 一组件 |
| 中等规模、需聚合 | `BMarkerCluster` | 数据组件 + 内置网格聚合 |
| 中小规模列表 | `BMarkerList` | 每个 item 一个 SDK Marker，由一个组件统一 diff 和清理 |
| 千级以上 | `BPointCollection`（待实现） | 单个批量 SDK 资源；当前不要将 `BMarkerList` 误认为批量 SDK 层 |

```vue
<BMarkerCluster :data="stations" item-key="id"
  :get-position="s => ({ lng: s.lng, lat: s.lat })"
  :min-cluster-size="3" />
```

> 这解决 v2 issue #131「上千 Marker 卡顿」。

---

## 5. 弃用(deprecation)

每条弃用都有稳定 code,文档列出替代 API,同实例只警告一次,production 默认不输出。
映射表本身是单一事实源(`packages/baidu-map-gl-vue/src/core/deprecations/aliases.ts`),
下面的表格从它派生。

| code | 旧名 | 替代 | 组件 | 说明 |
| --- | --- | --- | --- | --- |
| `BMAP_DEPRECATED_PROP_ALIAS` | `startPoint` + `endPoint` | `bounds` | `BGroundOverlay` | 一个 `bounds`(`{ southwest, northeast }`)取代两个角点。正典有值时旧名**完全不参与**(连提示都不发) |
| `BMAP_DEPRECATED_EVENT_ALIAS` | `@drag-end` | `@dragend` | `BMarker` | 两个名字都会发(同载荷),提示同实例一次 |

> 别名只在**真的被用到**时提示:prop 别名在读到旧值时提示,事件别名在第一次派发时提示——
> 组件里绑了却从不触发的旧名字不会打扰使用者。


示例(控制台):
```
[baidu-map-gl-vue] `initd` is deprecated; use `ready`.
```

---

## 6. 在线迁移清单(简版)

1. 升级依赖到 `3.0.0-beta.x`。
2. 将 `app.use(...)` 换为 `createBMapPlugin(...)`(或保留旧调用)。
3. 替换 `@initd` → `@ready`(可选)。
4. 检查 BMarker:大列表迁移到 `BMarkerCluster` / `BMarkerList`。
5. 检查 BInfoWindow:用 `v-model:open` 替代 `modelValue`。
6. 移除对 `package/*` 深路径的依赖,改用子路径(`/components`、`/composables`、`/plugins`)。
7. 删除 `version: '1.0'` 之类的旧版本号（只接受 `'4.0'`），并确认没有在用 `apiUrl` 换入口
   （两项都会在加载前显式报错,见 [Breaking Changes](./breaking-changes)）。

---

## 7. 常见问题

**Q: SDK 加载失败后如何重试?**
v3 的 SdkRegistry 会在失败后移除缓存,允许下次重试。

**Q: 多个 BMap 会互相干扰吗?**
不会。每个 BMap 创建独立 MapRuntime,含独立 event bus / overlay registry。

**Q: `BPointLayer` 是真正的批量 SDK 点层吗?**
不是。当前 `BPointLayer` 是 deprecated alias，实际每个 item 仍创建一个 SDK Marker；新代码使用 `BMarkerList`。真正的单资源批量层 `BPointCollection` 尚未实现。

**Q: `useBMapAsyncTask` 去哪了?**
它已在 v3 的服务重构里**删除**（同一件事有两套实现：一套是 Driver 的归一化调用面，一套是
composable 自己拼的 Promise + 定时器）。现在服务状态统一由各 service hooks 直接给出：

```ts
// v3-beta 早期（已删除）
const task = useBMapAsyncTask({ immediate: false, runner: async ({ signal }, q) => { … } })

// 现在：服务 hooks 自带统一状态与「最新者胜」
const { data, status, error, isLoading, supported, cancel } = useBMapGeocoder()
const result = await get('北京市', '北京市') // 恒 resolve 成 ServiceResult
```

- 超时 / 空结果 / 迟到回调 / 先到者胜全部由 Driver 的归一化调用面负责（`SERVICE_CALL_TIMEOUT_MS`），
  细节见 [`useBMapGeocoder`](../hooks/useBMapGeocoder) 等 hooks 与
  [ADR 2026-09-14](../../adr/2026-09-14-service-lifecycle-and-local-search.md)；
- 需要自己发请求（非百度服务）时用 `fetch` + `AbortController` 即可——本库不再提供通用异步任务框架。
