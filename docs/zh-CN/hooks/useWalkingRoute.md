# useWalkingRoute 步行路线规划

基于百度 `WalkingRoute` 的 **headless** 步行路线规划：与
[useDrivingRoute](./useDrivingRoute.md) 共用状态口径、归属模型、绘制所有权与
`clear` / `cancel` 语义（**先读那一页**），结果的形状也完全一致（`RoutePlan` → `RouteLeg` →
`RouteStep`）。差异只有下面三处。

```ts
import { useWalkingRoute } from "bmap-vue";
```

## 与驾车的差异

| 维度     | 步行                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 起终点   | 地名 / `{ lng, lat }` / POI 引用——**支持关键字检索**（官方 `WalkingRoute#search` 接受 `string`） |
| 途经点   | **没有**（官方两参数签名 `search(start, end)`），传了会以 `failed` 结算    |
| 构造选项 | 只有 `location` 与 `renderOptions`（官方 `WalkingRouteOptions` 没有策略、页容量、路况开关） |

结果的 `RouteLeg.routeType` 是 `BMAP_ROUTE_TYPE_WALKING`（`2`），可用来区分混合结果（例如公交方案里的
步行段）。

## 示例

:::demo 步行路线规划（地名起终点）
hooks/useWalkingRoute
:::

### 参数

| 字段          | 描述                                                                                     | 类型                                                    | 默认值 |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| location      | 检索区域：城市名字符串 / `{ lng, lat }` / `MapHandle`。不传时取当前 `<Map>` 的地图实例     | `MaybeRefOrGetter<string \| GeoPoint \| MapHandle \| undefined>` | -      |
| renderOptions | 绘制选项（`map` / `panel` / `autoViewport` / `viewportOptions`）。不传 = 纯 headless       | `MaybeRefOrGetter<BMapRouteRenderOptions \| undefined>`   | -      |

### 返回值

与 `useDrivingRoute` **完全一致**（`data` / `status` / `error` / `sdkStatus` / `isLoading` /
`supported` / `isError` / `isEmpty` / `search` / `clear` / `cancel` / `reset`），只是
`data` 的类型是 `WalkingRouteResult`（= `RouteResult<RoutePlan>`）。

```ts
const result = await search("天安门", "王府井");
result.data?.plans[0]?.legs[0]?.steps; // 与驾车同一套投影
```
