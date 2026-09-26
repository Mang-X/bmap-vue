---
"bmap-vue": major
---

# #160：未导出类型（`ae-forgotten-export`）存量清零

五份 `packages/bmap-vue/etc/<出口>/forgotten-exports.json` 全部变成 `[]`
（此前 `advanced` 27 / `composables` 41 / `plugins` 9 / `ui-kit` 21）。门禁从「已知的存量清单」
变成**零容忍**，文件与比对逻辑保留 —— 它就是那道 freeze 门。

处置逐条走 ADR 2026-09-25 预留的二选一，没有「顺手全导出」。

## 根因更正：`_2` 后缀不是源码重复声明

issue 原文推断 `_2`（`MapHandle_2` / `BMapClient_2` / `MapContext_2` …）是「同一形状在多个源文件里
各定义了一份」。**实测不成立**：`BMapEngine` / `Point` / `Bounds` / `Size` / `ServiceCallStatus` /
`ServiceErrorInfo` / `MapStatus` 在 `src/` 里**各自只声明一次**。真实原因在构建层：

`vue-tsc` 的声明 emit 会把「从子入口 barrel 转出、但自身不在本子目录声明」的符号写成
`import("..")`，而 `unplugin-dts` 的 `transformCode` 之后把它提升成一条**静态顶层导入**
`import { MapContext, MapStatus, MapHandle, BMapClient } from '..';`。从
`dist/composables/useMap.d.ts` 看，`..` 指向的正是 `dist/composables.d.ts` —— **本子入口自己**。
于是同一批符号同时以「rollup 根」和「被引用的模块」两种身份进入 API Extractor，触发
`DtsRollupGenerator._makeUniqueNames()` 判重，把整张约 111 个类型的图**复制一遍**并加 `_2`
后缀（逐字节相同），`dist/index.d.ts` 里连导出的别名都变成 `export { MapType_2 as MapType }`。
`check:api` 随后把 9 个 `_2` 名字报成「未导出」—— 它们在源码里各只有一份声明，误判的根因在这里。

修在构建层：`packages/bmap-vue/vite.config.build.ts` 新增 `rewriteEntrySelfImports()`，在
`beforeWriteFile` 把自指的 `import { … } from '..'` 换成指向**真正声明处**的相对 specifier。
入口不再被自己引用，判重消失：`**` 图整张复制（114 个类型）降到 **0**，类型语义一字不变。

仍剩 4 个 `_2`：`DrivingPolicy` / `IntercityPolicy` / `TransitPolicy` / `MapType`。它们是**另一个**
机制 —— `const X = {…} as const` 与 `type X = (typeof X)[keyof typeof X]` 这种**同名同文件**的
「既是值也是类型」对，AE 的 `_makeUniqueNames()` 对它们独立判重（与自指无关）。这 4 个名字**只出现
一次**（`DrivingPolicy_2` 是那唯一一份的后缀形态），因此不再触发 `ae-forgotten-export`；
`check:api` 五份集合基线都是 `[]` 就是证据。

## 三类处置

1. **升为公共导出**（消费方无法命名的形状）：`./advanced` 的 Provider / Driver / Layer /
   Service 家族，`./composables` 的服务与路线 options / result / 坐标类型，`./plugins` 的
   `BMapLoadOptions` / `PluginScope` / `PluginContext` / `Disposer` 等。全部**只增类型导出**。
2. **让引用消失**（内部运行时不出现在公共面）：`resolveMapContext()` / `useMapContext()` 改为
   返回窄面 `PublicMapContext`（`src/composables/resolveMapContext.ts`），`MapEventSource` 的
   `client` / `resources` 只声明用得到的那几个方法，完整 `MapContext` 经新的内部模块
   `src/composables/internalMapContext.ts` 供组件与 serviceTask 使用。
3. **让引用它的类型不再依赖它**：`BuiltinMarkerIconName` 从 `keyof typeof MARKER_ICON_SPRITES`
   改成显式联合（联合反过来**校验**那张表），那张从不进 API report 的私有常量表因此不再被
   以「未导出符号」之名带进公共声明。

## 新增值导出（3 个出口，共 11 个名字）

