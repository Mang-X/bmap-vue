# GroundPoint 贴地点

把一张图片「钉」在地图的**地面**上：它的尺寸是墨卡托坐标系下的实际大小，因此屏幕上看起来
会随地图缩放级别一起变大变小。适合停车场出入口、门牌、地面标识这类需要跟随地面透视的标注。

```ts
import { GroundPoint } from 'bmap-vue'
```

::: tip 与 `<GroundOverlay>` 是两件不同的事
两者都叫「地面」，但几何入口完全不同：

| | 几何入口 | 官方构造器 |
| --- | --- | --- |
| `<GroundOverlay>` | `bounds`（西南 / 东北两个角点，一个矩形区域） | `new BMap.GroundOverlay(bounds, opts)` |
| `<GroundPoint>` | `point`（**一个点**） | `new BMap.GroundPoint(point, opts)` |

官方声明 `class GroundPoint extends GroundOverlay`（`overlay/GroundPoint.d.ts:5`），
所以它**继承**了 GroundOverlay 的全部选项与事件，但**几何是点、不是矩形**。
:::

## 组件示例

:::demo 贴地点跟随地面透视：旋转与缩放都走就地更新（不重建实例）
overlay/groundPoint
:::

```vue
<GroundPoint
  :point="{ lng: 116.418351, lat: 39.921984 }"
  url="https://jsapi-demo.bj.bcebos.com/images/markers/car.png"
  :size="{ width: 30, height: 60 }"
  :rotation="45"
  :scale="2"
/>
```

## 组件 Props

### 就地更新（`options`）

这一组的每一项在官方 `GroundPoint` 的实例成员表上**都有对应的 setter**，改值走 setter、
**不重建实例**。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| point | 贴地点的地理坐标。**必填**（构造器的第一个位置参数）。落地方法官方叫 **`setPoint`**，不是 `setPosition` | `{ lng: number; lat: number }` | `required` |
| size | 坐标点尺寸，单位像素（`setSize`） | `{ width: number; height: number }` | - |
| anchor | 锚点，以图标左上角为原点（`setAnchor`） | `{ width: number; height: number }` | `new BMap.Size(0, 0)` |
| scale | 缩放比例（`setScale`） | `number` | `1` |
| rotation | 旋转角度，单位度（`setRotation`） | `number` | `0` |
| offset | 偏移量（`setOffset`） | `{ width: number; height: number }` | `new BMap.Size(0, 0)` |
| url | 图标地址（继承自 `GroundOverlay`，落地是 `setImage`）。**只接受图片地址**，不接受 canvas | `string` | - |
| opacity | 图层透明度，取值范围 0 - 1（`setOpacity`） | `number` | `1` |
| displayOnMinLevel | 图层显示的最小缩放级别（`setDisplayOnMinLevel`） | `number` | `3` |
| displayOnMaxLevel | 图层显示的最大缩放级别（`setDisplayOnMaxLevel`） | `number` | `21` |
| zIndex | 覆盖物的层叠顺序值（`setZIndex`） | `number` | - |
| enableMassClear | 是否允许在 `map.clearOverlays()` 时清除此覆盖物（成对开关 `enableMassClear` / `disableMassClear`） | `boolean` | `true` |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

### 构造期 Props（`recreate`）

这一组的每一项在官方实例成员表上**没有**对应的 setter，**改动会重建实例**。

| 属性 | 说明 | 类型 | 官方默认 | 为什么只能构造期 |
| --- | --- | --- | --- | --- |
| level | 尺寸参考的缩放级别 | `number` | `18` | 6 个 setter（`setPoint` / `setScale` / `setSize` / `setRotation` / `setAnchor` / `setOffset`）里**没有** `setLevel` |
| enableClicking | 是否响应鼠标事件 | `boolean` | `true` | 只有构造选项，没有 `setEnableClicking`，也没有成对开关 |
| top | 是否在普通覆盖物之上绘制 | `boolean` | `false` | 官方有 `setZIndex` 但**没有** `setTop`——`zIndex` 是层叠顺序**值**，语义不同，不能互相顶替 |

::: warning 「未给」与「关掉」是两件事
`enableMassClear` / `enableClicking` 的**官方默认是 `true`**，而 Vue 的 `Boolean` prop 未给时
会变成 `false`——与官方默认**相反**。本库在缺省里给它们写的是 `undefined` 而不是 `true`，
因此**未给时该键根本不进构造选项**，由 SDK 沿用自己的默认。
`top` 的官方默认是 `false`，同样钉成 `undefined`：它是 `recreate` 类，「未给」若有两个表示
（`false` 与 `undefined`），父级一次 `:top="undefined"` 就会触发一次内容没变的重建。
:::

### `size` / `anchor` / `offset` 收 `{ width, height }`

官方 `GroundPointOptions` 的这三个键声明的就是 `Size`：

```ts
size?: Size
anchor?: Size
offset?: Size
```

因此本库对外**如实**收 `{ width, height }`。这与图形族的 `offset`（如 `<Marker :offset>`）**不同**——
后者收 `{ x, y }`，那是本库的历史约定（上游同样吃 `Size` 对象），不是官方形状。
`<GroundPoint>` 不继承那一层，免得多一次需要解释的折算。

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`ground-point` 共 11 个事件，与 `ground-overlay` 逐行相同。

之所以相同：官方**没有**为 `GroundPoint` 声明独立的 `GroundPointEventMap`，它继承到的唯一
事件入口是 `GroundOverlay.addEventListener<K extends keyof GroundOverlayEventMap>`
（`overlay/GroundOverlay.d.ts:122`）。逐条表格见[覆盖物事件矩阵](./events)。

## 官方有、本库暂未暴露的选项

| 官方键 | 官方默认 | 为什么不提供 prop |
| --- | --- | --- |
| `imageURL` | - | 官方自己标注了 `@deprecated 4.0 请使用 url 代替`；本库的 `url` 已覆盖这个用途 |
| `type` / `isReDraw` / `drawHook` | - | 这三个是 `GroundOverlayOptions` 的**内容类型**项（image / video / canvas 与逐帧重绘）。`GroundPoint` 官方明确「只接受图片地址，不接受 canvas」，本组件因此不收它们 |
