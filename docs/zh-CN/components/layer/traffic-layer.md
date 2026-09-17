# BTrafficLayer 路况图层 <Badge type="tip" text="^3.0.0" />

实时路况图层。官方把它定义为「预配置的 `BTileLayer`」，因此构造选项与 `BTileLayer` 一致。

```ts
import { BTrafficLayer } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 显示实时路况
layer/trafficLayer
:::

## 统一槽位

图层的统一槽位由**同一个生命周期内核**处理：`visible` 表达为「挂上 / 摘掉」，
可就地更新的槽位（有 setter 的 `zIndex`、数据图层的 `data`）在挂载后就地写入，
其余槽位变化时**重建图层**（旧实例先摘掉，不会有旧请求残留）。

| 属性 | 说明 | 类型 | 默认值 | 本图层的更新口径 |
| --- | --- | --- | --- | --- |
| visible | 是否挂在地图上 | `boolean` | `true` | 挂上 / 摘掉（不重建） |
| opacity | 图层透明度（0 - 1） | `number` | SDK 默认 | 变化时重建（官方没有 setter） |
| zIndex | 图层层叠顺序 | `number` | SDK 默认 | **就地** `setZIndex()` |
| colors | 路况颜色 `[畅通, 缓行, 拥堵, 严重拥堵]` | `string[]` | SDK 默认 | **就地** `setColors()` |
| edge | 是否展示白色描边 | `boolean` | SDK 默认 | **就地** `setEdge()` |

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| autoRefresh | 是否自动刷新路况数据 | `boolean` | SDK 默认 |
| refreshInterval | 自动刷新间隔（毫秒） | `number` | SDK 默认 |

## 注意

`autoRefresh` / `refreshInterval` 只有构造期生效（官方没有对应 setter）：改变它们会**重建图层**——「刷新间隔」是图层内部的定时器，就地改不了。

## 注意（多实例）

官方 `TrafficLayer` 是**页面级单实例**：`map` / 瓦片缓存 / 刷新 timer 在所有实例之间共享，
因此本库**不承诺**「挂两个路况图层互不影响」（`autoRefresh` / `refreshInterval` 以最后一次
写入为准）。需要严格隔离时请一个 `<BMap>` 只放一个路况图层。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
