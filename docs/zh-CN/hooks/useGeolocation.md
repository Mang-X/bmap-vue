# useGeolocation

用于通过百度地图 SDK 获取用户所在的位置信息，相比 [IP 定位](./useIpLocation)获取的信息更丰富，但稳定性受浏览器权限和网络环境影响。

```ts
import { useGeolocation } from 'bmap-vue'
```

:::warning 注意

1. 由于 Chrome、iOS10 以上系统等已不再支持非安全域的浏览器定位请求，为保证定位成功率和精度，请尽快升级您的站点到 HTTPS。
2. iOS15 系统浏览器默认关闭位置请求，需要用户设置手机为允许/询问后方可获取精确的定位，定位权限的开启方式请参见 iOS15 定位问题。
  3. 由于浏览器原生定位成功率并不高，可以尝试 [IP 定位](./useIpLocation)和[安卓 SDK 定位](https://lbsyun.baidu.com/index.php?title=android-locsdk/guide/addition-func/assistant-h5)进行辅助，如果定位精准在城市级别，可联系百度地图提供 ak 以提高定位精准度。

:::

## 示例

:::demo
hooks/useGeolocation
:::

## 用法

```ts
const { locate, location, isLoading, isError, status } = useGeolocation(options, map)
```

:::tip
该 hooks 需要地图 ready 后才能执行定位；在 `<Map>` 子树内调用时可省略 `map` 参数；`locate` 与 `get` 为同一方法
:::

### 参数

| 参数    | 描述                 | 类型                                                      | 默认值 |
| ------- | -------------------- | --------------------------------------------------------- | ------ |
| options | 浏览器定位配置项     | [`UseBrowserLocationOptions`](#usebrowserlocationoptions) | -      |
| map     | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | - |

#### UseBrowserLocationOptions

| 属性               | 描述                                                                                                                                                     | 类型      | 默认值    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------- |
| enableSDKLocation  | 是否启用安卓定位 SDK 辅助定位，适用于安卓 WebView 页面，[详见](https://lbsyun.baidu.com/index.php?title=android-locsdk/guide/addition-func/assistant-h5) | `boolean` | `false`   |
| enableHighAccuracy | 是否要求浏览器获取最佳效果，同[浏览器定位](https://developer.mozilla.org/zh-CN-CN/docs/Web/API/Geolocation/getCurrentPosition)接口参数                   | `boolean` | `false`   |
| timeout            | 超时时间                                                                                                                                                 | `number`  | `10000`   |
| maximumAge         | 允许返回指定事件内的缓存结果，单位为毫秒。如果为`0`，则每次请求都获取最新的定位结果。默认为`10`分钟                                                      | `number`  | `600,000` |

### 返回值

:::tip 状态与动作约定（#38 起）

- `status` 的取值与含义对六个 service hooks **完全一致**：
  `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported`；
  `empty` 是「没有结果**或**服务当前不可用」（官方没有公开原因时的合并结论），`unsupported`
  表示**当前引擎没有这个能力、一次请求都没有发出**（同时 `supported` 为 `false`）。
- **动作恒 resolve**：`Promise<ServiceResult<T>>`，不 reject；失败/超时/取消都在返回值里，
  与 `status` / `error` 同步。
- `Geolocation` **公开带状态码**（`getStatus()` → `BMAP_STATUS_*`）：失败时 `status` 是 `failed`，
  `error.code` 与 `sdkStatus` 都是官方那个码。

:::

### 返回值

| 返回值    | 描述                                                                     | 类型                                                    |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| data      | 定位结果（`location` 为其别名）                                          | `Readonly<ShallowRef<BMapGeoResult \| null>>`            |
| location  | 定位信息                                                                 | [`Readonly<ShallowRef<BMapGeoResult \| null>>`](#location) |
| error     | 有公开原因时的错误信息（`{ code, message }`）                            | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`         |
| sdkStatus | 官方 `BMAP_STATUS_*` 状态码（成功为 `0`，失败带上失败码）                  | `Readonly<ShallowRef<number \| null>>`                   |
| isError   | 是否定位出错（`status === 'failed'`）                                     | `boolean`                                                |
| isEmpty   | 是否无结果（`data === null`）                                             | `boolean`                                                |
| isLoading | 是否在获取中                                                             | `boolean`                                                |
| supported | 当前引擎是否支持定位（Client 就绪前是乐观初值 `true` = 尚未判定）                                                     | `boolean`                                                |
| status    | 任务状态（见上）                                                         | `Readonly<ShallowRef<BMapServiceStatus>>`                 |
| locate    | 获取定位；**需要 Client 上下文**（`<Map>` 或 `<BMapProvider>` 子树内）    | `() => Promise<ServiceResult<BMapGeoResult>>`             |
| get       | `locate` 别名                                                            | 同上                                                     |
| cancel    | 逻辑取消在飞请求                                                         | `() => void`                                             |
| reset     | 取消 + 清空 data/error/status                                            | `() => void`                                             |

#### Location

| 属性      | 描述       | 类型                          |
| --------- | ---------- | ----------------------------- |
| accuracy  | 定位精度（SDK 未给出时为 `null`） | `number \| null`        |
| point     | 经纬度点   | `{ lng: number; lat: number }` |
| address   | 定位地址   | [`Address`](#address)         |
| status    | SDK 状态（成功恒为 `BMAP_STATUS_SUCCESS`） | `'BMAP_STATUS_SUCCESS'` |
| source    | 数据来源（固定 `baidu-sdk`） | `string`                |
| timestamp | 定位时间戳 | `number`                      |

#### Address

| 属性          | 描述      | 类型     |
| ------------- | --------- | -------- |
| country       | 国家      | `string` |
| city          | 城市      | `string` |
| city_code     | 城市 code | `string` |
| district      | 行政区    | `string` |
| province      | 省份      | `string` |
| street        | 街道      | `string` |
| street_number | 城市 code | `string` |

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type { BMapServiceStatus, Point, ServiceErrorInfo, ServiceResult } from 'bmap-vue'

interface UseBrowserLocationOptions {
  /**
   * 是否开启SDK辅助定位，仅当使用环境为移动web混合开发，且开启了定位sdk辅助定位功能后生效
   */
  enableSDKLocation?: boolean
  /**
   * 是否要求浏览器获取最佳效果，同浏览器定位接口参数。默认为false
   */
  enableHighAccuracy?: boolean
  /**
   * 超时事件，单位为毫秒。默认为10秒
   */
  timeout?: number
  /**
   * 允许返回指定事件内的缓存结果，单位为毫秒。如果为0，则每次请求都获取最新的定位结果。默认为10分钟
   */
  maximumAge?: number
  /**
   * 是否开启SDK辅助定位
   */
  SDKLocation?: boolean
}
interface Location {
  point: Point
  accuracy: number | null
  address: GeolocationAddressInfo | null
  /** 成功时恒为 `BMAP_STATUS_SUCCESS` */
  status: 'BMAP_STATUS_SUCCESS'
  source: 'baidu-sdk'
  timestamp: number
}
export declare function useGeolocation(
  options?: UseBrowserLocationOptions,
  map?: unknown
): {
  data: Readonly<ShallowRef<Location | null>>
  location: Readonly<ShallowRef<Location | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  locate: () => Promise<ServiceResult<Location>>
  get: () => Promise<ServiceResult<Location>>
  cancel: () => void
  reset: () => void
}
```
