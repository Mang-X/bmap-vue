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

全景与「常用控件」分属两条发布范围，避免体量较大的全景拖着 Stable 一起等：

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
| linksChange       | 相邻道路数据变化后触发（官方 `links_changed`）           | `PanoramaLink[]`            |
| load              | 全景数据加载完成后触发（官方 `dataload`）                | 官方事件对象                |
| error             | 全景数据加载失败时触发（官方 `pano_error`）              | 官方事件对象                |

::: tip 为什么载荷是回读出来的
官方的 `position_changed` / `pov_changed` / `zoom_changed` / `scene_type_changed` 事件对象里**只有**
`{type, target, currentTarget}`，没有值。本组件在回调里回读对应的 getter 再作为载荷发出，因此你拿到的是
「事件发生后的当前值」，不需要自己去调 SDK。
:::

### 画面交互与生命周期事件

官方 `PanoramaEventMap` 共 **23** 个事件。本库暴露其中 13 条，**刻意不加 2 条**，
另有 1 条**官方不存在**（见下）。

| 事件                  | 官方事件名                | 载荷                          |
| --------------------- | ------------------------- | ----------------------------- |
| click / dblclick      | 同名                      | `{ type: string }`            |
| touchstart / touchend | 同名                      | `{ type: string }`            |
| clickonroad           | `clickonroad`             | `{ type: string }`            |
| linkClick             | `link_click`              | `{ id?: string }`             |
| povChangedEnd         | `pov_changed_end`         | `PanoramaPov \| null`         |
| sceneChangeEnd        | `scene_change_end`        | `PanoramaSceneType \| null`   |
| sizeChanged           | `size_changed`            | 无                            |
| overlayAdd            | `overlay_add`             | 无                            |
| overlayRemove         | `overlay_remove`          | 无                            |
| overlaysClear         | `overlays_clear`          | 无                            |
| visiblePoiTypeChanged | `visible_poi_type_changed`| `PanoramaPoiType \| null`     |

::: warning 载荷是**收窄投影**，不是官方事件对象
官方把指针事件的载荷声明成 `MouseEvent | TouchEvent`——**原生 DOM 事件对象**，其
`target` 是 raw `BMap.Panorama`。原样转发会把 SDK 内部结构变成公共契约，因此本库**只保留
`type`**。同理，`clientX` / `clientY`（屏幕像素偏移）**不**投影：它与本库的 `{lng, lat}`
领域坐标不是一回事，也没有官方读回入口能换算——编一个「看起来像坐标」的数比不给更糟。
:::

::: tip 为什么 `povChangedEnd` / `sceneChangeEnd` 的载荷是回读出来的
与上面 6 条 `*_changed` 同一手法：官方事件对象不带值，组件在回调里回读 getter。
它们的价值在于「动画**停了**」——`povChange` 在动画期间会连续触发很多次，
业务要的是「现在可以拿最终视角去做点什么」的那一刻。
:::

### 刻意不暴露的两条（逐条有依据，不是遗漏）

- **`destroy`**：官方有声明，但本库 `dispose()` 的顺序是「**先解绑业务监听、再
  `driver.destroy()`**」——SDK 在 destroy 期间**同步**派发事件时，业务回调**不得**打到已拆解的
  状态上。要听见 `destroy` 就得把顺序倒过来，那是拿一个**真实存在的
  正确性风险**换一句收尾信号。清理用 `onUnmounted`（Vue 的正确出口）。
- **`linksVisibleChanged`**：由**官方自带**的道路指示控件（`linksControl`）的显隐驱动，
  而本库不镜像那个控件的内部 UI 状态（官方**没有给读回入口**）⇒ 加了就是「声明了却几乎
  永不触发」。

### ⚠️ 没有 `touchmove`

官方 `PanoramaEventMap` 里**没有** `touchmove`（只有 `touchstart` / `touchend`），
因此不暴露。

::: tip 命名：对外名是 camelCase（**与官方 React 封装一致**，这是有意的，不是偏差）
本组件的对外事件名是 **camelCase**。这一条**不是**待清理的历史偏差，而是对齐了官方
React 封装 `huiyan-fe/react-bmap@2.0.6`（`master`，`src/components/Panorama/index.tsx:46-66`）的
**公共事件面**——它的 `on*` props 是 camelCase（`onLinkClick` / `onLinksChange` / `onIdChange` / …），
内部才订阅 SDK 的 snake_case 事件名。本库的对齐规则是「同一能力优先同名，**参照官方封装**」，
参照对象是这份封装而不是 JSAPI 声明。

