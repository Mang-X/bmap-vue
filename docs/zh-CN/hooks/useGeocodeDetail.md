# useGeocodeDetail

由坐标点解析地址信息

```ts
import { useGeocodeDetail } from '@mangax/bmap-vue'
```

## 单个坐标点解析

使用坐标点对象作为 `getLocation` 方法参数解析单个坐标点
:::demo 鼠标点击地图选择坐标点解析
hooks/useGeocodeDetail/index
:::

:::tip
`data` 为 `Readonly<ShallowRef<GeocodeDetailResult | null>>`，可直接解构使用：

```ts
import { useGeocodeDetail, type GeocodeDetailResult } from '@mangax/bmap-vue'
const { data } = useGeocodeDetail(map)
```

:::

## 批量解析坐标点

使用坐标点对象数组作为 `getBatch` 方法参数批量解析坐标点
:::demo
hooks/useGeocodeDetail/batch
:::

:::tip
批量解析使用 `getBatch`，**顺序执行**、逐项返回 `{ point, detail, status, error }`。
单项失败时 `detail` 为 `null`，原因从该项的 `status` / `error` 读（这就是「部分成功」的表达方式）：

```ts
import { useGeocodeDetail, type GeocodeDetailResult } from '@mangax/bmap-vue'
const { getBatch } = useGeocodeDetail(map)
```

:::

## 用法

```ts
const { getLocation, getBatch, data, isLoading, isEmpty } = useGeocodeDetail(map)
```

::: warning 命名对齐官方 `BMap.Geocoder`

- 动作名是 `getLocation`（官方 `Geocoder#getLocation`），**不是** `get`；
- 正地址解析在 [`useGeocoder`](./useGeocoder) 的 `getPoint`（官方 `Geocoder#getPoint`）
  ——官方的 `Geocoder` 只有这两个成员，本库按方向拆成两个 hook，成员名保持一致；
- 结果**只有** `data` 一个读取口。不要再找 `result` 别名（与 `useGeocoder` 同口径，
  也不与官方成员名相撞）。
:::

:::tip
该 hooks 只需要 **Client 上下文**（`<Map>` 或 `<BMapProvider>` 子树内），**不需要地图实例**；
在 `<Map>` 子树内调用时可省略 `map` 参数
:::

:::warning 官方 `LocationOptions`（`poiRadius` / `numPois`）未暴露
官方 `Geocoder#getLocation(point, callback, options?)` 的第三个参数是 `LocationOptions`：
`poiRadius`（附近 POI 的最大半径，默认 100 米）与 `numPois`（返回的 POI 个数，默认 10）。
本库的 `getLocation(point)` **不接收**它，因此 `surroundingPois` 拿到的是官方默认口径下的结果
（半径 100 米、最多 10 个）。要调这两个值，目前只能拿 Driver 的归一化调用面
（`driver.services.reverseGeocode()`）——它的请求类型上带这两个字段。
:::

::: warning AK 域名白名单
逆地址解析走百度服务端接口，受 AK 的 Referer 白名单限制：若当前页面域名不在白名单内，
接口将返回空结果（表现为 `isEmpty`，无错误抛出）。本地开发遇到空结果时，请先到百度地图
开放平台检查该 AK 的 Referer 白名单是否包含当前域名。
:::

### 参数

| 参数 | 描述                                         | 类型      | 默认值 |
| ---- | -------------------------------------------- | --------- | ------ |
| map  | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | -      |

:::tip 状态与动作约定

- `status` 的取值与含义对**所有服务 composable** **完全一致**：
  `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported`；
  `empty` 是「没有结果**或**服务当前不可用」（官方没有公开原因时的合并结论），`unsupported`
  表示**当前引擎没有这个能力、一次请求都没有发出**（同时 `supported` 为 `false`）。
- **动作恒 resolve**：`Promise<ServiceResult<T>>`，不 reject；失败/超时/取消都在返回值里，
  与 `status` / `error` 同步。返回值里 `status === 'canceled'` 表示这次调用被更新的调用取代或被取消。
- `sdkStatus` 只有 SDK **公开给出状态码**的服务才有值（`Geolocation` / `LocalSearch` 的
  `BMAP_STATUS_*`、`Convertor` 回包 `status`），其余为 `null`——不伪装成 0。

:::
### 返回值

