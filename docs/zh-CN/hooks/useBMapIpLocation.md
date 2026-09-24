# useBMapIpLocation <Badge type="tip" text="^0.0.33" />

用于获取用户所在的城市位置信息。(根据用户 IP 自动定位到城市)

```ts
import { useBMapIpLocation } from 'bmap-vue'
```

## 示例

:::demo
hooks/useBMapIpLocation
:::

## 用法

```ts
const { get, location, isLoading } = useBMapIpLocation(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行定位；在 `<BMap>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                 | 类型                                | 默认值 |
| ---- | -------------------- | ----------------------------------- | ------ |
| map  | 地图组件 ref，用于等待地图 SDK 初始化（可省略，用注入值） | `unknown` | - |

### 返回值

:::tip 状态与动作约定（#38 起）

- `status` 的取值与含义对六个 service hooks **完全一致**：
  `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported`；
  `empty` 是「没有结果**或**服务当前不可用」（官方没有公开原因时的合并结论），`unsupported`
  表示**当前引擎没有这个能力、一次请求都没有发出**（同时 `supported` 为 `false`）。
- **动作恒 resolve**：`Promise<ServiceResult<T>>`，不 reject；失败/超时/取消都在返回值里，
  与 `status` / `error` 同步。

:::

| 返回值    | 描述                                                                 | 类型 |
| --------- | -------------------------------------------------------------------- | ---- |
| data      | 定位信息，初始为 `null`（`location`/`result` 为其别名）                | `Readonly<ShallowRef<BMapIpLocationResult \| null>>` |
| location  | 定位信息，初始为 `null`                                              | `Readonly<ShallowRef<BMapIpLocationResult \| null>>` |
| error     | 有公开原因时的错误信息（`{ code, message }`）                         | `Readonly<ShallowRef<ServiceErrorInfo \| null>>` |
| sdkStatus | `LocalCity` 没有公开状态码入口，**恒为 `null`**                        | `Readonly<ShallowRef<number \| null>>` |
| isError   | 是否出错（`status === 'failed'`）                                     | `boolean` |
| isEmpty   | 结果是否为空（`data === null`，含 `empty`）                            | `boolean` |
| isLoading | 是否在获取中                                                          | `boolean` |
| supported | 当前引擎是否支持 IP 定位（Client 就绪前是乐观初值 `true` = 尚未判定）                                              | `boolean` |
| status    | 任务状态（见上）                                                      | `Readonly<ShallowRef<BMapServiceStatus>>` |
| get       | 获取定位                                                              | `() => Promise<ServiceResult<BMapIpLocationResult>>` |
| cancel    | 逻辑取消在飞请求                                                      | `() => void` |
| reset     | 取消 + 清空 data/error/status                                         | `() => void` |

:::warning #38 起的类型变化：`code` 已被移除，新增 `level`

旧版结果里的 `code` **不在官方 `LocalCityResult` 的声明里**，且旧实现用 `code ?? 0`
把「没有这个字段」伪造成了 `0`。本库只依据官方声明投影，因此结果现在是：

| 属性  | 描述                                                       | 类型                              |
| ----- | ---------------------------------------------------------- | --------------------------------- |
| name  | 城市名                                                     | `string`                          |
| point | 城市中心点；SDK 未给出时为 `null`（不再伪造 `{0,0}`）        | `{ lng: number; lat: number } \| null` |
| level | 城市层级（官方默认给 5）                                    | `number \| null`                  |

需要旧版那个未声明字段时，走 `./advanced` 的 `unwrapRaw()` 取 raw 实例。

:::

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type { BMapServiceStatus, PointLike, ServiceErrorInfo, ServiceResult } from 'bmap-vue'
interface BMapIpLocationResult {
  name: string
  /** SDK 未给出时为 null（不伪造 0/0） */
  point: PointLike | null
  /** 官方 LocalCityResult.level */
  level: number | null
}
/**
 * ip定位
 */
export declare function useBMapIpLocation(map?: unknown): {
  location: Readonly<ShallowRef<BMapIpLocationResult | null>>
  data: Readonly<ShallowRef<BMapIpLocationResult | null>>
  result: Readonly<ShallowRef<BMapIpLocationResult | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  get: () => Promise<ServiceResult<BMapIpLocationResult>>
  cancel: () => void
  reset: () => void
}
```
