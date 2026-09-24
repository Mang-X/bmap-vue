# useGeocoder <Badge type="tip" text="^0.0.39" />

通过地址解析坐标点

```ts
import { useGeocoder } from 'bmap-vue'
```

## 单个地址解析

使用地址字符串作为 `get` 方法参数解析单个地址
:::demo 通过下拉框切换地址解析坐标点
hooks/useGeocoder/index
:::

:::tip
在 Ts 中使用单个解析地址时，使用泛型 `Point` 内部可推断 `point` 为可推断为 `Point`，从而避免读取值时 ts 的报错。

```ts
import type { Point } from 'bmap-vue'
const { point } = useGeocoder(map)
```

:::

## 批量解析地址

使用地址字符串数组作为 `get` 方法参数批量解析地址
:::demo
hooks/useGeocoder/batch
:::

:::tip
在 Ts 中使用批量解析地址时，使用泛型 `Point[]` 内部可推断 `point` 为可推断为 `Point[]`，从而避免遍历时 ts 的报错。

```ts
import type { Point } from 'bmap-vue'
const { getBatch } = useGeocoder(map)
```

:::

## 用法

```ts
const { get, getBatch, point, isLoading, isEmpty } = useGeocoder(map)
```

:::tip
该 hooks 只需要 **Client 上下文**（`<Map>` 或 `<BMapProvider>` 子树内），**不需要地图实例**；
在 `<Map>` 子树内调用时可省略 `map` 参数
:::

::: warning AK 域名白名单
正向地址解析走百度服务端接口，受 AK 的 Referer 白名单限制：若当前页面域名不在白名单内，
接口将返回空结果（表现为 `isEmpty`，无错误抛出）。本地开发遇到空结果时，请先到百度地图
开放平台检查该 AK 的 Referer 白名单是否包含当前域名。
:::

### 参数

| 参数 | 描述                                         | 类型      | 默认值 |
| ---- | -------------------------------------------- | --------- | ------ |
| map  | `Map`地图组件实例或 `ref`（可省略，用注入值） | `unknown` | -      |

:::tip 状态与动作约定（#38 起）

- `status` 的取值与含义对六个 service hooks **完全一致**：
  `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported`；
  `empty` 是「没有结果**或**服务当前不可用」（官方没有公开原因时的合并结论），`unsupported`
  表示**当前引擎没有这个能力、一次请求都没有发出**（同时 `supported` 为 `false`）。
- **动作恒 resolve**：`Promise<ServiceResult<T>>`，不 reject；失败/超时/取消都在返回值里，
  与 `status` / `error` 同步。返回值里 `status === 'canceled'` 表示这次调用被更新的调用取代或被取消。
- `sdkStatus` 只有 SDK **公开给出状态码**的服务才有值（`Geolocation` / `LocalSearch` 的
  `BMAP_STATUS_*`、`Convertor` 回包 `status`），其余为 `null`——不伪装成 0。

:::

### 返回值

| 返回值    | 描述                                                                                        | 类型                                                              |
| --------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| data      | 解析结果（`point`/`location`/`result` 均为其别名）                                            | `Readonly<ShallowRef<GeoPoint \| null>>`                          |
| point     | 地址解析出来的坐标点                                                                         | `Readonly<ShallowRef<GeoPoint \| null>>`                          |
| error     | 有公开原因时的错误信息（`{ code, message }`）                                                | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`                  |
| sdkStatus | SDK 公开状态码；本服务没有公开错误码入口，**恒为 `null`**                                      | `Readonly<ShallowRef<number \| null>>`                            |
| isError   | 是否出错（`status === 'failed'`）                                                            | `boolean`                                                         |
| isEmpty   | 是否无解析结果（`data === null`，含 `empty` / 取消）                                          | `boolean`                                                         |
| isLoading | 是否在获取中                                                                                | `boolean`                                                         |
| supported | 当前引擎是否支持地理编码（Client 就绪后立即判定；在此之前是乐观初值 `true` = 尚未判定）                                             | `boolean`                                                         |
| status    | 任务状态（见上）                                                                             | `Readonly<ShallowRef<BMapServiceStatus>>`                          |
| get       | 地址 → 坐标点；`city` **可省略**（省略即不做城市限定）                                        | `(address: string, city?: string) => Promise<ServiceResult<GeoPoint>>` |
| getBatch  | 批量解析，逐项返回 `{ address, point, status, error }`（**部分成功**：单项失败不影响其它项）   | `(addresses: readonly string[], city?: string) => Promise<GeocodeItemResult[]>` |
| cancel    | 逻辑取消在飞请求（SDK 侧请求收不回，只承诺「放弃结果」）                                        | `() => void`                                                      |
| reset     | 取消 + 清空 data/error/status                                                                | `() => void`                                                      |

#### Point

```ts
type Point = { lng: number; lat: number }
```

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type { BMapServiceStatus, GeoPoint, ServiceErrorInfo, ServiceResult } from 'bmap-vue'

export interface GeocodeItemResult {
  address: string
  point: GeoPoint | null
  status: BMapServiceStatus
  error: ServiceErrorInfo | null
}

/**
 * 由地址解析坐标点
 */
export declare function useGeocoder(map?: unknown): {
  data: Readonly<ShallowRef<GeoPoint | null>>
  location: Readonly<ShallowRef<GeoPoint | null>>
  point: Readonly<ShallowRef<GeoPoint | null>>
  result: Readonly<ShallowRef<GeoPoint | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  get: (address: string, city?: string) => Promise<ServiceResult<GeoPoint>>
  getBatch: (addresses: readonly string[], city?: string) => Promise<GeocodeItemResult[]>
  cancel: () => void
  reset: () => void
}
```
