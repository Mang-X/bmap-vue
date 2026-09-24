# GroundOverlay 地面叠加层 <Badge type="tip" text="^0.0.32" />

在地图底面上叠加覆盖物，覆盖物可以是图片、自定义 Canvas、视频。

```ts
import { GroundOverlay } from 'bmap-vue'
```

## 组件示例

:::demo 在地图上添加三种不同类型的地面叠加物，可通过下拉框切换显示不同类型
overlay/groundOverlay
:::

## 动态组件 Props

| 属性       | 说明                                                 | 类型                                     | 默认值     | 版本                               |
| ---------- | ---------------------------------------------------- | ---------------------------------------- | ---------- | ---------------------------------- |
| type       | 地面叠加物类型                                       | `video \| canvas \| image`               | `required` | -                                  |
| url        | 叠加物 image url、video url 或者自定义的 canvas 对象 | [`GroundOverlayUrl` ](#GroundOverlayUrl) | `required` | -                                  |
| bounds     | 显示区域（西南 / 东北两个角点），见[图示](#bounds-图示) | `{ southwest: Point, northeast: Point }` | `required` | <Badge type="tip" text="^1.0.0" /> |
| autoCenter | 是否自动根据地面叠加物显示区域居中地图               | `boolean `                               | `true`     | -                                  |
| opacity    | 透明度，范围 0-1                                     | `number`                                 |            | -                                  |
| visible    | 是否显示                                             | `boolean`                                | `true`     | <Badge type="tip" text="^2.2.0" /> |

### 从 `startPoint` + `endPoint` 迁移

v2 / v3-beta 的 `startPoint`（西南角）与 `endPoint`（东北角）**仍然可用**，但它们已经弃用：
内部只有一份几何模型 `bounds`，旧名由集中弃用层在**读取层**解析，并在控制台给出一次提示
（同实例只提示一次）。新代码请直接用 `bounds`；两者同时出现时 **`bounds` 优先**，旧名完全不参与。

```vue
<!-- 旧写法（仍可用，会提示一次） -->
<GroundOverlay type="image" url="a.png" :start-point="sw" :end-point="ne" />

<!-- 新写法 -->
<GroundOverlay type="image" url="a.png" :bounds="{ southwest: sw, northeast: ne }" />
```

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
  | Ref<HTMLCanvasElement | string>
  | (() => HTMLCanvasElement | Ref<HTMLCanvasElement | string>)
```

## 组件事件

本组件的事件面由**覆盖物事件矩阵**给出：`ground-overlay` 共 11 个事件，事件名（Vue 名 / SDK 名）、
载荷档与「需要哪个能力开关」都在那张表里，组件的 `defineEmits` 与它逐条一致。

详见 [覆盖物事件矩阵](./events)。