官方**声明**（`panorama/PanoramaEvent.d.ts`）的键当然是 snake_case；照官方文档抄 SDK 事件名的
使用者，用本库组件时应当用 camelCase 名。SDK 拼写作为**一一对应的别名**同时发出，
与 map 事件复用同一套「SDK 拼写作为别名同时发出」的机制。

⚠️ 别把 `linksChange` 与 `linksVisibleChanged` 当成一条：前者对应 SDK `links_changed`，
后者对应 **`links_visible_changed`**（载荷 `{ value: boolean }` 自带值），是**另一条**事件。
:::

::: warning 与全库 kebab 规则的表面差异
全库规则 `toVueEventName` 把 `_` 换成 `-`（地图事件与覆盖物事件都走它）。`<Panorama>` 的事件名
**不由 `toVueEventName` 派生**，因此与该规则的产出不同——这与上面的对齐理由不冲突：
派生规则服务于「与 SDK 名可推导」，而本组件的公共面以官方封装为准。
另注：`<Panorama>` 的事件名里**不得含下划线**，因为 SDK 的 snake_case 拼写已作为**别名**提供，
不再是主名。
:::

## 命令式接口

`<Panorama ref>` 暴露：

| 成员        | 说明                                                       |
| ----------- | ---------------------------------------------------------- |
| `whenReady()` | 查看器就绪（含 Client）；可用于判定加载结果              |
| `getLinks()` | 当前场景的相邻链接（未就绪时给**空数组**，见下）           |
| `capture(options?)` | 导出当前画面为 Data URL 字符串（`string \| null`）  |
| `clearOverlays()` | 清空查看器里**本库不管理**的覆盖物（`<PanoramaLabel>` 会被保留，见下） |
| `viewer`    | 当前查看器句柄（未就绪为 `null`）                          |
| `status`    | 实例状态（`idle` / `waiting-client` / `creating` / `ready` / `error` / `disposing` / `disposed`） |
| `error`     | 最近一次失败（`status === 'error'` 时有值）                |

## 已知限制

- 官方的 `Panorama#destroy()` 在**未加载任何场景**的实例上会抛错（真实 4.0 的实测行为）。组件路径的正确姿势是
  「先给 `point` / `id`、再销毁」；真的没有场景时销毁失败只告警，本库自己的资源照常释放。

## `capture()` 与 `clearOverlays()`

这两条是给业务的批量 / 取画面入口：官方 React 参考实现的
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

### `clearOverlays()` 保留 `<PanoramaLabel>`

官方那条 `clearOverlays()` 清的是**全部**覆盖物。官方**没有**枚举接口——`Panorama` 的覆盖物面
只有 `addOverlay` / `removeOverlay` / `clearOverlays` 三个方法——所以「跳过本库管理的、只清其余的」在官方面上**写不出来**：判不出哪个是
其余的。

`<Panorama>` 因此维护一份**标注名册**（`<PanoramaLabel>` 挂上来时登记、摘掉时销账），
`clearOverlays()` 清完之后把名册里的标注**按同一个句柄重新挂回去**。

**对调用方的语义：**

| 覆盖物 | `clearOverlays()` 之后 |
| --- | --- |
| 业务自己挂上去的（经 `advanced` 逃生口或直接用 SDK） | **被清掉** |
| `<PanoramaLabel>` 管理的 | **保留**，且是当前的（重新挂回的是同一个句柄，后续 prop 变化照常生效） |

要连 `<PanoramaLabel>` 一起清掉，正确做法是**卸载那些组件**——它们的释放路径是各自的
`removeLabel()`，这也是「谁创建谁摘除」这条所有权不变式的落点。

::: warning 为什么不是「让 `clearOverlays` 碰不到本库管理的」
那要么是**不调用**官方那条命令（业务要的「把这一屏标注撤掉重画」就没了，而那正是提供这条
命令的唯一理由），要么是**自己枚举后逐个 remove**（没有枚举接口，只能去摸 SDK 内部状态）。
协调是唯一有依据的第三条路。
:::

重新挂回**失败**时会抛出 `BMAP_SDK_CALL_FAILED` 并在消息里说清「有几个没挂回去」——静默吞掉
会让那些标注停在「组件认为挂着、画面上不存在」。

## `linksChange` 的载荷

官方 `Panorama#getLinks(): PanoramaLink[]` 是存在的，本库把它作为 `linksChange` 的载荷：

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
`links` 与 `tiles` 的处置不同：`links` 是业务数据，`tiles` 是渲染细节。
