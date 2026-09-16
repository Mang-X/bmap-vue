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

在 `status !== 'ready'` 且 `status !== 'error'` 时，`<BMap>` 会渲染 `loading` 具名插槽
（不提供时是居中灰字）：

- **容器还没有拿到非零尺寸**（未展开的 Tab / Drawer / 折叠面板）：`waiting for container size...`
  —— 此时地图**刻意还没有创建**，`status` 停在 `idle`；
- 否则：`map loading...`。

插槽载荷与 `error` 插槽**完全相同**（`status` / `error` / `containerReady` / `retry`），
见下文「状态插槽」一节。如果自带的文案不能满足你的需求，用 `loading` 具名插槽自定义即可。

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
  （`code: 'BMAP_PLUGIN_UNKNOWN'`），地图与同一列表里其它插件不受影响。注意它**不会**在注册表里留下
  记录，所以 `getStatus(name)` / `inspect(name)` 是 `undefined`，而不是 `'error'`。此前未知名字会被
  静默降级成一个「永远成功」的空实现，拼错一个字母也会 `plugin-ready`（见
  [ADR 2026-09-14 插件 Catalog 与作用域](/adr/2026-09-14-plugin-catalog-scope-scheduling)）；
- 内置插件都是**文档级（`global`）资源**：同页面多张地图**共享同一次加载**（只插一份脚本），
  并且**地图卸载不会释放它**（上游没有卸载入口）。`baidu-map-gl-vue/plugins` 的
  `disposeDefaultPluginHost()` 只能清掉**宿主缓存的资源与在飞的等待**，它**不卸载**第三方脚本、
  也不抹掉 `window.BMapGLLib.*` —— 所以那次调用之后重新渲染地图会**复用已存在的全局**（不会重新
  拉脚本）。要真正的干净起点只能刷新文档。调用方还要自己负责「此刻没有地图还在用这些插件」；
- 每个内置插件在 JSAPI 4.0 上的状态（含「不兼容」与「运行时未验证」）见
  [插件兼容 inventory](../contributing/plugin-compat-inventory)。
:::

## 动态组件 Props

