---
title: Map 地图
---

# Map 地图

地图核心对象，地图控件、覆盖物、图层等需作为其子组件，以获得 map 的实例化对象

```ts
import { BMap } from 'baidu-map-gl-vue'
```

## 渲染地图

:::demo class="p-top"
map/base
:::

## 多实例

:::demo class="p-top not-full p-bottom"
map/multiInstance
:::

## 个性化地图

通过指定 `Map` 组件的 `mapStyleId` 或者 `mapStyleJson` 来展示个性化地图，如果同时指定，`mapStyleId` 会优先生效。

::: tip 提示

1. 如果个性化地图没有生效，请先检查 `mapStyleId` 或 `mapStyleJson` 是否正确。如果是通过 `mapStyleId` 实现，还需要检查是否与 `ak` 申请的账号一致
2. 以下示例使用的 `mapStyleId` 均与 ak 和域名绑定，无法直接复制使用。可根据示例主题名字到[百度地图个性化编辑器](https://lbsyun.baidu.com/apiconsole/custommap)创建后使用
:::

### 获取资源

> mapStyleId 和 mapStyleJson 获取以及相关注意事项，请访问[百度地图个性化地图相关文档](https://lbsyun.baidu.com/index.php?title=jspopularGL/guide/custom#service-page-anchor3)知悉

### 出行主题示例

:::demo 类似苹果地图风格
map/theme1
:::

### 赛博朋克主题示例

:::demo 满满的科技感
map/theme2
:::

## 自定义地图加载中

默认情况下，地图加载中效果是 `map loading...` 文字居中。如果不能满足你的需求，你可以通过提供 `loading` 具名插槽来自定义地图加载中显示效果。

:::details 显示代码

<!-- prettier-ignore -->
```html
<template>
  <BMap ak="百度地图ak">
    <template #loading>
      <div class="spinner">
        <div class="double-bounce1"></div>
        <div class="double-bounce2"></div>
      </div>
    </template>
  </BMap>
</template>

<style lang="css">
  .spinner {
    width: 60px;
    height: 60px;

    position: relative;
    margin: 100px auto;
  }

  .double-bounce1,
  .double-bounce2 {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background-color: #42b883;
    opacity: 0.6;
    position: absolute;
    top: 0;
    left: 0;

    -webkit-animation: bounce 2s infinite ease-in-out;
    animation: bounce 2s infinite ease-in-out;
  }

  .double-bounce2 {
    -webkit-animation-delay: -1s;
    animation-delay: -1s;
  }

  @-webkit-keyframes bounce {
    0%,
    100% {
      -webkit-transform: scale(0);
    }
    50% {
      -webkit-transform: scale(1);
    }
  }

  @keyframes bounce {
    0%,
    100% {
      transform: scale(0);
      -webkit-transform: scale(0);
    }
    50% {
      transform: scale(1);
      -webkit-transform: scale(1);
    }
  }
</style>
```

:::

## 静态组件 props

| 属性              | 说明                                             | 类型                                                                    | 可选值 | 默认值                 | 版本                               |
| ----------------- | ------------------------------------------------ | ----------------------------------------------------------------------- | ------ | ---------------------- | ---------------------------------- |
| ak                | 百度地图 [ak](../guide/quick-start#申请-ak-密钥) | `string`                                                                | -      | -                      | -                                  |
| apiUrl            | 自建地图 api 资源地址（默认路径会显式报 `BMAP_INVALID_ARGUMENT`，见下方说明；请改用 `customScriptV4Provider`） | `string` | - | - | <Badge type="tip" text="^2.3.0" /> |
| provider          | 自定义 SDK 加载器；不传时走 `app.use` 的默认定义（`baiduJsapiV4Provider()` → 官方 `@baidumap/jsapi-loader`） | `BMapProviderLike` | - | - | - |
| client            | 已创建好的 `BMapClient`（最高优先级）            | `BMapClient`                                                            | -      | -                      | -                                  |
| definition        | 完整 Client 定义（覆盖 provider/ak 解析）        | `CreateBMapClientOptions`                                               | -      | -                      | -                                  |
| keepAliveBehavior | KeepAlive 下的行为：`suspend` 不销毁地图（激活后自动 `checkResize`），`dispose` 则销毁 | `'suspend' \| 'dispose'` | - | `'suspend'` | - |
| minZoom           | 地图允许展示的最小级别                           | `number`                                                                | `0-21` | `0`                    | -                                  |
| maxZoom           | 地图允许展示的最大级别                           | `number`                                                                | `0-21` | `21`                   | -                                  |
| backgroundColor   | 地图背景颜色, rgba 数组                          | ` number[]`                                                             | -      | `[245, 245, 245, 100]` | <Badge type="tip" text="^2.1.0" /> |
| restrictCenter    | 是否限制中心                                     | `boolean`                                                               | -      | `true`                 | <Badge type="tip" text="^1.1.3" /> |
| plugins           | 需要注册的插件（内置：`TrackAnimation` / `Mapvgl` / `DrawingManager` / `GeoUtils`，一律 optional；未知名字发 `plugin-error`） | `string[]` | - | - | - |

::: warning 默认路径的入口与插件
默认路径由官方 `@baidumap/jsapi-loader` 决定，因此：

- `apiUrl` 在上游**没有入口**，默认路径传它会在加载前显式报 `BMAP_INVALID_ARGUMENT`。要换入口请用
  `customScriptV4Provider(scriptSrc)`（经 `provider` / `definition` 传入），宿主已加载好 SDK 则用
  `existingGlobalV4Provider()`；
- `plugins` 里的名字必须是**内置**的四个之一。**名字不认识时该插件明确失败**：发 `plugin-error`
  （`code: 'BMAP_PLUGIN_UNKNOWN'`），地图与同一列表里其它插件不受影响。此前未知名字会被静默降级成
  一个「永远成功」的空实现，拼错一个字母也会 `plugin-ready`（见
  [ADR 2026-09-14 插件 Catalog 与作用域](/adr/2026-09-14-plugin-catalog-scope-scheduling)）；
- 内置插件都是**文档级（`global`）资源**：同页面多张地图**共享同一次加载**（只插一份脚本），
  并且**地图卸载不会释放它**（上游没有卸载入口）。要一个干净起点（测试 / 热更新）时用
  `baidu-map-gl-vue/plugins` 的 `disposeDefaultPluginHost()` —— 它等价于「释放当前持有的全部
  文档级插件资源」，调用方自己负责确保此刻没有地图还在用它们；
- 每个内置插件在 JSAPI 4.0 上的状态（含「不兼容」与「运行时未验证」）见
  [插件兼容 inventory](../contributing/plugin-compat-inventory)。
:::

## 动态组件 Props

| 属性                   | 说明                                                                                                                                                                           | 类型                                  | 默认值            | 版本                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------- | ---------------------------------- |
| width                  | 地图显示宽度                                                                                                                                                                   | `string / number`                     | `100%`            | <Badge type="tip" text="^1.0.1" /> |
| height                 | 地图显示高度                                                                                                                                                                   | `string / number`                     | `550px`           | <Badge type="tip" text="^1.0.1" /> |
| center                 | 地图默认中心点，可使用城市名，如：北京市，也可以使用对象如 `{lng: 121.424333, lat: 31.228604}` 表示经纬度。                                                                    | `string / {lng: number, lat: number}` | `{ lng: 116.403901, lat: 39.915185 }` | - |
| heading                | 地图旋转角度                                                                                                                                                                   | `number`                              | `0`               | -                                  |
| tilt                   | 地图倾斜角度                                                                                                                                                                   | `number`                              | `0 `              | -                                  |
| mapType                | 地图类型 [mapType](#地图类型)                                                                                                                                                  | `string`                              | `BMAP_NORMAL_MAP` | -                                  |
| zoom                   | 地图缩放级别                                                                                                                                                                   | `number`                              | `14`              | -                                  |
| displayOptions         | 自定义地图属性 [详见](#displayoptions)                                                                                                                                         | -                                     | -                 | -                                  |
| mapStyleId             | 个性化地图样式 ID [详见](#个性化地图)                                                                                                                                          | `string`                              | -                 | -                                  |
| mapStyleJson           | 个性化地图样式 Json [详见](#个性化地图)                                                                                                                                        | `{featureType: string...}[]`          | -                 | -                                  |
| enableTraffic          | 是否启用交通路况图层                                                                                                                                                           | `boolean`                             | `false`           | -                                  |
| enableDragging         | 启用地图拖拽                                                                                                                                                                   | `boolean`                             | `true`            | -                                  |
| enableInertialDragging | 启用地图惯性拖拽                                                                                                                                                               | `boolean`                             | `true`            | -                                  |
| enableScrollWheelZoom  | 允许地图可被鼠标滚轮缩放                                                                                                                                                       | `boolean`                             | `false`           | -                                  |
| enableContinuousZoom   | 开启双击平滑缩放效果                                                                                                                                                           | `boolean`                             | `true`            | -                                  |
| enableResizeOnCenter   | 开启图区 resize 中心点不变                                                                                                                                                     | `boolean`                             | `true`            | -                                  |
| enableDoubleClickZoom  | 启用地图双击缩放，左键双击放大、右键双击缩小                                                                                                                                   | `boolean`                             | `false`           | -                                  |
| enableKeyboard         | 启用键盘操作，键盘的上、下、左、右键可连续移动地图。同时按下其中两个键可使地图进行对角移动。PgUp、PgDn、Home 和 End 键会使地图平移其 1/2 的大小。 +、-键会使地图放大或缩小一级 | `boolean`                             | `true`            | -                                  |
| enablePinchToZoom      | 启用双指缩放地图                                                                                                                                                               | `boolean`                             | `true`            | -                                  |
| enableAutoResize       | 保留字段，当前版本未生效（容器尺寸变化请调用暴露的 `checkResize()`）                                                                                                          | `boolean`                             | `true`            | -                                  |
| loadingBgColor         | 加载背景图颜色                                                                                                                                                                 | `string`                              | `#f1f1f1`         | <Badge type="tip" text="^2.1.0" /> |

## v3 行为说明

### 地图初始化与更新

- `center` 和 `zoom` 在地图首次创建时一起应用，初始化使用 SDK 的 `centerAndZoom`。
- 地图创建完成后，单独更新 `center` 只调用 `setCenter`，不会重置当前 `zoom`。
- 单独更新 `zoom` 只调用 `setZoom`。
- `heading` 和 `tilt` 会在初始化时应用，也会在对应 prop 变化时同步到 SDK；具体是否生效取决于 SDK 能力。

### ready 与插件事件

`ready` 表示 SDK client 和地图实例已经创建完成，可以创建普通覆盖物。`plugins` 的加载不会阻塞 `ready`。

### KeepAlive

地图组件在 `deactivated` 时默认**不销毁** WebGL 地图（`keepAliveBehavior="suspend"`），仅暂停高频计算；
`activated` 时自动恢复并 `checkResize()`。如需停用时销毁，设为 `"dispose"`。

```vue
<BMap ak="百度地图ak" keepAliveBehavior="suspend" />
```

### 子资源挂载目标

覆盖物默认挂载到地图。`BMarker` 会为其子树提供新的挂载目标，因此 `BContextMenu` 写在
`BMarker` 内时自动挂到该 Marker；父资源晚于子组件就绪时，子组件会自动等待并原子挂载
（先从旧目标移除，再挂到新目标，不会同时残留）。

```vue
<BMap
  ak="百度地图ak"
  :plugins="['TrackAnimation']"
  @ready="onReady"
  @plugin-ready="onPluginReady"
  @plugin-error="onPluginError"
>
</BMap>
```

| 事件 | 说明 | 参数 |
| --- | --- | --- |
| `ready` | 地图实例创建并完成初始配置后触发 | `{ client, map, container }`（`map` 为 `MapHandle`；raw SDK 仅经 `./advanced` 的 `unwrapRaw` 获取） |
| `plugin-ready` | 单个插件加载完成后触发 | `name: string` |
| `plugin-error` | 单个插件加载失败；不会改变已经 ready 的地图状态 | `{ name, error }` |
| `initd` | `ready` 的兼容事件，建议迁移到 `ready` | `{ client, map, container }` |

## 地图类型

| 值                 | 描述         |
| ------------------ | ------------ |
| BMAP_NORMAL_MAP    | 标准地图     |
| BMAP_EARTH_MAP     | 地球模式     |
| BMAP_SATELLITE_MAP | 普通卫星地图 |

::: warning 注意
地球模式 (BMAP_EARTH_MAP) 下能支持的地图交互操作有限，如您需要卫星地图支持和标准地图 (BMAP_NORMAL_MAP) 一致的交互体验，请使用普通卫星图模式 (BMAP_SATELLITE_MAP)
:::

## displayOptions

| 属性      | 说明                                              | 类型               | 默认值 |
| --------- | ------------------------------------------------- | ------------------ | ------ |
| poi       | 是否显示地图上的地点标识                          | `boolean`          | `true` |
| indoor    | 是否显示室内图                                    | `boolean`          | `true` |
| poiText   | 是否显示地图上的地点标识文字                      | `boolean`          | `true` |
| poiIcon   | 是否显示地图上的地点标识图标                      | `boolean`          | `true` |
| overlay   | 是否显示覆盖物                                    | `boolean`          | `true` |
| layer     | 是否显示叠加图层，地球模式暂不支持                | `boolean`          | `true` |
| building  | 是否显示 3D 建筑物（仅支持 WebGL 方式渲染的地图） | `boolean`          | `true` |
| street    | 是否显示路网（只对卫星图和地球模式有效）          | `boolean`          | `true` |
| skyColors | 配置天空的颜色，数组中首个元素表示地面颜色，第二个元素表示天空颜色。从而形成渐变，支持只传入一个元素  | `[string, string]` | -      |

## 组件方法

| 方法              | 说明                             | 类型                               |
| ----------------- | -------------------------------- | ---------------------------------- |
| getMapInstance    | 父组件获取 map 句柄（`MapHandle`，非 raw SDK 地图） | `() => MapHandle \| null` |
| getContainer      | 获取地图容器 DOM                 | `() => HTMLElement \| null`        |
| whenReady         | 地图 ready 后 resolve             | `(signal?: AbortSignal) => Promise<MapReadyContext>` |
| retry             | 加载失败后重试                   | `() => Promise<MapReadyContext>`   |
| suspend           | 暂停高频计算（KeepAlive 停用时自动调用，不销毁地图） | `(reason?: unknown) => void` |
| resume            | 恢复并自动 `checkResize`（KeepAlive 激活时自动调用） | `(reason?: unknown) => void` |
| checkResize       | 容器尺寸变化后手动重设地图尺寸   | `() => void`                       |
| resetCenter       | 重置地图中心（deprecated）       | `() => void`                       |
| resetView         | 恢复首次初始化时的 center、zoom、heading 和 tilt | `() => void` |
| setDragging       | 设置地图是否可拖动               | `(enabled: boolean) => void` |

`resetCenter` 已 deprecated，不再返回 map 实例；新代码请使用 `resetView`。需要 raw SDK 地图时，用 `./advanced` 的 `unwrapRaw(mapHandle)` 获取。

## 组件事件

| 事件名          | 说明                                                                                        | 类型                                     |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| ready           | 地图实例创建并完成初始配置后触发                                                            | `{ client, map, container }`             |
| initd           | `ready` 的兼容事件，建议迁移到 `ready`                                                      | `{ client, map, container }`             |
| unload          | 组件卸载时会触发此事件                                                                      | -                                        |
| plugin-ready    | 单个插件加载完成后触发（载荷为插件名字符串；v2 的 `@pluginReady` 已移除）                   | `name: string`                           |
| plugin-error    | 单个插件加载失败；不会改变已经 ready 的地图状态                                             | `{ name, error }`                        |
| error           | 地图创建失败时触发                                                                          | `BMapError`                              |
| click           | 左键单击地图时触发，事件经归一化（`point/pixel/domEvent/raw`）                               | `MapMouseEvent`                          |

::: warning 注意
`BMap` 仅转发以上事件。`movestart/moving/zoomstart/tilesloaded` 等原生 SDK 事件当前版本不转发，
如需监听请经 `ready` 载荷的 `client.driver.events.on(map, name, handler)` 自行订阅并记得在卸载时取消。
:::