| 返回值    | 描述                                                                        | 类型                                                                   |
| --------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| data      | 逆地址解析的结果（唯一读取口）                                              | `Readonly<ShallowRef<GeocodeDetailResult \| null>>`                     |
| error     | 有公开原因时的错误信息（`{ code, message }`）                                | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`                        |
| sdkStatus | SDK 公开状态码；本服务没有公开错误码入口，**恒为 `null`**                      | `Readonly<ShallowRef<number \| null>>`                                  |
| isError   | 是否出错（`status === 'failed'`）                                            | `boolean`                                                               |
| isEmpty   | 是否有解析结果（`data === null`，含 `empty` / 取消）                          | `boolean`                                                               |
| isLoading | 是否在获取中                                                                | `boolean`                                                               |
| supported | 当前引擎是否支持逆地理编码（Client 就绪前是乐观初值 `true` = 尚未判定）                                                   | `boolean`                                                               |
| status    | 任务状态（见上）                                                             | `Readonly<ShallowRef<BMapServiceStatus>>`                                |
| getLocation | 坐标 → 地址详情（官方 `Geocoder#getLocation`）；`point` 非法时以 `failed(BMAP_INVALID_ARGUMENT)` 结算 | `(point: GeoPoint) => Promise<ServiceResult<GeocodeDetailResult>>` |
| getBatch  | 批量反查，**顺序执行**、逐项返回 `{ point, detail, status, error }`（**部分成功**） | `(points: readonly GeoPoint[]) => Promise<GeocodeDetailItemResult[]>`  |
| cancel    | 逻辑取消在飞请求                                                             | `() => void`                                                             |
| reset     | 取消 + 清空 data/error/status                                                | `() => void`                                                             |

#### GeoPoint

```ts
type GeoPoint = { lng: number; lat: number }
```

#### GeocodeDetailResult

| 属性              | 描述                         | 类型                                    |
| ----------------- | ---------------------------- | --------------------------------------- |
| point             | 坐标点（回包没给时回退到请求坐标） | `GeoPoint`                            |
| address           | 地址描述                     | `string`                                |
| addressComponents | 结构化的地址描述             | [`AddressComponent`](#AddressComponent) |
| surroundingPois   | 附近的 POI 点（完整的领域投影，字段见 [`LocalSearchPoi`](./useLocalSearch)）。数量与半径走官方默认值（10 个 / 100 米），见上面的 `LocationOptions` 说明 | `readonly LocalSearchPoi[]` |
| business          | 商圈字段，代表此点所属的商圈 | `string`                                |

##### AddressComponent

| 属性         | 描述     | 类型     |
| ------------ | -------- | -------- |
| streetNumber | 门牌号码 | `string` |
| street       | 街道名称 | `string` |
| district     | 区县名称 | `string` |
| city         | 城市名称 | `string` |
| province     | 省份名称 | `string` |

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type {
  BMapServiceStatus,
  GeoPoint,
  LocalSearchPoi,
  ServiceErrorInfo,
  ServiceResult,
} from '@mangax/bmap-vue'
export interface GeocodeDetailResult {
  /**
   * 坐标点
   */
  point: GeoPoint
  /**
   * 地址描述
   */
  address: string
  /**
   * 结构化的地址描述
   */
  addressComponents: {
    city: string
    district: string
    province: string
    street: string
    streetNumber: string
  }
  /**
   * 附近的POI点（完整的领域投影）
   */
  surroundingPois: readonly LocalSearchPoi[]
  /**
   * 商圈字段，代表此点所属的商圈
   */
  business: string
}
export interface GeocodeDetailItemResult {
  point: GeoPoint
  detail: GeocodeDetailResult | null
  status: BMapServiceStatus
  error: ServiceErrorInfo | null
}
/**
 * 由坐标点反查地址详情
 */
export declare function useGeocodeDetail(map?: unknown): {
  /** 逆地址解析的唯一结果读取口（地址详情） */
  data: Readonly<ShallowRef<GeocodeDetailResult | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  /** 坐标 → 地址详情（官方 `Geocoder#getLocation`）。 */
  getLocation: (point: GeoPoint) => Promise<ServiceResult<GeocodeDetailResult>>
  getBatch: (points: readonly GeoPoint[]) => Promise<GeocodeDetailItemResult[]>
  cancel: () => void
  reset: () => void
}
```
