# 图层总览

图层组件共用**同一个生命周期内核**：一份「图层规格」（种类 + 构造选项 + 统一槽位）驱动
`create → addLayer → 就地更新 / 重建 → removeLayer`，释放顺序统一为「先解绑业务监听、
再由 Map 摘除 SDK 资源」。

```ts
import {
  BDistrictLayer, BPanoramaCoverageLayer,
  BTileLayer, BTrafficLayer, BGeoJSONLayer, BDOMLayer,
  BXYZLayer, BWMSLayer, BWMTSLayer, BRasterLayer,
} from 'baidu-map-gl-vue'
```

## 选哪个图层

| 场景 | 用哪个 |
| --- | --- |
| 行政区划（省 / 市 / 县区） | `BDistrictLayer` |
| 自有瓦片，数据**已是**百度坐标系（BD09MC） | `BTileLayer` |
| 第三方标准瓦片（XYZ / WMTS / WMS / TMS） | `BXYZLayer`（内置 EPSG:3857 → BD09MC 转换） |
| 栅格瓦片（子域轮询 / TMS 翻转 / 四至裁剪） | `BRasterLayer` |
| WMS 服务 | `BWMSLayer` |
| WMTS 服务 | `BWMTSLayer` |
| 实时路况 | `BTrafficLayer` |
| GeoJSON 数据（点 / 线 / 面） | `BGeoJSONLayer` |
| 自定义 DOM 覆盖物 | `BDOMLayer` |
| 全景覆盖 | `BPanoramaCoverageLayer`（搭配 `BPanoramaControl`） |

## 统一槽位与更新口径

| 槽位 | 语义 | 落地方式 |
| --- | --- | --- |
| `visible` | 是否在地图上 | 挂上 / 摘掉（所有图层一致，**不**用 `hide()`） |
| `opacity` / `minZoom` / `maxZoom` | 透明度 / 显示层级范围 | 构造选项；官方这批图层没有对应 setter，变化时**重建** |
| `zIndex` | 层叠顺序 | 有 setter 的图层就地更新；没有的（如 `BDistrictLayer`）不支持该槽位 |
| `data` | 数据（仅数据驱动图层） | 就地 `setData()`；`null` = 清空 |

> 非目标之一：**不在 `map.addLayer` 之前执行依赖地图的操作**。层级一类的写入只在挂载后发生。

## 关于 `options` 的缺省语义

- **不传就是「不表态」**：没传的 option 不会出现在构造选项里，也不会调用对应 setter。
  这一条对布尔开关尤其重要——Vue 会把「缺省」的 `boolean` prop 转成 `false`，本库在组件里
  显式关掉了这个转换，因此 `edge` 一类 SDK 默认值为 `true` 的开关不会被你「没写」的代码改掉。
- **统一槽位不进 `options`**：`visible` / `opacity` / `minZoom` / `maxZoom` / `zIndex` / `data`
  请用同名 props；写进 `options` 不会被接受（`visible` 会在 Driver 层告警一次）。
- **`visible` 之外的可写项**：有 setter 的（`zIndex`、数据图层的 `data`、`colors` / `edge` /
  `offsetX`… 这类可变 option）就地更新，其余变化**重建**。

## 排障：图层挂上了但看不到东西

按下面的顺序查，能覆盖绝大多数「瓦片不显示」的问题：

1. **CORS**：第三方瓦片服务通常要求开启跨域（`Access-Control-Allow-Origin`）。浏览器会拦截
   图片以外的读取（拾取、绘制到 canvas）。本库只负责发起请求，**不保证源服务可用**。
2. **坐标系**：`BTileLayer` 的坐标**必须**是 BD09MC；第三方标准服务（EPSG:3857 / WGS84 /
   GCJ02）用 `BXYZLayer` / `BRasterLayer` / `BWMSLayer` / `BWMTSLayer`。用错的表现是**整体偏移**
   而不是报错。GeoJSON 数据要按 `reference` 声明来源坐标系。
3. **占位符写法**：`BXYZLayer` 用方括号 `[z]` / `[x]` / `[y]`；`BRasterLayer` 用花括号
   `{z}` / `{x}` / `{y}`（TMS 用 `{-y}`）；`BTileLayer` 用花括号 `{X}` / `{Y}` / `{Z}`。
   写错的表现是「图层挂得好好的，但瓦片全 404」。
4. **掩膜与范围**：`boundary` / `showRegion` / `extent` / `bounds` 会把瓦片裁到某个范围内，
   范围写错时图层在视野内是空的。
5. **服务条款与配额**：第三方瓦片服务有使用限制，请自行确认授权。

## 生命周期与释放

- **显隐**：`visible=false` 是「摘掉图层」（`removeLayer`），不是 `hide()`——所有图层一种口径。
- **重建**：构造期选项（URL、`params`、`transparentPng`…）变化会**换一个实例**：旧实例先摘掉、
  旧监听随它那一代的作用域释放，因此不会有「旧图层的请求/回调影响新图层」。
- **数据**：`BGeoJSONLayer` / `BDOMLayer` 的 `data` 变化只调 `setData()`，**不重建**
  （重建会让所有覆盖物重做，DOM 图层会肉眼可见地闪）。
- **释放**：组件卸载、地图销毁（含 `keepAliveBehavior="dispose"` 的停用）都会摘掉图层并释放
  监听；诊断计数归零有测试锁住。
