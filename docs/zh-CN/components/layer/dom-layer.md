# BDOMLayer DOM 图层 <Badge type="tip" text="^3.0.0" />

用回调创建自定义 DOM 覆盖物。`createDom` 对应官方构造签名的第一个参数 `createDOM`。

```ts
import { BDOMLayer } from 'baidu-map-gl-vue'
```

## 组件示例

:::demo 用自定义 DOM 渲染点要素
layer/domLayer
:::

## 统一槽位

图层的统一槽位由**同一个生命周期内核**处理：`visible` 表达为「挂上 / 摘掉」，
可就地更新的槽位（有 setter 的 `zIndex`、数据图层的 `data`）在挂载后就地写入，
其余槽位变化时**重建图层**（旧实例先摘掉，不会有旧请求残留）。

| 属性 | 说明 | 类型 | 默认值 | 本图层的更新口径 |
| --- | --- | --- | --- | --- |
| visible | 是否挂在地图上 | `boolean` | `true` | 挂上 / 摘掉（不重建） |
| data | GeoJSON `FeatureCollection`；`null` = 清空 | `object \| null` | - | **就地** `setData()` / `removeAllOverlays()` |
| minZoom | 最小显示缩放等级 | `number` | SDK 默认 | **就地** `setStyleOptions()` |
| maxZoom | 最大显示缩放等级 | `number` | SDK 默认 | **就地** `setStyleOptions()` |
| zIndex | 图层层叠顺序 | `number` | SDK 默认 | **就地** `setStyleOptions({ zIndex })` |

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| createDom | 创建 DOM 的回调（必填），接收 `properties` 与点坐标，返回 `HTMLElement` | `Function` | - |
| offsetX | 水平偏移（像素） | `number` | SDK 默认 |
| offsetY | 垂直偏移（像素） | `number` | SDK 默认 |
| anchors | 锚点 `[水平, 垂直]`，取值 `0 - 1` | `[number, number]` | `[0.5, 1]` |
| coordinate | 坐标系类型 | `string` | `BD09` |
| enableDraggingMap | 是否允许拖动地图 | `boolean` | `false` |

## 组件事件

| 事件名 | 说明 | 类型 |
| --- | --- | --- |
| click | 点击 DOM 覆盖物时触发 | `(e: unknown) => void` |
| mouseover | 鼠标移入 DOM 覆盖物时触发 | `(e: unknown) => void` |
| mouseout | 鼠标移出 DOM 覆盖物时触发 | `(e: unknown) => void` |

## 稳定性

官方把 `DOMLayer` 归在 4.0 新增的图层里，接口面可能变化；本库在能力清单中把它标为 `experimental`。

## 注意

- `createDom` 写成内联箭头函数**不会**导致重建（内核的指纹把函数折叠成 `fn`）。
- 模板里写 `:create-dom="..."`（prop 名用 `createDom` 而不是 `createDOM`：后者在 kebab-case 下不可达）。
- 层级一类构造项经官方的整袋 `setStyleOptions()` 更新，因此 `zIndex` / `minZoom` 变化不重建。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
