# Panorama 全景查看器

全景查看器（官方 `BMap.Panorama`）。

```ts
import { Panorama, PanoramaLabel } from 'bmap-vue'
```

## 组件示例

:::demo
panorama/index
:::

## 发布范围：post-stable

M7（#41）把「常用控件」与「全景」拆成两条发布范围，避免体量较大的全景拖着 Stable 一起等：

| 范围 | 内容 | 说明 |
| --- | --- | --- |
| **Stable** | `ZoomControl` / `ScaleControl` / `NavigationControl` / `NavigationControl3D` / `CityListControl` / `LocationControl` / `MapTypeControl` / `OverviewMapControl` / `PanoramaControl` / `CopyrightControl` / `CustomControl` 与统一 `ControlSpec` | 控件都通过同一套 spec（创建 / 挂载 / 卸载 / anchor / offset / visible / options / 事件），Stable 发布前语义冻结 |
| **post-stable（可选）** | `Panorama` / `PanoramaLabel` / `usePanoramaService` | 全景查看器与检索。**API 在 Stable 之前仍可能调整**；不与 Stable 控件共享发布节奏 |

两条范围之间的边界是稳定的：`PanoramaContext` 独立于 `MapContext`（`<Panorama>` 不把内部容器当成地图），
因此 post-stable 部分的增删不会影响 Stable 控件的契约。

## 与地图的关系

`<Panorama>` 与 `<Map>` 是**并列**的两条生命周期，不是嵌套依赖：

- 查看器创建在自己的容器里（`new BMap.Panorama(container)`），既不挂在 Map 上，也不受地图的暂停 / 重试策略管辖；
- 它只需要一个 **Client**，因此放在 `<Map>` 或 `<BMapProvider>` 子树里都可以；
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

`<Panorama ref>` 暴露：

| 成员        | 说明                                                       |
| ----------- | ---------------------------------------------------------- |
| `whenReady()` | 查看器就绪（含 Client）；可用于判定加载结果              |
| `getLinks()` | 当前场景的相邻链接（未就绪时给**空数组**，见下）           |
| `capture(options?)` | 导出当前画面为 Data URL 字符串（`string \| null`）  |
| `clearOverlays()` | 清空查看器里的**全部**覆盖物                        |
| `viewer`    | 当前查看器句柄（未就绪为 `null`）                          |
| `status`    | 实例状态（`idle` / `waiting-client` / `creating` / `ready` / `error` / `disposing` / `disposed`） |
| `error`     | 最近一次失败（`status === 'error'` 时有值）                |

## 已知限制

- 官方的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（真实 4.0 的实测行为）。组件路径的正确姿势是
  「先给 `point` / `id`、再销毁」；真的没有场景时销毁失败只告警，本库自己的资源照常释放。

## `capture()` 与 `clearOverlays()`（#171 补齐）

此前这两条按「没有组件消费」被**刻意不加**。该结论现在不成立：官方 React 参考实现的
`PanoramaRef` 两条都暴露，live probe 也确认**运行时真的可调用**（`capture()` 返回了 1,639 字节
的 data URL）；而 `clearOverlays` 补的是一条本库**造不出来**的路——`<PanoramaLabel>` 的归属是
「谁挂谁摘」，业务想「把这一屏标注撤掉重画」时手上未必有那些句柄。

```ts
import type { PanoramaCaptureOptions } from 'bmap-vue'

const dataUrl = panoramaRef.capture()                                   // string | null
const jpeg = panoramaRef.capture({ quality: 0.8, type: 'image/jpeg' })  // string | null
panoramaRef.clearOverlays()
```

### 三条口径

1. **`capture()` 是读命令**。官方签名是 `capture(options?): string | undefined`，文档写「当前
   渲染器不支持截图时返回 undefined」——Driver 把它归一成 **`null`**，与本库读取面其它成员
   （`getPosition` / `getPov` / `getId` …）同口径。拿到 `null` 意味着「换一条取画面的路」，
   例如 `<Map>` 的 `getScreenshot()`。
2. **未就绪 / 已释放时显式抛 `BMAP_RESOURCE_DISPOSED`，不返回 `null`**。这是它与 `getLinks()`
   的唯一分歧：`getLinks` 的空与非空**不承载语义**（没有链接 ≡ 拿不到链接），所以给空数组；
   而 `capture` 的 `null` 是**一条有后果的判断**——静默降级会让一个已卸载的组件被读成
   「这个环境截不了图」，走进一条永远拿不到画面的分支。
3. **`clearOverlays()` 是写命令，未就绪时同样显式抛**。清不掉却报告成功，会让「重画一屏标注」
   静默叠加在旧标注上。

覆盖面内**其余**的失败（SDK 抛错、成员缺失）一律照常上抛，不进 `null`。

### `clearOverlays()` 不代替摘除路径

组件卸载时每个 `<PanoramaLabel>` 仍然走**自己的** `removeLabel()`。`clearOverlays()` 是给业务的
批量入口，不销账、不替代释放路径（否则同一个标注会被销账两次）。

## `linksChange` 的载荷（#165 更正）

`<Panorama>` 此前派发 `linksChange` 时**不带载荷**。而官方 `Panorama#getLinks(): PanoramaLink[]`
是存在的，官方 React 参考实现同样暴露它——**消费者早就存在，缺的只是数据路径**。

现在 `linksChange` 带 `PanoramaLink[]`：

```ts
import type { PanoramaLink } from 'bmap-vue'

function onLinks(links: PanoramaLink[]) {
  // links: [{ id, description?, heading?, dir?, refinedDir?, x?, y?, roadWidth? }, ...]
}
```

`view.getLinks()` 也可以按需读回（未就绪时给**空数组**）。

官方 `PanoramaLink` 的八个成员**全是可选的**，投影**不补默认值**——`heading ?? 0` 会把
「上游没给方位」与「正北」混成同一个数，而调用方正是靠这个区别决定要不要画指向标。

⚠️ `tiles` 仍**不透出**：官方 `PanoramaTileData` 是瓦片贴图，属渲染内部，没有业务消费者。
`links` 与 `tiles` 的处置不同，这一点由 `driver/jsapi-v4/panorama.ts` 的注释记录。
