# useLocalSearch 本地检索

基于百度 `LocalSearch` 的 **headless** 本地检索：按关键字、按周边（中心点 + 半径）或按矩形范围检索
POI，并支持翻页与清空。

它**不提供任何 UI**（建议列表、搜索面板、详情面板属于官方 UI Kit，见
[Official-first 约定](../contributing/official-packages.md)）；结果是数据，画与不画由你决定。

```ts
import { useLocalSearch } from 'bmap-vue'
```

## 示例

:::demo 关键字检索 + 自己画点 + 翻页
hooks/useLocalSearch
:::

## 用法

```ts
const { data, status, sdkStatus, isLoading, supported, search, gotoPage, clear, cancel } =
  useLocalSearch(options)
```

:::tip

- 本 hooks 只需要 **Client 上下文**：`<Map>` 或 `<BMapProvider>` 子树内都可用，**不需要地图实例**；
- **要绘制官方结果**（地图标注 / 结果面板 / 自动视野）必须在 `renderOptions.map` 里显式传
  `MapHandle`（`<Map>` 的 `@ready` 或 `useMap().map`），不传就是纯 headless；
- 卸载时 hooks 会自动**取消在飞请求并释放 SDK 实例**（`disposeLocalSearch`）。

:::

### 参数

| 参数    | 描述             | 类型                                                                  | 默认值 |
| ------- | ---------------- | --------------------------------------------------------------------- | ------ |
| options | 构造期选项（见下） | `MaybeRefOrGetter<BMapLocalSearchOptions>`                            | `{}`   |

`options` 的每个字段都可以是 ref / getter。**只有下列字段变化才会重建 SDK 实例**（反复调用
`search()` 不会重建——实例本身是有状态的：结果与页码都存在它上面）：

| 字段          | 描述                                                                                     | 类型                                                       | 默认值 |
| ------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| location      | 检索区域：城市名字符串 / `{ lng, lat }` / `MapHandle`。不传时取当前 `<Map>` 的地图实例   | `MaybeRefOrGetter<string \| GeoPoint \| MapHandle \| undefined>` | -      |
| pageCapacity  | 每页容量（1-100，官方超出范围时重置为 10）                                                | `MaybeRefOrGetter<number \| undefined>`                    | `10`   |
| pageNum       | 起始页码（从 0 开始）                                                                     | `MaybeRefOrGetter<number \| undefined>`                    | `0`    |
| renderOptions | 绘制选项（见下）。不传 = 纯 headless                                                       | `MaybeRefOrGetter<BMapLocalSearchRenderOptions \| undefined>` | -      |

#### BMapLocalSearchRenderOptions

只透传官方声明的成员（其余字段会被忽略：接收后忽略属于假支持）。

| 字段              | 描述                                                          | 类型                                          | 默认值  |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------- | ------- |
| map               | 绘制目标：本库的 `MapHandle`（或它的 ref / getter）            | `MaybeRefOrGetter<MapHandle \| undefined>`    | -       |
| panel             | 结果列表容器（元素或 id）                                     | `string \| HTMLElement`                       | -       |
| selectFirstResult | 是否自动选中第一个结果                                        | `boolean`                                     | `false` |
| autoViewport      | 检索结束后是否自动调整地图视野                                | `boolean`                                     | `false` |
| viewportOptions   | 视野计算选项（`noAnimation` / `margins` / `zoomFactor`）       | `object`                                      | -       |

### 返回值

