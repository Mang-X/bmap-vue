# Rectangle 矩形

在地图上绘制矩形（v4 的 `Rectangle` 覆盖物，由对角两点定义的 `bounds` 描述）。

```ts
import { Rectangle } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的矩形
overlay/rectangle
:::

## 动态组件 Props

| 属性            | 说明                                        | 类型                                     | 可选值                    | 默认值                | 版本                               |
| --------------- | ------------------------------------------- | ---------------------------------------- | ------------------------- | --------------------- | ---------------------------------- |
| bounds          | 显示区域（西南 / 东北两个角点）             | `{ southwest: Point, northeast: Point }` | -                         | `required`            | <Badge type="tip" text="^1.0.0" /> |
| strokeColor     | 描边的颜色，同 CSS 颜色                     | `string`                                 | -                         | `#000000`             | <Badge type="tip" text="^1.0.0" /> |
| strokeWeight    | 描边的宽度，单位为像素                      | `number`                                 | -                         | `2`                   | <Badge type="tip" text="^1.0.0" /> |
| strokeOpacity   | 描边的透明度，范围 0-1                      | `number`                                 | -                         | `0.9`                 | <Badge type="tip" text="^1.0.0" /> |
| strokeStyle     | 描边的样式，为实线、虚线、或者点状线        | `string`                                 | `solid / dashed / dotted` | `solid`               | <Badge type="tip" text="^1.0.0" /> |
| fillColor       | 面填充颜色，同 CSS 颜色                     | `string`                                 | -                         | `#000000`             | <Badge type="tip" text="^1.0.0" /> |
| fillOpacity     | 面填充的透明度，范围 0-1                    | `number`                                 | -                         | `0.5`                 | <Badge type="tip" text="^1.0.0" /> |
| enableMassClear | 是否在调用 `map.clearOverlays` 清除此覆盖物 | `boolean`                                | -                         | `true`                | <Badge type="tip" text="^1.0.0" /> |
| enableEditing   | 是否启用线编辑                              | `boolean`                                | -                         | `false`               | <Badge type="tip" text="^1.0.0" /> |
| enableClicking  | 是否响应点击事件                            | `boolean`                                | -                         | `true`                | <Badge type="tip" text="^1.0.0" /> |
| zIndex           | 层叠顺序（**就地更新**）                      | `number`                      | -                         | -          | `1.0.0`（#165）    |
| visible         | 是否显示                                    | `boolean`                                | -                         | `true`                | <Badge type="tip" text="^1.0.0" /> |

> `bounds` 按**内容**判等：父级每次渲染传内联字面量不会产生多余的 SDK 命令。
> 这与 `Polyline` / `Polygon` 的 `points`（根引用 + 版本 prop）不同——矩形只有四个数字。

## 更新方式

与其它图形类覆盖物一致（同一套 `OverlaySpec` 生命周期内核）：

| 属性                       | 变化时发生什么                                       |
| -------------------------- | ---------------------------------------------------- |
| `bounds` / 描边 / 填充     | 就地更新（各自的 SDK setter，**不重建实例**）        |
| `enableEditing` / `enableMassClear` | 成对开关（`enableEditing()` / `disableEditing()`） |
| `enableClicking`           | 官方 4.0 只有构造选项 ⇒ **重建实例**（内部状态重置） |
| `visible`                  | `show()` / `hide()`：实例留在图上，只是不可见        |

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`rectangle` 共 17 个事件（与 `Polygon` / `Circle` / `Polyline`
相同，含开启编辑后才派发的 6 个编辑事件）。

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

`<Rectangle>` **不**给 `setPositionAt`：官方 `Rectangle` 没有这个方法（它的几何是 `setBounds`），
而 `getBounds()` 的四个角点顺序官方没有承诺——造一个「四顶点逐个改」的等价物是自研语义。
`<Polyline>` 的 `getFillColor()` / `getFillOpacity()` 抛 `BMAP_CAPABILITY_UNSUPPORTED`
（官方 `Polyline.d.ts` 只声明描边 getter）。

未就绪 / 已释放时**显式抛 `BMAP_RESOURCE_DISPOSED`**，不静默 no-op。
