/**
 * ServiceDriver
 *
 * SDK 服务类(Geocoder/Convertor/Geolocation/LocalCity/Boundary/Autocomplete/
 * ViewAnimation/TrackAnimation)统一由 Driver 创建，业务层拿 ServiceHandle。
 *
 * 分两层（M3A2-SERVICES-NATIVE / issue #23）：
 * - **创建面** `ServiceDriver`：两个引擎都要实现（webgl-v1 随 #26 删除）；
 * - **归一化调用面** `ServiceInvocationDriver`：把 SDK 的 callback 风格调用收敛成
 *   `ServiceCall<ServiceResult<T>>`，只在 JSAPI 4.0 上落地（见
 *   `docs/adr/2026-09-12-jsapi-v4-service-panorama-native-layers.md`）。
 */
import type { MapHandle, ServiceHandle } from "./handles";
import type { Bounds, Point } from "./geometry";

export interface AutocompleteOptions {
  /**
   * 绑定到 SDK 实例的输入框。
   *
   * **要使用 `suggest()`（程序化检索），这个输入框在调用时刻必须不可输入**
   * （`readOnly` / `disabled` / `type="hidden"`）：`Autocomplete` 只有一条
   * `onSearchComplete`，可输入的输入框上用户打字触发的检索与程序化检索共用它，关键词相同时
   * 回包无法区分——Driver 会因此拒绝 `suggest()`（且在调用时与每次回包时都重新校验输入框的
   * **当前**状态；一旦观察到可输入，该实例就永久失去独占资格，需要重建）。只用输入框的联想 UI
   * 时不受此限制。
   */
  input: HTMLInputElement;
  location?: unknown;
  types?: string[];
  onSearchComplete?: (event: unknown) => void;
}

/**
 * 已创建 Autocomplete 实例的可更新选项。
 *
 * `undefined` = **不改这一项**（刻意不用 `null` 表达「清空」：`setLocation` / `setTypes` 在官方 4.0.4
 * 声明里都不接受 `null`，用 `null` 只会得到一个 SDK 侧的类型错误）。
 *
 * 注意「恢复默认」是**调用方**的语义，不是本接口的：`<BAutoComplete>` 会把 prop 变回 `undefined`
 * 解释成「恢复默认」并显式传值（location → 当前地图、types → `[]`），因为 Vue 的 props 无法区分
 * 「这次没传」与「显式传了 undefined」。
 */
export interface AutocompleteUpdateOptions {
  /** 检索区域：城市名字符串、`MapHandle` 或领域 Point（由各引擎 Driver 归一化）。 */
  location?: unknown;
  types?: string[];
}

