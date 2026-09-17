# BTileLayer 瓦片图层 <Badge type="tip" text="^3.0.0" />

加载**百度坐标系（BD09MC）**的自有瓦片。第三方标准瓦片服务（XYZ / WMTS / WMS / TMS）请用 `BXYZLayer`。

```ts
import { BTileLayer } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 加载自定义瓦片（百度坐标系）
layer/tileLayer
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

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| tileUrlTemplate | 图块 URL 模板，占位符 `{X}` / `{Y}` / `{Z}` | `string` | - |
| transparentPng | 图块是否为含透明信息的 PNG | `boolean` | `false` |
| boundary | 图层掩膜（行政区名或坐标串） | `string \| string[]` | - |
| showRegion | 掩膜显示区域：`'inside'` / `'outside'` | `string` | - |
| retry | 瓦片加载失败时自动重试 | `boolean` | `false` |
| retryTime | 重试间隔（毫秒） | `number` | SDK 默认 |
| cacheSize | 瓦片缓存数量 | `number` | SDK 默认 |
| tileLoadFunction | 自定义瓦片加载函数 | `(tile, url) => void` | - |

## 注意

- 坐标必须是 BD09MC；用 EPSG:3857 / WGS84 会整体偏移。
- 不提供 `getTilesUrl()` 的逃生口：本库统一走 `tileUrlTemplate`。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
