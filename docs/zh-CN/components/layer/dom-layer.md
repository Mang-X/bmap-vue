# DOMLayer DOM 图层

用回调创建自定义 DOM 覆盖物。`createDom` 对应官方构造签名的第一个参数 `createDOM`。

```ts
import { DOMLayer } from '@mangax/bmap-vue'
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
| minZoom | 最小显示缩放等级 | `number` | 官方默认 `3` | **就地** `setStyleOptions()` |
| maxZoom | 最大显示缩放等级 | `number` | 官方默认 `21` | **就地** `setStyleOptions()` |
| zIndex | 图层层叠顺序 | `number` | SDK 默认 | **就地** `setStyleOptions({ zIndex })` |

## 图层专属选项

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| createDom | 创建 DOM 的回调（必填），接收 `properties` 与点坐标，返回 `HTMLElement` | `Function` | - |
| offsetX | 水平偏移（像素） | `number` | SDK 默认 |
| offsetY | 垂直偏移（像素） | `number` | SDK 默认 |
| anchors | 锚点 `[水平, 垂直]`，取值 `0 - 1` | `[number, number]` | 官方默认 `[0.5, 1]` |
| coordinate | 坐标系类型 | `string` | 官方默认 `BD09` |
| enableDraggingMap | 是否允许拖动地图 | `boolean` | 官方默认 `false` |

这一组**全部是就地更新**（官方用整袋 `setStyleOptions(partial)` 更新它们，没有逐字段 setter），
因此改动都**不重建图层**。

## 官方有、本库未暴露

官方 React 文档的 `DOMLayer` API 表列了 12 个属性，逐条对下来：

| 官方键 | 本库的情况 |
| --- | --- |
| `createDOM` | **改名**为 `createDom`。官方它是**构造首参**（`new BMap.DOMLayer(createDOM, options)`）；Vue 把模板里的 `create-dom` 归一成 `createDom`，而 `createDOM` 在 kebab-case 下**不可达**（`create-dom` ≠ `createDOM`），只能写 `:createDOM="..."`。本库选模板友好的一侧，映射在组件内部完成。见下方「注意」。 |
| `data` / `offsetX` / `offsetY` / `anchors` / `coordinate` / `enableDraggingMap` / `minZoom` / `maxZoom` / `zIndex` / `visible` | **同名同义**全部覆盖（见上两节表格）。 |
| `nextTick` | **不提供**。官方 4.0.5 的 `DOMLayerOptions` 声明里**没有**这个成员（`layer/DOMLayer.d.ts` 逐成员核对），官方类也没有对应方法。官方文档列了它、上游类型包没有——照抄进来就是一个**传了也不生效**的 prop，因此本库不声明。需要消除首帧抖动时在 `createDom` 里自己处理（元素创建后自行排一次布局）。 |

## 关于交互事件（本组件刻意不提供）

官方 4.0.5 的 `DOMLayer` 只声明了 `addEventListener`、**没有** `removeEventListener`，而本库的
事件订阅要求两者同时存在才生效（缺一个就告警 + no-op）—— 也就是说这类订阅**绑上就解不掉**。
官方文档因此把「在短生命周期组件注册 DOMLayer 事件」列为常见错误。故 `DOMLayer` **没有**
`@click` / `@mouseover` / `@mouseout`：与其公开一个真实契约下收不到的事件，不如不提供。

需要交互时：

- 在 **`createDom` 里给元素自己挂监听**（推荐）：元素随数据 / 图层一起销毁，不需要额外解绑；
- 或者把图层放在与 Map 同生命周期的壳层里，经 `advanced` 逃生口自行注册（解绑自担）。

## 稳定性

官方把 `DOMLayer` 归在 4.0 新增的图层里，接口面可能变化；本库在能力清单中把它标为 `experimental`。

## 注意

- `createDom` 变化**不重建**，但交给 SDK 的是「转发到最新 prop」的包装函数：**下一次数据解析**
  （`setData`，包括重新赋值 `data` 触发的那次）就会用到新实现，已经在图上的 DOM 元素保持旧实现
  ——「函数身份恒定、内部读最新值」是这条路径的通用做法。要让既有元素换实现，重新赋值
  `data` 即可（数据驱动的一次重建解析）。
- 模板里写 `:create-dom="..."`（prop 名用 `createDom` 而不是 `createDOM`：后者在 kebab-case 下不可达）。
- 层级、偏移、锚点、坐标系这一组构造项都经官方整袋 `setStyleOptions()` 更新，因此它们变化
  **不重建**图层。

## 参考

- 官方 4.0 API 参考与 `@baidumap/jsapi-v4-types@4.0.5` 的类声明。
- 排障（CORS / 坐标系 / 占位符）见「[图层总览](./index.md)」。