export interface ServiceDriver {
  createGeocoder(): ServiceHandle<"service:geocoder">;
  createConvertor(): ServiceHandle<"service:convertor">;
  createGeolocation(options?: Record<string, unknown>): ServiceHandle<"service:geolocation">;
  createLocalCity(): ServiceHandle<"service:local-city">;
  createBoundary(): ServiceHandle<"service:boundary">;
  createAutocomplete(options: AutocompleteOptions): ServiceHandle<"service:autocomplete">;
  /**
   * 本地检索（`BMap.LocalSearch`）实例。
   *
   * `location` 是**检索区域**：城市名字符串、领域 `Point`，或本库的 `MapHandle`。与
   * Autocomplete 不同，LocalSearch **不绑定输入框**：它没有「用户输入与程序化检索共用一条
   * 回调」的问题，因此逐请求归属可以落在 Driver（见 `LocalSearchRequest`）。
   *
   * `options.renderOptions.map` 传 `MapHandle` 时才会把结果绘制到地图上（覆盖物所有权在
   * 调用方一侧：`clearLocalSearch` / `disposeLocalSearch` 负责收）；**不传则纯 headless**——
   * 服务只需要 `ClientContext`，不需要地图实例。
   *
   * **检索区域**只接受官方 `LocalSearch(location, …)` 的三种形态：城市名字符串、领域 `Point`、
   * 或本库的 `MapHandle`（运行时仍会校验句柄品牌，覆盖 JS 调用方与跨 Client 混用）。
   */
  createLocalSearch(
    location: string | Point | MapHandle,
    options?: LocalSearchOptions,
  ): ServiceHandle<"service:local-search">;
  /**
   * 驾车路线规划实例（`BMap.DrivingRoute`，M7-ROUTES / #39）。
   *
   * 与 `createLocalSearch` 同形：`location` 是**检索区域**（城市名 / 领域 `Point` / 本库
   * `MapHandle`），官方四个路线服务的构造签名都是 `(location, opts)`。
   *
   * `options.renderOptions.map` 给 `MapHandle` 时服务会把路线与标注画到该地图上（覆盖物所有权在
   * 调用方一侧：`clearRouteResults` / `disposeRoute` 负责收）；不传则纯 headless。
   */
  createDrivingRoute(
    location: string | Point | MapHandle,
    options?: DrivingRouteOptions,
  ): ServiceHandle<"service:driving-route">;
  /** 步行路线规划实例（`BMap.WalkingRoute`）。 */
  createWalkingRoute(
    location: string | Point | MapHandle,
    options?: WalkingRouteOptions,
  ): ServiceHandle<"service:walking-route">;
  /** 骑行路线规划实例（`BMap.RidingRoute`）。 */
  createRidingRoute(
    location: string | Point | MapHandle,
    options?: RidingRouteOptions,
  ): ServiceHandle<"service:riding-route">;
  /** 公交路线规划实例（`BMap.TransitRoute`）。 */
  createTransitRoute(
    location: string | Point | MapHandle,
    options?: TransitRouteOptions,
  ): ServiceHandle<"service:transit-route">;
  /**
   * 更新已创建 Autocomplete 实例的检索区域与数据类型（`Autocomplete#setLocation` / `#setTypes`）。
   *
   * **为什么放在 Driver 而不是组件里**（R25-C / #72）：组件侧的 `inst.raw.setLocation(...)` 把
   * raw 成员访问散落在组件代码中，而 raw SDK 的访问边界是 Driver（`driver/**`）。收敛到这里之后，
   * 组件只传领域值，两个引擎各自决定怎么落到 SDK 上（v4 走结构化成员探测，legacy 走同一套
   * `callOptional` 口径），也不需要每个组件作者记得「某个 setter 在某个引擎上不存在」。
   *
   * **两个引擎的错误路径刻意不同**：v4 的 Driver 前置校验句柄种类与「实例是否已被释放」，
   * 命中时同步抛 `BMAP_INVALID_ARGUMENT`；legacy 目前**不做**这两项校验（成员缺失一律
   * silent no-op），因为它在 #26 会被整体删除，不值得为它补一套马上要消失的记账。调用方按
   * 「更新可能失败」处理即可（组件侧把异常经 `resource:error` 交出去）。
   */
  setAutocompleteOptions(
    handle: ServiceHandle<"service:autocomplete">,
    options: AutocompleteUpdateOptions,
  ): void;
  createViewAnimation(
    keyFrames: readonly Record<string, unknown>[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:view-animation">;
  createTrackAnimation(
    map: MapHandle,
    path: readonly Point[],
    options?: Record<string, unknown>,
  ): ServiceHandle<"service:track-animation">;
}

/* -------------------------------------------------------------------------- */
/* 归一化服务调用（callback → Promise<Result>）                                  */
/* -------------------------------------------------------------------------- */

/**
 * 归一化调用的终态。
 *
 * **`empty` 是一个合并结论**（R25-C / #72）：百度服务在失败时经常只回 `null`（配额 302 /
 * Referer 限制），而官方没有公开的错误码入口——因此「查无结果」与「服务当前不可用」在公开面上
 * **不可区分**，两者都归成 `empty`。`failed` 只留给**能给出公开原因**的情形：SDK 公开的状态码
 * （`Geolocation#getStatus()`、`Convertor#translate` 的回包 `status`）与调用方参数错误。
 * 本库不去嗅探 `_rd` 之类的私有面来「还原」精确错误码，见
 * `docs/adr/2026-09-13-private-sdk-surface-removal.md`。
 */
export type ServiceCallStatus = "success" | "empty" | "failed" | "timeout" | "canceled";

export interface ServiceErrorInfo {
  /** SDK 公开的状态码（`BMAP_STATUS_*` / `Convertor` 回包 `status`）或项目错误码；无从获得时为 `null` */
  code: number | string | null;
  message: string;
}

export interface ServiceResult<T> {
  readonly status: ServiceCallStatus;
  /** 只在 `success` 时非空 */
  readonly data: T | null;
  /** `success` / `empty` / `canceled` 时为 `null` */
  readonly error: ServiceErrorInfo | null;
  /** SDK 原始状态码（`BMAP_STATUS_*`）；适配器拿不到时为 `null` */
  readonly sdkStatus: number | null;
}

/**
 * 传给适配器的结算入口。
 *
 * **先到者胜**：`success`/`empty`/`failed` 任何一个先调用之后，后续（迟到）的结算都被
 * 忽略——真实服务会在超时后仍回包，不设这道门就会把已超时的结果写回去。
 */
export interface ServiceCallSettle<T> {
  success(data: T, sdkStatus?: number | null): void;
  empty(sdkStatus?: number | null): void;
  failed(error: ServiceErrorInfo, sdkStatus?: number | null): void;
}

export interface ServiceCallOptions {
  /** 调用标签（进入超时与失败信息，如 `Geocoder.getPoint`） */
  label: string;
  /** 超时毫秒；默认 `SERVICE_CALL_TIMEOUT_MS` */
  timeoutMs?: number;
  /**
   * 取消时执行。
   *
   * 百度服务大多**没有**取消入口（JSONP 请求发出去就收不回），因此这里只做「放弃结果 +
   * 解绑监听」；`result` 会立刻以 `canceled` 结算，之后到达的回调被忽略。
   */
  onCancel?: () => void;
  /**
   * 超时时执行（与 `onCancel` 对称）。
   *
   * 为什么需要它：超时不代表 SDK 侧请求消失——回包可能**仍在路上**。需要把「这一次调用已经结束」
   * 告知 Driver 侧归属记账的地方（`LocalSearch` 的实例身份模型）必须在这里收尾，否则同一 handle 的
   * 行为会取决于迟到回包何时到达（PR #89 复审 P1）。
   */
  onTimeout?: () => void;
}

export interface ServiceCall<T> {
  /** **恒 resolve**（不 reject）：失败/超时/取消都走 `status` */
  readonly result: Promise<ServiceResult<T>>;
  cancel(): void;
}

/* -------------------------------------------------- 各服务的请求与结果领域类型 */

/** 正地址解析请求（`Geocoder#getPoint`）。 */
export interface GeocodeRequest {
  address: string;
  /** 地址所在城市名，如 `'北京市'` */
  city?: string;
}

/** 逆地址解析请求（`Geocoder#getLocation`）。 */
export interface ReverseGeocodeRequest {
  point: Point;
  /** 附近 POI 的最大半径（米） */
  poiRadius?: number;
  /** 返回的 POI 个数 */
  numPois?: number;
}

/** 结构化地址（官方 `AddressComponent` 的领域投影）。 */
export interface GeocodedAddressComponents {
  province: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
  streetNumber: string | null;
}

export interface GeocodedAddress {
  address: string;
  point: Point | null;
  /** 所属商圈 */
  business: string | null;
  /** 结构化的地址描述（官方 `GeocoderResult.addressComponents`） */
  addressComponents: GeocodedAddressComponents;
  /**
   * 附近的 POI（官方 `GeocoderResult.surroundingPois` 的领域投影）。
   *
   * 与 `LocalSearchResult.pois` 用**同一个** `LocalSearchPoi`：两者都是官方
   * `LocalResultPoi`，分开定义只会让「投影漏字段」在两处各犯一次（#38 收口）。
   */
  surroundingPois: readonly LocalSearchPoi[];
  /** 附近 POI 数量（= `surroundingPois.length`；保留旧字段名以免破坏既有调用方） */
  poiCount: number;
}

/** 坐标转换源/目标类型（官方 `Convertor#translate` 的数值枚举）。 */
export type CoordinateFromType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type CoordinateToType = 3 | 5 | 6;

export interface ConvertorRequest {
  points: readonly Point[];
  from: CoordinateFromType;
  to: CoordinateToType;
}

/** 行政区边界请求（`Boundary#get`）。 */
export interface BoundaryRequest {
  /** 省 / 直辖市 / 地级市 / 县的名称 */
  name: string;
}

/**
 * 行政区边界结果（`Boundary#get` 回包的**两个公开视图**）。
 *
 * 官方回包是 `{ boundaries: string[] }`——每项是一条 `"lng,lat;lng,lat;…"` 的点串。这个字符串
 * 形态本身就是公开契约的一部分：`B*` 覆盖物的 `isBoundary` 直接吃它。因此 DTO 同时给出
 *
 * - `raw`：官方原样的点串（喂 `isBoundary` / 自行解析都用它）；
 * - `rings`：解析后的坐标环（几何运算、命中判定用）。
 *
 * 只留其中一份都会**静默丢掉**调用方需要的东西：只留 `rings` 会把「点串是官方表示」这件事
 * 藏起来，只留 `raw` 则逼每个调用方自己写一遍解析。
 */
export interface BoundaryRings {
  /** 官方回包的原始边界点串（每串一个闭合环），原样透传、不做归一 */
  readonly raw: readonly string[];
  /** `raw` 解析后的坐标环（非法片段已在解析时丢弃） */
  readonly rings: readonly (readonly Point[])[];
}

/* ------------------------------------------------------------------ LocalSearch */

/** 本地检索的关键字（官方 `search` 家族接受单关键字或多关键字，最多 10 个）。 */
export type LocalSearchKeyword = string | readonly string[];

/**
 * 矩形检索范围（`LocalSearch#searchInBounds`）。
 *
 * 与 `BMap.Bounds` 同形（`southwest` / `northeast`），由 Driver 归一化成 raw `Bounds`；
 * 领域层因此不需要 import 官方类型。
 */
export type LocalSearchBounds = Bounds;

/** 结果绘制选项（官方 `RenderOptions`）。 */
export interface LocalSearchRenderOptions {
  /**
   * 绘制目标：本库的 `MapHandle`（Driver 归一化成 raw `Map`）。
   *
   * 不传 = 纯 headless：只回数据、不在任何地图上绘制覆盖物。
   * 运行时仍按句柄品牌校验（JS 调用方拿不到编译期保护；跨 Client 混用必须被拒绝）。
   */
  map?: MapHandle;
  /** 结果列表容器（元素或 id） */
  panel?: string | HTMLElement;
  /** 是否自动选中第一个结果 */
  selectFirstResult?: boolean;
  /** 检索结束后是否自动调整地图视野 */
  autoViewport?: boolean;
  /**
   * `autoViewport` 的视野计算选项。
   *
   * 官方只声明了 `margins` / `zoomFactor` / `noAnimation` 三个成员；本库**不接收**声明之外的
   * 成员（接收后忽略 = 假支持）。
   */
  viewportOptions?: {
    noAnimation?: boolean;
    margins?: readonly number[];
    zoomFactor?: number;
  };
}

/** 本地检索**构造期**选项（只有这些字段变化才需要重建实例，见 `#38`）。 */
export interface LocalSearchOptions {
  renderOptions?: LocalSearchRenderOptions;
  /** 每页容量（1-100，官方超出范围时重置为 10） */
  pageCapacity?: number;
  /** 起始页码（从 0 开始） */
  pageNum?: number;
}

/** `search()` 的附加选项（官方 `LocalSearchSearchOption`）。 */
export interface LocalSearchSearchOption {
  /** 强制在当前城市内检索，不跳转到其它城市的结果 */
  forceLocal?: boolean;
}

/** 单个检索结果点（官方 `LocalResultPoi` 的领域投影）。 */
export interface LocalSearchPoi {
  /** 结果名称标题 */
  title: string;
  /** POI 唯一标识；官方回包没有时为空串 */
  uid: string;
  /** 结果坐标；回包给出非法坐标时为 `null` */
  point: Point | null;
  address: string | null;
  city: string | null;
  province: string | null;
  phoneNumber: string | null;
  postcode: string | null;
  /** 行政区编码 */
  adcode: string | null;
  /** POI 标签 */
  tags: readonly string[];
  /** 是否精确匹配（仅 `search()` 的结果中有效；无从判断时为 `null`） */
  isAccurate: boolean | null;
  /** 在百度地图中展示该结果点的链接 */
  url: string | null;
  /** 详情页链接 */
  detailUrl: string | null;
}

/**
 * 一次检索的结果（官方 `LocalResult` 的领域投影，**每个关键字一项**）。
 *
 * 多关键字检索时官方回包是 `LocalResult[]`、顺序与关键字数组一致；单关键字时是单个
 * `LocalResult`。本库统一归一成数组（单关键字 ⇒ 长度 1），因为「是否为数组」是实现细节，
 * 而「第 i 个关键字的结果是哪一份」才是调用方要的语义。
 *
 * **刻意不投影的官方成员**：`LocalResultPoi.marker`（SDK 的覆蓋物对象）与 `type`
 * （官方 `POIType` 数字枚举——本库不自持它的值域，投影成裸数字只会让调用方写魔法数字）。
 * 需要它们时经 `./advanced` 的 `unwrapRaw()` 取 raw。
 */
export interface LocalSearchResult {
  /** 本次检索的关键字 */
  keyword: string;
  /** 本次检索所在的城市 / 省份 */
  city: string;
  province: string;
  /** 周边检索的中心点（仅周边检索时有值） */
  center: Point | null;
  /** 周边检索的半径（仅周边检索时有值） */
  radius: number | null;
  /** 范围检索的矩形区域（仅范围检索时有值） */
  bounds: LocalSearchBounds | null;
  /** 本页结果 */
  pois: readonly LocalSearchPoi[];
  /** 本页结果数（官方 `getCurrentNumPois`） */
  pageSize: number;
  /** 结果总数（官方 `getNumPois`） */
  total: number;
  /** 总页数（官方 `getNumPages`） */
  pageCount: number;
  /** 当前页码，从 0 开始（官方 `getPageIndex`） */
  pageIndex: number;
  /** 检索词在多个城市有结果时的城市列表（官方 `getCityList`） */
  cities: readonly { readonly name: string; readonly count: number }[];
  /** 更多结果的链接（到百度地图搜索） */
  moreResultsUrl: string | null;
  /** 搜索建议（关键词为拼音或拼写错误时给出） */
  suggestions: readonly string[];
}

/**
 * 本地检索的请求描述。
 *
 * 四个操作**共用**一条 `onSearchComplete`（实例单例回调）。**归属不靠关键字也不靠到达顺序**：
 * 官方只承诺单次多关键字检索内部的顺序，`keyword` 也不是请求身份——因此 Driver 采用
 * 「**一个实例同一时刻只有一个未结算操作**」这条不变式，并发会被显式拒绝。完整契约见
 * `JsapiV4ServiceDriver.search` 的说明与 ADR `2026-09-14-service-lifecycle-and-local-search` 决策 4。
 */
export interface LocalSearchNearbyRequest {
  keyword: LocalSearchKeyword;
  /**
   * 周边检索的中心点。
   *
   * 官方签名还接受 `LocalResultPoi`（把上一次的结果点直接传回来）。本库**不接受**它：DTO 是
   * 投影、**不携带 raw POI**，把投影对象传回去只会得到 SDK 侧的非法值。需要以某个结果点为
   * 中心时用它的 `point`。
   */
  center: string | Point;
  /** 检索半径（米，默认 2000，最大 100000；`center` 为字符串时官方忽略它） */
  radius: number;
}

/** 范围检索请求（`LocalSearch#searchInBounds`）。 */
export interface LocalSearchInBoundsRequest {
  keyword: LocalSearchKeyword;
  bounds: LocalSearchBounds;
}

/* ------------------------------------------------------------------ 路线规划 */
/* M7-ROUTES / issue #39：DrivingRoute / WalkingRoute / RidingRoute / TransitRoute */

/**
 * 路线端点里能表达的 **POI 引用**。
 *
 * 官方四个路线服务的 `search()` 都声明接受 `LocalResultPoi`（`Point | LocalResultPoi` /
 * `string | Point | LocalResultPoi`）。本库**不接受** raw POI：公共 DTO 是投影、不携带 raw 对象，
 * 把投影对象传回 SDK 只会得到非法值（与 `LocalSearchNearbyRequest.center` 同源取舍）。
 *
 * 因此改用调用方**本来就拿得到**的三个字段表达同一个东西：`uid` + `point` + 可选 `name`
 * （`name` 进结果里的端点标题）。Driver 把它构造成 SDK 认得的对象。
 *
 * > **未经真实运行时证明的假设**（与 `Autocomplete` 的 `keyword`、`Promise` 型归属同级）：
 * > 官方 4.0 文档与类型包只声明了 `LocalResultPoi` 的**形状**，没有说明 `search()` 会读它的哪几个
 * > 成员。本库按「`uid` 定位、`point` 兜底、`title` 作标题」实现，并在 ADR
 * > `2026-09-14-route-services-headless.md` 的「已知限制」里登记为待真实 AK 验证项。
 * > 只传 `point`（不传 uid/name）时走纯坐标路径，那条路径**没有**这个假设。
 */
export interface RouteEndpointPoi {
  /** POI 唯一标识（官方优先按 uid 定位） */
  uid: string;
  /** POI 坐标（uid 失效时的定位依据） */
  point: Point;
  /** POI 名称（作为结果里的端点标题；缺省时用 uid） */
  name?: string;
}

/**
 * 路线端点（一个端点 = 「点 / 地点名 / POI 引用」三者之一）。
 *
 * **只给步行 / 骑行 / 公交**用：官方 `WalkingRoute#search` / `RidingRoute#search` /
 * `TransitRoute#search` 的签名是 `string | Point | LocalResultPoi`（支持关键字检索）。
 * 驾车**没有关键字检索**，它的端点是 {@link DrivingRouteEndpoint}——「不能用最宽模型假定
 * 全部模式相同」这条要求落在类型上，而不是留给运行时。
 */
export type RouteEndpoint = string | Point | RouteEndpointPoi;

/**
 * 驾车端点。
 *
 * 官方 `DrivingRoute#search(start: Point | LocalResultPoi, end: ..., options?)` 的签名里
 * **没有** `string`：驾车路线不支持按关键字起终点（要按地址走，先用 `Geocoder` / `LocalSearch`
 * 拿到坐标或 POI）。把它做成独立的窄类型，是为了让「给驾车传了地名」在编译期就被拒，
 * 而不是留到 SDK 侧得到一个不可解释的失败。
 */
export type DrivingRouteEndpoint = Point | RouteEndpointPoi;

/** 路线端点（结果里的起点 / 终点，官方 `LocalResultPoi` 的领域投影）。 */
export interface RouteEndpointInfo {
  /** 端点标题（官方 `LocalResultPoi.title`） */
  title: string;
  /** 端点坐标；回包给出非法坐标时为 `null` */
  point: Point | null;
  /** POI uid（没有时为空串） */
  uid: string;
}

/** 路线中的一个关键点（官方 `Step` 的领域投影）。 */
export interface RouteStep {
  /** 关键点在本路线中的序号（官方 `Step#getIndex`） */
  index: number;
  /** 关键点坐标（官方 `Step#getPosition`） */
  position: Point | null;
  /** 描述文本，**不含 HTML**（官方 `Step#getDescription(false)`） */
  description: string | null;
  /** 到下一个关键点的距离（米，`getDistance(false)`） */
  distance: number | null;
  /** 到下一个关键点的距离文本（`getDistance(true)`） */
  distanceText: string | null;
  /** 所属路线序号（`Step#getRouteIndex`） */
  routeIndex: number | null;
  /** 所属方案序号（`Step#getPlanIndex`） */
  planIndex: number | null;
}

/**
 * 一条路线（官方 `Route` 的领域投影）——驾车 / 步行 / 骑行与公交换乘里的步行段共用它。
 *
 * **刻意不投影的官方成员**：`Route#getPolyline()`。它是 SDK 自己画在地图上的覆盖物，属于
 * 「显式 `renderOptions.map` 时由服务持有、由 `clearResults()` 收回」的那一份资源；
 * 把它交出去会让「谁负责移除」变成两说。需要它时经 `./advanced` 的 `unwrapRaw()` 取 raw。
 */
export interface RouteLeg {
  /** 路线在方案中的序号（官方 `Route#getIndex`） */
  index: number;
  /** 所属方案序号（官方 `Route#getPlanIndex`） */
  planIndex: number | null;
  /** 路线类型（官方 `Route#getRouteType` → `BMAP_ROUTE_TYPE_*`）；拿不到时为 `null` */
  routeType: number | null;
  /** 路线距离（米，`getDistance(false)`） */
  distance: number | null;
  /** 路线距离文本（`getDistance(true)`） */
  distanceText: string | null;
  /** 路线坐标点串（官方 `Route#getPath`） */
  path: readonly Point[];
  /** 关键点（官方 `Route#getStep`；官方声明里驾车/步行适用，骑行结果可能为空数组） */
  steps: readonly RouteStep[];
}

/** 出租车计费明细（官方 `TaxiFareDetail` 的领域投影）。 */
export interface RouteTaxiFareDetail {
  /** 起步价 */
  initialFare: number | null;
  /** 单价 */
  unitFare: number | null;
  /** 总价 */
  totalFare: number | null;
}

/** 出租车费用信息（官方 `TaxiFare` 的领域投影；仅驾车方案的 `getTaxiFare()` 会给）。 */
export interface RouteTaxiFare {
  /** 白天计费（部分城市没有夜间费用，此时它是全天费用） */
  day: RouteTaxiFareDetail | null;
  /** 夜间计费 */
  night: RouteTaxiFareDetail | null;
  /** 出租车里程（米） */
  distance: number | null;
  /** 备注信息 */
  remark: string | null;
}

/**
 * 一条驾车 / 步行 / 骑行方案（官方 `RoutePlan` 的领域投影）。
 *
 * `toll` / `tollDistance` 取自官方那句**只在 `DrivingRoutePlan` 接口里声明**的
 * `getToll()` / `getTollDistance()`：4.0.4 的 `DrivingRouteResult#getPlan()` 返回类型写的是
 * `RoutePlan`（不含这两个成员），但 `DrivingRoutePlan` 接口确实在同一个类型包里声明了它们。
 * 因此这里**可选读取**（成员缺失 ⇒ `null`），不 augmentation、不告警——如实表达「这次没拿到」。
 */
export interface RoutePlan {
  /** 方案在结果里的序号（0 基；本库补的，官方没有「我排第几」的入口） */
  index: number;
  distance: number | null;
  distanceText: string | null;
  duration: number | null;
  durationText: string | null;
  /** 道路收费（元，`DrivingRoutePlan#getToll`） */
  toll: number | null;
  /** 收费路段里程（米，`DrivingRoutePlan#getTollDistance`） */
  tollDistance: number | null;
  /** 出租车费用（`RoutePlan#getTaxiFare`；没有该项时为 `null`） */
  taxiFare: RouteTaxiFare | null;
  /** 方案里的拖拽点（官方 `RoutePlan#getDragPois`） */
  dragPois: readonly RouteEndpointInfo[];
  /** 方案中的路线（官方 `RoutePlan#getRoute`） */
  legs: readonly RouteLeg[];
}

/** 公交方案里的**乘车**段（官方 `Line` 的领域投影）。 */
export interface TransitLineSegment {
  kind: "line";
  /** 线路全称（官方 `Line#getTitle` / `Line.title`） */
  title: string;
  /** 线路类型（官方 `Line#type` → `BMAP_LINE_TYPE_*`）；拿不到时为 `null` */
  lineType: number | null;
  /** 途经车站数（官方 `Line#getNumViaStops`；仅公交/地铁有效） */
  viaStops: number | null;
  /** 上车站（官方 `Line#getGetOnStop`） */
  onStop: RouteEndpointInfo | null;
  /** 下车站（官方 `Line#getGetOffStop`） */
  offStop: RouteEndpointInfo | null;
  distance: number | null;
  distanceText: string | null;
  /** 该段的地理坐标（官方 `Line#getPath`） */
  path: readonly Point[];
}

/** 公交方案里的**步行**段（官方 `Route`；与驾车方案里的路线同一套投影）。 */
export interface TransitWalkSegment {
  kind: "walk";
  leg: RouteLeg;
}

/**
 * 公交方案的一段。
 *
 * 判别键是**官方自己的判别入口** `TransitRoutePlan#getTotalType(i)`（0 = `Route` / 1 = `Line`），
 * 不是「有没有某个字段」这类形状特征——接口允许没有该字段的合法成员，特征识别会把它们误分类。
 */
export type TransitRouteSegment = TransitLineSegment | TransitWalkSegment;

/**
 * 一条公交方案（官方 `TransitRoutePlan` 的领域投影）。
 *
 * 与 {@link RoutePlan} 刻意**不同构**：公交方案是「乘车段 + 步行段」的序列，而不是「方案 → 路线
 * → 关键点」的树；硬套同一个形状会逼着调用方从 `description` 文本里还原换乘信息。
 */
export interface TransitRoutePlan {
  /** 方案在结果里的序号（0 基） */
  index: number;
  distance: number | null;
  distanceText: string | null;
  duration: number | null;
  durationText: string | null;
  /** 方案描述文本，**不含 HTML**（官方 `TransitRoutePlan#getDescription(false)`） */
  description: string | null;
  /** 各线路名称拼接文本（官方 `getLinesTitle`） */
  linesTitle: string | null;
  /** 总步行距离文本（官方 `getWalkDistance`） */
  walkDistance: string | null;
  /** 按官方 `getTotal` 顺序排列的路段序列 */
  segments: readonly TransitRouteSegment[];
}

/**
 * 路线检索结果（四类服务共用的信封，`TPlan` 是各自的方案类型）。
 *
 * 共用的只有信封（起终点 + 方案数组 + 策略），方案本身**不强求同构**——见
 * {@link TransitRoutePlan} 的说明。
 */
export interface RouteResult<TPlan> {
  start: RouteEndpointInfo | null;
  end: RouteEndpointInfo | null;
  plans: readonly TPlan[];
  /** 本次检索使用的策略（官方 `DrivingRouteResult.policy` / `TransitRouteResult.policy`） */
  policy: number | null;
  /**
   * 出行类型（官方 `TransitRouteResult#getTransitType` → `BMAP_TRANSIT_TYPE_*`）；
   * 驾车 / 步行 / 骑行没有这个成员，恒为 `null`。
   */
  transitType: number | null;
}

export type DrivingRouteResult = RouteResult<RoutePlan>;
export type WalkingRouteResult = RouteResult<RoutePlan>;
export type RidingRouteResult = RouteResult<RoutePlan>;
export type TransitRouteResult = RouteResult<TransitRoutePlan>;

/* ---------------------------------------------------------- 策略常量（值 + 类型） */

/**
 * 驾车策略（官方 `BMAP_DRIVING_POLICY_*`）。
 *
 * **既是类型也是值**，与 TS 枚举同形：调用方不必写魔法数字，也不必去读全局常量。
 * 与官方 4.0.4 声明的逐成员对齐由 `driver/jsapi-v4/routes.test.ts` 从上游 `.d.ts` 解析成员后
 * 逐项断言（名字配错数字是类型层拦不住的，只有这条断言能拦）。
 */
export const DrivingPolicy = {
  /** 默认（通常为时间最短） */
  DEFAULT: 0,
  /** 距离最短 */
  LEAST_DISTANCE: 2,
  /** 避开高速 */
  AVOID_HIGHWAYS: 3,
  /** 优先高速 */
  FIRST_HIGHWAYS: 4,
  /** 避开拥堵 */
  AVOID_CONGESTION: 5,
  /** 避开收费 */
  AVOID_PAY: 6,
  /** 高速优先且避开拥堵 */
  HIGHWAYS_AVOID_CONGESTION: 7,
  /** 避开高速和拥堵 */
  AVOID_HIGHWAYS_CONGESTION: 8,
  /** 避开拥堵和收费 */
  AVOID_CONGESTION_PAY: 9,
  /** 避开高速、拥堵和收费 */
  AVOID_HIGHWAYS_CONGESTION_PAY: 10,
  /** 避开高速和收费 */
  AVOID_HIGHWAYS_PAY: 11,
  /** 距离优先 */
  DISTANCE_PRIORITY: 12,
  /** 时间优先 */
  TIME_PRIORITY: 13,
} as const;

export type DrivingPolicy = (typeof DrivingPolicy)[keyof typeof DrivingPolicy];

/** 市内公交换乘策略（官方 `BMAP_TRANSIT_POLICY_*`）。 */
export const TransitPolicy = {
  /** 推荐方案 */
  RECOMMEND: 0,
  /** 最少换乘 */
  LEAST_TRANSFER: 1,
  /** 最少步行 */
  LEAST_WALKING: 2,
  /** 不乘地铁 */
  AVOID_SUBWAYS: 3,
  /** 最少时间 */
  LEAST_TIME: 4,
  /** 地铁优先 */
  FIRST_SUBWAYS: 5,
} as const;

export type TransitPolicy = (typeof TransitPolicy)[keyof typeof TransitPolicy];

/** 跨城公交换乘策略（官方 `BMAP_INTERCITY_POLICY_*`）。 */
export const IntercityPolicy = {
  /** 时间最短 */
  LEAST_TIME: 0,
  /** 出发时间最早 */
  EARLY_START: 1,
  /** 价格最低 */
  CHEAP_PRICE: 2,
} as const;

export type IntercityPolicy = (typeof IntercityPolicy)[keyof typeof IntercityPolicy];

/** 跨城交通方式策略（官方 `BMAP_TRANSIT_TYPE_POLICY_*`）。 */
export const TransitVehiclePolicy = {
  /** 火车 */
  TRAIN: 0,
  /** 飞机 */
  AIRPLANE: 1,
  /** 大巴 */
  COACH: 2,
} as const;

export type TransitVehiclePolicy = (typeof TransitVehiclePolicy)[keyof typeof TransitVehiclePolicy];

/* ------------------------------------------------------------- 路线构造期状态 */

/**
 * 四类路线服务共用的**呈现状态**：要不要画、画在哪里、画完要不要调视野。
 *
 * 「只有这些字段变化才重建 SDK 实例」是这一层的核心口径：路线服务实例既持有配置、又持有**结果与
 * 绘制物**（服务自己画在地图上的折线与标注、写进 `panel` 的 DOM），所以配置变了就必须换实例，
 * 而不是在旧实例上改——旧实例上的可见结果要由 `clearRouteResults()` 收回。
 */
export interface RouteRenderState {
  /**
   * 结果呈现设置。**不传 = 纯 headless**：只回数据、不在任何地图上绘制、不写任何 DOM。
   *
   * 传了 `map` 就是「让服务自己画」：画出来的折线 / 标注 / 结果面板由该服务实例持有，
   * 由 `clearRouteResults()` / `disposeRoute()` 收回（所有权因此可验证）。
   */
  renderOptions?: RouteRenderOptions;
}

/**
 * 驾车 / 公交的构造期状态（issue #39 的 `RouteState`）。
 *
 * 比 {@link RouteRenderState} 多一个 `enableTraffic`：官方只在 `DrivingRouteOptions` 与
 * `TransitRouteOptions` 里声明了它，`WalkingRouteOptions` / `RidingRouteOptions` 没有。
 */
export interface RouteState extends RouteRenderState {
  /**
   * 是否显示实时路况（官方 `enableTraffic`，4.0 默认 `false`）。
   *
   * 注意官方声明的一条副作用：**开启后按路况分段着色的折线不受 `polylineStyle` 影响**。
   */
  enableTraffic?: boolean;
}

/** 驾车构造期选项（官方 `DrivingRouteOptions` 的领域投影）。 */
export interface DrivingRouteOptions extends RouteState {
  /** 驾车策略，默认 `0`（`DrivingPolicy.DEFAULT`） */
  policy?: DrivingPolicy;
}

/**
 * 步行 / 骑行构造期选项。
 *
 * 官方 `WalkingRouteOptions` / `RidingRouteOptions` **没有** `policy`、`pageCapacity`，也**没有**
 * `enableTraffic`（声明里只有 `renderOptions` 与五个回调），因此它们的构造期状态只剩 `renderOptions`。
 * 用窄类型把不存在的选项排除掉，而不是「收进来再丢掉」——后者是假支持。
 */
export type WalkingRouteOptions = RouteRenderState;
export type RidingRouteOptions = RouteRenderState;

/** 公交构造期选项（官方 `TransitRouteOptions` 的领域投影）。 */
export interface TransitRouteOptions extends RouteState {
  /** 市内公交换乘策略，默认 `0`（`TransitPolicy.RECOMMEND`） */
  policy?: TransitPolicy;
  /** 跨城公交换乘策略（仅跨城检索有效） */
  intercityPolicy?: IntercityPolicy;
  /** 跨城交通方式策略（仅跨城检索有效） */
  transitTypePolicy?: TransitVehiclePolicy;
  /** 每页返回的方案个数（官方范围 1 - 5，超出时 SDK 自行重置） */
  pageCapacity?: number;
}

/**
 * 路线结果的绘制选项（官方 `RouteRenderOptions` 的领域投影）。
 *
 * 只透传官方声明里**存在且有语义**的成员：
 * - `selectFirstResult` 在官方 `RenderOptions` 里明说「此属性仅对 `LocalSearch` 有效」，
 *   路线服务收下它也不会生效 —— 因此**不暴露**（接收后忽略属于假支持）；
 * - `polylineStyle` 本轮**不暴露**：上游类型包声明的 `PolylineOptions`（平铺成员）与官方类文档
 *   给的**具名分桶**（`highlight` / `transit` / `walking` / `decorate`）互相矛盾，无法在不猜的
 *   前提下给出可信的公共形状。需要时经 `./advanced` 的 `unwrapRaw()` 或官方 UI Kit 配置。
 */
export interface RouteRenderOptions {
  /**
   * 绘制目标：本库的 `MapHandle`（Driver 归一化成 raw `Map`）。
   *
   * 不传 = 纯 headless。运行时仍按句柄品牌校验（JS 调用方拿不到编译期保护；跨 Client 混用必须被拒绝）。
   */
  map?: MapHandle;
  /**
   * 结果列表容器（元素或 id）。
   *
   * 4.0.4 对它的描述**自相矛盾**：`RenderOptions.panel` 的注释写「驾车路线规划无效」，而
   * `DrivingRoute.d.ts` 的官方示例又传 `panel: 'route-panel'` 并描述「结果面板已展示」。
   * **真实 AK 实测驾车有效**（容器 DOM `0 → 2417` 字符，`clearResults()` 后回 `0`）⇒ 那句
   * 「驾车无效」是过时描述。本库因此**原样转发**：不告警，也不替 SDK 承诺有效或无效
   * （上游自述仍矛盾，等官方修正或更多读数再收紧措辞）。见 ADR 决策 7。
   */
  panel?: string | HTMLElement;
  /** 检索结束后是否自动调整地图视野 */
  autoViewport?: boolean;
  /** 自动调整视野时的计算选项（与 `LocalSearch` 同形，官方只声明这三个成员） */
  viewportOptions?: {
    noAnimation?: boolean;
    margins?: readonly number[];
    zoomFactor?: number;
  };
}

/* --------------------------------------------------------------- 路线请求 */

/** 驾车检索请求（官方 `DrivingRoute#search(start, end, { waypoints })`）。 */
export interface DrivingRouteRequest {
  start: DrivingRouteEndpoint;
  end: DrivingRouteEndpoint;
  /**
   * 途经点坐标数组（**只有驾车支持**）。
   *
   * 官方 `DrivingRoute#search` 的第三个参数里只有 `waypoints` 这一个成员；步行 / 骑行 / 公交的
   * `search` 是两参数签名（`TransitRoute#search` 连 options 都没有），因此本库不把它们暴露成
   * 「收了但忽略」。
   */
  waypoints?: readonly Point[];
}

/**
 * 步行 / 骑行检索请求（官方两参数签名 `search(start, end)`）。
 *
 * 与 {@link DrivingRouteRequest} 分开，正是因为**没有途经点**：把 `waypoints` 放进公共请求类型
 * 再在实现里静默丢掉（官方参考实现 `react-bmap` 的做法）会让「设了途经点但不生效」变成无声行为。
 */
export interface RouteRequest {
  start: RouteEndpoint;
  end: RouteEndpoint;
}

/** 公交检索请求（官方 `TransitRoute#search(start, end)`，同样没有途经点）。 */
export type TransitRouteRequest = RouteRequest;

/** 路线服务句柄种类（四类服务共用一套释放 / 清理入口）。 */
export type RouteServiceKind =
  | "service:driving-route"
  | "service:walking-route"
  | "service:riding-route"
  | "service:transit-route";

/** 四类路线服务句柄的联合（`clearRouteResults` / `disposeRoute` 的参数）。 */
export type RouteServiceHandle = ServiceHandle<RouteServiceKind>;

export interface GeolocationOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
  SDKLocation?: boolean;
}

/** 定位结果的地址信息（官方 `GeolocationAddress` 的领域投影）。 */
export interface GeolocationAddressInfo {
  country?: string;
  province?: string;
  city?: string;
  cityCode?: string | number;
  district?: string;
  street?: string;
  streetNumber?: string;
}

export interface GeolocationFix {
  point: Point;
  /** 精度（米）；SDK 未给出时为 `null` */
  accuracy: number | null;
  address: GeolocationAddressInfo | null;
}

/** IP 定位结果（`LocalCity#get`）。 */
export interface LocalCityFix {
  name: string;
  /** SDK 未给出中心点时（`renderOptions.map` 缺失时按官方应恒有）为 `null` */
  center: Point | null;
  level: number | null;
}

/** 输入提示条目（`Autocomplete` 的检索结果）。 */
export interface PlaceSuggestion {
  title: string;
  /** 结构化地址（`province + city + district + street`） */
  address: string;
  /** 条目在列表中的索引；无高亮时为 -1 */
  index: number;
}

/**
 * 归一化调用面（callback → Promise/Result）。
 *
 * 每个方法都返回 `ServiceCall`：**不 reject**，失败/超时/取消都表达成
 * `ServiceResult.status`。
 *
 * 唯一同步抛错的情形是**调用方错误**：`handle` 不是本 Driver 创建的句柄时抛
 * `BMAP_HANDLE_FOREIGN`（跨 Client 混用会操作到另一张地图的资源，必须在边界立刻失败，
 * 而不是伪装成一个「服务失败」的 Result）；参数非法则相反，走结果通道
 * （`status: "failed"` + `BMAP_INVALID_ARGUMENT`），因为它是**调用内容**的问题。
 */
export interface ServiceInvocationDriver {
  /** 地址 → 坐标（`Geocoder#getPoint`） */
  geocode(handle: ServiceHandle<"service:geocoder">, request: GeocodeRequest): ServiceCall<Point>;
  /** 坐标 → 地址（`Geocoder#getLocation`） */
  reverseGeocode(
    handle: ServiceHandle<"service:geocoder">,
    request: ReverseGeocodeRequest,
  ): ServiceCall<GeocodedAddress>;
  /** 坐标系互转（`Convertor#translate`） */
  convert(
    handle: ServiceHandle<"service:convertor">,
    request: ConvertorRequest,
  ): ServiceCall<Point[]>;
  /** 行政区边界（`Boundary#get`）→ 原始点串 + 解析后的坐标环 */
  queryBoundary(
    handle: ServiceHandle<"service:boundary">,
    request: BoundaryRequest,
  ): ServiceCall<BoundaryRings>;
  /** 浏览器定位（`Geolocation#getCurrentPosition`） */
  locate(
    handle: ServiceHandle<"service:geolocation">,
    options?: GeolocationOptions,
  ): ServiceCall<GeolocationFix>;
  /** IP 定位城市（`LocalCity#get`） */
  locateCity(handle: ServiceHandle<"service:local-city">): ServiceCall<LocalCityFix>;
  /**
   * 输入提示（`Autocomplete#search` + `onSearchComplete`）。
   *
   * 以下条件不满足时**拒绝**（`status: "failed"` + `BMAP_SERVICE_FAILED`），因为那时回包归属
   * 无法确定（`Autocomplete` 的回包不带请求身份，只有可选的 `keyword`）：
   *
   * 1. **回调通道独占**：实例绑定的输入框在**调用时刻**必须不可输入（`readOnly` / `disabled` /
   *    `type="hidden"`）——HTML 控件的可编辑性随时可变，所以这是**每次调用都重新校验**的，
   *    而不是创建实例时定死；一旦观察到可输入，该实例会被**永久**标记为失去独占（不因为随后
   *    又变回只读而恢复，因为可编辑期间触发的原生请求可能仍在等回包），需要重建实例。
   *    等待回包期间失去独占时，在飞的调用也会被**显式失败**，不会接受可能来自用户输入的结果；
   * 2. **同关键词互斥**：该实例上不能已有同关键词的未完成请求，等它结算（或改用不同关键词）
   *    之后再调用。
   *
   * 彻底去掉这些限制需要「每次请求一个独立实例 + 回调闭包」，属 M7（#38 / #41）。
   */
  suggest(
    handle: ServiceHandle<"service:autocomplete">,
    keyword: string,
  ): ServiceCall<PlaceSuggestion[]>;

