# BCopyright 版权控件

地图 3D 控件，可以控制地图的旋转、倾斜，默认位于地图右下角

```ts
import { BCopyright } from 'baidu-map-gl-vue'
```

## 组件示例

多个相同位置版权控件会自动排列，避免重叠

:::demo class="p-bottom"
control/copyRight
:::

::: tip 提示
如果动态内容中有图片会导致闪烁，建议将图片和文字拆分成两个自定义版权
:::

## 静态组件 Props

| 属性   | 说明           | 类型                      | 可选值            | 默认值                    |
| ------ | -------------- | ------------------------- | ----------------- | ------------------------- |
| anchor | 控件的停靠位置 | `string`                  | [anchor](#anchor) | `BMAP_ANCHOR_BOTTOM_LEFT` |
| offset | 控件的偏移值   | `{x: number, y: number }` | -                 | `{ x: 83, y: 18 }`        |

## 动态组件 Props

| 属性    | 说明     | 类型      | 可选值 | 默认值 | 版本                               |
| ------- | -------- | --------- | ------ | ------ | ---------------------------------- |
| visible | 是否显示 | `boolean` | -      | `true` | <Badge type="tip" text="^2.2.0" /> |

`offset` 与 `visible` 都可以动态更新。`anchor` 是**构造期项**（实例按停靠位置共享），改变它会重建控件
并完成共享组迁移 —— 见下面的「选项的更新方式」。

## 选项的更新方式

- `offset` → 就地 `setOffset()`；
- `visible` → **只影响本组件那一条版权项**（见上），不隐藏整个控件；
- `anchor` → **构造期项**：实例按停靠位置共享（同 anchor 共用一个 `CopyrightControl`），
  就地 `setAnchor()` 会让实例与它服务的 anchor 脱钩、同一个位置出现两个控件。因此改变 `anchor`
  会**重建**：先把自己那条版权项从旧实例上摘掉（旧实例没人用了就一并移除），再加入目标位置
  已有的共享实例（没有就新建一个）。

::: tip 把选项改回「不传」
把某个选项从有值改回 `undefined`（模板里就是不再传这个 prop）等价于「回到 SDK 默认值」。默认值只存在于
构造期，因此这类变化会**重建控件**（而不是就地写一个 `undefined`——那会被 SDK 边界按「没有值」跳过，
既不下发也不会重试）。
原地修改父级传入的那个对象（例如 `offset.x = 21`、`size.x = 200`）**同样会下发**——变化检测按**值**比较，不要求你换一个新对象。
:::

## anchor

| 值                       | 说明 |
| ------------------------ | ---- |
| BMAP_ANCHOR_TOP_LEFT     | 左上 |
| BMAP_ANCHOR_TOP_RIGHT    | 右上 |
| BMAP_ANCHOR_BOTTOM_LEFT  | 左下 |
| BMAP_ANCHOR_BOTTOM_RIGHT | 右下 |

## 组件事件

v3 子组件没有 `initd/unload` 事件。如需地图实例，请在 `<BMap>` 子树内用 `useBMap()` + `whenReady()`。

该组件没有对外事件。

