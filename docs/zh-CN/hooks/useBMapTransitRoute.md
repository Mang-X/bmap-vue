# useBMapTransitRoute 公交路线规划

基于百度 `TransitRoute` 的 **headless** 公交路线规划：市内公交 / 地铁与跨城（飞机、火车、大巴）
换乘方案。它是四个路线服务里**结果刻意不同构**的那一个——方案是一条「步行段 + 乘车段」的序列。

```ts
import { useBMapTransitRoute } from "bmap-vue";
```

它与 [useBMapDrivingRoute](./useBMapDrivingRoute.md) 共用状态口径、归属模型、绘制所有权与
`clear` / `cancel` 语义（**先读那一页**），差异只有下面三处。

## 示例

:::demo 公交换乘方案 + 自己渲染分段
hooks/useBMapTransitRoute
:::

## 与驾车 / 步行 / 骑行的差异

| 维度       | 公交                                                                       |
| ---------- | -------------------------------------------------------------------------- |
| 构造选项   | 比其余三个多：`policy`（市内策略）、`intercityPolicy`、`transitTypePolicy`、`pageCapacity`（官方范围 1-5） |
| 起终点     | 地名 / `{ lng, lat }` / POI 引用（支持关键字检索）；**没有途经点**            |
| 结果形状   | `TransitRoutePlan.segments`：按官方 `getTotalType(i)` 判别成 `{ kind: 'walk' }` 或 `{ kind: 'line' }` |
| 额外字段   | `data.transitType`（官方 `getTransitType()`：市内 / 跨城）、`linesTitle`、`walkDistance`、`description` |

### 参数

| 字段              | 描述                                                       | 类型                                                    | 默认值 |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------- | ------ |
| location          | 检索区域：城市名 / `{ lng, lat }` / `MapHandle`。不传时取当前地图 | `MaybeRefOrGetter<string \| GeoPoint \| MapHandle \| undefined>` | -      |
| policy            | 市内公交换乘策略（`TransitPolicy.*`）                       | `MaybeRefOrGetter<TransitPolicy \| undefined>`            | `0`    |
| intercityPolicy   | 跨城换乘策略（`IntercityPolicy.*`，仅跨城检索有效）           | `MaybeRefOrGetter<IntercityPolicy \| undefined>`          | -      |
| transitTypePolicy | 跨城交通方式（`TransitVehiclePolicy.*`，仅跨城检索有效）      | `MaybeRefOrGetter<TransitVehiclePolicy \| undefined>`     | -      |
| pageCapacity      | 每页方案个数（官方范围 1 - 5）                               | `MaybeRefOrGetter<number \| undefined>`                   | -      |
| enableTraffic     | 是否显示实时路况（官方 4.0 默认 `false`）                     | `MaybeRefOrGetter<boolean \| undefined>`                  | `false`|
| renderOptions     | 绘制选项。不传 = 纯 headless                                 | `MaybeRefOrGetter<BMapRouteRenderOptions \| undefined>`   | -      |

### 返回的 segments

```ts
for (const segment of plan.segments) {
  if (segment.kind === "walk") {
    segment.leg.distanceText; // 步行段（官方的 Route，与驾车方案里的线路同一套投影）
  } else {
    segment.title; // 线路全称，如「快速公交 1 号线」
    segment.lineType; // BMAP_LINE_TYPE_*（0 公交 / 1 地铁 / 2 渡轮 / 3 火车 / 4 飞机 / 5 大巴）
    segment.onStop?.title; // 上车站
    segment.offStop?.title; // 下车站
    segment.viaStops; // 途经车站数（仅公交 / 地铁有效）
  }
}
```

判别键用的是**官方自己的** `TransitRoutePlan#getTotalType(i)`，不是「有没有某个字段」这类形状特征
——接口允许没有该字段的合法成员，特征识别会把它们误分类。

## 与标准面板互斥

`BRoutePlan`（`bmap-vue/ui-kit`）在锁定版本里**只开放驾车**，因此公交没有标准面板可用；
如果你用自定义 UI 的公交路线，别再给 `BRoutePlan` 传同一份检索参数（那会变成两套请求、两份结果）。
详见 [useBMapDrivingRoute 的「与标准面板互斥」](./useBMapDrivingRoute.md#与标准面板互斥)。
