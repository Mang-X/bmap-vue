# useBMapConvertor 坐标点转换

用于将其他坐标系的坐标转换为百度坐标。

```ts
import { useBMapConvertor } from 'bmap-vue'
```

## 示例

:::demo 将谷歌坐标转换为百度坐标
hooks/useBMapConvertor
:::

## 用法

```ts
const { result, convert, isLoading, isError, status } = useBMapConvertor(map)
```

:::tip
该 hooks 只需要 **Client 上下文**（`<BMap>` 或 `<BMapProvider>` 子树内），**不需要地图实例**；
在 `<BMap>` 子树内调用时可省略 `map` 参数
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
  与 `status` / `error` 同步。

:::

### 返回值

| 返回值    | 描述                                                                       | 类型                                                                                                    |
| --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| data      | 目标坐标点数组（`result` 为其别名）                                        | `Readonly<ShallowRef<Point[] \| null>>`                                                                  |
| result    | 目标坐标点数组                                                             | `Readonly<ShallowRef<Point[] \| null>>`                                                                  |
| error     | 有公开原因时的错误信息（`{ code, message }`）                              | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`                                                         |
| sdkStatus | `Convertor#translate` 回包的公开状态码（`0` = 成功）                        | `Readonly<ShallowRef<number \| null>>`                                                                   |
| isError   | 是否出错（`status === 'failed'`）                                          | `boolean`                                                                                                 |
| isEmpty   | 结果是否为空（`data === null`）                                            | `boolean`                                                                                                 |
| isLoading | 是否加载中                                                                 | `boolean`                                                                                                 |
| supported | 当前引擎是否支持坐标转换（Client 就绪前是乐观初值 `true` = 尚未判定）                                                   | `boolean`                                                                                                 |
| status    | 任务状态（见上）                                                           | `Readonly<ShallowRef<BMapServiceStatus>>`                                                                  |
| convert   | 坐标互转；`points` 为空 / 坐标非法时以 `failed(BMAP_INVALID_ARGUMENT)` 结算 | `(points: readonly Point[], from: CoordinatesFromType, to: CoordinatesToType) => Promise<ServiceResult<Point[]>>` |
| get       | `convert` 别名                                                             | 同上                                                                                                      |
| cancel    | 逻辑取消在飞请求                                                           | `() => void`                                                                                              |
| reset     | 取消 + 清空 data/error/status                                              | `() => void`                                                                                              |

### CoordinatesFromType

原坐标类型

```ts
export enum CoordinatesFromType {
  /**
   *  WGS84坐标（GPS标准坐标）
   */
  'COORDINATES_WGS84' = 1,
  /**
   *  WGS84的平面墨卡托坐标（搜狗地图坐标）
   */
  'COORDINATES_WGS84_MC' = 2,
  /**
   * GCJ02坐标(火星坐标)，即高德地图、腾讯地图、谷歌坐标和MapABC等地图使用的坐标；
   */
  'COORDINATES_GCJ02' = 3,
  /**
   *  GCJ02的平面墨卡托坐标（火星坐标对应的墨卡托平面坐标）
   */
  'COORDINATES_GCJ02_MC' = 4,
  /**
   *  百度地图采用的经纬度坐标（bd09ll）
   */
  'COORDINATES_BD09' = 5,
  /**
   * 百度地图采用的墨卡托平面坐标（bd09mc）
   */
  'COORDINATES_BD09_MC' = 6,
  /**
   * 图吧地图坐标
   */
  'COORDINATES_MAPBAR' = 7,
  /**
   * 51地图坐标
   */
  'COORDINATES_51' = 8
}
```

### CoordinatesToType

目标坐标类型

```ts
export enum CoordinatesToType {
  /**
   * GCJ02坐标(火星坐标)，即高德地图、腾讯地图、谷歌坐标和MapABC等地图使用的坐标；
   */
  'COORDINATES_GCJ02' = 3,
  /**
   * 百度地图采用的经纬度坐标（bd09ll）
   */
  'COORDINATES_BD09' = 5,
  /**
   * 百度地图采用的墨卡托平面坐标（bd09mc）
   */
  'COORDINATES_BD09_MC' = 6
}
```

### UsePointConvertorStatus

:::warning 警告
当转换不被允许的坐标系，如：X→GPS，可能不会响应返回以下错误 code，会拒绝响应，浏览器直接报跨域请求
:::

| code | 描述                                                                       |
| ---- | -------------------------------------------------------------------------- |
| 0    | ok 正常 服务请求正常召回                                                   |
| 1    | 内部错误                                                                   |
| 4    | 转换失败 X→GPS 时必现，根据法律规定，不支持将任何类型的坐标转换为 GPS 坐标 |
| 21   | from 非法                                                                  |
| 22   | to 非法                                                                    |
| 24   | coords 格式非法                                                            |
| 25   | coords 个数非法，超过限制                                                  |
| 26   | 参数错误                                                                   |

## 代码示例

<!-- prettier-ignore -->
```html
<BMap @ready="handleReady"></BMap>

<script setup lang="ts">
  import { useBMapConvertor, CoordinatesFromType, CoordinatesToType } from 'bmap-vue'

  const { convert, result } = useBMapConvertor()

  async function handleReady() {
    await convert(
      [{ lng: 116.297611, lat: 40.047363 }],
      CoordinatesFromType.COORDINATES_GCJ02,
      CoordinatesToType.COORDINATES_BD09
    )
    console.log(result.value)
  }
</script>
```

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type { BMapServiceStatus, ServiceErrorInfo, ServiceResult } from 'bmap-vue'
/**
 * 地图经纬度点
 */
export declare type GeoPoint = {
  lng: number
  lat: number
}
/**
 * 坐标转换
 */
export declare function useBMapConvertor(map?: unknown): {
  data: Readonly<ShallowRef<GeoPoint[] | null>>
  result: Readonly<ShallowRef<GeoPoint[] | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  convert: (
    points: readonly GeoPoint[],
    from: CoordinatesFromType,
    to: CoordinatesToType
  ) => Promise<ServiceResult<GeoPoint[]>>
  get: (
    points: readonly GeoPoint[],
    from: CoordinatesFromType,
    to: CoordinatesToType
  ) => Promise<ServiceResult<GeoPoint[]>>
  cancel: () => void
  reset: () => void
}
```
