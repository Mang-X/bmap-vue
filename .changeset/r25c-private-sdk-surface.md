---
"baidu-map-gl-vue": patch
---

删除 SDK 私有面嗅探（`_rd`），修复 `<BInfoWindow>` 在 JSAPI 4.0 上的打开与内容可见性，并补齐 `BAutoComplete` 的清理路径。

**服务失败的表现变了**（`baidu-map-gl-vue` 的 `BMapError` 契约不受影响，但服务调用结果与 composable 的返回会变）：

- 地理编码 / 逆地理编码 / 行政区边界 / IP 定位在**服务端失败**（配额用尽、Referer 白名单等等）时，不再被还原成服务端错误码。官方没有公开的错误码入口，本库也不去嗅探它的私有回调表，因此这类失败与「查无结果」一样表现为 `empty`（`data` 为 `null`）。
- `useBMapGeocoder` / `useBMapGeocodeDetail` 因此不再因配额 / Referer 失败而 reject，改为解析出 `null`（`isEmpty` 为 `true`）；**超时仍会报 `BMAP_SERVICE_FAILED`**（`... timed out after 15000ms`）。
- `failed` 只剩「能给出公开原因」的情形：定位的 `BMAP_STATUS_*`、坐标转换回包的 `status`、以及调用方参数错误。

其余：

- `<BInfoWindow>` 改走地图级专用入口（`openInfoWindow` / `closeInfoWindow`），在 JSAPI 4.0 上不再因「气泡被当成普通覆盖物」而报错；内容容器的可见性由打开状态驱动（此前模板上的静态 `display:none` 会让打开后的内容也看不见）。
- **打开气泡必须给出 `position`**：官方 4.0 的 `Map#openInfoWindow(infoWnd, point)` 里 `point` 是必需参数，`InfoWindow` 实例也没有公开的 `openInfoWindow()`。`open` 为 `true` 而没有 `position` 时不再「碰巧打开」（原先会回退到实例级成员；legacy 也有一条同类回退），而是把 `BMAP_INVALID_ARGUMENT` 交到内部诊断总线（`resource:error`）并且不打开。气泡挂到 Marker 的「目标级打开」属后续里程碑。
- `<BAutoComplete>` 卸载时释放 Driver 侧资源（输入框上的输入活动监听、在飞请求、SDK `dispose()`）；**释放之后到达的检索回包不再转给 `searchComplete`**（含 SDK 在 `dispose()` 内同步回调的重入路径）。
- `<BAutoComplete>` 的 `location` / `types` 更新改经新增的 `ServiceDriver.setAutocompleteOptions()`，组件不再直接访问 `inst.raw`；**两者变回 `undefined` 表示恢复默认**（`location` → 当前 `<BMap>`，`types` → 官方默认 `[]`）。
- Capability Catalog 把 `service.autocomplete` 标为 `experimental`：程序化检索（`suggest()`）的请求归属依赖官方未承诺的 `keyword` 假设。
