# BWMSLayer WMS 图层 <Badge type="tip" text="^1.0.0" />

加载瓦片式 WMS 服务：官方内部拼接 `SERVICE` / `REQUEST` / `VERSION` / `FORMAT` / `CRS` 等参数，并用 `BBOX` / `WIDTH` / `HEIGHT` 驱动瓦片请求。

```ts
import { BWMSLayer } from 'bmap-vue'
```

## 组件示例

:::demo 加载 WMS 服务
layer/wmsLayer
:::

## 统一槽位

图层的统一槽位由**同一个生命周期内核**处理：`visible` 表达为「挂上 / 摘掉」，
可就地更新的槽位（有 setter 的 `zIndex`、数据图层的 `data`）在挂载后就地写入，
其余槽位变化时**重建图层**（旧实例先摘掉，不会有旧请求残留）。

| 属性 | 说明 | 类型 | 默认值 | 本图层的更新口径 |
| --- | --- | --- | --- | --- |
| visible | 是否挂在地图上 | `boolean` | `true` | 挂上 / 摘掉（不重建） |
| opacity | 图层透明度（0 - 1） | `number` | SDK 默认 | 变化时重建（官方没有 setter） |
| minZoom | 最小显示层级 | `number` | SDK 默认 | 变化时重建 |
| maxZoom | 最大显示层级 | `number` | SDK 默认 | 变化时重建 |
| zIndex | 图层层叠顺序 | `number` | SDK 默认 | **就地** `setZIndex()` |

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| url | 服务地址（WMS 端点） | `string` | - |
| params | WMS 请求参数，至少要有 `LAYERS` | `Record<string, string>` | - |
| projection | 请求使用的投影 | `string` | - |
| tileSize | 瓦片边长（像素） | `number` | SDK 默认 |
| extent | 数据四至范围 | `number[]` | - |
| extentCRSIsWGS84 | `extent` 是否为 EPSG:4326 | `boolean` | `false` |
| reproject | 是否在客户端做投影变换 | `boolean` | SDK 默认 |
| reprojectSourceCRS | `reproject` 时源数据的坐标系 | `string` | - |
| png8 | 是否请求 8 位 PNG | `boolean` | SDK 默认 |
| dataType | 返回数据格式 | `string` | SDK 默认 |
| boundary | 掩膜（行政区列表） | `string[]` | - |
| height / spanLevel / useThumbData | 图层高度 / 缩略层级跨度 / 跨级平滑切换 | `number \| boolean` | SDK 默认 |
| retry / retryTime / cacheSize | 重试与缓存 | `boolean \| number` | SDK 默认 |
| thumbParentDepth / thumbChildDepth | 缩略图深度 | `number` | SDK 默认 |
| tileLoadFunction | 自定义瓦片加载函数 | `(tile, url) => void` | - |

## 稳定性

同 `BXYZLayer`：4.0 新增的构造器，本库标 `experimental`。

## 注意

`params` 的键名遵循 **WMS 标准**（`LAYERS` / `STYLES` / `VERSION`，全大写）；不写 `VERSION` 时按服务端默认版本解析。`reproject` 没开时服务返回的坐标系必须与地图一致，否则表现是瓦片错位而不是报错。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
