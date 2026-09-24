# WMTSLayer WMTS 图层 <Badge type="tip" text="^1.0.0" />

加载 WMTS 标准瓦片服务：官方内部拼接 `Service` / `Request` / `Version` / `Format` / `TileMatrixSet` 等参数，调用方只需服务地址与图层参数。

```ts
import { WMTSLayer } from 'bmap-vue'
```

## 组件示例

:::demo 加载 WMTS 服务
layer/wmtsLayer
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
| url | 服务地址（WMTS 端点） | `string` | - |
| params | WMTS 请求参数，至少要给 `Layer` / `TileMatrixSet` | `Record<string, string>` | - |
| extent | 数据四至范围 | `number[]` | - |
| extentCRSIsWGS84 | `extent` 是否为 EPSG:4326 | `boolean` | `false` |
| transform | 源 / 目标坐标系映射 | `{ source?, target? }` | - |
| xTemplate / yTemplate / zTemplate | 自建瓦片矩阵映射 | `(x, y, z) => number \| string` | - |
| reproject / reprojectSourceCRS | 客户端投影变换 | `boolean \| string` | SDK 默认 |
| png8 / dataType / height | 请求格式与高度 | `boolean \| string \| number` | SDK 默认 |
| boundary | 掩膜（行政区列表） | `string[]` | - |
| retry / retryTime / cacheSize | 重试与缓存 | `boolean \| number` | SDK 默认 |
| useThumbData / spanLevel / thumbParentDepth / thumbChildDepth | 缩略与跨级复用 | `boolean \| number` | SDK 默认 |
| tileLoadFunction | 自定义瓦片加载函数 | `(tile, url) => void` | - |

## 稳定性

同 `XYZLayer`：4.0 新增的构造器，本库标 `experimental`。

## 注意

`params` 的键名遵循 **WMTS 标准**（`Layer` / `Style` / `TileMatrixSet` / `Format`，首字母大写），与 WMS 的全大写**不同**；写错的表现通常是服务端 400 或空白瓦片。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