  /**
   * 关键字检索（`LocalSearch#search`）。
   *
   * 与 `suggest()` 的差别不是「换了个类」：**LocalSearch 不绑输入框**（没有用户输入与程序化
   * 检索共用回调的问题）。但它的**回包归属**反而更受约束——见下。
   *
   * **归属模型：一个实例同一时刻只有一个未结算操作**（`search` / `searchNearby` /
   * `searchInBounds` / `gotoPage` 共用同一套规则）。
   *
   * 为什么不是「FIFO + keyword 校验」：官方只承诺**单次多关键字检索内部**结果数组与关键字
   * 数组顺序一致，**没有**承诺多次请求之间的回调顺序；`LocalResult.keyword` 也不是请求身份
   * （同关键词重查时完全等价）。按到达顺序归属在乱序回包下会确定性出错——「cancel A → search
   * B」时 B 的回包先到会被判成不属于在册请求而丢弃，旧 A 的回包反而可能结算新请求（stale data）。
   * 因此本库不再猜：**同一实例同一时刻只允许一个未结算操作**，归属与到达顺序无关。
   *
   * 由此派生三条对调用方可见的契约：
   *
   * 1. **并发被显式拒绝**：实例上已有未结算操作（含已取消/已超时、但其回包可能仍在路上的那次）
   *    时，新调用以 `failed(BMAP_SERVICE_FAILED)` 结算，并提示重建实例；
   * 2. **取消 = 该实例不再可用**：SDK 没有取消入口（JSONP 发出去收不回），`cancel()` 只把本次
   *    `ServiceCall` 结算成 `canceled`；这个实例的迟到回包无法与后续请求区分，因此它从此拒绝
   *    新的检索。要继续请 `disposeLocalSearch()` 后**重建实例**（返回的说明里也这么写）；
   * 3. **超时同理**：超时不代表 SDK 侧请求消失，因此该实例同样需要重建。
   *
   * 参数非法（空关键字 / 非法坐标 / 非法半径）走 `failed(BMAP_INVALID_ARGUMENT)`；
   * 句柄不属于本 Driver 时同步抛 `BMAP_HANDLE_FOREIGN`（与其余调用面同源）。
   */
  search(
    handle: ServiceHandle<"service:local-search">,
    keyword: LocalSearchKeyword,
    option?: LocalSearchSearchOption,
  ): ServiceCall<LocalSearchResult[]>;

