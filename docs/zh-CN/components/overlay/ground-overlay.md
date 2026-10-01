# GroundOverlay 地面叠加层

在地图底面上叠加覆盖物，覆盖物可以是图片、自定义 Canvas、视频。

```ts
import { GroundOverlay } from '@mangax/bmap-vue'
```

## 组件示例

:::demo 在地图上添加三种不同类型的地面叠加物，可通过下拉框切换显示不同类型
overlay/groundOverlay
:::

## 构造期 Props（`recreate`）

**这一组的每一项都是构造期属性**——官方 `GroundOverlay` 的实例成员表上**没有**对应的 setter，
**改动其中任何一项都会重建实例**。

| 属性 | 说明 | 类型 | 官方默认 |
| --- | --- | --- | --- |
| type | 叠加内容类型 | `'image' \| 'video' \| 'canvas'` | `'image'` |
| url | 叠加内容来源：`type` 为 `image` 时传图片地址，`video` 时传视频地址，`canvas` 时传 canvas 元素 | `GroundOverlayUrl` | - |
| enableClicking | 是否响应鼠标事件。官方**没有**成对开关 | `boolean` | `true` |
| top | 是否在普通覆盖物之上绘制。⚠️ 与 `zIndex` **不是同一件事**：`zIndex` 是层叠顺序**值**，`top` 是布尔的「压在普通覆盖物之上」开关 | `boolean` | `false` |

## 就地更新 Props（`options`）

| 属性 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| bounds | 显示区域（西南 / 东北两个角点），见[图示](#bounds-图示) | `{ southwest: Point, northeast: Point }` | `required` |
| opacity | 图层透明度，取值范围 0 - 1 | `number` | `1` |
| zIndex | 标注的层叠顺序值 | `number` | - |
| enableMassClear | 是否允许在调用 `map.clearOverlays()` 时清除此覆盖物（成对开关） | `boolean` | `true` |
| autoCenter | 是否自动根据地面叠加物显示区域居中地图。**组件侧行为**，不是 SDK 选项 | `boolean` | `true` |
| visible | 是否显示（走 `show()` / `hide()`） | `boolean` | `true` |

```vue
<GroundOverlay type="image" url="a.png" :bounds="{ southwest: sw, northeast: ne }" />
```

::: warning 只有一种写法
显示区域**只有 `bounds` 一种**（与上游 `createGroundOverlay(bounds, options)` 同形）。
本库 1.0 不提供旧版写法，传入其它几何字段不会生效。
:::

### bounds 图示

<br />
<div class="bounds-image">
  <img src="/bounds.svg" alt="">
</div>

<style>
  .dark .bounds-image{
    width: 60%;
    background: var(--vp-c-text-1);
  }
</style>

### GroundOverlayUrl

```ts
export type GroundOverlayUrl =
  | string
  | HTMLCanvasElement
  | (() => string | HTMLCanvasElement)
```

第三种是**惰性工厂**：`type: "canvas"` 时通常需要现场创建 canvas，工厂只在创建 / 显式替换时
被调用**一次**（求值发生在组件的 props 视图里，函数本身不会被交给 SDK）。

```vue
<GroundOverlay type="canvas" :url="makeCanvas" :bounds="bounds" />
```

## 官方有、本库暂未暴露的选项

下面几项官方 `GroundOverlayOptions` 有声明，但**本组件目前没有对应 prop**，传了不会生效：

| 官方键 | 说明 | 官方默认 | 为什么不提供 prop |
| --- | --- | --- | --- |
| `displayOnMinLevel` | 图层显示的最小缩放级别 | 3 | 本库没有接线；需要按级别控制显示区域时直接改 `bounds` |
| `displayOnMaxLevel` | 图层显示的最大缩放级别 | 21 | 同上 |
| `isReDraw` | 是否开启循环重绘（`type` 为 `canvas` 时生效）。开启后每帧渲染前都会调用 `drawHook` 并重新采集 canvas 内容，用于雷达扫描、水波动画这类动态效果 | `false` | 涉及**逐帧回调**——本库目前没有可稳定释放的帧循环归属，给一个 `drawHook` prop 等于收下一条不受管理的重绘链 |
| `drawHook` | 自定义绘制回调，`type` 为 `canvas` 且开启 `isReDraw` 时每帧渲染前调用 | - | 同上 |
| `imageURL` | 官方已标注 `@deprecated 4.0 请使用 url 代替` | - | 官方自己建议改用 `url`；本库的 `url` 已经覆盖这个用途，再加一个别名只是多一条会漂移的路 |

前两项的替代做法是用 `bounds` 直接圈定想显示的区域；`isReDraw` / `drawHook` 在拿到稳定的
帧循环归属之前本库不提供入口。

::: tip 官方文档站还列了 `stretch`，但官方 4.0.5 声明里**没有**
官方 React 文档的 API 表比 SDK 本身宽：`stretch` 在上游 `GroundOverlayOptions` 的声明中查无此成员。
本库不提供它——照抄会变成「传了也不生效」的假支持。要按比例拉伸图像，请在你的图片里预先处理好，
或改用 `bounds` 直接圈定范围。
:::

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`ground-overlay` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
