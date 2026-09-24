# useRidingRoute 骑行路线规划

基于百度 `RidingRoute` 的 **headless** 骑行路线规划。公开签名与
[useWalkingRoute](./useWalkingRoute.md) **完全一致**（地名 / 坐标 / POI 起终点，没有途经点，
构造选项只有 `location` 与 `renderOptions`），差异只在结果里：`RouteLeg.routeType` 是
`BMAP_ROUTE_TYPE_RIDING`（`6`）。

```ts
import { useRidingRoute } from "bmap-vue";
```

> 为什么要两个 hooks 而不是一个 `useRoute(mode)`：两个服务在 SDK 里就是两个类、两个能力 id
> （`service.walking-route` / `service.riding-route`），合并只会让「其中一个加了选项」时要在共享类型
> 上开洞。这也是本库不做「最宽模型」的原因。

## 示例

:::demo 骑行路线规划（地名起终点）
hooks/useRidingRoute
:::

### 参数

| 字段          | 描述                                                                                     | 类型                                                    | 默认值 |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ |
| location      | 检索区域：城市名字符串 / `{ lng, lat }` / `MapHandle`。不传时取当前 `<Map>` 的地图实例     | `MaybeRefOrGetter<string \| GeoPoint \| MapHandle \| undefined>` | -      |
| renderOptions | 绘制选项（`map` / `panel` / `autoViewport` / `viewportOptions`）。不传 = 纯 headless       | `MaybeRefOrGetter<BMapRouteRenderOptions \| undefined>`   | -      |

### 返回值

与 `useDrivingRoute` **完全一致**（状态口径、归属、`clear` / `cancel` / `reset` 都一样），
只是 `data` 的类型是 `RidingRouteResult`（= `RouteResult<RoutePlan>`）。
