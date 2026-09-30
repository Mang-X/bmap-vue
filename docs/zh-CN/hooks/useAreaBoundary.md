# useAreaBoundary

通过该 hooks 可获取行政区域的边界。

```ts
import { useAreaBoundary } from 'bmap-vue'
```

:::warning 上游 4.0 已把 `Boundary` 标记为废弃
官方类型包给 `BMap.Boundary` 的类注释写明「**4.0 已废弃，请使用 `DistrictLayer` 代替**」。本库仍然
暴露 `useAreaBoundary`，因为「查边界点串」这条能力在官方还没有等价替代品（`DistrictLayer` 是图层，
拿不到点串）。要的是「行政区划图层」而不是点串时，用 [`DistrictLayer`](/zh-CN/components/layer/district-layer)。
:::

:::tip 官方 `Boundary#parsebdStr` 未暴露
官方 `Boundary` 上还有 `parsebdStr(str, callback)`（解析已拿到的混淆点串）。本库**不暴露**它：
`get()` 的回包已经是解析后的结果，点串是你**这次查询的输入**而不是资产，单独再暴露一个解析入口
只会多一条没有消费者的路径。需要解析手上已有的点串时，走 Driver 的归一化调用面。
:::

## 示例

:::demo 结合 [`Polygon`](../components/overlay/polygon) 组件获取行政区域边界
overlay/polygon/boundaries
:::

## 用法

```ts
const { isLoading, boundaries, get } = useAreaBoundary(map)
```

:::tip
该 hooks 需要地图 ready 后才能执行查询；在 `<Map>` 子树内调用时可省略 `map` 参数
:::

### 参数

| 参数 | 描述                         | 类型                             | 默认值 |
| ---- | ---------------------------- | -------------------------------- | ------ |
| map  | 地图组件 ref，用于等待地图 SDK 初始化（可省略，用注入值） | `unknown` | - |

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

| 返回值     | 描述                                                                     | 类型                                                          |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| boundaries | 区域边界数据（**官方点串**，可直接喂给 `isBoundary` 的覆盖物），取不到时为空数组 | `ComputedRef<string[]>`                                       |
| data       | 同一份数据的 `null | string[]` 形态（`boundaries` 是它的空数组兜底）      | `Readonly<ShallowRef<string[] \| null>>`                      |
| error      | 有公开原因时的错误信息（`{ code, message }`）                            | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`              |
| sdkStatus  | `Boundary#get` 没有公开状态码入口，**恒为 `null`**                        | `Readonly<ShallowRef<number \| null>>`                        |
| isError    | 是否出错（`status === 'failed'`）                                        | `boolean`                                                     |
| isEmpty    | 是否无结果（`data === null`）                                             | `boolean`                                                     |
| isLoading  | 是否加载中                                                               | `boolean`                                                     |
| supported  | 当前引擎是否支持行政区边界                                                | `boolean`                                                     |
| status     | 任务状态（见上）                                                         | `Readonly<ShallowRef<BMapServiceStatus>>`                      |
| get        | 获取指定区域边界                                                         | `(area: string) => Promise<ServiceResult<string[]>>`           |
| cancel     | 逻辑取消在飞请求                                                         | `() => void`                                                   |
| reset      | 取消 + 清空 data/error/status                                            | `() => void`                                                   |

:::tip 需要解析后的坐标环？

`boundaries` 保持「官方点串」形态是为了兼容 `isBoundary` 的覆盖物。需要坐标环时，用
Driver 的归一化调用面（`driver.services.queryBoundary()`）——它的载荷里 `raw`（点串）与
`rings`（解析后的坐标环）**两者都有**。

:::

:::tip 查不到时是 `empty` 还是 `failed`
官方 `Boundary#get` 失败时回调参数是 `null`，**没有**公开的错误码入口。因此本库把「没查到」与
「服务当前不可用」合并结算成 `empty`，`sdkStatus` 恒为 `null`——想让 UI 区分「重试有用」与
「重试没用」，请用 `status`，不要拿 `sdkStatus` 判断。
:::

## 代码示例

<!-- prettier-ignore -->
```html
<Map ref="map" @ready="handleInitd"></Map>

<script setup lang="ts">
  import { ref } from 'vue'
  import { useAreaBoundary } from 'bmap-vue'

  const map = ref()
  const { isLoading, boundaries, get } = useAreaBoundary(map)

  function handleInitd() {
    get('北京市')
  }
</script>
```

## TS 类型定义参考

```ts
import type { ComputedRef, ShallowRef } from 'vue'
import type { BMapServiceStatus, ServiceErrorInfo, ServiceResult } from 'bmap-vue'
export declare type AreaBoundary = string[]
/**
 * 获取地图区域边界
 */
export declare function useAreaBoundary(map?: unknown): {
  boundaries: ComputedRef<AreaBoundary>
  data: Readonly<ShallowRef<AreaBoundary | null>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  /**
   * 获取指定区域边界
   * @example get('北京市')
   */
  get: (area: string) => Promise<ServiceResult<AreaBoundary>>
  cancel: () => void
  reset: () => void
}
```
