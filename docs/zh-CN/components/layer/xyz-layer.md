# XYZLayer 标准瓦片图层 <Badge type="tip" text="^1.0.0" />

第三方标准瓦片服务（XYZ / WMTS / WMS / TMS）：内置 **EPSG:3857 → BD09MC** 转换。

```ts
import { XYZLayer } from 'bmap-vue'
```

## 组件示例

:::demo 加载第三方标准瓦片（XYZ）
layer/xyzLayer
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
| tileUrlTemplate | 服务地址；占位符 `[z]` / `[x]` / `[y]` / `[b]`，`{0,1,2}` 标记多地址 | `string` | - |
| xTemplate | 计算 `[x]` 的取值 | `(x, y, z) => number \| string` | - |
| yTemplate | 计算 `[y]` 的取值 | `(x, y, z) => number \| string` | - |
| zTemplate | 计算 `[z]` 的取值 | `(x, y, z) => number \| string` | - |
| bTemplate | 计算 `[b]` 的取值（默认四至坐标串） | `(x, y, z) => string` | - |
| extent | 加载范围（EPSG:3857 的 `[minX,minY,maxX,maxY]`） | `number[]` | - |
| extentCRSIsWGS84 | `extent` 是否为 EPSG:4326 | `boolean` | `false` |
| boundary | 掩膜（行政区坐标数据） | `string[]` | - |
| useThumbData | 缩放时用跨图层瓦片平滑切换 | `boolean` | `false` |
| tms | `[y]` 是否为 TMS 形式（y 轴翻转） | `boolean` | `false` |

## 稳定性

官方 4.0 新增的独立构造器（只有类声明，没有官方专页），接口面可能变化；本库在能力清单中把它标为 `experimental`。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