  /** 周边检索（`LocalSearch#searchNearby`），归属规则同 `search()`。 */
  searchNearby(
    handle: ServiceHandle<"service:local-search">,
    request: LocalSearchNearbyRequest,
  ): ServiceCall<LocalSearchResult[]>;

  /** 范围检索（`LocalSearch#searchInBounds`），归属规则同 `search()`。 */
  searchInBounds(
    handle: ServiceHandle<"service:local-search">,
    request: LocalSearchInBoundsRequest,
  ): ServiceCall<LocalSearchResult[]>;

  /**
   * 翻页（`LocalSearch#gotoPage`），归属规则同 `search()`。
   *
   * 页码无效时官方**仍会**触发 `onSearchComplete` 并把状态设为 `INVALID_REQUEST`（5），
   * 因此这次调用会以 `failed({ code: 5 })` 结算——不虚构原因，就是官方给的那个码。
   */
  gotoPage(
    handle: ServiceHandle<"service:local-search">,
    page: number,
  ): ServiceCall<LocalSearchResult[]>;

  /* -------------------------------------------------- 路线规划（M7-ROUTES / #39） */

  /**
   * 驾车路线检索（`DrivingRoute#search`）。
   *
   * **归属模型与 `search()` 完全一致**（同一个 Driver、同一份记账）：路线服务也只有一条
   * `onSearchComplete`，回包里没有请求身份，官方也没有承诺多次请求之间的回调顺序。因此同样按
   * 「**一个实例同一时刻只有一个未结算操作**」归属——并发被显式拒绝、取消/超时之后该实例不再接受
   * 新检索（调用方侧 `useBMapServiceTask` 的 `supersede: "recreate"` 会在下一次检索时换新实例）。
   *
   * 端点形态上驾车是**最窄的那一个**：官方签名 `search(start: Point | LocalResultPoi, end: …,
   * options?: { waypoints })` 里没有 `string`，因此传地名在类型层就被拒（`BMAP_INVALID_ARGUMENT`）。
   */
  searchDrivingRoute(
    handle: ServiceHandle<"service:driving-route">,
    request: DrivingRouteRequest,
  ): ServiceCall<DrivingRouteResult>;
  /** 步行路线检索（`WalkingRoute#search`），归属规则同 `searchDrivingRoute()`。 */
  searchWalkingRoute(
    handle: ServiceHandle<"service:walking-route">,
    request: RouteRequest,
  ): ServiceCall<WalkingRouteResult>;
  /** 骑行路线检索（`RidingRoute#search`），归属规则同 `searchDrivingRoute()`。 */
  searchRidingRoute(
    handle: ServiceHandle<"service:riding-route">,
    request: RouteRequest,
  ): ServiceCall<RidingRouteResult>;
  /** 公交路线检索（`TransitRoute#search`），归属规则同 `searchDrivingRoute()`。 */
  searchTransitRoute(
    handle: ServiceHandle<"service:transit-route">,
    request: TransitRouteRequest,
  ): ServiceCall<TransitRouteResult>;

