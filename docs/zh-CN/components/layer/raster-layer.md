# BRasterLayer 栅格瓦片图层 <Badge type="tip" text="^3.0.0" />

面向 XYZ / TMS 类标准瓦片服务：比 `BXYZLayer` 多了子域轮询、TMS 翻转与四至裁剪。

```ts
import { BRasterLayer } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 加载带子域轮询的栅格瓦片
layer/rasterLayer
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
| url | 瓦片地址模板（`{z}` / `{x}` / `{y}` / `{s}` / `{-y}`）或 `(x, y, z) => string` 回调 | `string \| Function` | - |
| subdomains | 子域轮询候选（配合模板里的 `{s}`） | `string[]` | - |
| projection | 请求使用的投影 | `string` | - |
| bounds | 加载范围 `[minX, minY, maxX, maxY]` | `number[]` | - |
| boundsInWGS84 | `bounds` 是否为 WGS84 | `boolean` | - |
| boundary | 掩膜 | `string \| string[]` | - |
| showRegion | 掩膜显示区域：`'inside'` / `'outside'` | `'inside' \| 'outside'` | - |
| useThumbData / spanLevel | 跨级平滑切换与缩略层级跨度 | `boolean \| number` | SDK 默认 |
| height / retry / retryTime / cacheSize | 高度 / 重试 / 缓存 | `number \| boolean` | SDK 默认 |
| tileLoadFunction | 自定义瓦片加载函数 | `(tile, url) => void` | - |

## 稳定性

同 `BXYZLayer`：4.0 新增的构造器，本库标 `experimental`。

## 注意

模板占位符是**花括号**（`{z}` / `{x}` / `{y}`），与 `BXYZLayer` 的方括号不同；`{-y}` 表示 TMS 的 y 轴翻转。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
