# Rectangle 矩形

在地图上绘制矩形（v4 的 `Rectangle` 覆盖物，由对角两点定义的 `bounds` 描述）。

```ts
import { Rectangle } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上绘制可编辑的矩形
overlay/rectangle
:::

## 构造期 Props（`recreate`）

官方 `Rectangle` 的实例成员表上**没有**这些项的 setter（`enableClicking` 没有成对开关；
`coordType` / `linkRight` / `dashArray` 既无 setter 也无读回）⇒ **改动其中任何一项都会重建实例**。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| enableClicking | 是否响应点击事件。官方**没有**成对开关 | `boolean` | `true` |
| coordType | 输入坐标的坐标类型。未设置时使用全局 `BMap.coordType` | `'BMAP_COORD_BD09' \| 'BMAP_COORD_GCJ02' \| 'BMAP_COORD_WGS84'` | 用全局值 |
| linkRight | 跨 180 度经线时是否按最短路径绘制 | `boolean` | `false` |
| dashArray | 虚线样式配置，如 `[8, 4]` 表示实线部分长 8 像素、间隙部分长 4 像素 | `number[]` | 实线与空隙的长度均为线宽的 2 倍 |

::: warning `<Rectangle>` **没有** `strokeLineCap` / `strokeLineJoin`

官方 `RectangleOptions` 的 13 个键里**没有**这两项——只有 `<Polyline>` 与 `<Polygon>` 有。

:::

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| bounds | 显示区域（西南 / 东北两个角点） | `{ southwest: Point, northeast: Point }` | `required` |
| strokeColor | 描边的颜色，同 CSS 颜色 | `string` | `#000000` |
| strokeWeight | 描边的宽度，单位为像素 | `number` | `2` |
| strokeOpacity | 描边的透明度，范围 0 - 1 | `number` | `0.9` |
| fillColor | 面填充颜色，同 CSS 颜色 | `string` | `#000000` |
| fillOpacity | 面填充的透明度，范围 0 - 1 | `number` | `0.5` |
| strokeStyle | 描边的样式，为实线、虚线、或者点状线 | `'solid' \| 'dashed' \| 'dotted'` | `solid` |
| enableMassClear | 是否在调用 `map.clearOverlays()` 时清除此覆盖物（成对开关） | `boolean` | `true` |
| enableEditing | 是否启用线编辑（成对开关 `enableEditing()` / `disableEditing()`） | `boolean` | `false` |
| zIndex | 覆盖物的层叠顺序值 | `number` | - |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

::: tip `bounds` 按**内容**判等
父级每次渲染传内联字面量**不会**产生多余的 SDK 命令。这与 `Polyline` / `Polygon` 的 `points`
（根引用 + `pathVersion`）不同——矩形只有四个数字。
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`rectangle` 共 17 个事件（与 `Polygon` / `Circle` /
`Polyline` 相同，含开启编辑后才派发的 6 个编辑事件），组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。

## 读回命令面（`defineExpose`）

官方在这个类上声明的 getter 在组件 `ref` 上。返回值全部是**领域值**：`getBounds()` 给
`{ southwest, northeast }`、`getOffset()` 一类给 `{ x, y }`——raw `BMap.Bounds` / `BMap.Size`
不会出现在调用方手里。

| 方法 | 官方声明 | 适用 |
| --- | --- | --- |
| `getBounds()` | `getBounds(): Bounds` | Polyline / Polygon / Rectangle / Circle |
| `getStrokeColor()` / `getStrokeOpacity()` / `getStrokeWeight()` / `getStrokeStyle()` | 各自的 `getXxx()` | 全部 |
| `getFillColor()` / `getFillOpacity()` | 各自的 `getXxx()` | Polygon / Rectangle / Circle（**Polyline 没有填充**） |
| `getCenter()` / `getRadius()` | 各自的 `getXxx()` | 仅 Circle |
| `setPositionAt(i, pt)` | `setPositionAt(index: number, point: Point): void` | Polygon / Polyline |

⚠️ **不镜像成组件状态**：官方这些 getter 返回的是**当前值**而不是 SDK 默认值，`props` 才是主模型。

### 刻意不暴露

`<Rectangle>` **不**给 `setPositionAt`：官方 `Rectangle` 没有这个方法（它的几何是 `setBounds`），
而 `getBounds()` 的四个角点顺序官方没有承诺——造一个「四顶点逐个改」的等价物是自研语义。

未就绪 / 已释放时**显式抛 `BMAP_RESOURCE_DISPOSED`**，不静默 no-op。

## 官方有、本库未暴露

**没有缺口。** 官方 `RectangleOptions` 的 13 个键全部有出口：四个构造期（`enableClicking` /
`coordType` / `linkRight` / `dashArray`）在上表，其余九个在「就地更新 Props」表里。

::: tip 官方文档站的 `path` / `node` / `nodeT` 不在官方 4.0.5 声明里
官方 React 文档的 API 表比 SDK 本身宽：`path`（本库改名 `bounds`，见上文「就地更新 Props」表）、
`node` / `nodeT` 在上游 `RectangleOptions` 的声明中查无此成员。`node` / `nodeT` 是 React 的
渲染插槽，不是构造选项。

另外官方**没有**给 `Rectangle` 声明 `strokeLineCap` / `strokeLineJoin`（只有 `Polyline` /
`Polygon` 有），本库因此不提供——传了不会被 SDK 识别。
:::