  /**
   * 清除最近一次路线检索的结果（官方四个服务共有的 `clearResults()`）。
   *
   * 官方文档对它的描述是「清除最近一次检索的结果，**同时清除地图上的路线和标注**」——因此它正是
   * 「显式 render 之后把本服务生成的 Marker / Polyline / Panel 收回来」的那个入口，不需要（也不
   * 应该）由本库另外去枚举 SDK 画出来的覆盖物。
   *
   * **没有回包**，因此不是 `ServiceCall`：与「取消一个在飞请求」（`ServiceCall.cancel()`）是两件事。
   * 实例仍可继续检索（下一次 `search*Route` 会重新画）。
   */
  clearRouteResults(handle: RouteServiceHandle): void;

  /**
   * 释放路线服务实例（幂等；四类服务共用）。
   *
   * 与 `disposeLocalSearch()` 同一套语义与实现（`disposeServiceInstance`）：① 停止接受业务调用并把
   * 在飞调用显式失败；② 解绑 Driver 侧订阅；③ 走**公开的** `clearResults()` 收回已画出的路线与标注
   * ——这一步**只有成功才记账**，抛错时句柄保持不可用、再次调用会重试。
   *
   * 官方四个路线服务都**没有** `dispose()`（4.0.4 声明里是 `clearResults` / `setPolylineStyle` /
   * `getStatus` …），所以「有没有释放入口」这件事与 `LocalSearch` 同档：实例本身随 GC，真正的资源
   * 是它**交付出去的结果**（地图上的折线与标注、写进 `panel` 的 DOM），由 `clearResults()` 销账。
   */
  disposeRoute(handle: RouteServiceHandle): void;
}

/** JSAPI 4.0 的 Service Facet：创建面 + 归一化调用面 + **持有 Driver 侧资源的服务**的释放入口。 */
export interface JsapiV4ServiceDriver extends ServiceDriver, ServiceInvocationDriver {
  /**
   * 释放 **Autocomplete** 服务实例（幂等）。
   *
   * 语义：① 停止接受该实例的业务调用；② 解绑 Driver 侧资源（输入活动监听）并把在飞的 `suggest()`
   * 显式失败；③ 调用 SDK 自身的 `dispose()`——**只有成功才记账**，抛错时调用方收到错误，句柄仍保持
   * 不可用，再次调用会**重试**未完成的 SDK 清理。
   *
   * **为什么是专用入口、而不是通用 `dispose(ServiceHandle<string>)`**：契约必须与实现一致。**只有**
   * `Autocomplete`（输入活动监听 + 待回包队列）与 `LocalSearch`（待回包队列）在 Driver 侧持有资源；
   * 其余服务（Geocoder / Boundary / Convertor / LocalCity / Geolocation）的调用既没有登记在飞请求、
   * 也没有释放标记——通用入口会承诺「在飞调用会失败、释放后拒绝新调用」而实现做不到。
   * 这条取舍（以及「统一状态口径由 composable 侧的 `useBMapServiceTask` 承担」）冻结在 ADR
   * `2026-09-14-service-lifecycle-and-local-search.md`。
   *
   * 只用输入框联想 UI（不调用 `suggest()`）的实例也**应该**在结束使用时调用它：输入框通常比实例
   * 活得久，Driver 挂在它上面的监听器不会随 SDK 实例被回收而消失。
   */
  disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">): void;

