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
import type { Point } from "./geometry";

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
 * `undefined` = 不改这一项（刻意不用 `null` 表达「清空」：`setLocation` / `setTypes` 在官方 4.0.4
 * 声明里都不接受 `null`，用 `null` 只会得到一个 SDK 侧的类型错误）。
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

export interface GeocodedAddress {
  address: string;
  point: Point | null;
  /** 所属商圈 */
  business: string | null;
  /** 附近 POI 数量（官方 `surroundingPois` 的长度；只暴露计数，POI 结构属 M7 #38） */
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
  /** 行政区边界（`Boundary#get`）→ 坐标点串数组（每串一个闭合环） */
  queryBoundary(
    handle: ServiceHandle<"service:boundary">,
    request: BoundaryRequest,
  ): ServiceCall<Point[][]>;
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
   * **为什么是专用入口、而不是通用 `dispose(ServiceHandle<string>)`**：契约必须与实现一致。目前只有
   * Autocomplete 在 Driver 侧持有资源（输入活动监听 + 待回包队列），其余服务（Geocoder / Boundary /
   * Convertor / LocalCity / Geolocation）的调用没有登记在飞请求、也没有释放标记——通用入口会承诺
   * 「在飞调用会失败、释放后拒绝新调用」而实现做不到。统一的服务生命周期（在飞请求登记 + 取消）
   * 属 M7（#38 的 ServiceSpec / AsyncTaskController）。
   *
   * 只用输入框联想 UI（不调用 `suggest()`）的实例也**应该**在结束使用时调用它：输入框通常比实例
   * 活得久，Driver 挂在它上面的监听器不会随 SDK 实例被回收而消失。
   */
  disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">): void;
}
