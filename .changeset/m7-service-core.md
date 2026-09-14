---
"baidu-map-gl-vue": patch
---

服务层收口：统一公开 JSAPI 服务状态、实现 headless LocalSearch，并删除 composable 自己那套通用请求框架。

**新增**

- `useBMapLocalSearch()`：headless 本地检索（`search` / `searchNearby` / `searchInBounds` / `gotoPage` / `clear` / `cancel`）。
  选项接受 `MaybeRefOrGetter`，**只有构造字段（`location` / `pageCapacity` / `pageNum` / `renderOptions`）变化才重建 SDK 实例**；
  服务只需要 Client 上下文（`<BMapProvider>` 子树即可用），**要绘制结果必须显式传 `renderOptions.map`**（`MapHandle`）。
- 统一的服务状态口径（七个 hooks 共用）：`status` 取值 `idle` / `loading` / `success` / `empty` / `failed` / `timeout` / `canceled` / `unsupported`，
  外加只读的 `data` / `error` / `sdkStatus` / `isLoading` / `supported`。

**破坏性变更**

| 变更 | 说明 |
| --- | --- |
| **动作恒 resolve 成 `ServiceResult<T>`** | `get` / `convert` / `locate` / `search` / `gotoPage` 等不再返回数据本身、也不再 reject；失败 / 超时 / 取消都在返回值里（`status` 为 `failed` / `timeout` / `canceled`）。被更新调用取代的那次以 `canceled` 结算。 |
| `useBMapAsyncTask` / `withServiceTimeout` / `SERVICE_TIMEOUT_MS` **已删除** | 同一件事曾有两套实现（Driver 的归一化调用面 + composable 自己拼的 Promise/定时器）。超时语义现只在 Driver 侧（`SERVICE_CALL_TIMEOUT_MS`）。需要自己发请求时用 `fetch` + `AbortController`。 |
| `error` 从 `unknown` 变成 `ServiceErrorInfo \| null` | `{ code, message }`；`code` 是 SDK 公开状态码或项目错误码，无从获得时为 `null`。 |
| `status` 取值扩充 | 不再只有 `idle`/`loading`/`success`/`error`：`empty`（没有结果**或**服务当前不可用）、`failed`（有公开原因）、`timeout`、`canceled`、`unsupported`（当前引擎没这个能力，**一次请求都没发出**）。 |
| `useBMapGeocoder.get(address, city?)` | `city` 由必填改为可选（省略即不做城市限定）；`getBatch` 的每一项新增 `status`。 |
| `useBMapIpLocation` 的结果类型 | **去掉 `code`**（不在官方 `LocalCityResult` 声明里，旧实现用 `code ?? 0` 把「没有」伪造成 0），新增 `level`；`point` 允许为 `null`。 |
| `useBMapGeocodeDetail` 的结果类型 | `surroundingPois` 从 `{title, point}` 变为完整的领域投影 `LocalSearchPoi[]`（含 `address` / `phoneNumber` / `tags` 等，**不含** SDK 的 `marker` 对象）；`addressComponents` 的缺项在 composable 层仍是空串，在 Driver 层是 `null`。 |
| Driver 的 `queryBoundary` 载荷 | `Point[][]` → `BoundaryRings { raw, rings }`：官方回包的**点串形态**（`isBoundary` 覆盖体直接吃它）与解析后的坐标环一并给出。 |
| Driver 的 `GeocodedAddress` | 新增 `addressComponents` 与 `surroundingPois`（此前只暴露 `poiCount`，结构化地址被静默丢弃）。 |
| Driver 新增 LocalSearch 面 | `createLocalSearch` / `search` / `searchNearby` / `searchInBounds` / `gotoPage` / `clearLocalSearch` / `disposeLocalSearch`。 |

**语义细节（值得知道）**

- 「查无结果」与「服务当前不可用」仍是 `empty`（官方对 Geocoder / Boundary / LocalCity 只给了「回调参数是不是 `null`」这一条公开信息），
  但**拿到了合法回包而结果为空**（`LocalSearch` 的 `pois: []`）是 `success`——用 `pois.length` / `total` 判断，比压成 `empty` 更有信息量。
- `LocalSearch` 的归属**不靠回包顺序**（官方只承诺单次多关键字检索内部的顺序）：同一实例同一时刻只处理
  一个检索，并发会被显式拒绝；`useBMapLocalSearch` 用「取代即换新实例」实现「最新者胜」，
  `cancel()` / 超时之后的下一次检索同样会新建实例。`gotoPage` 在上一次还没结算时会被**拒绝**
  （它是对上一条结果的延续），而不是空转到超时。
- `cancel()` 是**逻辑取消**：SDK 没有取消入口（JSONP 发出去收不回），只承诺「放弃结果」；
  取消/超时之后的实例不再复用（那时 SDK 侧可能仍有回包在路上）。
- 与官方 UI Kit 的分流不变：headless composable 不会因为 UI 交互而发请求，两者互相独立。
