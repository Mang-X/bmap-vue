# GeoJSONLayer GeoJSON 图层

用一份 GeoJSON 数据渲染点 / 线 / 面覆盖物。数据变化时只调 `setData()`，不重建图层。

```ts
import { GeoJSONLayer } from 'bmap-vue'
```

## 组件示例

:::demo 用 GeoJSON 数据渲染线要素
layer/geojsonLayer
:::

## 统一槽位

图层的统一槽位由**同一个生命周期内核**处理：`visible` 表达为「挂上 / 摘掉」，
可就地更新的槽位（有 setter 的 `zIndex`、数据图层的 `data`）在挂载后就地写入，
其余槽位变化时**重建图层**（旧实例先摘掉，不会有旧请求残留）。

| 属性 | 说明 | 类型 | 默认值 | 本图层的更新口径 |
| --- | --- | --- | --- | --- |
| visible | 是否挂在地图上 | `boolean` | `true` | 挂上 / 摘掉（不重建） |
| minZoom | 最小显示层级 | `number` | 官方默认 `3` | 变化时重建 |
| maxZoom | 最大显示层级 | `number` | 官方默认 `21` | 变化时重建 |
| data | GeoJSON `FeatureCollection`；`null` = 清空 | `object \| null` | - | **就地** `setData()` / `clearData()` |

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| layerName | 图层名（写入每个要素的属性）；变化时重建 | `string` | `bmap-vue-geojson` |
| reference | 来源数据坐标系：`BD09LL` / `BD09MC` / `EPSG3857` / `GCJ02` / `WGS84` | `string` | `BD09LL` |
| markerStyle | 点要素样式（或按属性计算的函数） | `object \| Function` | - |
| polylineStyle | 线要素样式 | `object \| Function` | - |
| polygonStyle | 面要素样式 | `object \| Function` | - |
| level | 显示层级（官方默认 `-99`）；变化时**就地更新**，不重建 | `number` | `-99` |

## 组件事件

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 点击图层要素时触发 | `(e: unknown) => void` |
| mousemove | 鼠标在要素上移动时触发 | `(e: unknown) => void` |
| mouseout | 鼠标移出要素时触发 | `(e: unknown) => void` |

## 官方有、本库未暴露

官方 React 文档的 `GeoJSONLayer` API 表列了 9 个属性，本组件**同名同义**地覆盖了其中 8 个
（`reference` / `markerStyle` / `polylineStyle` / `polygonStyle` / `level` / `minZoom` /
`maxZoom` / `visible`）。剩下的一项：

| 官方键 | 本库的等价写法 |
| --- | --- |
| `dataSource` | **`data`**。官方把它同时写进构造选项（`GeoJSONLayerOptions.dataSource`）并另给一个 `setData()` 方法；本库只保留**方法那条路径**：`data` 的每次变化都经 `setData()` 落到同一张图层上——这已经覆盖 `dataSource` 能表达的全部语义（初始数据 = 挂载后的第一次 `setData`），而多一个「构造期数据源」prop 只会让「数据从哪来」有两个入口，初始那一帧与后续 `setData` 走两套时机。 |

官方这一页的 API 表**没有**列出任何「上游类型包未声明」的键，因此上表就是全部差异。

## 注意

- 事件回调收到的是**归一化事件**；要素集合在 `e.raw.features`（`e.raw` 是官方事件对象）。
- 本组件**不提供** `opacity` / `zIndex`：官方 `GeoJSONLayer` 没有这两个语义（层级是语义不同的
  `level`），声明了再静默忽略属于假支持。
- `level` 变化走官方 `setLevel()` **就地更新**，**不重建图层**。依据是 live 读数而不是对称性：
  `setLevel(-50)` 之后 `getLevel()` 读回 `-50`，且解析出的**每一个**要素的 `zIndex` 都从 `-99`
  变成 `-50`。重建的代价与 `data` 变化同量级——把所有已画好的要素拆掉重做——却换不来任何额外效果。
  取值域**不做校验**：官方注释说「负数越大层级越高」，但那是**语义**描述，实测 `0` / `2000` /
  `1.5` 都被照收。
- `minZoom` / `maxZoom` **走重建**：官方 `GeoJSONLayer` **没有** `setMinZoom` / `setMaxZoom`
  （真实运行时也没有），与 `level` 相反。

## 关于函数型样式

`markerStyle` / `polylineStyle` / `polygonStyle` 也可以是「按要素属性计算样式」的**函数**。
样式是在**解析数据时求一次**的，因此换实现的方式与瓦片回调不同：

- 换一个函数**引用** ⇒ 图层**重建**，既有要素会用新实现重新解析（请传稳定引用：`computed` /
  模块常量，内联箭头会因引用每次变化而重建）；
- **对象**样式仍按值比较：同内容的新对象不会重建，内容变了才重建；
- **对象内部**的函数不在覆盖范围内（`{ icon: fnA } → { icon: fnB }` 指纹相同，换外层对象也没用）：
  把样式写成函数、或在 Vue 层用 `:key` 强制重挂载。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.5` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