状态与错误语义**与其它服务 hooks 完全一致**（见[统一状态口径](#统一状态口径)）。

| 返回值        | 描述                                                                       | 类型                                                  |
| ------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- |
| data          | 每个关键字一份结果（单关键字 ⇒ 长度 1）                                     | `Readonly<ShallowRef<LocalSearchResult[] \| null>>`   |
| status        | 任务状态（见下）                                                            | `Readonly<ShallowRef<BMapServiceStatus>>`             |
| error         | 有公开原因时的错误信息（`{ code, message }`）                               | `Readonly<ShallowRef<ServiceErrorInfo \| null>>`      |
| sdkStatus     | SDK 公开的状态码（`BMAP_STATUS_*`；成功为 `0`，拿不到时为 `null`）           | `Readonly<ShallowRef<number \| null>>`                |
| isLoading     | 是否在检索中                                                                | `Readonly<ShallowRef<boolean>>`                       |
| supported     | 当前引擎是否支持本地检索（Client 就绪后立即判定，不需要先发一次请求）        | `Readonly<ShallowRef<boolean>>`                       |
| isError       | `status === 'failed'` 的别名                                                | `ComputedRef<boolean>`                                |
| isEmpty       | `data === null` 的别名（注意：失败、取消、`empty` 都是 `true`）              | `ComputedRef<boolean>`                                |
| search        | 关键字检索（支持多关键字数组，最多 10 个）                                  | `(keyword, option?) => Promise<ServiceResult<LocalSearchResult[]>>` |
| searchNearby  | 周边检索（中心点 + 半径，单位米）                                           | `(keyword, center, radius) => Promise<…>`             |
| searchInBounds | 范围检索（矩形 `{ southwest, northeast }`）                                | `(keyword, bounds) => Promise<…>`                     |
| gotoPage      | 翻页（页码从 0 开始）                                                       | `(page: number) => Promise<…>`                        |
| clear         | 清空结果：清掉地图上的标注 / 结果面板与本地状态（实现上是释放当前实例，下一次 `search()` 用新实例） | `() => void`                                          |
| cancel        | **逻辑取消**在飞请求（SDK 没有取消入口，只承诺「放弃结果」）；取消后该实例不再复用 | `() => void`                                          |
| reset         | 取消 + 清空 `data` / `error` / `status`                                     | `() => void`                                          |

#### 统一状态口径

`status` 的取值与含义（六个 service hooks 共用同一份口径）：

| 值            | 含义                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `idle`        | 尚未发起（或 `reset()` 之后）                                        |
| `loading`     | 请求在飞                                                             |
| `success`     | 拿到结果。**结果为空仍是 `success`**（用 `pois.length` / `total` 判断） |
| `empty`       | 没有结果**或**服务当前不可用（官方没有公开原因时的合并结论）          |
| `failed`      | 有公开原因：SDK 公开状态码 / 参数非法 / 前置条件不满足                |
| `timeout`     | 适配器超时（SDK 可能永不回调）                                        |
| `canceled`    | 逻辑取消                                                             |
| `unsupported` | 当前引擎没有这个能力：**一次请求都没有发出**（此时 `supported` 为 `false`） |

### 请求归属与并发（**同一实例同一时刻只处理一个检索**）

官方只承诺**单次多关键字检索内部**结果数组与关键字数组顺序一致，**没有**承诺多次请求之间的回调顺序；
`keyword` 也不是请求身份。因此本 hooks 不按到达顺序猜归属，而是靠**实例身份**：

| 场景 | 行为 |
| --- | --- |
| 新 `search*` 落在**已经有未结算检索**的实例上 | 取消旧检索、**释放旧实例**（公开的 `clearResults()`，顺带清掉它画出的标注），并为新检索建新实例 → 旧的迟到回包只会落到旧实例上 |
| `cancel()` 之后 | 实例被标记过期；**已经画出的结果保留可见**（`data` 也保留），下一次 `search*` 建新实例 |
| 超时（`status === 'timeout'`）之后 | 同上：超时不代表 SDK 侧请求消失，实例不再复用 |
| 在「上一次还没结算 / 实例已过期」时 `gotoPage()` | **直接以 `failed` 拒绝**（说明见 `error.message`），不落到 SDK、也不空转到超时 |
| `clear()` | 释放当前实例（→ 公开的 `clearResults()`）+ 清空本地状态；下一次 `search()` 用新实例 |
| 直接调 Driver（不经本 hooks）时并发 | Driver 以 `failed(BMAP_SERVICE_FAILED)` 拒绝，并提示 `disposeLocalSearch()` 后重建实例 |

代价：取代 / 取消 / 超时之后的重查会**多建一个 SDK 实例**（换来归属可判定）。这是与「每次请求
一个独立实例」相比的有意取舍：多一次构造，换来「回包属于哪次调用」可判定。

### 与官方 UI Kit 的分流

本 hooks 不会因为 UI Kit 的交互而发请求，UI Kit 也不会触发本 hooks——两者是**独立**的通道。
同一次交互只会走其中一条（如果你同时用（例如）`<PlaceSearch>` 与本 hooks，那是两条独立请求，
由你决定是否合并）。

## TS 类型定义参考

```ts
import type { ComputedRef, MaybeRefOrGetter, ShallowRef } from 'vue'
import type {
  MapHandle,
  LocalSearchResult,
  ServiceResult,
  ServiceErrorInfo,
  BMapServiceStatus,
  GeoPoint,
} from 'bmap-vue'

export interface BMapLocalSearchRenderOptions {
  map?: MaybeRefOrGetter<MapHandle | undefined>
  panel?: string | HTMLElement
  selectFirstResult?: boolean
  autoViewport?: boolean
  viewportOptions?: { noAnimation?: boolean; margins?: readonly number[]; zoomFactor?: number }
}

export interface BMapLocalSearchOptions {
  location?: MaybeRefOrGetter<string | GeoPoint | MapHandle | undefined>
  pageCapacity?: MaybeRefOrGetter<number | undefined>
  pageNum?: MaybeRefOrGetter<number | undefined>
  renderOptions?: MaybeRefOrGetter<BMapLocalSearchRenderOptions | undefined>
}

export declare function useLocalSearch(
  options?: MaybeRefOrGetter<BMapLocalSearchOptions>
): {
  data: Readonly<ShallowRef<LocalSearchResult[] | null>>
  status: Readonly<ShallowRef<BMapServiceStatus>>
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>
  sdkStatus: Readonly<ShallowRef<number | null>>
  isLoading: Readonly<ShallowRef<boolean>>
  supported: Readonly<ShallowRef<boolean>>
  isError: ComputedRef<boolean>
  isEmpty: ComputedRef<boolean>
  search(
    keyword: string | readonly string[],
    option?: { forceLocal?: boolean }
  ): Promise<ServiceResult<LocalSearchResult[]>>
  searchNearby(
    keyword: string | readonly string[],
    center: string | GeoPoint,
    radius: number
  ): Promise<ServiceResult<LocalSearchResult[]>>
  searchInBounds(
    keyword: string | readonly string[],
    bounds: { southwest: GeoPoint; northeast: GeoPoint }
  ): Promise<ServiceResult<LocalSearchResult[]>>
  gotoPage(page: number): Promise<ServiceResult<LocalSearchResult[]>>
  clear(): void
  cancel(): void
  reset(): void
}
```
