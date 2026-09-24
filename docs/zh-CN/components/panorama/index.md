# BPanorama 全景查看器

全景查看器（官方 `BMap.Panorama`）。

```ts
import { BPanorama, BPanoramaLabel } from 'bmap-vue'
```

## 组件示例

:::demo
panorama/index
:::

## 发布范围：post-stable

M7（#41）把「常用控件」与「全景」拆成两条发布范围，避免体量较大的全景拖着 Stable 一起等：

| 范围 | 内容 | 说明 |
| --- | --- | --- |
| **Stable** | `BZoom` / `BScale` / `BNavigation` / `BNavigation3d` / `BCityList` / `BLocation` / `BMapType` / `BOverview` / `BPanoramaControl` / `BCopyright` / `BControl` 与统一 `ControlSpec` | 控件都通过同一套 spec（创建 / 挂载 / 卸载 / anchor / offset / visible / options / 事件），Stable 发布前语义冻结 |
| **post-stable（可选）** | `BPanorama` / `BPanoramaLabel` / `usePanoramaService` | 全景查看器与检索。**API 在 Stable 之前仍可能调整**；不与 Stable 控件共享发布节奏 |

两条范围之间的边界是稳定的：`PanoramaContext` 独立于 `MapContext`（`<BPanorama>` 不把内部容器当成地图），
因此 post-stable 部分的增删不会影响 Stable 控件的契约。

## 与地图的关系

`<BPanorama>` 与 `<BMap>` 是**并列**的两条生命周期，不是嵌套依赖：

- 查看器创建在自己的容器里（`new BMap.Panorama(container)`），既不挂在 Map 上，也不受地图的暂停 / 重试策略管辖；
- 它只需要一个 **Client**，因此放在 `<BMap>` 或 `<BMapProvider>` 子树里都可以；
- 容器尺寸必须由使用方给出（经 `class` / `style`），全景没有默认尺寸。

## 静态组件 Props

| 属性      | 说明                                                     | 类型      | 默认值     |
| --------- | -------------------------------------------------------- | --------- | ---------- |
| point     | 展示某个坐标处的全景                                     | `Point`   | -          |
| id        | 按全景 id 展示（与 `point` 二选一，同时给出时以 `id` 为准）| `string`  | -          |
| pov       | 视角（`heading` 必填，`pitch` 省略表示不改俯角）         | `PanoramaPov` | -      |
| zoom      | 缩放级别                                                 | `number`  | -          |
| options   | 查看器配置（构造期给一次，之后经 `setOptions()` 写回）    | `PanoramaOptions` | -  |
| visible   | 显隐                                                     | `boolean` | `true`     |
| scrollWheelZoom | 鼠标滚轮缩放开关（仅 PC 端有效）                   | `boolean` | -          |
| poiType   | 外景场景点内可见的 POI 类型（默认隐藏全部）              | `PanoramaPoiType` | -  |

`class` / `style` 会透传到宿主容器上（Vue 的单根节点属性透传），因此尺寸写在模板上即可。

## PanoramaPov

| 字段    | 说明                                               |
| ------- | -------------------------------------------------- |
| heading | 水平角：正北 0、正东 90、正南 180、正西 270（度）  |
| pitch   | 俯仰角：向上最大 90，向下最大 -90（度）            |

## PanoramaOptions

| 字段                       | 说明                                     | 默认值 |
| -------------------------- | ---------------------------------------- | ------ |
| navigationControl          | 是否显示全景的导航控件                   | `true` |
| linksControl               | 是否显示道路指示控件                     | `true` |
| indoorSceneSwitchControl   | 是否显示室内场景切换控件（仅室内景生效） | `true` |
| albumsControl              | 是否显示相册控件                         | `false`|
| albumsControlOptions       | 相册控件配置（形状由官方决定，原样透传） | -      |

## PanoramaPoiType

`hotel` / `catering` / `movie` / `transit` / `indoor_scene` / `none`

## 组件事件

| 事件              | 说明                                                     | 载荷                        |
| ----------------- | -------------------------------------------------------- | --------------------------- |
| positionChange    | 当前全景位置变化后触发（官方 `position_changed`）        | `Point \| null`             |
| povChange         | 当前视角变化后触发（官方 `pov_changed`）                 | `PanoramaPov \| null`       |
| zoomChange        | 当前缩放级别变化后触发（官方 `zoom_changed`）            | `number \| null`            |
| idChange          | 当前全景 id 变化后触发（官方 `id_changed`）              | `string \| null`            |
| sceneTypeChange   | 场景类型变化后触发（官方 `scene_type_changed`）          | `'street' \| 'inter' \| null` |
| linksChange       | 相邻道路数据变化后触发（官方 `links_changed`）           | 无                          |
| load              | 全景数据加载完成后触发（官方 `dataload`）                | 官方事件对象                |
| error             | 全景数据加载失败时触发（官方 `pano_error`）              | 官方事件对象                |

::: tip 为什么载荷是回读出来的
官方的 `position_changed` / `pov_changed` / `zoom_changed` / `scene_type_changed` 事件对象里**只有**
`{type, target, currentTarget}`，没有值。本组件在回调里回读对应的 getter 再作为载荷发出，因此你拿到的是
「事件发生后的当前值」，不需要自己去调 SDK。
:::

## 命令式接口

`<BPanorama ref>` 暴露：

| 成员        | 说明                                                       |
| ----------- | ---------------------------------------------------------- |
| `whenReady()` | 查看器就绪（含 Client）；可用于判定加载结果              |
| `viewer`    | 当前查看器句柄（未就绪为 `null`）                          |
| `status`    | 实例状态（`idle` / `waiting-client` / `creating` / `ready` / `error` / `disposing` / `disposed`） |
| `error`     | 最近一次失败（`status === 'error'` 时有值）                |

## 已知限制

- 官方的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（真实 4.0 的实测行为）。组件路径的正确姿势是
  「先给 `point` / `id`、再销毁」；真的没有场景时销毁失败只告警，本库自己的资源照常释放。
- `capture()`（截图）与 `clearOverlays()` 是官方成员，但当前没有组件消费它们，因此本库**不暴露** ——
  需要时用 `advanced` 的 raw 逃生口。