  /**
   * 清除最近一次检索的结果（`LocalSearch#clearResults`）：同时清掉地图上的标注与结果面板。
   *
   * **没有回包**（官方无回调），因此不发生成 `ServiceCall`——语义是「丢弃 SDK 侧的可见结果」，
   * 与「取消一个在飞请求」（`ServiceCall.cancel()`）是两件事。纯 headless（未传
   * `renderOptions.map`）时它仍然有意义：结果的内部状态与 `getResults()` 会被清掉。
   *
   * 调用方**不需要**在 `disposeLocalSearch` 之前调用它。
   */
  clearLocalSearch(handle: ServiceHandle<"service:local-search">): void;

  /**
   * 释放本地检索实例（幂等）。
   *
   * ① 停止接受该实例的业务调用并**把在飞调用显式失败**；② 解绑 Driver 侧资源（EventDriver 订阅）；
   * ③ **清掉 SDK 侧已画出的结果**——官方 `LocalSearch` **没有** `dispose()`（`4.0.4` 的声明里只有
   * `clearResults` / `clearSelected` / `setSearchCompleteCallback` / `getStatus` …），因此这一步走
   * 公开的 `clearResults()`：它同时清掉地图上的标注与结果面板。这一步**只有成功才记账**，抛错时
   * 调用方收到错误，句柄仍保持不可用，再次调用会**重试**未完成的清理。
   *
   * 与 `clearLocalSearch()` 的区别：后者只清结果、实例仍可继续检索；本入口把实例置为**终态**。
   *
   * 为什么 LocalSearch 需要专用释放入口、而 Geocoder 等不需要：它在 Driver 侧持有在飞请求记账，
   * 并且是**唯一**会把覆盖物画到地图上的服务（`renderOptions.map`）——那些覆盖物不会随实例被 GC
   * 回收，必须由这里收回。其余服务（Geocoder / Boundary / Convertor / LocalCity / Geolocation）
   * 的调用不持有 Driver 侧资源，因此仍然没有通用 `dispose(ServiceHandle<string>)`。
   */
  disposeLocalSearch(handle: ServiceHandle<"service:local-search">): void;
}