| 入口 | 新增 | 理由 |
| --- | --- | --- |
| `./advanced` | `BMapError`、`DrivingPolicy`、`IntercityPolicy`、`OFFICIAL_V4_VERSION`、`TransitPolicy`、`TransitVehiclePolicy` | 错误类要能 `catch` / `instanceof` / 读 `code`；策略常量与类型同名，装配面要能直接收下这些值 |
| `./composables` | `DrivingPolicy`、`IntercityPolicy`、`TransitPolicy`、`TransitVehiclePolicy` | 此前只有根入口有值，`bmap-vue/composables` 的消费者改根入口 import 才对得上 |
| `./plugins` | `BMapError`、`DrivingPolicy`、`IntercityPolicy`、`TransitPolicy`、`TransitVehiclePolicy` | 同上 |
| `./ui-kit` | `BMapError` | `<RoutePlan>` 的 `error` 事件载荷是它的实例 |

`./composables` 另新增一个值导出 `MAP_EVENT_CATALOG`：`MapEventName = keyof typeof MAP_EVENT_CATALOG`
需要它以值的形式可达，而写成 `export type` 会产生「类型检查通过、运行时 `undefined`」的幽灵导出
（#160 评审查出）。四个子入口的 `export declare const` 已逐个对着 `.mjs` 核过，零幽灵。

## `./ui-kit` 的 21 个：四个组件的 expose 面

四个 SFC 用内联箭头函数写 `defineExpose({...})`，`vue-tsc` 把每个方法提升成顶层
`declare function search()`，`DefineComponent` 再以 `typeof search` 引用它 —— 每个公开方法名
都成了「只剩名字的符号」。改为**具名、显式标注**的 expose 接口（`PlaceAutocompleteExpose` /
`PlaceSearchExpose` / `PlaceDetailExpose` / `RoutePlanExpose`，与 `<Map>` 的 `MapExpose` 同一
模式）后，20 个 `declare function` 全部消失；剩下 `BMapError` 由上一节处理。

## 为什么三个子路径重复转出同一批类型（72 个名字三处都有）

`advanced` / `composables` / `plugins` 三个子入口的导出面有 72 个名字重叠
（`Point` / `MapHandle` / 各 Driver / 各 options …）。这是**刻意**的，不是重复：

- 子路径导出的意义就是「**只** import 你要的那个入口」。若 `./composables` 不转出
  `Point`，消费方就得为了给路线 composable 标一个坐标类型而去 import 根入口或
  `./advanced` —— 那与 `./core` 当初被取消的原因（105 个值导出整包暴露）是同一种毛病。
- 门禁的判据是「**本**出口有没有导出它」，不是「全局有没有别处导出过」。AE 逐出口分析，
  因此每个出口都得**自己**转出，绕不过去。
- 真正的重复风险是「同一份定义写了两遍」。这里全部是 `export type … from "<单一模块>"` 的
  **转出**，没有第二份定义（`CapabilityRegistry` / `MapDriver` 等各自的声明处唯一）。
  唯一例外是策略常量：`./composables` 与 `./plugins` 都从 `driver/types/services`
  转出同一个 `DrivingPolicy` 值，仍然是同一份绑定，不是两次求值。

## 逐名处置表（98 个名字，每个都标了走哪条路）

判据同 ADR 2026-09-25 决策 5：**消费方能不能为它命名**。「导出」= 升为公共导出；
「让引用消失」= 收窄签名 / 让依赖它的类型不再依赖它 / 修掉构建层自指。

### `./advanced`（27）

| 名字 | 处置 | 具体做法 |
| --- | --- | --- |
| `AutocompleteUpdateOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapError` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapLoadOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ControlOptionStatus` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `CreateCapabilityRegistryOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `DrivingRouteOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4Driver` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4Engine` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4LoadMetadata` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4LoadMode` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4Namespace` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4ProviderId` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `JsapiV4VersionSource` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LayerCreateOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LayerData` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LayerOperation` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LayerSurface` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `NativeLayerFeatureKeys` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `NativeLayerFeatureState` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `NativeLayerFeatureStateMap` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `NormalizedProvider` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `OfficialJsapiV4Version` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `RidingRouteOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `TransitRouteOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ViewAnimationCancelOutcome` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `WalkingRouteOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |

### `./composables`（41）

| 名字 | 处置 | 具体做法 |
| --- | --- | --- |
| `BMapClient` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapClient` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapRouteLocation` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapRouteRenderOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapServiceStatus` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapServiceStatus` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `Bounds` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BuiltinMarkerIconName` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `DrivingPolicy` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `DrivingRouteEndpoint` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `DrivingRouteResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `FrameScheduler` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `GeolocationAddressInfo` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `IntercityPolicy` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchInBoundsRequest` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchKeyword` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchNearbyRequest` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchPoi` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `LocalSearchSearchOption` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapContext` | 让引用消失 | `resolveMapContext()` / `useMapContext()` 返回窄面 `PublicMapContext` |
| `MapContext` | 让引用消失 | 同左（随自指判重一并消失） |
| `MapEventName` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapEventPayload` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapEventPayloadOf` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapHandle` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapHandle` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `MapStatus` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `PanoramaDataInfo` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `Point` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ResourceScope` | 让引用消失 | `MapEventSource.resources` 收窄成 `{ add(disposer) }` |
| `RidingRouteResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `RouteEndpoint` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ServiceErrorInfo` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ServiceErrorInfo` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `ServiceResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `Size` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `TransitPolicy` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `TransitRouteResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `TransitVehiclePolicy` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `WalkingRouteResult` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |

### `./plugins`（9）

| 名字 | 处置 | 具体做法 |
| --- | --- | --- |
| `BMapLoadOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `BMapProviderLike` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `Capability` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `CreateBMapClientOptions` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `Disposer` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `PluginContext` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `PluginHostEntryStatus` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `PluginScope` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `PluginUrlKey` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |

### `./ui-kit`（21）

| 名字 | 处置 | 具体做法 |
| --- | --- | --- |
| `BMapError` | 导出 | 出现在已导出签名里、消费方无法命名 ⇒ 升为公共导出 |
| `clear` | 让引用消失 | 同上 |
| `clear` | 让引用消失 | 同上 |
| `getCurrentType` | 让引用消失 | 同上 |
| `getInputValue` | 让引用消失 | 同上 |
| `getLastResult` | 让引用消失 | 同上 |
| `goToPage` | 让引用消失 | 同上 |
| `hide` | 让引用消失 | 同上 |
| `nextPage` | 让引用消失 | 同上 |
| `prevPage` | 让引用消失 | 同上 |
| `search` | 让引用消失 | 四个组件改为具名 expose 接口（`declare function` 消失） |
| `searchInBounds` | 让引用消失 | 同上 |
| `searchNearby` | 让引用消失 | 同上 |
| `search` | 让引用消失 | 同上 |
| `search` | 让引用消失 | 同上 |
| `setCitylimit` | 让引用消失 | 同上 |
| `setInputValue` | 让引用消失 | 同上 |
| `setLocation` | 让引用消失 | 同上 |
| `setPlace` | 让引用消失 | 同上 |
| `setTypes` | 让引用消失 | 同上 |
| `show` | 让引用消失 | 同上 |

## 顺带结清

`./composables` 的 2 条 `ae-unresolved-link`（`useViewAnimation` 里指向**非导出成员**的
`{@link start}` / `{@link cancel}`）—— 改为普通文字，因为 AE 把 `@link` 解析成**出口导出**。
`check:api` 现在五个出口**零 warning**。

## 对消费方的影响（**有破坏性变更**）

- 上述类型现在可以从各自子路径 `import type`；**没有删除任何已有的 `export` 名字**。
  但下述**类型收窄**会让部分既有调用在升级后**类型报错** —— 行为不变，类型变严。
- `resolveMapContext()` / `useMapContext()` 的返回类型**收窄**为 `PublicMapContext`：
  `status` / `map` / `client` / `error` / `whenReady()` / `isTearingDown()` / `events.emit()`
  取值一字不变，只是不再暴露 `overlays` / `layers` / `resources` / `infoWindows` 等内部运行时。
  需要完整上下文的库内代码从 `src/composables/internalMapContext.ts` 取。
- `MapEventSource.client` / `.resources` 改为结构化声明，行为不变。