| 属性                   | 说明                                                                                                                                                                           | 类型                                  | 默认值            | 版本                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ----------------- | ---------------------------------- |
| width                  | 地图显示宽度                                                                                                                                                                   | `string / number`                     | `100%`            | <Badge type="tip" text="^1.0.1" /> |
| height                 | 地图显示高度                                                                                                                                                                   | `string / number`                     | `550px`           | <Badge type="tip" text="^1.0.1" /> |
| center                 | 地图中心点（**受控**，见下文「受控 / 非受控视野」）：可使用城市名，如：北京市；也可以使用对象如 `{lng: 121.424333, lat: 31.228604}` 表示经纬度。与 `v-model:center` 配对，用户拖拽后回写具体坐标。 | `string / {lng: number, lat: number}` | -（缺省时用 `{ lng: 116.403901, lat: 39.915185 }`） | - |
| defaultCenter          | 非受控中心点**初值**：只在首次创建视野时生效，之后变化不覆盖当前状态 | `string / {lng: number, lat: number}` | - | <Badge type="tip" text="^3.0.0" /> |
| heading                | 地图旋转角度（**受控**，环绕角） | `number`                              | -（缺省时用 `0`）     | - |
| defaultHeading         | 非受控旋转角初值：只在首次创建视野时生效 | `number` | - | <Badge type="tip" text="^3.0.0" /> |
| tilt                   | 地图倾斜角度（**受控**） | `number`                              | -（缺省时用 `0`） | - |
| defaultTilt            | 非受控倾斜角初值：只在首次创建视野时生效 | `number` | - | <Badge type="tip" text="^3.0.0" /> |
| mapType                | 地图类型 [mapType](#地图类型)                                                                                                                                                  | `string`                              | `BMAP_NORMAL_MAP` | -                                  |
| zoom                   | 地图缩放级别（**受控**） | `number`                              | -（缺省时用 `14`） | - |
| defaultZoom            | 非受控缩放级别初值：只在首次创建视野时生效 | `number` | - | <Badge type="tip" text="^3.0.0" /> |
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
| enableAutoResize       | 容器尺寸变化时自动重设地图尺寸（内部经 FrameScheduler 合帧，一帧最多一次 `checkResize()`）。传 `false` 时只更新读数，由调用方自己在合适的时机调用暴露的 `checkResize()` | `boolean` | `true` | <Badge type="tip" text="^3.0.0" /> |
| loadingBgColor         | 加载背景图颜色                                                                                                                                                                 | `string`                              | `#f1f1f1`         | <Badge type="tip" text="^2.1.0" /> |

## 容器尺寸、自动重设与可见性策略

### 容器门禁：零尺寸不建图

容器拿到**非零尺寸**之前，`<BMap>` **不会创建地图**。零尺寸建图在真实浏览器上会得到一个 0×0 的
WebGL 画布（JSAPI 4.0 不会自己重算尺寸），而 Tab / Drawer / 折叠面板在展开之前正是 0×0 —— 于是
用户会看到「地图加载完了但一片空白」。

| 观察点 | 零尺寸期间 | 拿到非零尺寸之后 |
| --- | --- | --- |
| `status` | `idle`（不进入加载流程） | `loading` → `ready` |
| `#loading` 插槽的 `containerReady` | `false` | `true` |
| 组件方法 `isContainerReady()` | `false` | `true` |
| 地图实例 | **不存在**（`getMapInstance()` 为 `null`） | 创建一次 |

读数走标准 DOM 测量（`getBoundingClientRect()`，退化到 `offsetWidth` / `clientWidth`），
被测量的是**组件根容器**（作者声明的尺寸所在）。

地图**建好之后**容器再变成 0（折叠 / 切走 / 进后台）**不会销毁地图**，也不取消门禁：恢复尺寸后由
`checkResize()` 纠正即可（本库刻意不在这种时机销毁 WebGL 地图）。

门禁不止覆盖首次挂载：**`retry()` 与首次建图共用同一个判据**（容器**当前**是否有非零尺寸），
且**一次完整启动是单飞的**（并发 `retry()` 共享同一次启动，`ready` / `initd` / 插件加载都不会重复）。

- 「初始化失败 → Tab 收起 → 点重试」不会在 0×0 容器上建出第二张图：那次重试会**挂起**，
  等容器重新展开时由门禁接着放行；
- 容器收起期间 `retry()` 返回的 Promise 保持 **pending**，直到这次重试真正执行完才 settle
  （成功 resolve 上下文 / 失败 reject **那一次**的错误）—— 它**不会**拿旧的错误立刻拒绝；
- 已就绪的地图遇到「0×0 → 恢复非零尺寸」会**补一次 `checkResize()`**（`enableAutoResize` 为
  `true` 时；关掉则完全手动）；
- 门禁的判据落在**建图之前的那一刻**，因此「SDK 还在加载时把容器收起」也不会在 0×0 上建图：
  那次挂载会等容器恢复可用再创建（`status` 停在 `creating`）；
- 在 `@error` 回调里**同步**调用 `retry()`（自动重试的常见写法）会真的排下一次重试，不会复用
  刚失败的那次任务。

### 尺寸变化的自动重设

容器尺寸变化 → 经内部 `FrameScheduler` **合帧** → 一帧最多下发一次 `checkResize()`：

- 默认开启（`enableAutoResize` 默认 `true`）；
- 传 `enableAutoResize: false` 时只更新读数，由调用方自己调暴露的 `checkResize()`
  （与旧版本的「保留字段」行为一致）。

### 暂停策略：按**原因**记账

`<BMap>` 与 `expose` 的 `suspend()` / `resume()` 不是「一个开关」，而是一组**暂停原因**。
只有原因集合**变空**才真正恢复（并补偿一次 `checkResize()`）：

| 原因 | 谁加 | 谁移除 | 说明 |
| --- | --- | --- | --- |
| `user` | `expose.suspend()`（默认原因） | 调用方 `resume()` | 业务主动暂停；与其他原因**互相独立**（别的原因怎么变都不会把它摘掉） |
| `disposed` | **只有库内部的 `dispose()`** | 不解除（终态） | 公开的 `suspend('disposed')` 会被拒绝并告警：它会把正常运行的地图永久锁死 |
| `keep-alive` | `<KeepAlive>` 停用（`onDeactivated`） | 重新激活 | 默认不销毁地图 |
| `document` | 页面 `visibilitychange → hidden` | 页面重新可见 | 后台标签页 |
| `offscreen` | 容器离开视口（含 64px 安全边） | 回到视口附近 | **不销毁地图** |

```ts
const api = mapRef.value!
api.suspend()                     // 等价于 suspend('user')
api.suspend('my-own-reason')      // 也可以用自己的原因字符串
api.suspendReasons()              // 当前生效的原因（诊断用）
api.resume()                      // 只摘掉 'user'；页面恢复可见不会顺手解除它
```

两条冻结语义：

1. **不误恢复**：页面恢复可见只移除 `document` —— 用户的手动暂停必须活着；
2. **暂停的可见效果**：容器尺寸变化不触发 `checkResize`、合帧任务不提交（保留每个 key 的最后一次），
   恢复时**补偿一次** `checkResize()`（后台 / 视口外发生的尺寸变化没有下发过命令）。

### 减少动画偏好

`expose.prefersReducedMotion()` 暴露 `(prefers-reduced-motion: reduce)` 的当前取值，供**可选动画**
决定要不要跳过。它**不参与暂停**、也不阻断任何必要的数据更新；`<BMap>` 自身没有可选动画
（首次视野一直是 `noAnimation`），所以它是暴露给调用方的只读信号。

## 受控 / 非受控视野

`center` / `zoom` / `heading` / `tilt` 是**受控 / 非受控双模**字段，来源优先级固定为
**受控值 > `default*` 初值 > 库默认视野**。

### 状态表

| 传入的 prop | 模式 | 生效值 | 用户交互（拖拽 / 缩放 / 旋转 / 倾斜） | `default*` 后续变化 | 受控值后续变化 |
| --- | --- | --- | --- | --- | --- |
| `center` | 受控 | 外部值 | 回写内部状态 + `update:center` | 不适用 | 与地图当前值不一致时 `setCenter` |
| `defaultCenter` | 非受控 | 内部状态（初值 = `defaultCenter`） | 回写内部状态 + `update:center` | **不生效**（告警一次） | 不适用 |
| 都不传 | 缺省 | 内部状态（初值 = 库默认视野） | 回写内部状态 + `update:center` | 不适用 | 不适用 |

`zoom` / `heading` / `tilt` 的规则与上表逐字相同，把 `center` 换成对应字段名即可。

库默认视野：`center` = `{ lng: 116.403901, lat: 39.915185 }`、`zoom` = `14`、
`heading` = `0`、`tilt` = `0`（与 v2/v3 的 props 默认值一致，**只在首次创建视野时**应用一次）。

### v-model 用法

```vue
<template>
  <BMap
    ak="百度地图ak"
    v-model:center="center"
    v-model:zoom="zoom"
    v-model:heading="heading"
    v-model:tilt="tilt"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

const center = ref({ lng: 116.404, lat: 39.915 })
const zoom = ref(14)
const heading = ref(0)
const tilt = ref(0)
</script>
```

只想给初值、不想自己维护状态时，用非受控写法：

```vue
<BMap ak="百度地图ak" :default-center="{ lng: 121.424333, lat: 31.228604 }" :default-zoom="12" />
```

用户交互后仍能拿到回执（非受控模式同样会 emit）：

```vue
<BMap ak="百度地图ak" :default-zoom="12" @update:zoom="(z) => console.log(z)" />
```

### 事件

| 事件 | 触发时机 | 载荷 |
| --- | --- | --- |
| `update:center` | `moveend`（拖拽 / 惯性移动结束） | `{ lng: number, lat: number }` |
| `update:zoom` | `zoomend` | `number` |
| `update:heading` | `headingchange` | `number`（环绕角，可能为负值，如 `-90` 等价于 `270`） |
| `update:tilt` | `tiltchange` | `number` |

**视野回写**只订阅**结束**事件（不订阅 `moving` / `zooming`）：逐帧回写会让父级每帧重渲染，并与受控写入来回打架。
需要 `moving` / `zooming` 这类中途事件时用 map 事件（`@moving` / `@zooming`）或
[`useMapStatus`](../hooks/useMapStatus) 的 `moving` / `zooming` 标志——它们与回写是两条独立的订阅。

### 三条规则（发布后不易修改，改前请先读 ADR）

1. **`default*` 只在首次解析时读一次。** 之后它的变化不会覆盖当前状态——否则「用户拖到 A，
   父级重算 default 得到 B」会把用户操作静默吃掉。**任何**后续写入（值改变、从无到有、从有到无）
   都会有一条告警（每字段至多一次）。
2. **模式按「当前受控值是否存在」实时判定，不冻结在首次解析。** 所以
   `:center="loaded ? spot : undefined"` 这种「异步加载完成后才开始受控」的用法是支持的
   （加载窗口内的变化不丢，见下节）。
3. **模式切换只告警、不拒绝。** 非受控 → 受控且外部值与当前内部状态冲突时告警一次；
   受控 → 非受控时内部状态接管（保留最后一次外部值）并告警一次。
   父级把 `update:*` 的值原样写回（`v-model` 的正常闭环）**不会**告警。

### 初次视野与「加载期间到达的受控值」

视野在**地图创建时**一次性设定（SDK 的 `centerAndZoom` + `setHeading` / `setTilt`），此后
不再重跑初始化路径。SDK 就绪之后、`ready` / `initd` 事件之前，组件会把**当前生效值**
（受控时是外部值，非受控时是内部状态）收敛一次——因此「SDK 还在加载时父级就改了 `center`」，
乃至「加载途中在受控与非受控之间切换过」都不会丢：

```vue
<template>
  <BMap ak="百度地图ak" :center="loaded ? spot : undefined" :zoom="loaded ? 16 : undefined" />
</template>
```

收敛走的是字段级命令（`setCenter` / `setZoom` / …），**不是**重跑 `centerAndZoom`，所以
`zoom` 不会被 center 的写入重置，初始化也仍然只发生一次；每个字段在这一步**至多写一条命令**
（与首次快照相同的字段直接跳过）。

### resetView()

组件通过 `defineExpose` 暴露 `resetView()`：把地图视野移回
**首次快照**，并**同时把四个状态重置**到该快照。后者不是可有可无的——非受控档下内部状态就是
事实源，只重置地图会让两者分叉：用户再拖回「重置前的那个值」时会被判成「没变化」而不 emit，
那次真实操作就丢了。

因此冻结一条语义：**重置之后如果受控值被移除（受控 → 非受控），接管的是重置值**（而不是重置前的
外部值），地图不会被拉回重置前的位置。

::: tip 告警只在开发环境输出
「`default*` 失效」「模式切换」这几条告警读 `process.env.NODE_ENV`，**判定留给消费方的构建 /
运行时**：打包器会把它折叠成字面量，Node / SSR 下它是真实环境变量。所以自己的 dev server 里能
看到、生产构建里会被消除。`<script>` 直引的 `index.global.js` 固定按生产处理（浏览器里没有
`process`），看不到这几条提示。
:::

::: tip props 请用「换引用」的方式更新
`center` 是对象：原地改 `spot.lng = 121` **不会**被当成 prop 变化（Vue 的常规语义），
组件也不会据此写 SDK。要移动地图请换一个新对象（或整体替换 `ref`）。
组件内部对传进来的点做了防御性拷贝，所以原地改也不会污染内部状态与 `resetView()` 的首次快照。
:::

### 不做什么

- **不做「用户交互后强制回退到受控值」。** 受控的含义是「外部变化驱动地图」，不是「地图必须
  随时等于外部值」。回退需要在中途事件上持续写回，会与用户手势打架、在松手回弹时抖动。
  代价是：**父级收到 `update:*` 却不更新自己的状态时，地图会停在用户操作后的位置**，直到
  父级下次改变该 prop。官方参考实现 `huiyan-fe/react-bmap` 同样如此。
- **不做 deep watch。** `center` 按 `lng` / `lat` 两个标量做字段级比较，父级传内联对象字面量
  不会让受控写入空跑。
- **后续 `center` 变化不调用 `centerAndZoom`。** 初始化用 `centerAndZoom`（一次），后续只用
  `setCenter` / `setZoom` / `setHeading` / `setTilt`，避免「改中心点顺手把 zoom 重置掉」。

### 相等判定与浮点抖动

受控写入前会**读回地图当前值**再做容差判等，因此「相同值不同引用」「父级回写同一值」
「SDK 读回带 ±1e-9 抖动」都不会产生多余的 SDK 命令。容差见
`packages/baidu-map-gl-vue/src/core/utils/equality.ts`：

| 字段 | 判定 | 容差 |
| --- | --- | --- |
| `center` | 逐坐标容差比较（字符串按整串比较，跨形态永不相等） | `1e-7` 度 |
| `zoom` | 数值容差比较 | `1e-6` |
| `heading` | **按 360 环绕**取最小差（`-90` ≡ `270`） | `0.01` 度 |
| `tilt` | 数值容差比较（0..90 无环绕语义） | `0.01` 度 |

`heading` 的环绕判定不是可选优化：JSAPI 4.0 的 `setHeading(270)` 之后 `getHeading()` 返回
`-90`，线性判等会让每次自身写入都产生一条假的 `update:heading`。

::: tip 字符串中心点的读回限制

`getCenter()` 只给出坐标点，而字符串 `center` 要么是城市名、要么需要地理编码，因此**字符串形态
无法**做读回判等：每次字符串值变化都会下发一次 `setCenter`（这符合「不假支持」——我们并不知道
自己是否已经在那座城市）。点形态不受影响。

:::

## v3 行为说明

### 地图初始化与更新

- 视野（`center` / `zoom` / `heading` / `tilt`）在**地图首次创建时一次应用**（SDK 的
  `centerAndZoom` + `setHeading` / `setTilt`），此后不再重跑初始化路径。
- 地图创建完成后，单独更新 `center` 只调用 `setCenter`，不会重置当前 `zoom`；
  单独更新 `zoom` 只调用 `setZoom`。
- 受控写入前会读回地图当前值做容差判等（见上文「相等判定与浮点抖动」），一致时不下命令；
  读不到（地图已销毁 / 该能力不可用）时不下命令，其它读回错误照常抛出。
- SDK 就绪前到达的受控值会在 `ready` 之前按当前 props 收敛一次（见「加载期间到达的受控值」）。
- `heading` 和 `tilt` 是否生效取决于 SDK 能力（JSAPI 4.0 原生支持）。

### ready 与插件事件

`ready` 表示 SDK client 和地图实例已经创建完成，可以创建普通覆盖物。`plugins` 的加载不会阻塞 `ready`。

### KeepAlive

地图组件在 `deactivated` 时默认**不销毁** WebGL 地图（`keepAliveBehavior="suspend"`），仅暂停高频计算；
`activated` 时自动恢复并**补偿一次** `checkResize()`（只补偿一次：组件层不再重复下发，见
[ADR](/adr/2026-09-14-map-handle-container-and-visibility) 决策 5）。

设为 `"dispose"` 时，`deactivated` 会**销毁地图并一并释放容器观察器**（Resize /
Intersection、页面前后台与减少动画偏好的监听都挂在地图实例的资源作用域上）—— 组件在
`<KeepAlive>` 的 cache 里仍活着，但地图相关资源已经归零；`activated` 不会复活它（需要重新挂载）。

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

`<BMap ref>` 拿到的是一份**冻结的命令面**（类型 `BMapExpose`）。它只包含常用能力，不是
`BMap.Map` 方法表的镜像 —— 要别的能力先问 `supports()`，要 raw SDK 对象走 `./advanced`。

### 常用命令

| 方法 | 说明 | 类型 |
| --- | --- | --- |
| `getCenter()` | 读当前中心点（读不到给 `null`） | `() => { lng, lat } \| null` |
| `setCenter(center)` | 设置中心点（不含 zoom，不会重置级别） | `(center: { lng, lat }) => void` |
| `getZoom()` / `setZoom(zoom)` | 缩放级别读写 | `() => number \| null` / `(zoom: number) => void` |
| `getHeading()` / `setHeading(heading)` | 旋转角读写（环绕角） | `() => number \| null` / `(heading: number) => void` |
| `getTilt()` / `setTilt(tilt)` | 倾斜角读写（0..90） | `() => number \| null` / `(tilt: number) => void` |
| `getBounds()` | 读可视范围 | `() => Bounds \| null` |
| `getSize()` | 读地图尺寸 | `() => Size \| null` |
| `panTo(point)` / `panBy(pixel)` | 平移到点 / 按像素平移 | `(point: { lng, lat }) => void` / `(pixel: { x, y }) => void` |
| `fitBounds(bounds)` | 按范围适配视野 | `(bounds: Bounds) => void` |
| `supports(capability)` | 该能力在当前引擎上是否可用（读不到结论时为 `false`；Map 作用域的能力要等地图建好之后才可靠 —— 需要确定性时先 `await whenReady()`） | `(capability: Capability) => boolean` |

**未就绪时的契约**：读命令给 `null`、写命令是**空操作**（不排队、也不会在就绪后重放）。
需要确定性时先 `await whenReady()`。SDK 调用失败会照常抛出（不降级成 `null`）。

### 容器 / 生命周期 / 暂停

| 方法 | 说明 | 类型 |
| --- | --- | --- |
| `getContainer` | 获取地图容器 DOM | `() => HTMLElement \| null` |
| `isContainerReady` | 容器是否已拿到非零尺寸（门禁是否放行） | `() => boolean` |
| `checkResize` | 手动重设地图尺寸（与自动路径同一口径：暂停期间不下发） | `() => void` |
| `getMapInstance` | 获取 map 句柄（`MapHandle`，**非** raw SDK 地图） | `() => MapHandle \| null` |
| `whenReady` | 地图 ready 后 resolve；可传 `AbortSignal` 只取消本次等待 | `(signal?: AbortSignal) => Promise<MapReadyContext>` |
| `whenMapCreated` | 建图成功、初始化视野**之前**的挂载点（订阅 `load` 这类初始化期事件用） | `(cb) => () => void` |
| `isTearingDown` | 承载地图的组件是否已开始卸载 | `() => boolean` |
| `retry` | 重试加载：返回「这一次重试」的 Promise（并发共享同一次启动；容器不可用时保持 pending；已就绪时立刻 resolve 当前上下文） | `() => Promise<MapReadyContext>` |
| `suspend` / `resume` | 加 / 摘一个暂停原因（默认 `'user'`） | `(reason?: MapSuspendReason) => void` |
| `isSuspended` / `suspendReasons` | 当前是否暂停 / 生效的原因快照 | `() => boolean` / `() => readonly string[]` |
| `resetView` | 恢复首次初始化时的 center、zoom、heading 和 tilt（并同步重置四个内部状态） | `() => void` |
| `setDragging` | 设置地图是否可拖动 | `(enabled: boolean) => void` |
| `prefersReducedMotion` | 当前的「减少动画」偏好（只读信号，不参与暂停） | `() => boolean` |

`resetCenter` 在本版本**已移除**（它是「名字说重置中心、实现重置整个视野」的废弃别名），
请使用 `resetView()`。需要 raw SDK 地图时，用 `./advanced` 的 `unwrapRaw(mapInstance)` 获取。

## 状态插槽

加载与错误状态都有具名插槽，**业务不需要监听内部 Runtime**：

```vue
<BMap ak="百度地图ak">
  <template #loading="{ status, containerReady }">
    <p>{{ containerReady ? '地图加载中…' : '容器还没展开' }}</p>
  </template>
  <template #error="{ error, retry }">
    <p>加载失败：{{ error }}</p>
    <button @click="retry()">重试</button>
  </template>
</BMap>
```

两个插槽收到**同一份**载荷（`error` 是 `unknown`：通常是 `BMapError`，要读 `code` / `message`
请先自证形状，模板里直接插值最省事）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | `MapRuntimeStatus` | 运行时状态（`idle` / `loading` / `ready` / `error` …） |
| `error` | `unknown` | 结构化错误（`status === 'error'` 时非空；通常是 `BMapError`） |
| `containerReady` | `boolean` | 容器门禁是否放行（区分「容器还没展开」与「SDK 在加载」） |
| `retry` | `() => Promise<MapReadyContext>` | 重试加载（失败态下重新走一遍加载与建图；容器收起时保持 pending，容器恢复后由门禁接着执行） |

- `#loading` 在 `status !== 'ready'` **且** `status !== 'error'` 时渲染（自带文案见
  「自定义地图加载中」一节）—— 与原来一样，error 态走 `#error`；
- `#error` 在 `status === 'error'` 时渲染（自带文案带一个「重试」按钮）；
- **默认插槽的载荷不变**：`{ status, map, error, client }`。

## 组件事件

与地图无关的事件（就绪、插件、生命周期、视野 `v-model` 回写）：

| 事件名          | 说明                                                                                        | 类型                                     |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| ready           | 地图实例创建并完成初始配置后触发                                                            | `{ client, map, container }`             |
| initd           | `ready` 的兼容事件，建议迁移到 `ready`                                                      | `{ client, map, container }`             |
| unload          | 组件卸载时会触发此事件                                                                      | -                                        |
| plugin-ready    | 单个插件加载完成后触发（载荷为插件名字符串；v2 的 `@pluginReady` 已移除）                   | `name: string`                           |
| plugin-error    | 单个插件加载失败；不会改变已经 ready 的地图状态                                             | `{ name, error }`                        |
| error           | 地图创建失败时触发                                                                          | `BMapError`                              |
| update:center   | 用户交互后的中心点回写（`v-model:center`）                                                  | `{ lng, lat }`                           |
| update:zoom     | 用户交互后的缩放级别回写（`v-model:zoom`）                                                  | `number`                                 |
| update:heading  | 用户交互后的旋转角回写（`v-model:heading`）                                                 | `number`                                 |
| update:tilt     | 用户交互后的倾斜角回写（`v-model:tilt`）                                                    | `number`                                 |

**map 事件（43 个规范名 + 5 个 SDK 拼写兼容名）**——`click` / `moveend` / `maptypechange` /
`style-loaded` / `moving` 等全部可绑，完整清单与载荷字段见
见 [组件事件](../guide/com-events) 页的「BMap：map 事件」一节。两点行为约定：

- **订阅固定**：地图就绪时一次订全部 map 事件（不随改绑监听器变化，原因是 Vue 不会因 emit listener
  变化重渲染子组件，见 [组件事件](../guide/com-events) 的说明）；未绑定 handler 的事件不会触发任何回调。
- **高频合帧**：`mousemove` / `touchmove` / `dragging` / `moving` / `zooming` 一帧最多提交一次
  （取该帧最后一次的载荷），`mousewheel` 不合帧。
- **`.once` 可用**：`@click.once` 之类按 Vue 的语义只触发一次。

需要在 setup 里按条件订阅、或订阅「别处的地图」时，用
[`useMapEvent`](../hooks/useMapEvent)（订阅）与 [`useMapStatus`](../hooks/useMapStatus)（状态读数），
不必自己拼 `client.driver.events.on(...)`。

