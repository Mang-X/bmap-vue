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
 * 四个操作**共用**一条 `onSearchComplete`（实例单例回调），而除 `gotoPage` 外的操作各自带
 * 关键字。归属因此按「请求顺序 + 关键字」判定：回包带回的 `keyword` 与队首期望的关键字
 * 不一致时，这次回包**不属于**在册请求（不消费队列槽位），见 `JsapiV4ServiceDriver.search`
 * 的契约说明。
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
}

/** JSAPI 4.0 的 Service Facet：创建面 + 归一化调用面 + **Autocomplete 专用**释放入口。 */
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
