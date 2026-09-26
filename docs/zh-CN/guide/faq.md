# FAQ

## 支持 Vue 2 吗

不支持。本库基于 Vue 3 的 Composition API 编写，需要 `vue ^3.5.0`。
Vue 2 请用 [@baidumap/vue-bmap](https://github.com/baidumap/vue-bmap)——
那是面向 Vue 2 的官方绑定。两者关系见[与官方库的关系](./comparison)。

## 地图不显示 / 空白

按这个顺序排查：

1. **`ak` 对不对**。最常见的原因是 `ak` 没配、或配在了错误的作用域（域名 / IP 白名单）。
2. **容器有没有尺寸**。地图在容器拿到**非零尺寸**之前不会创建。如果 `<Map>` 在折叠面板、
   未展开的 Tab 或 `display:none` 的父元素里，地图会停在 `idle`。
   给容器固定高度，或等展开后再渲染。
3. **看 `status` 与错误码**。`<Map>` 的 `error` 插槽会拿到 `error` 与 `retry`，
   错误码含义见[错误码与排障](./errors)。
4. **控制台有没有 CSP / 网络拦截**。SDK 是运行时注入的脚本，CSP 策略没放行会静默失败。

## 报 `getMapInstance` 之类的方法不存在

本库**不**把 SDK 实例方法透出到组件上。请用组件 `ref` 暴露的命令面：

```vue
<Map ref="mapRef" :ak="ak" />
```

```ts
const mapRef = useTemplateRef<InstanceType<typeof Map>>('mapRef')
mapRef.value?.panTo({ lng: 116.4, lat: 39.9 })
```

命令面是**只读**的，不承诺与 SDK 实例同形。需要 raw 实例时用
[`bmap-vue/advanced`](./advanced) 的 `unwrapRaw()`，注意那条路径形状由 SDK 决定。

## 服务请求「发出去了但没反应」

服务 composable 的状态口径见 [Headless 服务](./services)。两个容易混淆的：

- `unsupported` = **一次请求都没发出**（当前环境没有这个能力），重试没有意义。
- `failed` = 请求发了但失败，看 `error.message`；`timeout` = 适配器超时。

`empty` 也不等于失败：它是「问了但没结果」，用 `pois.length` / `total` 判断。

## 同一张地图上多次搜索，回包对不上

不会。本库不按到达顺序猜归属：独占档的 composable 用「一个实例一个未结算操作」
+ 取代即换新实例，旧的迟到回包只会落到它自己那个旧实例上。
代价是取代之后会多建一个 SDK 实例。详见
[useLocalSearch](/zh-CN/hooks/useLocalSearch) 的「请求归属与并发」。

## 大数据量卡顿

覆盖物是**每个实例一个 SDK 对象**，一万个点就是一万个对象。上千个点请换
[原生批量图层](/zh-CN/components/layer/native-visual-layers) 或
[数据组件](/zh-CN/components/data)，它们整批渲染在 SDK 内部。

数据数组用 `shallowRef` / `markRaw` 避免进深响应；原地改内容要递增 `dataVersion`。
细节见[数据组件](/zh-CN/components/data)。

## 服务端渲染报错 / `window is not defined`

SDK 只在客户端加载，本库不会在模块顶层访问 `window` / `document`。
如果你在 SSR 项目里遇到这类报错，检查是不是静态引入了
`bmap-vue/ui-kit`（官方 UI Kit 在 import 时就碰 `document`）——它必须动态 import。
详见[服务端渲染与生命周期](./ssr)。

## `timeout` 设成 0 会立刻超时吗

不会，`0` 表示**不超时**。`timeout` 是官方支持的参数，语义按官方：

```ts
createBMapPlugin({ ak, defaults: { timeout: 0 } }) // 永不超时
```

## 为什么没有 `usePoint`

`Point` 是纯数据（`{ lng, lat }`），不需要 SDK 实例：

```ts
import type { Point } from 'bmap-vue'
const p: Point = { lng: 116.297611, lat: 40.047363 }
```

需要转成 SDK 实例时（例如传给第三方插件），用
`client.driver.geometry.toRawPoint(point)`。

## 还有别的问题

先看[错误码与排障](./errors)（本库的错误码是稳定标识，可以直接搜 issue），
没有的话去 [Discussions](https://github.com/Mang-X/bmap-vue/discussions) 问。
