# Polyline 折线

在地图上绘制简单的折线

```ts
import { Polyline } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的折线
overlay/polyline
:::

## 静态组件 Props

| 属性           | 说明                                                     | 类型      | 可选值 | 默认值  | 版本                               |
| -------------- | -------------------------------------------------------- | --------- | ------ | ------- | ---------------------------------- |
| enableClicking | 是否响应点击事件                                         | `boolean` | -      | `true`  |                                    |
| geodesic       | 是否开启大地线模式，true 时，两点连线将以大地线的形式。  | `boolean` | -      | `false` |                                    |
| clip           | 是否进行跨经度 180 度裁剪，绘制跨精度 180 时为了优化效果 | `boolean` | -      | `true`  |                                    |
| linkRight      | 连接右线，配合`clip`解决跨 ±180 度经线绘制问题           | `boolean` | -      | `true`  | <Badge type="tip" text="^2.1.0" /> |

## 动态组件 Props

| 属性            | 说明                                        | 类型                            | 可选值                    | 默认值     | 版本                               |
| --------------- | ------------------------------------------- | ------------------------------- | ------------------------- | ---------- | ---------------------------------- |
| points          | 多边形的坐标数组                            | `{ lng: number, lat: number}[]` | -                         | `required` | -                                  |
| strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                        | -                         | `#000000`  | -                                  |
| strokeWeight    | 描边的宽度，单位为像素                      | `string`                        | -                         | `2`        | -                                  |
| strokeOpacity   | 描边的透明度，范围 `0-1`                    | ` number`                       | -                         | ` 1`       | -                                  |
| strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `string`                        | `solid / dashed / dotted` | -          | -                                  |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                       | -                         | `true `    | -                                  |
| enableEditing   | 开启可编辑模式                              | `boolean`                       | -                         | `false `   | -                                  |
| zIndex           | 层叠顺序（**就地更新**）                      | `number`                      | -                         | -          | `1.0.0`（#165）    |
| visible         | 是否显示                                    | `boolean`                       |                           | `true`     | <Badge type="tip" text="^2.2.0" /> |

> `points` / `controlPoints` 这类**大数组**按**根引用**比较（不做内容指纹）：换引用即更新；
> 原地修改数组时请递增配套的版本 prop（`pathVersion` / `controlPointsVersion`）触发一次更新。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`polyline` 共 17 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。

## 读回命令面（`defineExpose`，#165）

官方在这个类上声明的 getter 此前**没有任何调用路径**——组件永远不会替调用方读一次。
现在它们在组件 `ref` 上。

| 方法                                     | 官方声明 | 适用 |
| ---------------------------------------- | -------- | ---- |
| `getBounds()`                            | `getBounds(): Bounds` | 全部 |
| `getStrokeColor()` / `getStrokeOpacity()` / `getStrokeWeight()` / `getStrokeStyle()` | 各自的 `getXxx()` | 全部 |
| `getCenter()` / `getRadius()`            | 各自的 `getXxx()` | 仅 Circle |
| `getFillColor()` / `getFillOpacity()`    | 各自的 `getXxx()` | Polygon / Rectangle / Circle（**Polyline 没有填充**） |
| `setPositionAt(i, pt)`                   | `setPositionAt(index: number, point: Point): void` | Polygon / Polyline |

返回值全部是**领域值**：`getBounds()` 给 `{ southwest, northeast }`、`getOffset()` 一类给
`{ x, y }`——raw `BMap.Bounds` / `BMap.Size` 不会出现在调用方手里。

⚠️ **不镜像成组件状态**：官方这些 getter 返回的是**当前值**而不是 SDK 默认值，`props` 才是主模型。

### `setPositionAt` 的 `deep`

官方 `Polygon` 的签名是 `setPositionAt(index, point, deep?)`——`deep` 指定「改第几层环」
（`Polygon` 的路径可以是多环），而 `Polyline` 只有两个参数。给非 polygon 传 `deep` 会**显式抛
`BMAP_INVALID_ARGUMENT`**，而不是让官方默默吞掉第三个参数。

它**不**回写 `props.path`：官方没有「顶点被改了」的事件，猜不出一次 `setPositionAt` 属于哪次
路径写入。调用方应同时更新 `path`（或递增 `pathVersion`）。

### 刻意不暴露

`<Polyline>` 的 `getFillColor()` / `getFillOpacity()` 抛 `BMAP_CAPABILITY_UNSUPPORTED`
（官方 `Polyline.d.ts` 只声明描边 getter，没有填充）。

未就绪 / 已释放时**显式抛 `BMAP_RESOURCE_DISPOSED`**，不静默 no-op。
