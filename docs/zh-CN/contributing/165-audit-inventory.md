# #165 公共 API 对齐审计 — 成员级清单（实施基线 0f053d8）

> 范围声明：本文只覆盖**工作包 E（全部 Composable / 服务层）**与它触及的公共类型。
> Provider/Map（B）、覆盖物/控件/全景组件（C）、图层/数据组件（D）、UI Kit/插件/Resolver（F）
> **尚未审计**——不得据此认为 #165 已完成。

依据：官方 `@baidumap/jsapi-v4-types@4.0.5` 声明（git `5ba67f4dda11b0a4b54fc631278d3e39e11667c3`；
**4.0.5 至今未发布到 npm**，依赖钉的是这个 commit）+ `@baidumap/react-bmap@2.0.6`
（命名与使用心智参考）。**两者冲突时以 v4 声明为准。**

## 4.0.5 相对 4.0.4 的变化（2026-09-24，commit `5ba67f4`）

| 变化 | 对本票的影响 |
| --- | --- |
| 新增 `visualization/` 命名空间，**13 个类**（`PointLayer` / `PolylineLayer` / `PolygonLayer` / `TextLayer` / `BarLayer` / `Heatmap` / `FlyLineLayer` / `ClusterLayer` / `TrackLine` / `WebGLCustomLayer` / `ThreejsLayer` / `DeckglLayer` / `GeoJSONSource`），并被 `Map#addLayer` / `removeLayer` 接受 | **不在本票**——这是新增产品功能（#165 §2.3「新增产品功能」须单独明确纳入或延期），已另开子票 |
| `FillLayer` / `LineLayer` / `PointIconLayer` / `PointShapeLayer` 全部标记 `@deprecated`，建议改用 `visualization/` 的 `PolygonLayer` / `PolylineLayer` / `PointLayer` | **本票范围内**：本库已封装的 4 个图层，其官方对应项**已被官方弃用**。现有封装保留（不制造破坏），但要在文档与对齐表里登记 |
| `PointLayer` / `ClusterLayer` / `Heatmap` / `TrackLine` 补上了**类声明**（4.0.4 没有） | 本库这 4 个 kind 的 `declared` 由 `false` 升 `true`；⚠️ 见下方「三类判断必须分开」 |
| 路线服务 `setPolylineStyle` 的参数类型由**从未声明**的 `RoutePolylineStyle` 改为 `PolylineOptions` | 原「上游缺陷、不猜」的裁决**可以撤掉**：类型现在真实存在 |
| `index.d.ts` 的 `core/displayOptions.d.ts` 引用大小写已修正 | 上游自己修好了 ⇒ `patches/@baidumap__jsapi-v4-types@4.0.4.patch` 及其 deletionCondition 达成，**补丁删除**；大小写回归改由 `upstream-types-reference-case.test.ts` 守着 |

### ⚠️ 「类是否声明」与「是不是运行时注入」是两个维度

4.0.5 之后 `PointLayer` 等既有类声明、**又是**运行时异步注入的成员。把它当成两回事会让两处
真实行为退化：样式更新打到上游没承诺的 `setStyleOptions`、拾取开关打到 `setBaseOptions`、
以及「运行时未注入」被误报成普通成员缺失（`BMAP_SDK_CALL_FAILED` 而非
`BMAP_CAPABILITY_UNSUPPORTED`）。因此 Driver 里的 `declared`、`styleMember` 与
`RUNTIME_INJECTED_LAYER_CTORS` 三者**各判各的**，不再由一个 `declared` 一把带过。


## 已确认的 DEFECT（类型/行为与官方不符，优先于「缺口」处理）

| # | 位置 | 问题 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| D1 | `LocalSearchRenderOptions.viewportOptions` / `RouteRenderOptions.viewportOptions` | 声明并**原样转发**官方不存在的 `noAnimation`；官方真实的 `enableAnimation` / `callback` 被丢弃 | `core/ViewportOptions.d.ts` 恰好四成员：`enableAnimation` / `margins` / `zoomFactor` / `callback` | **已修** |
| D2 | `driver/jsapi-v4/services.ts` geolocation 投影 | `address: result.address ?? null` **原样透传**，但官方 `GeolocationAddress` 是 `city_code` / `street_number`，本库类型承诺 `cityCode` / `streetNumber` ⇒ **类型在运行时说谎** | `service/GeolocationResult.d.ts`；`services.ts:2043` | **已修** |
| D3 | `useGeolocation.ts` `timestamp` | 官方回包字段（设备定位时刻）被**伪造成 `Date.now()`**，注释却声称「Driver 只投影 SDK 载荷」 | `GeolocationResult.timestamp?: number` | **已修** |
| D4 | `useGeocoder` 返回面 | `data`/`location`/`point`/`result` 四个名字指向**同一个 ref**；其中 `location` 与官方语义相反（官方 `getLocation` 返回**地址**，`getPoint` 返回坐标） | 官方 `Geocoder.getPoint`/`getLocation` | **已修** |
| D5 | `useGeolocation` 返回面 | 同样的别名堆叠（`data`+`location`、`locate`+`get`）；`get` 与官方 `getCurrentPosition` 同义 | — | **已修** |
| D6 | `useGeolocation` 构造选项 | 构造期把 `enableSDKLocation` 传给 SDK，而官方 `PositionOptions` 的键名是 **`SDKLocation`** ⇒ 该选项**被 SDK 静默丢弃**（逐次调用那侧键名是对的，两条路径不一致） | `service/PositionOptions.d.ts` | **已修** |

