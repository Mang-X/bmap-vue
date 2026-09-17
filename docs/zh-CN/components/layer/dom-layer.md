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

## 关于交互事件（本组件刻意不提供）

官方 4.0.4 的 `DOMLayer` 只声明了 `addEventListener`、**没有** `removeEventListener`，而本库的
事件订阅要求两者同时存在才生效（缺一个就告警 + no-op）—— 也就是说这类订阅**绑上就解不掉**。
官方技能文档把「在短生命周期组件注册 DOMLayer 事件」列为常见错误。因此 `BDOMLayer` **没有**
`@click` / `@mouseover` / `@mouseout`：与其公开一个真实契约下收不到的事件，不如不提供。

需要交互时：

- 在 **`createDom` 里给元素自己挂监听**（推荐）：元素随数据 / 图层一起销毁，不需要额外解绑；
- 或者把图层放在与 Map 同生命周期的壳层里，经 `advanced` 逃生口自行注册（解绑自担）。

## 稳定性

官方把 `DOMLayer` 归在 4.0 新增的图层里，接口面可能变化；本库在能力清单中把它标为 `experimental`。

## 注意

- `createDom` 变化**不重建**，但交给 SDK 的是「转发到最新 prop」的包装函数：**下一次数据解析**
  （`setData`，包括重新赋值 `data` 触发的那次）就会用到新实现，已经在图上的 DOM 元素保持旧实现
  ——与官方参考实现 `huiyan-fe/react-bmap` 的 `useLatest` 语义一致。要让既有元素换实现，重新赋值
  `data` 即可（数据驱动的一次重建解析）。
- 模板里写 `:create-dom="..."`（prop 名用 `createDom` 而不是 `createDOM`：后者在 kebab-case 下不可达）。
- 层级一类构造项经官方的整袋 `setStyleOptions()` 更新，因此 `zIndex` / `minZoom` 变化不重建。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.4` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