## 已确认的 MISSING（官方公开成员，本库无路径）

| 服务 | 官方成员 | 备注 |
| --- | --- | --- |
| LocalSearch | `clearSelected` / `setLocation` / `setPageCapacity` / `getPageCapacity` / `setPageNum` / `getPageNum` / `enable|disableAutoViewport` / `enable|disableFirstResultSelection` | 视野/选中/分页四组开关目前**只能**在构造期给 |
| 路线 ×4 | `setPolicy` / `setLocation` / `setPolylineStyle` / `enable|disableAutoViewport` | 现状是「配置变化 ⇒ 丢弃实例」，与官方「活实例上原地改」不同 |
| Geolocation | `enableSDKLocation` / `disableSDKLocation` | 需 Driver mutator 才可达 |
| Boundary | `parsebdStr` | **Driver 内部已在做解码**（`parseBoundaryRing`），只是没暴露官方入口 |
| LocalCity | `opts.renderOptions` | `createLocalCity()` 不收参数 ⇒ `result.level` 结构上恒是「无 map」那一种 |
| Geocoder | `ctor({language})` | Driver 与 composable 都无路径 |
| GeocodeDetail | `poiRadius` / `numPois` | Driver 支持，**composable 丢弃** |
| Panorama | `links`（8 成员） | `toDataInfo` 丢弃；但 `Panorama.vue` 已发 `linksChange` 事件却**无载荷** ⇒ 「无消费者」的理由不成立 |

## SOURCE-CONFLICT（两处官方来源不一致，裁决记录）

| 成员 | React 参考 | v4 声明 | 裁决 |
| --- | --- | --- | --- |
| `LocalSearch#onPolylinesSet` | 有（且代码里用 `typeof === 'function'` 自我设防） | **无**（`grep -c olyline LocalSearch.d.ts` = 0；该成员只存在于路线/公交类） | **不实现**。Official-first：上游没有的能力不补齐；作者自身的防御式判断说明他并未核实 |
| `LocalSearch#select(index)` | 有（`raw.select?.(i)`） | **无**（只有 `clearSelected`） | **不实现**。且它违反本库自己的归属规则：索引指向「SDK 当前持有的那份结果集」，在实例被取代后语义漂移 |

## 明确的 NOT-APPLICABLE（有依据地不提供）

- LocalSearch / 路线的 `onMarkersSet` / `onInfoHtmlSet` / `onResultsHtmlSet`：交出 raw `poi.marker` 或 SDK 私有 DOM，越 raw-SDK 边界；逃生口是 `./advanced` 的 `unwrapRaw`。
- `setSearchCompleteCallback` 逐次重挂：#72 实测无法证明逐请求归属 ⇒ 不建推断层。
- `Route#getPolyline()` / `Line#getPolyline()`：折线是渲染资源，由 `clearResults()` 收；交出去会产生第二个所有者。
- `setPolylineStyle`：上游声明与类文档自相矛盾（扁平 `PolylineOptions` vs `highlight`/`transit`/`walking`/`decorate`），不猜公开形态。
- `BMap.Boundary` 官方已标 `@deprecated 4.0 请用 DistrictLayer`：保留 hook，但在对齐文档里登记。

## 剩余未实施（已核实，待维护者裁决是否另开子票）

上表「MISSING」条目**本轮未实施**。它们多数需要先在 `ServiceInvocationDriver` 上开 mutator
（路线 9 个 + Geolocation 2 个），并决定「活实例原地改 vs 丢弃实例重建」这一 ADR 级取舍——
这超出单票范围，按 #165 §7「延期由维护者明确裁决」列出，不自行扩大。

优先级最高的三个（成本最低、官方成员是独立入口）：

| 条目 | 为何未做 | 恢复成本 |
| --- | --- | --- |
| `Boundary#parsebdStr` | Driver 内部**已经在做**解码（`parseBoundaryRing`），只差暴露官方入口 | 低：1 个 driver 成员 + 1 个 composable 方法 |
| `LocalCity#opts.renderOptions` | `createLocalCity()` 不收参数；`result.level` 结构上恒是「无 map」那一种 | 中：driver 签名 + composable 选项 |
| `useGeocodeDetail` 的 `poiRadius`/`numPois` | Driver **已支持**，是 composable 丢掉了参数 | 低：透传即可 |

`Panorama.links` 需要同时改 `Panorama.vue` 的 `linksChange` 载荷（当前事件无载荷，
「无消费者所以不暴露」的理由不成立），跨组件面，建议单独一票。

## 剩余未审计范围（#165 的绝大部分）

| 工作包 | 内容 | 状态 |
| --- | --- | --- |
| B | Provider / Map 初始化、上下文、props、ref/expose、v-model、ready/retry、KeepAlive | **未审计** |
| C | 全部覆盖物 / 控件 / 菜单 / 全景组件的 props·事件·命令·slots | **未审计** |
| D | 全部图层 / 数据组件的 DTO·样式·拾取·Feature State | **未审计** |
| F | UI Kit wrapper / 插件 / advanced / Resolver / 全局组件声明 | **未审计** |
| — | 现有 `official-api-alignment.md` 只比**名称集合**，不判成员/签名/默认值/行为 | 生成器需扩展 |

维护者裁决项：#165 §7 明确「延期由维护者明确裁决，不允许实施者靠批量例外绕过验收」。上表未审计的四包需要维护者决定是否另开子票。
