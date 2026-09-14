/**
 * v4 ServiceDriver（M3A2-SERVICES-NATIVE / issue #23；LocalSearch 属 M7-SERVICE-CORE / #38）
 *
 * 两件事写在同一处，因为它们必须一起成立：
 *
 * 1. **创建面**（`ServiceDriver`）：7 项服务 + `ViewAnimation` 经 `namespaceCtor` 创建，
 *    实例一律 `registry.adopt` 成句柄（跨 Client 混用抛 `BMAP_HANDLE_FOREIGN`）；
 * 2. **归一化调用面**（`ServiceInvocationDriver`）：SDK 的 callback 风格收敛成
 *    `ServiceCall<ServiceResult<T>>`（`../normalize/serviceCall`），业务不再需要自己写
 *    「超时 / 空结果 / 迟到回调」三件套。
 *
 * 行为依据（官方 4.0 API 参考 + `@baidumap/jsapi-v4-types@4.0.4`）：
 * - `Geocoder#getPoint/getLocation`、`Convertor#translate`、`Boundary#get`、`LocalCity#get`、
 *   `Geolocation#getCurrentPosition` + `getStatus`、`Autocomplete#search` /
 *   `AutocompleteOptions.onSearchComplete`、`LocalSearch#search/searchNearby/searchInBounds/
 *   gotoPage/getResults/clearResults/getStatus` 是各自唯一的调用入口；
 * - `Autocomplete#setLocation` / `#setTypes` 是官方声明里的实例更新入口（`serviceDriver.
 *   setAutocompleteOptions` 的落点），组件因此不需要碰 `.raw`；
 * - **只看公开回调参数与实例状态**（R25-C / #72）：`Geocoder#getPoint/getLocation`、
 *   `Boundary#get`、`LocalCity#get` 失败时只回 `null`，**没有**公开的错误码入口
 *   （服务端错误码在 JSONP 私有回调注册表里）。因此归一化结果只有两种：
 *   有结果 → `success`；回 `null` 或空容器 → `empty`（「没有结果或服务当前不可用」）。
 *   本库**不**去嗅探 `_rd` 之类的私有面，也不制造精确错误码——见 ADR
 *   `2026-09-13-private-sdk-surface-removal.md`。只有 SDK 公开给出状态码的服务
 *   （`Geolocation#getStatus()` / `LocalSearch#getStatus()` → `BMAP_STATUS_*`、
 *   `Convertor#translate` 回包的 `status`）才走 `failed` 并带上那个码；
 * - `Geolocation` 与 `LocalSearch` 是公开带状态码的服务，因此 `sdkStatus` 恒有值
 *   （拿不到时如实为 `null`，不伪装成 0）；
 * - `Autocomplete` 是**事件式**服务：`search()` 只负责发起请求，结果经构造选项的
 *   `onSearchComplete` 回来。归一化调用因此由 Driver 在创建时挂一个**内部分发器**：
 *   既结算 pending 的 `suggest()`，也把同一个回调转给调用方传入的 `onSearchComplete`
 *   （不吞掉业务本来就有的监听）；
 * - `LocalSearch` 同样是**事件式**服务，但**不绑输入框**；它的归属**不**依赖回包顺序或 `keyword`
 *   （官方没有承诺跨请求顺序，`keyword` 也不是请求身份），而是靠「**一个实例一个未结算操作**」
 *   这条不变式：并发显式拒绝，取消/超时之后该实例要重建。见 `search()` 的契约与 ADR 决策 4；
 * - `TrackAnimation` 属 `BMapGLLib` 插件、不在 4.0 的运行时入口里（Catalog
 *   `service.track-animation` 为 `unsupported`，迁移结论属 M8 #43），因此**显式失败**
 *   而不是静默给一个不能用的实例——4.0 的对应能力是原生图层 `TrackLine`。
 */
import { BMapError } from "../../core/errors/BMapError";
import { createServiceCall } from "../normalize/serviceCall";
import { toPlainPoint } from "../normalize/results";
import type { Capability } from "../capability/catalog";
import type { CapabilityRegistry } from "../capability/registry";
import type { GeometryDriver, Point } from "../types/geometry";
import { HANDLE_BRAND, type MapHandle, type SdkHandle, type ServiceHandle } from "../types/handles";
import type {
  AutocompleteOptions,
  AutocompleteUpdateOptions,
  BoundaryRequest,
  BoundaryRings,
  ConvertorRequest,
  DrivingPolicy,
  DrivingRouteOptions,
  DrivingRouteRequest,
  DrivingRouteResult,
  GeocodeRequest,
  GeocodedAddress,
  GeocodedAddressComponents,
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
  IntercityPolicy,
  JsapiV4ServiceDriver,
  LocalCityFix,
  LocalSearchBounds,
  LocalSearchInBoundsRequest,
  LocalSearchKeyword,
  LocalSearchNearbyRequest,
  LocalSearchOptions,
  LocalSearchPoi,
  LocalSearchRenderOptions,
  LocalSearchResult,
  LocalSearchSearchOption,
  PlaceSuggestion,
  ReverseGeocodeRequest,
  RidingRouteOptions,
  RidingRouteResult,
  RouteEndpoint,
  RouteEndpointInfo,
  RouteLeg,
  RoutePlan,
  RouteRenderOptions,
  RouteRequest,
  RouteResult,
  RouteServiceHandle,
  RouteServiceKind,
  RouteStep,
  RouteTaxiFare,
  RouteTaxiFareDetail,
  ServiceCall,
  ServiceCallSettle,
  TransitLineSegment,
  TransitPolicy,
  TransitRouteOptions,
  TransitRoutePlan,
  TransitRouteRequest,
  TransitRouteResult,
  TransitRouteSegment,
  TransitVehiclePolicy,
  WalkingRouteOptions,
  WalkingRouteResult,
} from "../types/services";
import {
  assertJsapiV4Namespace,
  callRequired,
  createWarnOnce,
  isObjectLike,
  namespaceCtor,
  readNamespaceMember,
  sdkCall,
  type JsapiV4Namespace,
} from "./internal";
import type { JsapiV4EventDriver } from "./events";
import type { JsapiV4HandleRegistry } from "./registry";

/* -------------------------------------------------------------------------- */
/* raw 形状（结构化访问，不引入官方类型）                                        */
/* -------------------------------------------------------------------------- */

interface RawPoint {
  lng: number;
  lat: number;
}

interface RawTranslatePayload {
  status?: number;
  points?: RawPoint[];
  message?: string;
}

interface RawBoundaryPayload {
  boundaries?: unknown;
}

interface RawGeolocationPayload {
  point?: RawPoint;
  accuracy?: number;
  address?: GeolocationAddressInfo;
}

interface RawLocalCityPayload {
  name?: string;
  center?: RawPoint;
  level?: number;
}

interface RawAutocompletePoi {
  province?: string;
  city?: string;
  district?: string;
  street?: string;
  streetNumber?: string;
  business?: string;
}

interface RawAutocompleteResult {
  /** 检索关键字（官方 `AutocompleteResult.keyword`；运行时不保证填充） */
  keyword?: string;
  getNumPois?: () => number;
  getPoi?: (index: number) => RawAutocompletePoi | undefined;
}

/** `LocalSearch#onSearchComplete` 回包的单个结果点（官方 `LocalResultPoi`）。 */
interface RawLocalSearchPoi {
  title?: unknown;
  uid?: unknown;
  point?: unknown;
  address?: unknown;
  city?: unknown;
  province?: unknown;
  phoneNumber?: unknown;
  postcode?: unknown;
  adcode?: unknown;
  tags?: unknown;
  isAccurate?: unknown;
  url?: unknown;
  detailUrl?: unknown;
}

/** `LocalSearch#onSearchComplete` 回包（官方 `LocalResult`；多关键字时是它的数组）。 */
interface RawLocalResult {
  keyword?: unknown;
  center?: unknown;
  radius?: unknown;
  bounds?: unknown;
  city?: unknown;
  province?: unknown;
  moreResultsUrl?: unknown;
  suggestions?: unknown;
}

/* -------------------------------------------------------------------------- */
/* 常量与纯函数                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * `Geolocation#getStatus()` 的失败状态码 → 可读原因。
 *
 * 键是**数值字面量**而不是全局 `BMAP_STATUS_*`（Driver 只认 `rawSdk` 传入的命名空间，
 * 不读未经 Provider 校验的全局），与官方 `const/StatusCodes.d.ts` 的一致性由文件末尾的
 * 类型断言钉死。
 */
const GEOLOCATION_FAILURE_REASONS = {
  2: "位置未知",
  6: "定位权限被拒绝",
  7: "定位服务不可用",
  8: "定位超时",
} as const;

/** 服务 ↔ Catalog 能力（能力清单是单一事实源：`driver/capability/catalog.ts`）。 */
const SERVICE_CAPABILITIES = {
  createGeocoder: "service.geocoder",
  createConvertor: "service.convertor",
  createGeolocation: "service.geolocation",
  createLocalCity: "service.local-city",
  createBoundary: "service.boundary",
  createAutocomplete: "service.autocomplete",
  createLocalSearch: "service.local-search",
  // 四类路线服务（M7-ROUTES / #39）在 Catalog 里都是 `native`（服务模块存在、签名已核对）
  createDrivingRoute: "service.driving-route",
  createWalkingRoute: "service.walking-route",
  createRidingRoute: "service.riding-route",
  createTransitRoute: "service.transit-route",
} as const satisfies Record<string, Capability>;

/**
 * `LocalSearch#getStatus()` 的失败状态码 → 可读原因（0 = 成功、1 = 城市列表不是失败）。
 *
 * 与 `GEOLOCATION_FAILURE_REASONS` 同样的口径：`LocalSearch` 是**公开给出状态码**的服务，
 * 因此失败走 `failed` 并带上官方那个码；码表里没有的码原样透传成 `状态码 N`，不编造。
 */
const LOCAL_SEARCH_FAILURE_REASONS = {
  2: "位置未知",
  4: "非法密钥",
  5: "非法请求（关键词或页码无效）",
  6: "没有权限",
  7: "服务不可用",
  8: "超时",
} as const;

/** `null` / `0`（成功）/ `1`（城市列表）之外的状态码都是失败。 */
function isLocalSearchFailureStatus(status: number | null): status is number {
  return status !== null && status !== 0 && status !== 1;
}

function describeLocalSearchStatus(status: number): string {
  return (
    LOCAL_SEARCH_FAILURE_REASONS[status as keyof typeof LOCAL_SEARCH_FAILURE_REASONS] ??
    `检索失败（状态码 ${status}）`
  );
}

/**
 * 路线服务的失败状态码 → 可读原因（M7-ROUTES / #39）。
 *
 * **只列 3..8**：官方对四个路线服务的 `getStatus()` 声明的是 `ServiceStatus`（`BMAP_STATUS_*`：
 * 0 成功 / 1 城市列表 / 2 位置未知 / 3 导航未知 / 4 非法密钥 …），但同一个类型包里还有一套
 * `RouteStatus`（`BMAP_ROUTE_STATUS_NORMAL` = 0 / `_EMPTY` = 1 / `_ADDRESS` = 2），**两套在 0..2
 * 区间重叠、语义却不同**（1：城市列表 vs 结果为空；2：位置未知 vs 仅返回地址信息）。官方没有说明
 * 路线服务的 `getStatus()` 到底回哪一套，因此本库**只解释两套读法一致的那一段**：
 *
 * - `≥ 3`：两套码表都表示失败（`BMAP_STATUS_UNKNOWN_ROUTE` / `UNKNOWN_LOCATION` / `INVALID_KEY` …），
 *   按 `failed` 上报并带上那个码——这正是「有公开原因的失败」；
 * - `0..2`（含读不到状态码时的 `null`）：两套读法都**不提供**「请求发了但结果不好」的公开原因，
 *   因此按 `empty` 上报。那正是 `empty` 的语义（没有可用结果，且**可以重试**）；报成 `failed`
 *   会让调用方以为「重试没用」，而事实上我们并不知道。
 */
const ROUTE_FAILURE_REASONS = {
  3: "导航未知（无法规划出路线）",
  4: "非法密钥",
  5: "非法请求",
  6: "没有权限",
  7: "服务不可用",
  8: "超时",
} as const;

/** 路线状态码按「两套码表一致的那一段」判定失败（见 `ROUTE_FAILURE_REASONS`）。 */
function isRouteFailureStatus(status: number | null): status is number {
  return status !== null && status >= 3;
}

function describeRouteStatus(status: number): string {
  return (
    ROUTE_FAILURE_REASONS[status as keyof typeof ROUTE_FAILURE_REASONS] ??
    `路线规划失败（状态码 ${status}）`
  );
}

export interface CreateJsapiV4ServiceDriverInput {
  /** v4 全局命名空间（`globalThis.BMap`）；raw SDK 只允许在 Driver/Client 边界读取。 */
  rawSdk: unknown;
  geometry: GeometryDriver;
  capabilities: CapabilityRegistry;
  registry: JsapiV4HandleRegistry;
  /**
   * 同 Client 的 v4 EventDriver：`disposeAutocomplete` 需要它的 target 释放入口
   * （与 Map / Panorama Facet 同一份，九轮复审 P2）。
   */
  events: JsapiV4EventDriver;
}

/** 把 `"lng1,lat1;lng2,lat2;…"` 的边界点串解析成坐标数组（非法片段直接丢弃）。 */
export function parseBoundaryRing(value: unknown): Point[] {
  if (typeof value !== "string") return [];
  const ring: Point[] = [];
  for (const pair of value.split(";")) {
    const [lngText, latText] = pair.split(",");
    const lng = Number(lngText);
    const lat = Number(latText);
    if (Number.isFinite(lng) && Number.isFinite(lat)) ring.push({ lng, lat });
  }
  return ring;
}

/** `province + city + district + street` 的结构化地址（`business` 为空时的标题）。 */
function composeAddress(poi: RawAutocompletePoi): string {
  return [poi.province, poi.city, poi.district, poi.street]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("");
}

/** `AutocompleteResult` → 领域条目（`getPoi` / `getNumPois` 是官方唯一读法）。 */
export function readSuggestions(
  results: RawAutocompleteResult | null | undefined,
): PlaceSuggestion[] {
  if (
    !results ||
    typeof results.getNumPois !== "function" ||
    typeof results.getPoi !== "function"
  ) {
    return [];
  }
  const count = results.getNumPois();
  if (!Number.isFinite(count) || count <= 0) return [];
  const suggestions: PlaceSuggestion[] = [];
  for (let index = 0; index < count; index += 1) {
    const poi = results.getPoi(index);
    if (!poi) continue;
    suggestions.push({
      title: poi.business || composeAddress(poi),
      address: composeAddress(poi),
      index,
    });
  }
  return suggestions;
}

/**
 * 读服务实例的 `getStatus()`（`Geolocation` 与 `LocalSearch` 是本文档里公开状态码的两个服务）。
 *
 * 成员缺失或调用失败时返回 `null`（不把缺成员伪装成状态 0）：状态码只用于**补充**公开原因，
 * 拿不到就如实说「拿不到」，而不是编一个 0。
 */
function readServiceStatus(
  raw: Record<string, unknown>,
  warn: (key: string, message: string) => void,
  label: string,
): number | null {
  const fn = readNamespaceMember(raw, "getStatus");
  if (typeof fn !== "function") return null;
  try {
    const status = (fn as () => unknown).call(raw);
    return typeof status === "number" ? status : null;
  } catch (error) {
    warn(
      `${label}:getStatus`,
      `${label}: getStatus() 调用失败，状态码按未知处理：${
        (error as Error)?.message ?? String(error)
      }`,
    );
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* LocalSearch 结果投影（#38）                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 可选成员的统一读法：**成员缺失、调用抛错、或返回值形状不对**时一律返回 `undefined`。
 *
 * 这里用 try/catch 而不是「前置校验 + 直接调用」是刻意的：这些读取器只用来**补全**一份已经
 * 拿到手的载荷（`getCityList` / `getBounds` / `getPageIndex` …），任何一个可选成员在某个
 * 运行时上抛错，都不应该把整次检索变成失败——那会把「某个 getter 不可用」升级成「检索不可用」。
 * 必需成员（`getPoi` / `getCurrentNumPois`）走另一条路：缺失时整份载荷被判为「不是 LocalResult」。
 */
function readOptionalMember(
  target: unknown,
  method: string,
  ...args: unknown[]
): unknown {
  const fn = readNamespaceMember(target, method);
  if (typeof fn !== "function") return undefined;
  try {
    return (fn as (...a: unknown[]) => unknown).apply(target, args);
  } catch {
    return undefined;
  }
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readOptionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** `{ lng, lat }` 形状 + 有限数校验；不满足返回 `null`（不把非法坐标写成 0/0）。 */
function readPointLike(value: unknown): Point | null {
  if (!isObjectLike(value)) return null;
  const record = value as Record<string, unknown>;
  const lng = readOptionalFiniteNumber(record.lng);
  const lat = readOptionalFiniteNumber(record.lat);
  return lng === null || lat === null ? null : { lng, lat };
}

/** raw `Bounds`（`getSouthWest` / `getNorthEast`）→ 领域矩形；空 Bounds 返回 `null`。 */
function readBoundsLike(value: unknown): LocalSearchBounds | null {
  if (!isObjectLike(value)) return null;
  const southwest = readPointLike(readOptionalMember(value, "getSouthWest"));
  const northeast = readPointLike(readOptionalMember(value, "getNorthEast"));
  if (!southwest || !northeast) return null;
  return { southwest, northeast };
}

/** `LocalResultPoi` → 领域条目。非对象返回 `null`（编造的条目比丢一条更糟）。 */
export function readLocalSearchPoi(value: unknown): LocalSearchPoi | null {
  if (!isObjectLike(value)) return null;
  const poi = value as RawLocalSearchPoi;
  return {
    title: readOptionalString(poi.title) ?? "",
    uid: readOptionalString(poi.uid) ?? "",
    point: readPointLike(poi.point),
    address: readOptionalString(poi.address),
    city: readOptionalString(poi.city),
    province: readOptionalString(poi.province),
    phoneNumber: readOptionalString(poi.phoneNumber),
    postcode: readOptionalString(poi.postcode),
    adcode: readOptionalString(poi.adcode),
    tags: readStringList(poi.tags),
    isAccurate: readOptionalBoolean(poi.isAccurate),
    url: readOptionalString(poi.url),
    detailUrl: readOptionalString(poi.detailUrl),
  };
}

/** 单个 `LocalResult` → 领域结果；**不是** `LocalResult`（缺 `getPoi`）时返回 `null`。 */
export function readLocalSearchResult(value: unknown): LocalSearchResult | null {
  if (!isObjectLike(value)) return null;
  const result = value as RawLocalResult;
  if (typeof readNamespaceMember(result, "getPoi") !== "function") return null;

  // `getCurrentNumPois()` 是**本页**条数（`getNumPois()` 是总条数）；读不到时按 0 处理，
  // 而不是拿总条数冒充本页条数——那会让 `pois` 之外的两个读数互相矛盾。
  const pageSize = readOptionalFiniteNumber(readOptionalMember(result, "getCurrentNumPois")) ?? 0;
  const pois: LocalSearchPoi[] = [];
  for (let index = 0; index < pageSize; index += 1) {
    const projected = readLocalSearchPoi(readOptionalMember(result, "getPoi", index));
    if (projected) pois.push(projected);
  }

  const cities: Array<{ name: string; count: number }> = [];
  const rawCities = readOptionalMember(result, "getCityList");
  if (Array.isArray(rawCities)) {
    for (const entry of rawCities) {
      if (!isObjectLike(entry)) continue;
      const name = readOptionalString((entry as Record<string, unknown>).city);
      if (name === null) continue;
      cities.push({
        name,
        count: readOptionalFiniteNumber((entry as Record<string, unknown>).numResults) ?? 0,
      });
    }
  }

  return {
    keyword: readOptionalString(result.keyword) ?? "",
    city: readOptionalString(result.city) ?? "",
    province: readOptionalString(result.province) ?? "",
    center:
      readPointLike(readOptionalMember(result, "getCenter")) ?? readPointLike(result.center),
    radius: readOptionalFiniteNumber(result.radius),
    // `getBounds()` 是官方读法；字段 `bounds` 只在部分实现上填充，作为退路（两者都读不到
    // 就是没有范围信息，返回 `null` 而不是编一个空矩形）
    bounds:
      readBoundsLike(readOptionalMember(result, "getBounds")) ?? readBoundsLike(result.bounds),
    pois,
    pageSize,
    total: readOptionalFiniteNumber(readOptionalMember(result, "getNumPois")) ?? pageSize,
    pageCount: readOptionalFiniteNumber(readOptionalMember(result, "getNumPages")) ?? 0,
    pageIndex: readOptionalFiniteNumber(readOptionalMember(result, "getPageIndex")) ?? 0,
    cities,
    moreResultsUrl: readOptionalString(result.moreResultsUrl),
    suggestions: readStringList(result.suggestions),
  };
}

/**
 * `onSearchComplete` 的回包 → 领域结果数组。
 *
 * 官方单关键字回单个 `LocalResult`、多关键字回 `LocalResult[]`（顺序与关键字数组一致）。
 * 本库统一归一成数组；载荷不是 `LocalResult`（`null` / 空数组 / 别的对象）时返回 `[]`，
 * 由调用方按「回包不可用」结算。
 */
export function readLocalSearchResults(payload: unknown): LocalSearchResult[] {
  const list = Array.isArray(payload) ? payload : [payload];
  const results: LocalSearchResult[] = [];
  for (const item of list) {
    const projected = readLocalSearchResult(item);
    if (projected) results.push(projected);
  }
  return results;
}

/* -------------------------------------------------------------------------- */
/* 路线结果投影（M7-ROUTES / #39）                                               */
/* -------------------------------------------------------------------------- */

/** 坐标数组读取：不是坐标的项直接丢弃（伪造一个 0/0 比丢一个点更糟）。 */
function readPointList(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  const points: Point[] = [];
  for (const item of value) {
    const point = readPointLike(item);
    if (point) points.push(point);
  }
  return points;
}

/** 成员是否可调用（与 `readOptionalMember` 的分工：这里只判存在，不调用）。 */
function hasMember(target: unknown, method: string): boolean {
  return typeof readNamespaceMember(target, method) === "function";
}

/** 官方 `getDistance(format?)` 一类的「数值 / 文本」双读法。 */
interface FormattedNumber {
  value: number | null;
  text: string | null;
}

function readFormatted(target: unknown, method: string): FormattedNumber {
  return {
    value: readOptionalFiniteNumber(readOptionalMember(target, method, false)),
    text: readOptionalString(readOptionalMember(target, method, true)),
  };
}

/** 结果里的端点（官方 `LocalResultPoi` 的领域投影；缺坐标时为 `null` 而不是 0/0）。 */
export function readRouteEndpointInfo(value: unknown): RouteEndpointInfo | null {
  if (!isObjectLike(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    title: readOptionalString(record.title) ?? "",
    point: readPointLike(record.point),
    uid: readOptionalString(record.uid) ?? "",
  };
}

/**
 * `Step` → 领域关键点。
 *
 * 判别键是 `getIndex()`（官方 `Step` 的唯一序号入口）：缺它说明这不是一个关键点，返回 `null`
 * ——把「形状不认识」降级成「这个关键点没有描述」会让调用方分不清两种「没有」。
 */
export function readRouteStep(value: unknown): RouteStep | null {
  if (!isObjectLike(value)) return null;
  const index = readOptionalFiniteNumber(readOptionalMember(value, "getIndex"));
  if (index === null) return null;
  const distance = readFormatted(value, "getDistance");
  return {
    index,
    position: readPointLike(readOptionalMember(value, "getPosition")),
    // `getDescription(includeHtml)`：官方默认带 HTML，这里只取**纯文本**（`false`）；
    // 要 HTML 的调用方本来就不该从数据层拿（那属于 UI 的事）。
    description: readOptionalString(readOptionalMember(value, "getDescription", false)),
    distance: distance.value,
    distanceText: distance.text,
    routeIndex: readOptionalFiniteNumber(readOptionalMember(value, "getRouteIndex")),
    planIndex: readOptionalFiniteNumber(readOptionalMember(value, "getPlanIndex")),
  };
}

/** `Route` → 领域路线；缺 `getPath()` 说明这不是一条路线，返回 `null`。 */
export function readRouteLeg(value: unknown): RouteLeg | null {
  if (!isObjectLike(value) || !hasMember(value, "getPath")) return null;
  const distance = readFormatted(value, "getDistance");
  const stepCount = readOptionalFiniteNumber(readOptionalMember(value, "getNumSteps")) ?? 0;
  const steps: RouteStep[] = [];
  for (let index = 0; index < stepCount; index += 1) {
    const step = readRouteStep(readOptionalMember(value, "getStep", index));
    if (step) steps.push(step);
  }
  return {
    index: readOptionalFiniteNumber(readOptionalMember(value, "getIndex")) ?? 0,
    planIndex: readOptionalFiniteNumber(readOptionalMember(value, "getPlanIndex")),
    routeType: readOptionalFiniteNumber(readOptionalMember(value, "getRouteType")),
    distance: distance.value,
    distanceText: distance.text,
    path: readPointList(readOptionalMember(value, "getPath")),
    steps,
  };
}

function readTaxiFareDetail(value: unknown): RouteTaxiFareDetail | null {
  if (!isObjectLike(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    initialFare: readOptionalFiniteNumber(record.initialFare),
    unitFare: readOptionalFiniteNumber(record.unitFare),
    totalFare: readOptionalFiniteNumber(record.totalFare),
  };
}

function readTaxiFare(value: unknown): RouteTaxiFare | null {
  if (!isObjectLike(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    day: readTaxiFareDetail(record.day),
    night: readTaxiFareDetail(record.night),
    distance: readOptionalFiniteNumber(record.distance),
    remark: readOptionalString(record.remark),
  };
}

/** `RoutePlan` → 领域方案；缺 `getNumRoutes()` 说明这不是一条方案，返回 `null`。 */
export function readRoutePlan(value: unknown, index: number): RoutePlan | null {
  if (!isObjectLike(value)) return null;
  const routeCount = readOptionalFiniteNumber(readOptionalMember(value, "getNumRoutes"));
  if (routeCount === null) return null;

  const distance = readFormatted(value, "getDistance");
  const duration = readFormatted(value, "getDuration");
  const legs: RouteLeg[] = [];
  for (let i = 0; i < routeCount; i += 1) {
    const leg = readRouteLeg(readOptionalMember(value, "getRoute", i));
    if (leg) legs.push(leg);
  }
  const dragPois: RouteEndpointInfo[] = [];
  const rawDragPois = readOptionalMember(value, "getDragPois");
  if (Array.isArray(rawDragPois)) {
    for (const item of rawDragPois) {
      const poi = readRouteEndpointInfo(item);
      if (poi) dragPois.push(poi);
    }
  }

  return {
    index,
    distance: distance.value,
    distanceText: distance.text,
    duration: duration.value,
    durationText: duration.text,
    // `getToll()` / `getTollDistance()` 只在官方 `DrivingRoutePlan` 接口里声明（4.0.4 的
    // `DrivingRouteResult#getPlan` 返回类型写的是 `RoutePlan`）⇒ **可选读取**：拿不到就是 `null`，
    // 不 augmentation、不告警——「这次没拿到」本身就是如实的表达。
    toll: readOptionalFiniteNumber(readOptionalMember(value, "getToll")),
    tollDistance: readOptionalFiniteNumber(readOptionalMember(value, "getTollDistance")),
    taxiFare: readTaxiFare(readOptionalMember(value, "getTaxiFare")),
    dragPois,
    legs,
  };
}

/** `Line` → 领域乘车段；缺 `getTitle()` 说明这不是一条线路，返回 `null`。 */
export function readTransitLineSegment(value: unknown): TransitLineSegment | null {
  if (!isObjectLike(value) || !hasMember(value, "getTitle")) return null;
  const record = value as Record<string, unknown>;
  const distance = readFormatted(value, "getDistance");
  return {
    kind: "line",
    title: readOptionalString(readOptionalMember(value, "getTitle")) ?? readOptionalString(record.title) ?? "",
    // 官方 `Line#type` 是**字段**（`LineType` 数值枚举），不是 getter
    lineType: readOptionalFiniteNumber(record.type),
    viaStops: readOptionalFiniteNumber(readOptionalMember(value, "getNumViaStops")),
    onStop: readRouteEndpointInfo(readOptionalMember(value, "getGetOnStop")),
    offStop: readRouteEndpointInfo(readOptionalMember(value, "getGetOffStop")),
    distance: distance.value,
    distanceText: distance.text,
    path: readPointList(readOptionalMember(value, "getPath")),
  };
}

/**
 * `TransitRoutePlan` → 领域公交方案；缺 `getNumTotal()` 说明这不是一条公交方案，返回 `null`。
 *
 * 分段按**官方自己的判别入口** `getTotalType(i)`（0 = 步行 `Route` / 1 = 乘车 `Line`）分流，
 * `getTotal(i)` 取对象——不用「有没有某个字段」这类形状特征（接口允许没有该字段的合法成员，
 * 特征识别会把它们误分类）。
 */
export function readTransitRoutePlan(value: unknown, index: number): TransitRoutePlan | null {
  if (!isObjectLike(value)) return null;
  const totalCount = readOptionalFiniteNumber(readOptionalMember(value, "getNumTotal"));
  if (totalCount === null) return null;

  const segments: TransitRouteSegment[] = [];
  for (let i = 0; i < totalCount; i += 1) {
    const type = readOptionalFiniteNumber(readOptionalMember(value, "getTotalType", i));
    const item = readOptionalMember(value, "getTotal", i);
    if (type === 0) {
      const leg = readRouteLeg(item);
      if (leg) segments.push({ kind: "walk", leg });
    } else if (type === 1) {
      const line = readTransitLineSegment(item);
      if (line) segments.push(line);
    }
    // 判别键不是 0/1 ⇒ 既不按步行也不按乘车读，丢弃该段（不猜）
  }

  const distance = readFormatted(value, "getDistance");
  const duration = readFormatted(value, "getDuration");
  return {
    index,
    distance: distance.value,
    distanceText: distance.text,
    duration: duration.value,
    durationText: duration.text,
    description: readOptionalString(readOptionalMember(value, "getDescription", false)),
    linesTitle: readOptionalString(readOptionalMember(value, "getLinesTitle")),
    walkDistance: readOptionalString(readOptionalMember(value, "getWalkDistance")),
    segments,
  };
}

/**
 * 路线结果的**信封**读取（四类服务共用）：`getNumPlans()` + `getPlan()` 是判别键。
 *
 * 两者缺一即认为「这不是我们认识的路线结果」⇒ 返回 `null`，由调用方结算成 `empty`；不伪造一个
 * 「0 条方案」的成功结果（那会把「契约变了」伪装成「这次没有路线」）。
 */
function readRouteEnvelope(
  value: unknown,
): { envelope: Omit<RouteResult<never>, "plans">; planCount: number } | null {
  if (!isObjectLike(value)) return null;
  const planCount = readOptionalFiniteNumber(readOptionalMember(value, "getNumPlans"));
  if (planCount === null || !hasMember(value, "getPlan")) return null;
  const record = value as Record<string, unknown>;
  return {
    envelope: {
      start: readRouteEndpointInfo(readOptionalMember(value, "getStart")),
      end: readRouteEndpointInfo(readOptionalMember(value, "getEnd")),
      policy: readOptionalFiniteNumber(record.policy),
      // 驾车 / 步行 / 骑行没有 `getTransitType()`，恒为 `null`（`readTransitRouteResult` 补它）
      transitType: null,
    },
    planCount,
  };
}

/** 路线结果 → 领域 DTO（驾车 / 步行 / 骑行）。 */
export function readRouteResult(value: unknown): RouteResult<RoutePlan> | null {
  const head = readRouteEnvelope(value);
  if (!head) return null;
  const plans: RoutePlan[] = [];
  for (let i = 0; i < head.planCount; i += 1) {
    const plan = readRoutePlan(readOptionalMember(value, "getPlan", i), i);
    if (plan) plans.push(plan);
  }
  return { ...head.envelope, plans };
}

/** 公交路线结果 → 领域 DTO（多一个 `getTransitType()`）。 */
export function readTransitRouteResult(value: unknown): RouteResult<TransitRoutePlan> | null {
  const head = readRouteEnvelope(value);
  if (!head) return null;
  const plans: TransitRoutePlan[] = [];
  for (let i = 0; i < head.planCount; i += 1) {
    const plan = readTransitRoutePlan(readOptionalMember(value, "getPlan", i), i);
    if (plan) plans.push(plan);
  }
  return {
    ...head.envelope,
    transitType: readOptionalFiniteNumber(readOptionalMember(value, "getTransitType")),
    plans,
  };
}

/** `AddressComponent` → 领域投影（缺项一律 `null`，不补空串——空串会被读成「真的有这个值」）。 */
export function readAddressComponents(value: unknown): GeocodedAddressComponents {
  const record = isObjectLike(value) ? (value as Record<string, unknown>) : {};
  return {
    province: readOptionalString(record.province),
    city: readOptionalString(record.city),
    district: readOptionalString(record.district),
    street: readOptionalString(record.street),
    streetNumber: readOptionalString(record.streetNumber),
  };
}

export function createJsapiV4ServiceDriver(
  input: CreateJsapiV4ServiceDriverInput,
): JsapiV4ServiceDriver {
  const { rawSdk, geometry, capabilities, registry, events } = input;
  const namespace: JsapiV4Namespace = assertJsapiV4Namespace(rawSdk);

  const warnOnce = createWarnOnce();

  /**
   * 同一 `Autocomplete` 实例的 pending 结算**队列**。
   *
   * > **这是未经真实运行时证明的假设（R25-C / #72 的显式标注）。** 下面的归属规则成立的前提是
   * > `AutocompleteResult.keyword` 确实等于「本次检索所用的关键字」、且同关键字的回包与请求一一
   * > 对应。这两条**都不在官方 4.0 文档的承诺范围内**（`keyword` 被声明为可选字段，运行时是否
   * > 填充未说明），本仓库也**没有**在真实 AK 上验证过。因此：
   * > - Capability Catalog 把 `service.autocomplete` 标为 `experimental`（不是 `native`）；
   * > - 归属规则只按「够用且可解释」设计（见下 1/2/3），并在无法归因时**拒绝**而不是猜；
   * > - 彻底的隔离（每次请求一个独立实例 + 回调闭包）属 M7（#38 / #41），本 issue 只做
   * >   「串行化 + 上界 + 标注」，不新增隐式请求调度框架。
   *
   * `Autocomplete#search()` **不带请求身份**：回包除了可选的 `keyword` 之外没有任何可用于
   * 归因的信息。因此归属规则必须与「同一关键词最多只有一个槽位」这条**不变式**配套使用
   * （由 `suggest()` 的前置拒绝保证），否则无论取最早还是取最新的同名项都只是按到达时间猜：
   *
   * 1. 回包**带 `keyword` 且队列里有同名项** ⇒ 取**最早**的同名项（回包与 `search()` 一一对应
   *    并按请求顺序到达；由于同关键词只有一个槽位，取最早即等于「就是它自己的那个」）；
   * 2. 回包**带 `keyword` 但队列里没有同名项** ⇒ **不消费任何槽位**（不属于任何 `suggest()`，
   *    或属于已被上界丢掉的旧请求）——落回 FIFO 会把用户输入触发的回包结算给下一个调用；
   * 3. 回包**不带 `keyword`**（运行时是否填充未在文档中承诺）⇒ 退化为**先进先出**。
   *
   * 两个直接推论：
   * - **被取消 / 已超时的那次 `search()` 的回包仍会到达**（SDK 没有取消入口），所以取消不能
   *   从队列里删掉自己的槽位——否则它的迟到回包会去结算**下一个**调用（旧结果污染新请求）；
   * - 取消 / 超时后的结算由适配器的「先到者胜」吸收（已结算的 `ServiceCall` 再收到 `success`
   *   是 no-op），墓碑只需要保证数量对齐；墓碑在自己那个回包到达时被移除。
   */
  const pendingSuggest = new WeakMap<
    object,
    Array<{ keyword: string; settle: ServiceCallSettle<PlaceSuggestion[]> }>
  >();

  /**
   * 待回包队列的上限。**达到上限时拒绝新调用，而不是淘汰旧记录**（PR #63 四轮复审 P2-1）：
   * 淘汰并不会取消 SDK 请求，被淘汰的请求的回包仍会到达；一旦它的关键词又出现在队列里
   * （例如取消旧 K 之后再查 K），那个回包就会被错误地结算给新调用。上限只作为「SDK 长期
   * 不回包」时的资源护栏，失败是显式的。
   */
  const MAX_PENDING_SUGGESTS = 16;

  const isQueueFull = (raw: Record<string, unknown>): boolean =>
    (pendingSuggest.get(raw)?.length ?? 0) >= MAX_PENDING_SUGGESTS;

  const enqueueSuggest = (
    raw: Record<string, unknown>,
    keyword: string,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw) ?? [];
    queue.push({ keyword, settle });
    pendingSuggest.set(raw, queue);
  };

  /** `search()` 同步抛错时回滚刚入队的槽位（没有请求就没有回包，留着会永久错位）。 */
  const dequeueSuggest = (
    raw: Record<string, unknown>,
    settle: ServiceCallSettle<PlaceSuggestion[]>,
  ): void => {
    const queue = pendingSuggest.get(raw);
    if (!queue) return;
    const index = queue.findIndex((entry) => entry.settle === settle);
    if (index >= 0) queue.splice(index, 1);
  };

  /**
   * 取出本次回包对应的 pending 结算（判定规则见 `pendingSuggest` 的注释）。
   *
   * 队列为空、或**回包带了 keyword 但队列里没有同名项**时返回 `null`：那种回包既不属于任何
   * `suggest()`（用户在输入框里打字会触发同一条 `onSearchComplete`），也可能是已被队列上界
   * 丢掉的旧请求的迟到回包。落回 FIFO 会把它结算给队列里的**下一个**调用（旧结果污染新请求），
   * 所以这里必须**不消费任何槽位**。
   */
  const shiftPending = (
    raw: Record<string, unknown>,
    results: RawAutocompleteResult | null | undefined,
  ): ServiceCallSettle<PlaceSuggestion[]> | null => {
    const queue = pendingSuggest.get(raw);
    if (!queue || queue.length === 0) return null;

    const keyword = typeof results?.keyword === "string" ? results.keyword : null;
    if (keyword === null) {
      // 回包不带 keyword（官方只承诺「可选」）⇒ 只能按顺序退化到队首
      return queue.shift()?.settle ?? null;
    }
    // 带 keyword ⇒ 取**最早**的同名项：回包与 `search()` 一一对应、且按请求顺序到达，
    // 因此最早那个就是本次回包的归属。取最新会把**旧回包塞给新请求**（三轮复审用「按请求
    // 顺序正常返回」的反例证明了这一点）。
    const index = queue.findIndex((entry) => entry.keyword === keyword);
    if (index < 0) return null;
    const [entry] = queue.splice(index, 1);
    return entry?.settle ?? null;
  };

  /**
   * 该关键词是否已有未完成的槽位（含已取消 / 已超时、但仍在等自己那个回包的墓碑）。
   *
   * `suggest()` 用它做**前置拒绝**：同关键词的重叠请求无法被归属（见 `suggest` 的注释），
   * 拒绝之后同一关键词在任意时刻最多只有一个槽位，回包归属与到达顺序无关。
   */
  const hasPendingKeyword = (raw: Record<string, unknown>, keyword: string): boolean =>
    (pendingSuggest.get(raw) ?? []).some((entry) => entry.keyword === keyword);

  /**
   * 回调通道**独占**的判定（五轮复审 P2 之后）。
   *
   * `Autocomplete` 只有一条 `onSearchComplete`，用户输入触发的检索与程序化 `search()` 共用它，
   * 而回包里没有任何「这次是谁触发的」信息——因此**可输入的实例上，同关键词的原生回包与程序化
   * 回包无法区分**。判定必须看输入框的**当前**状态（HTML 控件的可编辑性取决于当前的
   * `disabled` / `readonly` / `type`，构造之后随时可能变回可输入），所以：
   *
   * - `boundInput`：保留输入框引用，在**每次 `suggest()` 与每次回包**时重新校验；
   * - `lostExclusivity`：一旦观察到可输入就**永久失效**（不因为随后又变回只读而恢复资格——
   *   可编辑期间触发的旧请求可能仍在等回包），此后的 `suggest()` 与回包都明确失败/忽略，
   *   调用方需重建实例。
   *
   * 为什么不直接建一个「程序化专用实例」：真实 4.0 里不带 `input` 的实例**能构造但 `search()`
   * 不回包**（smoke 实测：`no-input` / `input: undefined` 都是「构造 ok；3s 内回包数=0」），
   * 而挂到文档的输入框才是 `search()` 能回包的前提——所以独占通道只能由调用方用「不可输入的
   * 输入框」表达，Driver 不替它造 DOM（DOM 所有权与释放路径都留在调用方一侧）。
   */
  const boundInput = new WeakMap<object, unknown>();
  const lostExclusivity = new WeakSet<object>();
  /**
   * 已进入**终态**的服务实例（`disposeAutocomplete()` / `disposeLocalSearch()`）：此后一律拒绝
   * 业务调用（释放时会把在飞调用显式失败）。
   *
   * 两类服务共用同一份记账：WeakSet 的键是 raw 实例，而一个 raw 对象只可能是其中一类，
   * 因此不存在互相污染；分开存只会让「服务实例终态」这件事有两个真相。
   */
  const disposedInstances = new WeakSet<object>();
  /** 清理**正在执行**（重入保护）：SDK 的销毁回调里再次调用 dispose 入口必须短路，
   *  否则同一个底层对象会被销毁两次（与 Map / Panorama Facet 同源）。 */
  const disposingInstances = new WeakSet<object>();
  /**
   * SDK 侧 `dispose()` **已成功执行**的实例。
   *
   * 与 `disposedInstances` 分开记账（八轮复审 P2-2）：SDK 销毁抛错时句柄必须保持「不再接受业务
   * 调用」，但**不能**因此跳过后续重试——只有成功才记账，失败留给下一次 dispose 入口重试。
   */
  const sdkDisposedInstances = new WeakSet<object>();
  /**
   * 绑定输入框上的「用户输入活动」监听（`input` 事件）——**释放路径见 `releaseInputWatcher`**。
   *
   * 六轮曾用 `MutationObserver` 观察属性变化，但**「属性被写过」不等于「曾经可输入」**（七轮复审
   * P2-2）：真实 Chromium 里 `input.readOnly = true` 重复赋同值同样会产生一条记录，于是「始终只读、
   * 只是随 loading 切 `disabled`」这类完全安全的用法会被永久禁用。
   *
   * 改为监听**输入活动**：它才是官方文档里原生检索的触发源（「输入框中的字符输入会触发检索」），
   * 既不误伤属性写入，又覆盖了 `解除只读 → 用户输入 → 恢复只读` 那个没有观察点的窗口。
   */
  const inputWatchers = new WeakMap<object, { target: EventTarget; listener: EventListener }>();

  /** 输入框是否可被用户输入（决定回调通道是否独占）。缺输入框时按「不独占」处理。 */
  const isTypableInput = (input: unknown): boolean => {
    if (typeof input !== "object" || input === null) return false;
    const el = input as { readOnly?: unknown; disabled?: unknown; type?: unknown };
    if (el.readOnly === true || el.disabled === true) return false;
    return el.type !== "hidden";
  };

  const EXCLUSIVITY_LOST_HINT = "请重建 Autocomplete 实例（用不可输入的输入框）后再做程序化检索";

  /**
   * 解绑输入框上的输入活动监听。**这是监听器的唯一释放路径**，必须在实例进入终态时调用
   * （失去独占 / 被 `dispose()`）：输入框通常比实例活得久，不解绑就会让监听器长期持有旧的 raw
   * 实例与闭包（七轮复审 P2-1）。
   */
  const releaseInputWatcher = (raw: Record<string, unknown>): void => {
    const watcher = inputWatchers.get(raw);
    if (!watcher) return;
    inputWatchers.delete(raw);
    try {
      watcher.target.removeEventListener("input", watcher.listener);
    } catch {
      /* 解绑失败不阻断：输入框可能已被替换或宿主未完整实现 EventTarget */
    }
  };

  /**
   * 标记实例失去独占，并把在飞的程序化请求**显式失败**：那些回包可能来自用户输入，不能再被当成
   * 程序化检索的结果（宁可失败也不猜）。永久生效，见 `lostExclusivity`。
   */
  const loseExclusivity = (raw: Record<string, unknown>, reason: string): void => {
    if (lostExclusivity.has(raw)) return;
    lostExclusivity.add(raw);
    // 释放路径：监听器只在「实例可能被用于程序化检索」期间需要，终止态一定解绑，
    // 不留下持有输入框与闭包的活监听器。
    releaseInputWatcher(raw);
    const queue = pendingSuggest.get(raw) ?? [];
    pendingSuggest.delete(raw);
    for (const entry of queue) {
      entry.settle.failed({ code: "BMAP_SERVICE_FAILED", message: reason });
    }
  };

  /**
   * 开始监听输入框的**输入活动**（`input` 事件）。
   *
   * 绑定失败时静默退化为「每次检查当前状态」——监听能力缺失不应让实例不可用。
   */
  const watchInputActivity = (raw: Record<string, unknown>, input: unknown): void => {
    if (typeof input !== "object" || input === null) return;
    const target = input as Partial<EventTarget>;
    if (typeof target.addEventListener !== "function") return;
    const listener: EventListener = () => {
      loseExclusivity(
        raw,
        "该 Autocomplete 实例绑定的输入框在实例使用期间收到过用户输入：用户输入会触发原生检索，" +
          "其回包与程序化检索无法区分（可能把用户那次的结果当成程序化调用的结果）；" +
          EXCLUSIVITY_LOST_HINT,
      );
    };
    try {
      target.addEventListener("input", listener);
      inputWatchers.set(raw, { target: target as EventTarget, listener });
    } catch {
      /* 非 DOM 环境等：退化为每次检查当前状态 */
    }
  };

  /** 每次调用 / 每次回包都要跑的独占校验；返回失败原因（null 表示仍然独占）。 */
  const exclusivityFailure = (raw: Record<string, unknown>): string | null => {
    if (disposedInstances.has(raw)) {
      return "该服务实例已被 disposeAutocomplete() 释放：请重建实例后再做程序化检索";
    }
    if (lostExclusivity.has(raw)) {
      return `该 Autocomplete 实例已失去回调通道独占（输入框曾可输入、或收到过用户输入）：${EXCLUSIVITY_LOST_HINT}`;
    }
    if (isTypableInput(boundInput.get(raw))) {
      const message =
        "该 Autocomplete 实例绑定的输入框当前可输入：用户输入触发的检索与程序化检索共用同一条 " +
        "onSearchComplete，关键词相同时回包无法区分（可能把用户那次的结果当成程序化调用的结果）。" +
        `请用不可输入的输入框（readOnly / disabled / type="hidden"）创建程序化检索实例，` +
        `或改用该实例的 onSearchComplete 回调；${EXCLUSIVITY_LOST_HINT}`;
      loseExclusivity(raw, message);
      return message;
    }
    return null;
  };

  /**
   * 空回包的统一结算：`null` / 空容器 → `empty`。
   *
   * 这里**刻意不区分**「真的查不到」与「服务当前不可用」——官方对这几个服务只给了「回调参数
   * 是不是 `null`」这一条公开信息，错误码只在私有回调注册表里。R25-C / #72 的处置是：
   * 不嗅探私有面、不编造精确错误码，把「没有可用的结果」如实报成 `empty`；需要更细的服务健康度
   * 时由调用方自己按业务口径重试或提示（超时路径已经由适配器的 `timeout` 覆盖）。
   *
   * 为什么不做成 `failed({ code: "BMAP_SERVICE_UNAVAILABLE", … })`：那会让调用方以为拿到了
   * 一个可判定的失败原因（配额？Referer？网络？），实际上我们并不知道——`empty` 至少诚实。
   */
  const settleUnavailable = <T>(settle: ServiceCallSettle<T>): void => settle.empty();

  /** 参数不合法的调用：适配器不抛错，因此以 `failed` 结算（`BMAP_INVALID_ARGUMENT`）。 */
  const invalidCall = <T>(label: string, message: string): ServiceCall<T> =>
    createServiceCall<T>(
      (settle) =>
        settle.failed({ code: "BMAP_INVALID_ARGUMENT", message: `${label}: ${message}` }),
      { label },
    );

  /**
   * 前置条件不满足的调用（不是参数问题，也不是 SDK 调用失败）：以 `failed` 结算
   * （`BMAP_SERVICE_FAILED`），不抛错、不猜。
   */
  const serviceFailedCall = <T>(label: string, message: string): ServiceCall<T> =>
    createServiceCall<T>(
      (settle) => settle.failed({ code: "BMAP_SERVICE_FAILED", message: `${label}: ${message}` }),
      { label },
    );

  /**
   * 释放一个**在 Driver 侧持有资源**的服务实例（`Autocomplete` / `LocalSearch` 共用）。
   *
   * 三件事的顺序与 Map / Panorama Facet 一致：
   * 1. 先置**终态**（不再接受业务调用）——这一步是「一旦释放就不再恢复」的状态；
   * 2. 执行 `cleanup()`（该种类专属的 Driver 侧清理：解绑监听、把在飞调用显式失败）与
   *    `events.release(handle)`——**解绑失败不阻断后续步骤，但汇总抛出**（订阅也是 Driver 侧资源，
   *    EventDriver 的 `groups` 是强引用 Map，SDK 清空自己的监听器不会删除这份记录）；
   * 3. 执行**该服务的 SDK 公开释放步骤**（`releaseSdk`）：缺省是探测并调用 `dispose`
   *    （`Autocomplete` 的官方声明里有该成员）；`LocalSearch` **没有** `dispose()`，因此注入的是
   *    公开的 `clearResults()`。这一步**只有成功才记账**，抛错时句柄保持不可用、再次调用会重试。
   *
   * 幂等 + 重入短路（SDK 销毁钩子里再次 dispose）都在这里统一处理。两个种类的差异只有
   * `label`（错误信息里点名是谁）、`cleanup` 与 `releaseSdk`（第 3 步调哪个公开成员）；
   * 写成两份只会让「成功才记账」这类细节各自漂移。
   */
  const disposeServiceInstance = (
    raw: Record<string, unknown>,
    handle: ServiceHandle<string>,
    options: {
      label: string;
      cleanup: () => void;
      /**
       * SDK 侧的释放步骤（**公开 API**）。缺省 = 探测 `dispose`（`Autocomplete` 的官方声明里有
       * 该成员）；`LocalSearch` 没有官方 `dispose()`，因此传
       * `() => callRequired(raw, "clearResults")`（见 `disposeLocalSearch`）。
       *
       * **只有成功才记账**：抛错时句柄保持不可用，再次调用会重试这一步。
       */
      releaseSdk?: () => void;
    },
  ): void => {
    disposedInstances.add(raw); // 先停止接受业务调用
    if (disposingInstances.has(raw)) return; // 清理期间的重入直接短路
    disposingInstances.add(raw);

    const failures: unknown[] = [];
    try {
      // **两步分别 try/catch**：`cleanup()` 抛错不能连带跳过 `events.release()`——那句注释
      // 里承诺的是「解绑失败不阻断其余步骤」，两份清理写在一个 try 里就做不到（PR #89 评审 P2）。
      try {
        options.cleanup();
      } catch (error) {
        failures.push(error);
      }
      try {
        events.release(handle);
      } catch (error) {
        failures.push(error);
      }

      if (!sdkDisposedInstances.has(raw)) {
        if (options.releaseSdk) {
          options.releaseSdk();
          sdkDisposedInstances.add(raw);
        } else {
          const disposeMember = readNamespaceMember(raw, "dispose");
          if (typeof disposeMember !== "function") {
            sdkDisposedInstances.add(raw); // 没有该成员 ⇒ 视为已完成（不是错误）
          } else {
            sdkCall(`${options.label}.dispose`, () => callRequired(raw, "dispose"));
            sdkDisposedInstances.add(raw);
          }
        }
      }
    } finally {
      disposingInstances.delete(raw);
    }

    if (failures.length > 0) {
      const details = failures
        .map((failure) => (failure as Error)?.message ?? String(failure))
        .join("; ");
      throw new BMapError(
        "BMAP_SDK_CALL_FAILED",
        `${options.label} 有 ${failures.length} 项 Driver 侧清理未完成（其余步骤已尽力执行；` +
          `再次调用只会重试未完成的那一步）: ${details}`,
        { cause: failures[0], engine: "jsapi-v4" },
      );
    }
  };

  /**
   * 释放一个「以**公开 `clearResults()`** 为唯一清理入口」的服务实例
   * （`LocalSearch` 与四类路线服务共用，#39 把它从 `disposeLocalSearch` 里提出来）。
   *
   * 五类服务在这里的性质完全一样：实例本身**没有** `dispose()`（官方 4.0.4 声明里只有
   * `clearResults` / `getResults` / `getStatus` …），但它**交付出去的结果集**不随实例被 GC
   * ——地图上的折线与标注、写进 `panel` 的 DOM 都由调用方交给 SDK 的地图持有。因此：
   *
   * 1. 先把在册的未结算操作**显式失败**并置为**终态**（它的迟到回包从此没有归属可言）；
   * 2. 再走公开的 `clearResults()` 把已经可见的结果收回来。
   *
   * 差异只剩 `label`（错误信息里点名是谁）；写成两份只会让「成功才记账」这类细节各自漂移。
   */
  const disposeResultHolderInstance = (
    raw: Record<string, unknown>,
    handle: ServiceHandle<string>,
    label: string,
  ): void => {
    disposeServiceInstance(raw, handle, {
      label,
      cleanup: () => {
        // 在飞调用显式失败（幂等）；并置为**终态** —— 迟到回包不再有归属
        const settle = readActiveOperation<unknown>(raw);
        activeOperations.delete(raw);
        supersededOperations.add(raw);
        settle?.failed({
          code: "BMAP_SERVICE_FAILED",
          message: `该服务实例在请求进行中被 ${label}() 释放`,
        });
      },
      // 官方公开的清理入口：清掉它画在地图上的路线 / 标注与结果面板。
      // **不能**只把实例丢给 GC：那些覆盖物由调用方交给 SDK 的地图持有。
      releaseSdk: () => {
        sdkCall(`${label}.clearResults`, () => callRequired(raw, "clearResults"));
      },
    });
  };

  /**
   * 运行期句柄种类校验（类型是编译期契约，JS 调用方仍需在边界拦住）。
   *
   * 与 layers / controls / native-layers 同源，按 Handle 品牌判断，避免把别的服务句柄悄悄
   * 当成 Autocomplete 处理。`disposeAutocomplete` 与 `setAutocompleteOptions` 共用一份，
   * 两条入口的判据不允许分叉。
   */
  const assertAutocompleteHandle = (
    handle: ServiceHandle<"service:autocomplete">,
    operation: string,
  ): void => {
    const brand = String(handle[HANDLE_BRAND]);
    if (brand === "service:autocomplete") return;
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `${operation} 只接受 createAutocomplete 的句柄，收到 "${brand}"；` +
        "需要释放的另一个服务实例是 LocalSearch（disposeLocalSearch）",
      { engine: "jsapi-v4" },
    );
  };

  const resolve = <T>(handle: SdkHandle<string>, facet: string): T => {
    try {
      return registry.resolve<T>(handle);
    } catch (error) {
      throw new BMapError(
        "BMAP_HANDLE_FOREIGN",
        `${facet}: 句柄不属于当前 Client，或不是本 Facet 创建的句柄（${
          (error as Error)?.message ?? String(error)
        }）`,
        { cause: error, engine: "jsapi-v4" },
      );
    }
  };

  const geocoderOf = (handle: ServiceHandle<"service:geocoder">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.geocode");
  const convertorOf = (handle: ServiceHandle<"service:convertor">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.convert");
  const boundaryOf = (handle: ServiceHandle<"service:boundary">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.queryBoundary");
  const geolocationOf = (handle: ServiceHandle<"service:geolocation">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.locate");
  const localCityOf = (handle: ServiceHandle<"service:local-city">) =>
    resolve<Record<string, unknown>>(handle, "ServiceDriver.locateCity");

  /**
   * Autocomplete 的 `location` 归一化。
   *
   * 官方 `AutocompleteOptions.location` 接受 `string | Map | Point`，而本库调用方手里的是**句柄**
   * （`<BAutoComplete>` 直接传 `ready.map`）。把句柄对象原样透传给 SDK 是非法值（R25-C / #72 之前
   * 的形态），所以这里按身份分派：本 Client 的句柄 → 解析成 raw；`{lng, lat}` → raw Point；其余
   * （城市名字符串、宿主自备的 raw 对象）原样透传。
   */
  const normalizeAutocompleteLocation = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (typeof (value as Record<PropertyKey, unknown>)[HANDLE_BRAND] === "string") {
      return registry.resolve<unknown>(value as SdkHandle<string>);
    }
    if ("lng" in (value as Record<string, unknown>)) return geometry.toRawPoint(value as Point);
    return value;
  };

  /* ------------------------------------------------- LocalSearch 请求归属（#38） */

  /**
   * 同一 `LocalSearch` 实例上**唯一**那个未结算操作（`search` / `searchNearby` /
   * `searchInBounds` / `gotoPage` 共用一条 `onSearchComplete`）。
   *
   * **归属模型：一个实例同一时刻只有一个未结算操作**，因此回包归属与到达顺序无关：
   * 回调到达时，在册的那一个就是它（不需要 keyword、不需要 FIFO、不需要队列）。
   *
   * 为什么不用「FIFO + keyword 校验」（PR #89 评审 P1）：官方只承诺**单次多关键字检索内部**
   * 结果数组与关键字数组顺序一致，**没有**承诺多次请求之间的回调顺序；`LocalResult.keyword`
   * 也不是请求身份。按到达顺序归属在乱序回包下会确定性出错：
   *
   * - `cancel A → search B`（不同关键词）：B 的回包先到时，队首是 A 的墓碑，B 被判定为
   *   「不属于在册请求」而**丢弃**，随后 A 的回包消费墓碑 —— B 只能等 timeout；
   * - `cancel K → search K`（同关键词）：新 K 的回包被旧 K 的墓碑吃掉，旧 K 的迟到回包反而
   *   结算给新请求 —— **stale data**。
   *
   * 这两种反例都没有「哪一次请求产生了这个回包」这个事实可用，所以本库不再猜：并发被**显式拒绝**，
   * 取消/超时之后该实例**不再接受新的检索**（它的迟到回包无人可归属），要继续就重建实例。
   * 调用方侧（composable）用「supersede ⇒ 新建实例」实现「最新者胜」，见
   * `docs/adr/2026-09-14-service-lifecycle-and-local-search.md` 决策 4。
   */
  const activeOperations = new WeakMap<object, ServiceCallSettle<unknown>>();

  /**
   * 已被**取消 / 超时**取代的实例：此后它不再接受新的检索。
   *
   * 判据是「这个实例上出现过一次无法归属的迟到回包」，因此与「是否已释放」是两件事：
   * 前者可以由调用方重新建实例继续用，后者只能重建。
   *
   * 键是 raw 实例，而一个 raw 对象只可能是 `LocalSearch` 或四类路线服务之一，因此**一份记账够用**
   * （与 `disposedInstances` 同一取舍）：分开存只会让「这个实例上还有没有未结算操作」有两个真相。
   */
  const supersededOperations = new WeakSet<object>();

  /** 取消 / 超时 = 该实例不再可用（它的迟到回包无法与后续请求区分）。 */
  const supersedeOperation = (raw: Record<string, unknown>): void => {
    supersededOperations.add(raw);
    activeOperations.delete(raw);
  };

  /**
   * 读取该实例上**唯一**那个未结算操作的结算入口。
   *
   * 存进去的是 `ServiceCallSettle<unknown>`（一份记账服务多个调用面），取出来时按调用面自己的
   * 载荷类型收窄——一个 raw 实例只可能属于一个调用面（`LocalSearch` **或** 四类路线服务之一），
   * 因此这个收窄在事实层面是安全的，而不是「赌」。
   */
  const readActiveOperation = <T>(raw: Record<string, unknown>): ServiceCallSettle<T> | null =>
    (activeOperations.get(raw) as ServiceCallSettle<T> | undefined) ?? null;

  /**
   * 发起一次检索操作：占用唯一槽位 → 调用 SDK → （同步抛错则回滚槽位）。
   *
   * **`LocalSearch` 与四类路线服务共用它**（#39 明确要求「复用请求生命周期、避免建立第二套框架」）：
   * 这五类服务的回包语义完全一样——一条 `onSearchComplete`、回包里没有请求身份、官方也没有承诺
   * 跨请求顺序，所以归属只能靠**实例身份**（一个实例同一时刻一个未结算操作）。
   *
   * `cancel()` 走 `onCancel` 把实例标记为「已被取代」——**不保留槽位**：实例从此不再接受新检索，
   * 迟到回包到达时没有任何在册操作可被结算（也就不会再错配给别人）。
   */
  const invokeSlotOperation = <T>(
    label: string,
    raw: Record<string, unknown>,
    invoke: () => void,
  ): ServiceCall<T> =>
    createServiceCall<T>(
      (settle) => {
        activeOperations.set(raw, settle as ServiceCallSettle<unknown>);
        try {
          invoke();
        } catch (error) {
          // 请求没发出去就不会有回包：把槽位交还，否则这个实例会永远「忙」
          activeOperations.delete(raw);
          throw error;
        }
      },
      {
        label,
        // 取消只影响调用方看到的结果；实例本身从此不再可用（见 `supersededOperations`）
        onCancel: () => supersedeOperation(raw),
        // **超时同理**：超时不代表 SDK 侧请求消失，迟到回包仍可能到达。若这里不收尾，
        // 「迟到回包到达后实例又变回可用」就会让同一 handle 的行为取决于回包早晚
        // （PR #89 复审 P1）——契约要求：取消/超时之后必须重建实例。
        onTimeout: () => supersedeOperation(raw),
      },
    );

  /**
   * 调用前的准入判定（返回失败原因，`null` 表示放行）。
   *
   * 三条拒绝理由都必须**显式失败**而不是静默排队：排队会让调用方以为请求已经发出去了。
   * 三条都指向同一个处置——`disposeEntry()` 后重建实例。
   */
  const operationAdmissionFailure = (
    raw: Record<string, unknown>,
    operation: string,
    disposeEntry: string,
  ): string | null => {
    if (disposedInstances.has(raw)) {
      return `${operation}: 该服务实例已被 ${disposeEntry}() 释放：请重建实例后再检索`;
    }
    if (supersededOperations.has(raw)) {
      // 这个集合有两个来源：`cancel()`（`onCancel`）与**超时**（`onTimeout`）——两者都意味着
      // 「这一次调用已经结束，但 SDK 侧的请求可能仍在路上」，因此文案不点名 cancel。
      return (
        `${operation}: 该实例已因**取消或超时**失效 —— 它上一次检索的迟到回包无法与` +
        "后续请求区分（官方没有承诺多次请求之间的回包顺序），因此不再接受新的检索；" +
        `请 ${disposeEntry}() 后重建实例（composable 的「最新者胜」正是这样做的）`
      );
    }
    if (activeOperations.has(raw)) {
      return (
        `${operation}: 该实例上已有**未结算**的检索 —— 同一实例同一时刻只允许一个` +
        "未结算操作，否则回包无法归属（官方只承诺单次多关键字内部顺序，不承诺跨请求顺序）。" +
        `请等它结算，或 ${disposeEntry}() 后重建实例（已在路上的回包不会因为取消而消失）`
      );
    }
    return null;
  };

  /**
   * 回包归属 + 结算（唯一入口：`onSearchComplete` 的内部分发器调用它）。
   *
   * 槽位唯一，因此**不需要**关键字校验或到达顺序假设；没有在册操作时直接返回（例如终态实例的
   * 迟到回包，或运行时自行触发的检索）。
   */
  const settleActiveSearch = (raw: Record<string, unknown>, payload: unknown): void => {
    if (disposedInstances.has(raw) || supersededOperations.has(raw)) return;
    const settle = readActiveOperation<LocalSearchResult[]>(raw);
    if (!settle) return;
    activeOperations.delete(raw);

    const status = readServiceStatus(raw, warnOnce, "ServiceDriver.search");
    // **状态码优先**：`LocalSearch` 是公开带状态码的服务，失败时官方仍会触发
    // `onSearchComplete`（`gotoPage` 页码无效时甚至带上一轮的载荷一起回调）——先看载荷
    // 会把「官方说这次失败了」误判成成功。
    if (isLocalSearchFailureStatus(status)) {
      settle.failed({ code: status, message: describeLocalSearchStatus(status) }, status);
      return;
    }
    if (payload === null || payload === undefined) {
      // 回包不可用（状态码是 0/1）：没有公开原因就不假装是失败
      settle.empty(status);
      return;
    }
    const results = readLocalSearchResults(payload);
    if (results.length === 0) {
      // 载荷不是 LocalResult（缺 getPoi 等）：按「没有可用结果」上报，不编造
      settle.empty(status);
      return;
    }
    settle.success(results, status);
  };

  /**
   * 路线回包归属 + 结算（四类路线服务共用；由 `onSearchComplete` 的内部分发器调用）。
   *
   * 与 `settleActiveSearch` 同源——槽位唯一，因此不需要关键字校验、也不依赖到达顺序；差别只有两处：
   *
   * 1. 载荷投影换成路线的那两个（`readRouteResult` / `readTransitRouteResult`）；
   * 2. **状态码口径**换成路线的（见 `isRouteFailureStatus`：0..2 区间有两套码表重叠，一律按
   *    `empty` 报，`≥3` 才是失败的公开原因）。
   *
   * `label` 同时用于 `getStatus()` 读取失败时的告警与超时文案，因此按调用面分别传
   * （`ServiceDriver.searchDrivingRoute` 等）——同一个实例只可能属于一个调用面。
   */
  const settleActiveRoute = <TPlan>(
    raw: Record<string, unknown>,
    payload: unknown,
    project: (value: unknown) => RouteResult<TPlan> | null,
    label: string,
  ): void => {
    if (disposedInstances.has(raw) || supersededOperations.has(raw)) return;
    // 载荷类型按调用面收窄：raw 实例只可能由一个 `create*Route` 建出来（见 `readActiveOperation`）
    const settle = readActiveOperation<RouteResult<TPlan>>(raw);
    if (!settle) return;
    activeOperations.delete(raw);

    const status = readServiceStatus(raw, warnOnce, label);
    // **状态码优先**：官方失败时仍会触发 `onSearchComplete`（可能还带着上一轮或空的载荷），
    // 先看载荷会把「官方说这次失败了」误判成成功。
    if (isRouteFailureStatus(status)) {
      settle.failed({ code: status, message: describeRouteStatus(status) }, status);
      return;
    }
    const result = project(payload);
    if (!result) {
      // 回包不可用（`null` / 不是路线结果）：没有公开原因就不假装是失败
      settle.empty(status);
      return;
    }
    if (result.plans.length === 0) {
      // 合法回包但一条方案都没有 ⇒ 查无路线（`empty`，不是 `failed`）
      settle.empty(status);
      return;
    }
    settle.success(result, status);
  };

  /** 参数不合法的 LocalSearch 调用（走结果通道，不抛错）。 */
  const invalidSearchCall = (label: string, message: string): ServiceCall<LocalSearchResult[]> =>
    invalidCall<LocalSearchResult[]>(label, message);

  /** 准入失败的 LocalSearch 调用（不是参数问题，也不是 SDK 调用失败）。 */
  const rejectedSearchCall = (label: string, message: string): ServiceCall<LocalSearchResult[]> =>
    serviceFailedCall<LocalSearchResult[]>(label, message);

  /**
   * 服务实例的**检索区域**归一化（`LocalSearch` 与四类路线服务共用）。
   *
   * 官方接受 `Map | Point | string`；本库对应 `MapHandle | 领域 Point | 城市名`。其余形态
   * **显式失败**而不是透传给 SDK（透传会得到 SDK 侧的原生异常，调用方无法按 code 分类处理）。
   *
   * `label` 是**创建入口名**（`createLocalSearch` / `createDrivingRoute` …）：这条函数被多类服务
   * 共用，把入口名写死会让路线的参数错误报成「createLocalSearch: …」（指错服务），因此逐调用点传。
   */
  const normalizeSearchLocation = (value: unknown, label: string): unknown => {
    if (typeof value === "string") {
      if (value.length === 0) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `${label}: 检索区域不能是空字符串`,
          { engine: "jsapi-v4" },
        );
      }
      return value;
    }
    if (isObjectLike(value)) {
      const brand = (value as Partial<Record<PropertyKey, unknown>>)[HANDLE_BRAND];
      if (typeof brand === "string") {
        if (brand !== "map") {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            `${label}: 检索区域只接受 MapHandle（收到 "${brand}"）`,
            { engine: "jsapi-v4" },
          );
        }
        return registry.resolve<unknown>(value as SdkHandle<string>);
      }
      if ("lng" in (value as Record<string, unknown>)) {
        return geometry.toRawPoint(value as Point);
      }
    }
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `${label}: 检索区域必须是城市名字符串、领域 Point（{ lng, lat }）或 MapHandle`,
      { engine: "jsapi-v4" },
    );
  };

  /**
   * 绘制选项归一化（`LocalSearch` 与四类路线服务共用）。
   *
   * 只透传官方声明里**存在且有语义**的成员——接收后忽略属于假支持。两处按调用方区分：
   *
   * - `selectFirstResult` 只有 `LocalSearch` 收（官方 `RenderOptions` 明说它「仅对 LocalSearch
   *   有效」），由 `options.allowSelectFirstResult` 决定要不要读：路线服务传 `false`，因此 JS 调用方
   *   硬塞进来的 `selectFirstResult` 也**不会**被转发；
   * - `label` 是创建入口名，用于错误信息（共用一份实现不能把入口名写死，否则路线会报成
   *   「createLocalSearch: …」）。
   *
   * `map` 必须是本库的 `MapHandle`：绘制出来的覆盖物所有权必须可验证，否则清理路径
   * （`clearLocalSearch` / `clearRouteResults` / `disposeLocalSearch` / `disposeRoute`）收不回它们。
   */
  const normalizeRenderOptions = (
    value: LocalSearchRenderOptions | RouteRenderOptions | undefined,
    options: { label: string; allowSelectFirstResult: boolean },
  ): Record<string, unknown> | null => {
    if (!value || typeof value !== "object") return null;
    const out: Record<string, unknown> = {};
    if (value.map !== undefined) {
      // 类型层已是 `MapHandle`；运行时校验用来兜住 JS 调用方与跨 Client 混用
      const brand = isObjectLike(value.map) ? value.map[HANDLE_BRAND] : undefined;
      if (brand !== "map") {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `${options.label}: renderOptions.map 必须是本库的 MapHandle` +
            "（绘制目标的所有权必须可验证，否则清理路径收不回覆盖物）",
          { engine: "jsapi-v4" },
        );
      }
      out.map = registry.resolve<unknown>(value.map as SdkHandle<string>);
    }
    if (typeof value.panel === "string" || isObjectLike(value.panel)) out.panel = value.panel;
    // `selectFirstResult` 只存在于 `LocalSearchRenderOptions`（`RouteRenderOptions` 刻意不含它：
    // 官方声明说它「仅对 LocalSearch 有效」），因此按结构化读法「存在才读」，而不是把两个类型强行合并。
    const selectFirstResult = (value as { selectFirstResult?: unknown }).selectFirstResult;
    if (options.allowSelectFirstResult && typeof selectFirstResult === "boolean") {
      out.selectFirstResult = selectFirstResult;
    }
    if (typeof value.autoViewport === "boolean") out.autoViewport = value.autoViewport;
    if (value.viewportOptions) {
      const viewport: Record<string, unknown> = {};
      if (typeof value.viewportOptions.noAnimation === "boolean") {
        viewport.noAnimation = value.viewportOptions.noAnimation;
      }
      if (Array.isArray(value.viewportOptions.margins)) {
        viewport.margins = [...value.viewportOptions.margins];
      }
      if (typeof value.viewportOptions.zoomFactor === "number") {
        viewport.zoomFactor = value.viewportOptions.zoomFactor;
      }
      if (Object.keys(viewport).length > 0) out.viewportOptions = viewport;
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  /**
   * 关键字归一化：非空字符串、或非空的**全字符串**数组（官方最多 10 个）。
   *
   * 只做形状校验，**不**参与回包归属（归属靠「一个实例一个未结算操作」这条不变式，见
   * `activeSearches` 的说明）：关键字不是请求身份，同关键词重查时完全等价。
   */
  const normalizeSearchKeyword = (
    value: LocalSearchKeyword,
  ): { value: LocalSearchKeyword } | null => {
    if (typeof value === "string") return value.length === 0 ? null : { value };
    if (!Array.isArray(value) || value.length === 0) return null;
    if (value.some((item) => typeof item !== "string" || item.length === 0)) return null;
    return { value: [...value] };
  };

  const assertLocalSearchHandle = (
    handle: ServiceHandle<"service:local-search">,
    operation: string,
  ): void => {
    const brand = String(handle[HANDLE_BRAND]);
    if (brand === "service:local-search") return;
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `${operation} 只接受 createLocalSearch 的句柄，收到 "${brand}"`,
      { engine: "jsapi-v4" },
    );
  };

  const localSearchOf = (
    handle: ServiceHandle<"service:local-search">,
    operation: string,
  ): Record<string, unknown> => {
    assertLocalSearchHandle(handle, operation);
    return resolve<Record<string, unknown>>(handle, operation);
  };

  /* ------------------------------------------------------- 路线规划（#39） */

  /** 路线服务句柄种类（`clearRouteResults` / `disposeRoute` 的准入判据）。 */
  const ROUTE_HANDLE_KINDS: readonly string[] = [
    "service:driving-route",
    "service:walking-route",
    "service:riding-route",
    "service:transit-route",
  ];

  const assertRouteHandle = (handle: RouteServiceHandle, operation: string): void => {
    const brand = String(handle[HANDLE_BRAND]);
    if (ROUTE_HANDLE_KINDS.includes(brand)) return;
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `${operation} 只接受 createDrivingRoute / createWalkingRoute / createRidingRoute / ` +
        `createTransitRoute 的句柄，收到 "${brand}"`,
      { engine: "jsapi-v4" },
    );
  };

  /** 把「有值才写」的构造选项收成一个对象（`undefined` = 不写这一项，而不是写一个 undefined）。 */
  const definedSettings = (entries: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entries)) {
      if (value !== undefined) out[key] = value;
    }
    return out;
  };

  /**
   * 路线端点归一化。
   *
   * 官方四个服务的 `search()` 接受 `Point`（四者都有）、`string`（步行 / 骑行 / 公交有，
   * **驾车没有**）、与 `LocalResultPoi`（四者都有）。本库对应：
   *
   * - 领域 `Point`（`{ lng, lat }`）→ `geometry.toRawPoint()`；
   * - 非空字符串（仅 `allowKeyword` 时）→ 原样透传；
   * - `RouteEndpointPoi`（`uid` + `point` + 可选 `name`）→ 构造成 SDK 认得的对象，见
   *   `RouteEndpointPoi` 的说明（**未经真实运行时证明的假设**，已登记在 ADR 的已知限制里）；
   * - 其余形态**显式失败**：不把非法值透传给 SDK（透传得到的是 SDK 侧原生异常，调用方无法按码分类）。
   */
  const normalizeRouteEndpoint = (
    value: unknown,
    options: { allowKeyword: boolean },
  ): unknown => {
    if (typeof value === "string") {
      if (!options.allowKeyword) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "驾车路线不支持关键字（字符串）起终点：官方 DrivingRoute#search 只接受 Point 或 POI。" +
            "要按地址出发，请先用 Geocoder / LocalSearch 取得坐标或 POI",
          { engine: "jsapi-v4" },
        );
      }
      if (value.length === 0) {
        throw new BMapError("BMAP_INVALID_ARGUMENT", "路线端点不能是空字符串", {
          engine: "jsapi-v4",
        });
      }
      return value;
    }
    if (isObjectLike(value)) {
      const record = value as Record<string, unknown>;
      if ("lng" in record || "lat" in record) {
        const point = readPointLike(record);
        if (!point) {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            `路线端点必须是有限坐标 { lng, lat }：${JSON.stringify(value) ?? String(value)}`,
            { engine: "jsapi-v4" },
          );
        }
        return geometry.toRawPoint(point);
      }
      if (typeof record.uid === "string" && record.uid.length > 0) {
        const point = readPointLike(record.point);
        if (!point) {
          throw new BMapError(
            "BMAP_INVALID_ARGUMENT",
            "路线端点的 POI 引用必须带合法坐标 point（{ lng, lat }）——uid 失效时它就是定位依据",
            { engine: "jsapi-v4" },
          );
        }
        // 官方 `LocalResultPoi` 的标题字段叫 `title`；本库的 `name` 映射到它
        return {
          uid: record.uid,
          title: typeof record.name === "string" ? record.name : record.uid,
          point: geometry.toRawPoint(point),
        };
      }
    }
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      "路线端点必须是领域 Point（{ lng, lat }）、POI 引用（{ uid, point }）" +
        (options.allowKeyword ? "或非空地名字符串" : ""),
      { engine: "jsapi-v4" },
    );
  };

  /** 途经点归一化（**只有驾车**调用它）：必须是坐标数组，非法项显式失败。 */
  const normalizeRouteWaypoints = (value: unknown): unknown[] | null => {
    if (value === undefined) return null;
    if (!Array.isArray(value)) {
      throw new BMapError("BMAP_INVALID_ARGUMENT", "waypoints 必须是坐标数组", {
        engine: "jsapi-v4",
      });
    }
    const points: Point[] = [];
    for (const item of value) {
      const point = readPointLike(item);
      if (!point) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          `waypoints 里存在非法坐标（缺分量或非有限数）: ${JSON.stringify(item) ?? String(item)}`,
          { engine: "jsapi-v4" },
        );
      }
      points.push(point);
    }
    return geometry.toRawPoints(points);
  };

  /**
   * 创建路线服务实例（四类服务共用）。
   *
   * 与 `createLocalSearch` 的三点一致：① 能力门先过；② 回包经 `settleActiveRoute` 落到本实例的
   * **唯一**槽位；③ **终态实例一律不再回写**（SDK 的回包可能在释放之后才到，也可能在清理过程中
   * 同步触发）。差别只有构造器名、能力 id、句柄种类与载荷投影。
   */
  const createRouteService = <TPlan, TKind extends RouteServiceKind>(input: {
    /** SDK 构造器名（同时作为 `sdkCall` 的标签），如 `"DrivingRoute"` */
    ctor: string;
    capability: Capability;
    kind: TKind;
    /** 调用面标签（进告警与超时文案），如 `"ServiceDriver.searchDrivingRoute"` */
    operation: string;
    projection: (value: unknown) => RouteResult<TPlan> | null;
    location: string | Point | MapHandle;
    /** 该服务自己的构造选项（策略 / 页容量 / 路况开关），已按官方声明过滤 */
    settings?: Record<string, unknown>;
    renderOptions?: RouteRenderOptions;
  }): ServiceHandle<TKind> => {
    capabilities.require(input.capability);
    const Ctor = namespaceCtor(namespace, input.ctor);
    // 创建入口名（`createDrivingRoute` 这类）：共用的归一化函数靠它把错误指向**正确的服务**
    const label = `create${input.ctor}`;
    const location = normalizeSearchLocation(input.location, label);
    const settings: Record<string, unknown> = { ...(input.settings ?? {}) };
    // 绘制选项复用 `createLocalSearch` 的那份归一化（`RouteRenderOptions` 是 `LocalSearchRenderOptions`
    // 的结构子集：`map` 的句柄品牌校验、「只透传声明里存在且有语义的成员」的口径两处完全相同）。
    // 路线传 `allowSelectFirstResult: false` ⇒ JS 调用方硬塞的 `selectFirstResult` 也不会被转发。
    const renderOptions = normalizeRenderOptions(input.renderOptions, {
      label,
      allowSelectFirstResult: false,
    });
    if (renderOptions) settings.renderOptions = renderOptions;

    let raw: Record<string, unknown> | null = null;
    const instance = sdkCall(input.ctor, () =>
      new Ctor(location, {
        ...settings,
        onSearchComplete: (payload: unknown) => {
          if (raw && disposedInstances.has(raw)) return;
          if (raw) settleActiveRoute(raw, payload, input.projection, input.operation);
        },
      }),
    );
    raw = instance as unknown as Record<string, unknown>;
    return registry.adopt(input.kind, instance);
  };

  /**
   * 路线检索的公共前半段：句柄判定 → 参数归一化 → 准入判定 → 槽位记账。
   *
   * 三点取舍与其余调用面一致：
   * - **句柄错误同步抛**（`BMAP_HANDLE_FOREIGN` / `BMAP_INVALID_ARGUMENT`）：跨 Client 混用必须在
   *   边界立刻失败，而不是伪装成一个「服务失败」的结果；
   * - **参数错误走结果通道**（`invalidCall`）：它是**调用内容**的问题，调用方要能按 code 分类；
   * - **该服务没有的选项显式失败**（例如给步行传 `waypoints`），而不是静默丢掉——官方
   *   `WalkingRoute#search` 是两参数签名，收下再忽略就是假支持。
   */
  const invokeRouteSearch = <TPlan>(
    label: string,
    handle: RouteServiceHandle,
    request: { start?: unknown; end?: unknown; waypoints?: unknown },
    options: { allowKeyword: boolean; allowWaypoints: boolean },
  ): ServiceCall<RouteResult<TPlan>> => {
    assertRouteHandle(handle, label);
    const raw = resolve<Record<string, unknown>>(handle, label);

    if (!options.allowWaypoints && request?.waypoints !== undefined) {
      return invalidCall<RouteResult<TPlan>>(
        label,
        "该服务不支持途经点：官方 WalkingRoute / RidingRoute / TransitRoute 的 search 是两参数签名，" +
          "只有 DrivingRoute 接受 { waypoints }",
      );
    }

    let start: unknown;
    let end: unknown;
    let waypoints: unknown[] | null = null;
    try {
      start = normalizeRouteEndpoint(request?.start, options);
      end = normalizeRouteEndpoint(request?.end, options);
      waypoints = options.allowWaypoints ? normalizeRouteWaypoints(request?.waypoints) : null;
    } catch (error) {
      return invalidCall<RouteResult<TPlan>>(label, (error as Error)?.message ?? String(error));
    }

    const rejection = operationAdmissionFailure(raw, label, "disposeRoute");
    if (rejection !== null) return serviceFailedCall<RouteResult<TPlan>>(label, rejection);

    return invokeSlotOperation<RouteResult<TPlan>>(label, raw, () => {
      if (waypoints) callRequired(raw, "search", start, end, { waypoints });
      else callRequired(raw, "search", start, end);
    });
  };

  /* ------------------------------------------------------------ 创建面 */

  return {
    createGeocoder() {
      capabilities.require(SERVICE_CAPABILITIES.createGeocoder);
      const Geocoder = namespaceCtor(namespace, "Geocoder");
      return registry.adopt("service:geocoder", sdkCall("Geocoder", () => new Geocoder()));
    },

    createConvertor() {
      capabilities.require(SERVICE_CAPABILITIES.createConvertor);
      const Convertor = namespaceCtor(namespace, "Convertor");
      return registry.adopt("service:convertor", sdkCall("Convertor", () => new Convertor()));
    },

    createGeolocation(options = {}) {
      capabilities.require(SERVICE_CAPABILITIES.createGeolocation);
      const Geolocation = namespaceCtor(namespace, "Geolocation");
      return registry.adopt(
        "service:geolocation",
        sdkCall("Geolocation", () => new Geolocation(options)),
      );
    },

    createLocalCity(options = {}) {
      capabilities.require(SERVICE_CAPABILITIES.createLocalCity);
      const LocalCity = namespaceCtor(namespace, "LocalCity");
      return registry.adopt(
        "service:local-city",
        sdkCall("LocalCity", () => new LocalCity(options)),
      );
    },

    createBoundary() {
      capabilities.require(SERVICE_CAPABILITIES.createBoundary);
      const Boundary = namespaceCtor(namespace, "Boundary");
      return registry.adopt("service:boundary", sdkCall("Boundary", () => new Boundary()));
    },

    createAutocomplete(options: AutocompleteOptions) {
      capabilities.require(SERVICE_CAPABILITIES.createAutocomplete);
      const Autocomplete = namespaceCtor(namespace, "Autocomplete");
      const location = normalizeAutocompleteLocation(options.location);

      // 内部分发器：先结算在册的那一个 pending，再把同一个回调转给调用方自己的监听。
      let raw: Record<string, unknown> | null = null;
      const instance = sdkCall("Autocomplete", () =>
        new Autocomplete({
          location,
          input: options.input,
          types: options.types,
          onSearchComplete: (results: RawAutocompleteResult) => {
            // **已释放的实例一律不再回写**（R25-C 复审 P1）：SDK 的回包可能在
            // `disposeAutocomplete()` 之后才到达（取消 / 卸载都收不回请求），也可能在 dispose()
            // 内部**同步**触发（真实销毁流程会走回调）。`disposedInstances` 在 dispose 的第一步就置位，
            // 因此两条路径都在这里被挡住。「卸载后不再回写」是 Driver 的契约，不能依赖调用方
            // （Vue 组件）自己再判一次——更不能依赖「Vue 卸载后 emit 恰好是 no-op」这种内部实现。
            if (raw && disposedInstances.has(raw)) return;
            let settle: ServiceCallSettle<PlaceSuggestion[]> | null = null;
            if (raw) {
              // 独占在**每次回包**时重新校验：等待期间输入框变回可输入 ⇒ 这个回包可能来自用户输入，
              // 一律不接受（把在飞的程序化请求显式失败，并让实例永久失效）
              if (exclusivityFailure(raw) === null) settle = shiftPending(raw, results);
            }
            if (settle) {
              const suggestions = readSuggestions(results);
              if (suggestions.length > 0) settle.success(suggestions);
              else settle.empty();
            }
            options.onSearchComplete?.(results);
          },
        }),
      );
      raw = instance as unknown as Record<string, unknown>;
      // 记下输入框**引用**：独占判定在每次 `suggest()` 与每次回包时重新校验（见 `boundInput`）；
      // 另外监听它的**输入活动**——只看当前状态发现不了「检查间隔内发生过的输入」（见 `inputWatchers`）
      boundInput.set(raw, options.input);
      watchInputActivity(raw, options.input);
      return registry.adopt("service:autocomplete", instance);
    },

    /**
     * 创建本地检索实例（`BMap.LocalSearch`）。
     *
     * 与 `createAutocomplete` 的关键差别：**不绑输入框**，因此回调通道不被用户输入污染，不需要
     * 「通道独占」那套前置校验。但它的回包**同样没有请求身份**（`keyword` 不是标识、官方也没承诺
     * 跨请求顺序），所以归属靠**实例身份**：一个实例同一时刻只允许一个未结算操作（见 `search()`
     * 的契约与 ADR 决策 4）。代价是必须自己管在飞请求的记账与释放入口（`disposeLocalSearch`）。
     *
     * 内部分发器只挂一次（构造期）：所有操作共用它，因为它必须与实例同寿命——`setSearchCompleteCallback`
     * 虽然也在官方 `LocalSearch` 的声明里，但「换回调能否按请求归属」在 #72 的真实 AK 探测里
     * **没有得出可发布结论**（那批检索全部无回包，对照组同样无回包），因此不建立在它上面。
     */
    createLocalSearch(location, options: LocalSearchOptions = {}) {
      capabilities.require(SERVICE_CAPABILITIES.createLocalSearch);
      const LocalSearch = namespaceCtor(namespace, "LocalSearch");
      const resolvedLocation = normalizeSearchLocation(location, "createLocalSearch");
      const renderOptions = normalizeRenderOptions(options.renderOptions, {
        label: "createLocalSearch",
        // 官方 `RenderOptions.selectFirstResult` 明说「仅对 LocalSearch 有效」
        allowSelectFirstResult: true,
      });

      const settings: Record<string, unknown> = {};
      if (renderOptions) settings.renderOptions = renderOptions;
      if (typeof options.pageCapacity === "number") settings.pageCapacity = options.pageCapacity;
      if (typeof options.pageNum === "number") settings.pageNum = options.pageNum;

      let raw: Record<string, unknown> | null = null;
      const instance = sdkCall("LocalSearch", () =>
        new LocalSearch(resolvedLocation, {
          ...settings,
          onSearchComplete: (payload: unknown) => {
            // 终态实例一律不再回写（与 Autocomplete 同源）：SDK 的回包可能在 release 之后才
            // 到达（取消 / 卸载都收不回请求），也可能在 `dispose()` 内部同步触发。
            if (raw && disposedInstances.has(raw)) return;
            if (raw) settleActiveSearch(raw, payload);
          },
        }),
      );
      raw = instance as unknown as Record<string, unknown>;
      return registry.adopt("service:local-search", instance);
    },

    /**
     * 更新已创建实例的检索区域 / 数据类型（官方 4.0.4 声明的 `Autocomplete#setLocation` /
     * `#setTypes`）。
     *
     * 为什么收在 Driver（R25-C / #72 的「组件 raw setter 回到集成边界」）：组件侧的
     * `inst.raw.setLocation(...)` 把 raw 成员访问摊在组件里，既越过了 raw SDK 边界，又让
     * 「某个 setter 在某个引擎上不存在」变成组件作者的记忆负担。这里统一：
     *
     * - **前置状态校验**：已被 `disposeAutocomplete()` 释放的实例一律拒绝——写入一个已销毁的
     *   SDK 对象是没有意义的行为，静默成功会骗人；
     * - **失去回调通道独占**（输入框曾可输入）**不**拒绝：这是纯配置写入，不发起请求、也不影响
     *   回包归属，把它算成错误只会让「用户改过输入框」的实例连检索区域都改不了；
     * - 成员缺失时**告警一次**而不是静默 no-op（与 `setOptions` 的 mutable 分支同口径）：
     *   官方声明了该成员，运行时没有说明声明与实现不一致，调用方有权知道这次更新没生效。
     */
    setAutocompleteOptions(handle, options: AutocompleteUpdateOptions) {
      // 先按句柄种类拦（纯元数据判断），再解析：否则外来句柄会在 resolve 里先抛
      // `BMAP_HANDLE_FOREIGN`，品牌判据永远不可达，两条入口的「共用一份判据」就名不副实。
      assertAutocompleteHandle(handle, "setAutocompleteOptions");
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.setAutocompleteOptions");
      if (disposedInstances.has(raw)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "setAutocompleteOptions: 该 Autocomplete 实例已被 disposeAutocomplete() 释放，" +
            "拒绝在已销毁的实例上写入；请重建实例",
          { engine: "jsapi-v4" },
        );
      }

      const apply = (key: "setLocation" | "setTypes", value: unknown): void => {
        const fn = readNamespaceMember(raw, key);
        if (typeof fn !== "function") {
          warnOnce(
            `autocomplete:${key}-missing`,
            `ServiceDriver.setAutocompleteOptions: 当前 Autocomplete 实例没有 ${key}()（4.0.4 的 ` +
              `Autocomplete 声明里存在该成员），本次更新被忽略`,
          );
          return;
        }
        sdkCall(`Autocomplete.${key}`, () => callRequired(raw, key, value));
      };

      if (options.location !== undefined) {
        apply("setLocation", normalizeAutocompleteLocation(options.location));
      }
      if (options.types !== undefined) {
        apply("setTypes", options.types);
      }
    },

    /* ---------------------------------------------------- 路线规划（#39） */

    createDrivingRoute(location, options: DrivingRouteOptions = {}) {
      // 官方 `RenderOptions.panel` 的文档明说「驾车路线规划无效」：不静默忽略（那是假支持），也不拒绝
      // （同一份配置在四种服务间复用是常见写法），而是**明确告警一次**。
      if (options.renderOptions?.panel !== undefined) {
        warnOnce(
          "route:driving-panel",
          "createDrivingRoute: 官方文档写明 renderOptions.panel 对驾车路线规划无效（该属性对 " +
            "LocalSearch 与步行 / 骑行 / 公交有效）。本次仍会把它传给 SDK，但不会渲染出面板",
        );
      }
      return createRouteService<RoutePlan, "service:driving-route">({
        ctor: "DrivingRoute",
        capability: SERVICE_CAPABILITIES.createDrivingRoute,
        kind: "service:driving-route",
        operation: "ServiceDriver.searchDrivingRoute",
        projection: readRouteResult,
        location,
        settings: definedSettings({
          policy: options.policy,
          enableTraffic: options.enableTraffic,
        }),
        renderOptions: options.renderOptions,
      });
    },

    createWalkingRoute(location, options: WalkingRouteOptions = {}) {
      return createRouteService<RoutePlan, "service:walking-route">({
        ctor: "WalkingRoute",
        capability: SERVICE_CAPABILITIES.createWalkingRoute,
        kind: "service:walking-route",
        operation: "ServiceDriver.searchWalkingRoute",
        projection: readRouteResult,
        location,
        renderOptions: options.renderOptions,
      });
    },

    createRidingRoute(location, options: RidingRouteOptions = {}) {
      return createRouteService<RoutePlan, "service:riding-route">({
        ctor: "RidingRoute",
        capability: SERVICE_CAPABILITIES.createRidingRoute,
        kind: "service:riding-route",
        operation: "ServiceDriver.searchRidingRoute",
        projection: readRouteResult,
        location,
        renderOptions: options.renderOptions,
      });
    },

    createTransitRoute(location, options: TransitRouteOptions = {}) {
      return createRouteService<TransitRoutePlan, "service:transit-route">({
        ctor: "TransitRoute",
        capability: SERVICE_CAPABILITIES.createTransitRoute,
        kind: "service:transit-route",
        operation: "ServiceDriver.searchTransitRoute",
        projection: readTransitRouteResult,
        location,
        // 公交的构造选项比其余三个多（市内策略 / 跨城策略 / 跨城交通方式 / 页容量）——逐个按官方
        // `TransitRouteOptions` 的声明透传，`undefined` 不写（写了等于把「没设」变成「显式设成
        // undefined」，SDK 侧无法区分）
        settings: definedSettings({
          policy: options.policy,
          intercityPolicy: options.intercityPolicy,
          transitTypePolicy: options.transitTypePolicy,
          pageCapacity: options.pageCapacity,
          enableTraffic: options.enableTraffic,
        }),
        renderOptions: options.renderOptions,
      });
    },

    createViewAnimation(keyFrames, options = {}) {
      const ViewAnimation = namespaceCtor(namespace, "ViewAnimation");
      const frames = keyFrames.map((frame) => ({
        ...frame,
        center:
          frame.center && typeof frame.center === "object"
            ? geometry.toRawPoint(frame.center as Point)
            : frame.center,
      }));
      const animation = sdkCall("ViewAnimation", () =>
        new ViewAnimation(frames, {
          duration: (options.duration as number) ?? 1000,
          delay: (options.delay as number) ?? 0,
          interation: (options.interation ?? options.loop ?? 1) as number | "INFINITE",
        }),
      );
      return registry.adopt("service:view-animation", animation);
    },

    createTrackAnimation(_map: MapHandle) {
      // Catalog：`service.track-animation` 是 `unsupported`（迁移结论属 M8 #43）。
      throw new BMapError(
        "BMAP_CAPABILITY_UNSUPPORTED",
        "JSAPI 4.0 没有 TrackAnimation 入口（该插件属 BMapGLLib，迁移结论待 M8 #43 定夺）；" +
          "4.0 的对应能力是原生图层 TrackLine（driver.nativeLayers.create('track-line')）",
        { engine: "jsapi-v4", capability: "service.track-animation" },
      );
    },

    /**
     * 释放 **Autocomplete** 服务实例（Driver 侧释放入口，七/八轮复审）。
     *
     * 为什么是专用入口而不是通用 `dispose(ServiceHandle<string>)`（八轮复审 P2-1）：契约必须与实现
     * 一致。当前只有 Autocomplete 在 Driver 侧持有资源（输入活动监听 + 待回包队列）与 LocalSearch
     * （待回包队列），其余服务
     * （Geocoder / Boundary / Convertor …）的调用**没有登记在飞请求、也没有释放标记**——一个通用的
     * `dispose()` 会承诺「在飞调用会失败、释放后拒绝新调用」，而实现做不到。统一的服务生命周期
     * 统一状态口径由 composable 侧的 `useBMapServiceTask` 承担（ADR `2026-09-14-service-lifecycle-and-local-search.md`）。
     *
     * 语义：① 幂等；② **Driver 侧清理**（解绑输入活动监听 + 把在飞建议调用显式失败）每次都执行
     * （幂等）；③ **SDK 自身的 `dispose()` 只有成功才记账**：抛错时调用方会收到错误，而句柄保持
     * 「不再接受业务调用」，再次 dispose 会**重试**未完成的 SDK 清理（八轮复审 P2-2）。
     */
    disposeAutocomplete(handle: ServiceHandle<"service:autocomplete">) {
      // 先按句柄种类拦（纯元数据判断），再解析；与 setAutocompleteOptions 共用一份判据
      assertAutocompleteHandle(handle, "disposeAutocomplete");
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.disposeAutocomplete");

      disposeServiceInstance(raw, handle, {
        label: "disposeAutocomplete",
        cleanup: () => {
          // 输入框上的输入活动监听必须在实例进入终态时解绑（输入框通常比实例活得久）
          releaseInputWatcher(raw);
          // 在飞建议调用显式失败（幂等，重试时重复执行没有代价）
          const queue = pendingSuggest.get(raw) ?? [];
          pendingSuggest.delete(raw);
          for (const entry of queue) {
            entry.settle.failed({
              code: "BMAP_SERVICE_FAILED",
              message: "该服务实例在请求进行中被 disposeAutocomplete() 释放",
            });
          }
        },
      });
    },

    /* -------------------------------------------------------- 归一化调用面 */

    geocode(handle, request: GeocodeRequest) {
      const address = request?.address;
      if (typeof address !== "string" || address.length === 0) {
        return invalidCall<Point>("Geocoder.getPoint", "address 必须是非空字符串");
      }
      const raw = geocoderOf(handle);
      return createServiceCall<Point>(
        (settle) => {
          callRequired(
            raw,
            "getPoint",
            address,
            (point: RawPoint | null) => {
              if (!point) {
                settleUnavailable(settle);
                return;
              }
              settle.success(toPlainPoint(point));
            },
            request.city,
          );
        },
        { label: "Geocoder.getPoint" },
      );
    },

    reverseGeocode(handle, request: ReverseGeocodeRequest) {
      const point = request?.point;
      if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
        return invalidCall<GeocodedAddress>("Geocoder.getLocation", "point 必须是 { lng, lat }");
      }
      const raw = geocoderOf(handle);
      const options: Record<string, unknown> = {};
      if (typeof request.poiRadius === "number") options.poiRadius = request.poiRadius;
      if (typeof request.numPois === "number") options.numPois = request.numPois;

      return createServiceCall<GeocodedAddress>(
        (settle) => {
          callRequired(
            raw,
            "getLocation",
            geometry.toRawPoint(point),
            (
              result: {
                address?: string;
                point?: RawPoint;
                business?: string;
                addressComponents?: unknown;
                surroundingPois?: unknown[];
              } | null,
            ) => {
              if (!result) {
                settleUnavailable(settle);
                return;
              }
              const surrounding = Array.isArray(result.surroundingPois)
                ? result.surroundingPois
                    .map(readLocalSearchPoi)
                    .filter((poi): poi is LocalSearchPoi => poi !== null)
                : [];
              settle.success({
                address: typeof result.address === "string" ? result.address : "",
                point: result.point ? toPlainPoint(result.point) : null,
                business: typeof result.business === "string" ? result.business : null,
                addressComponents: readAddressComponents(result.addressComponents),
                surroundingPois: surrounding,
                poiCount: surrounding.length,
              });
            },
            options,
          );
        },
        { label: "Geocoder.getLocation" },
      );
    },

    convert(handle, request: ConvertorRequest) {
      const points = request?.points;
      if (!Array.isArray(points) || points.length === 0) {
        return invalidCall<Point[]>("Convertor.translate", "points 必须是非空数组");
      }
      // 坐标合法性**必须在进入调用之前校验**：几何边界会以 `BMAP_INVALID_POINT` 拒绝非有限数
      // / 缺分量，而它是在 `createServiceCall` 之外执行的——不先拦下来就会同步抛错，
      // 连 `ServiceCall` 都返回不了（PR #63 复审 P2-4）。**先校验容器，再逐项读分量**：
      // `points` 里出现 null / 非对象时也不能抛原生 TypeError。
      for (const point of points) {
        const candidate = point as { lng?: unknown; lat?: unknown } | null | undefined;
        const lng = candidate?.lng;
        const lat = candidate?.lat;
        if (typeof lng !== "number" || !Number.isFinite(lng) || typeof lat !== "number" || !Number.isFinite(lat)) {
          return invalidCall<Point[]>(
            "Convertor.translate",
            `points 里存在非法坐标（缺失分量或非有限数）: ${JSON.stringify(point) ?? String(point)}`,
          );
        }
      }
      const raw = convertorOf(handle);
      return createServiceCall<Point[]>(
        (settle) => {
          // 放在受保护流程里：几何转换若仍抛出（例如上游加了别的校验），也走 `failed`
          // 而不是从 `ServiceCall` 之外逃逸。
          const rawPoints = geometry.toRawPoints(points);
          callRequired(
            raw,
            "translate",
            rawPoints,
            request.from,
            request.to,
            (result: RawTranslatePayload | null) => {
              if (!result || typeof result.status !== "number") {
                settle.empty();
                return;
              }
              if (result.status !== 0) {
                settle.failed(
                  {
                    code: result.status,
                    message: result.message || `坐标转换失败（status ${result.status}）`,
                  },
                  result.status,
                );
                return;
              }
              const converted = Array.isArray(result.points) ? result.points : [];
              if (converted.length === 0) {
                settle.empty(result.status);
                return;
              }
              settle.success(converted.map(toPlainPoint), result.status);
            },
          );
        },
        { label: "Convertor.translate" },
      );
    },

    queryBoundary(handle, request: BoundaryRequest) {
      const name = request?.name;
      if (typeof name !== "string" || name.length === 0) {
        return invalidCall<BoundaryRings>("Boundary.get", "name 必须是非空字符串");
      }
      const raw = boundaryOf(handle);
      return createServiceCall<BoundaryRings>(
        (settle) => {
          callRequired(raw, "get", name, (result: RawBoundaryPayload | null) => {
            if (!result || !Array.isArray(result.boundaries)) {
              settleUnavailable(settle);
              return;
            }
            // 两个视图一起给：官方回包本身就是点串，`B*` 覆盖物的 `isBoundary` 直接吃它；
            // 解析出的坐标环给几何运算用。只留一份都会静默丢掉调用方需要的东西。
            const strings = (result.boundaries as unknown[]).filter(
              (ring): ring is string => typeof ring === "string" && ring.length > 0,
            );
            const rings = strings.map(parseBoundaryRing).filter((ring) => ring.length > 0);
            if (rings.length === 0) settle.empty();
            else settle.success({ raw: strings, rings });
          });
        },
        { label: "Boundary.get" },
      );
    },

    locate(handle, options: GeolocationOptions = {}) {
      const raw = geolocationOf(handle);
      return createServiceCall<GeolocationFix>(
        (settle) => {
          callRequired(
            raw,
            "getCurrentPosition",
            (result: RawGeolocationPayload | null) => {
              // `Geolocation` 是公开带状态码的服务之一（`BMAP_STATUS_*`；另一个是 `LocalSearch`）。
              const status = readServiceStatus(raw, warnOnce, "ServiceDriver.locate");
              if (!result || (status !== null && status !== 0)) {
                settle.failed(
                  {
                    code: status ?? "BMAP_SERVICE_FAILED",
                    message:
                      status !== null
                        ? `定位失败：${
                            GEOLOCATION_FAILURE_REASONS[
                              status as keyof typeof GEOLOCATION_FAILURE_REASONS
                            ] ?? `状态码 ${status}`
                          }`
                        : "定位失败：SDK 未返回结果",
                  },
                  status,
                );
                return;
              }
              const point = result.point;
              if (!point || !Number.isFinite(point.lng) || !Number.isFinite(point.lat)) {
                settle.empty(status);
                return;
              }
              settle.success(
                {
                  point: toPlainPoint(point),
                  accuracy: typeof result.accuracy === "number" ? result.accuracy : null,
                  address: result.address ?? null,
                },
                status,
              );
            },
            options,
          );
        },
        { label: "Geolocation.getCurrentPosition" },
      );
    },

    locateCity(handle) {
      const raw = localCityOf(handle);
      return createServiceCall<LocalCityFix>(
        (settle) => {
          callRequired(raw, "get", (result: RawLocalCityPayload | null) => {
            const name = typeof result?.name === "string" ? result.name : "";
            if (!name) {
              // 官方没有公开的错误码入口（R25-C / #72）：回包非空但没有城市名 ⇒ 没有可用的结果
              settle.empty();
              return;
            }
            settle.success({
              name,
              center: result?.center ? toPlainPoint(result.center) : null,
              level: typeof result?.level === "number" ? result.level : null,
            });
          });
        },
        { label: "LocalCity.get" },
      );
    },

    suggest(handle, keyword: string) {
      if (typeof keyword !== "string" || keyword.length === 0) {
        return invalidCall<PlaceSuggestion[]>("Autocomplete.search", "keyword 必须是非空字符串");
      }
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.suggest");

      // 前置拒绝 1（通道独占）：在**调用时**校验输入框的当前状态，而不是只信构造时的标记——
      // HTML 控件的可编辑性随时可变，构造后恢复可输入同样会让两类回包无法区分（五轮复审 P2）。
      const exclusivity = exclusivityFailure(raw);
      if (exclusivity !== null) {
        return serviceFailedCall<PlaceSuggestion[]>("Autocomplete.search", exclusivity);
      }

      // 前置拒绝 2（同关键词互斥）：`Autocomplete` 的回包不带请求身份，两次同名请求的回包互相
      // 不可区分——旧回包先到会把旧结果塞给新请求，新回包先到又会让旧请求失效（两种情况都在
      // PR #63 的复审里被复现过）。拒绝之后同一关键词在任意时刻最多只有一个槽位，归属与到达
      // 顺序无关。彻底的隔离（每次请求一个独立实例 + 回调闭包）属 M7（#38 / #41），见 ADR。
      if (hasPendingKeyword(raw, keyword)) {
        return serviceFailedCall<PlaceSuggestion[]>(
          "Autocomplete.search",
          `同一 Autocomplete 实例上已有关键词 "${keyword}" 的未完成请求：Autocomplete 的回包不带请求标识，` +
            "本次与它的回包无法区分（旧结果可能被当成新结果）；请等它结算后再查，或改用不同关键词",
        );
      }
      if (isQueueFull(raw)) {
        return serviceFailedCall<PlaceSuggestion[]>(
          "Autocomplete.search",
          `同一 Autocomplete 实例上等待回包的程序化检索已达上限 ${MAX_PENDING_SUGGESTS}：` +
            "旧请求的记录必须保留到它的回包到达为止（淘汰它们会让迟到回包被错误归属），请等待结算后再查",
        );
      }

      // 刻意**不传 `onCancel`**：取消只影响本次 `ServiceCall` 的结果（由适配器结算成
      // `canceled`），队列槽位必须留在原处吸收那次 search 的回包——理由见 `pendingSuggest`。
      return createServiceCall<PlaceSuggestion[]>(
        (settle) => {
          enqueueSuggest(raw, keyword, settle);
          try {
            callRequired(raw, "search", keyword);
          } catch (error) {
            // 请求没发出去就不会有回包：回滚槽位，否则队列会永久错位一格
            dequeueSuggest(raw, settle);
            throw error;
          }
        },
        { label: "Autocomplete.search" },
      );
    },

    /* ---------------------------------------------------- LocalSearch（#38） */

    search(handle, keyword, option?: LocalSearchSearchOption) {
      const normalized = normalizeSearchKeyword(keyword);
      if (!normalized) {
        return invalidSearchCall(
          "LocalSearch.search",
          "keyword 必须是非空字符串，或非空的字符串数组",
        );
      }
      const raw = localSearchOf(handle, "ServiceDriver.search");
      const rejection = operationAdmissionFailure(raw, "LocalSearch.search", "disposeLocalSearch");
      if (rejection !== null) return rejectedSearchCall("LocalSearch.search", rejection);

      return invokeSlotOperation<LocalSearchResult[]>("LocalSearch.search", raw, () => {
        if (option?.forceLocal === undefined) {
          callRequired(raw, "search", normalized.value);
        } else {
          callRequired(raw, "search", normalized.value, { forceLocal: option.forceLocal });
        }
      });
    },

    searchNearby(handle, request: LocalSearchNearbyRequest) {
      const normalized = normalizeSearchKeyword(request?.keyword);
      if (!normalized) {
        return invalidSearchCall(
          "LocalSearch.searchNearby",
          "keyword 必须是非空字符串，或非空的字符串数组",
        );
      }
      const center = request?.center;
      const raw = localSearchOf(handle, "ServiceDriver.searchNearby");
      const rejection = operationAdmissionFailure(
        raw,
        "LocalSearch.searchNearby",
        "disposeLocalSearch",
      );
      if (rejection !== null) return rejectedSearchCall("LocalSearch.searchNearby", rejection);

      // 参数校验前移到进入调用之前：几何/半径非法必须走结果通道（`failed`），
      // 而不是从 `createServiceCall` 之外同步抛出（与 `convert` 同一取舍）。
      let resolvedCenter: unknown;
      if (typeof center === "string") {
        if (center.length === 0) {
          return invalidSearchCall("LocalSearch.searchNearby", "center 不能是空字符串");
        }
        resolvedCenter = center;
      } else {
        const point = readPointLike(center);
        if (!point) {
          return invalidSearchCall(
            "LocalSearch.searchNearby",
            "center 必须是城市名字符串或领域 Point（{ lng, lat }）；" +
              "本库不接受官方签名里的 LocalResultPoi——DTO 是投影、不携带 raw POI",
          );
        }
        resolvedCenter = geometry.toRawPoint(point);
      }
      const radius = request?.radius;
      if (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0) {
        return invalidSearchCall("LocalSearch.searchNearby", "radius 必须是非负有限数（米）");
      }

      return invokeSlotOperation<LocalSearchResult[]>("LocalSearch.searchNearby", raw, () => {
        callRequired(raw, "searchNearby", normalized.value, resolvedCenter, radius);
      });
    },

    searchInBounds(handle, request: LocalSearchInBoundsRequest) {
      const normalized = normalizeSearchKeyword(request?.keyword);
      if (!normalized) {
        return invalidSearchCall(
          "LocalSearch.searchInBounds",
          "keyword 必须是非空字符串，或非空的字符串数组",
        );
      }
      const bounds = request?.bounds;
      const raw = localSearchOf(handle, "ServiceDriver.searchInBounds");
      const rejection = operationAdmissionFailure(
        raw,
        "LocalSearch.searchInBounds",
        "disposeLocalSearch",
      );
      if (rejection !== null) return rejectedSearchCall("LocalSearch.searchInBounds", rejection);

      let rawBounds: unknown;
      try {
        // 容器形状由 GeometryDriver 校验（它在进入调用之前抛结构化错误，见 `convert` 同源取舍）
        rawBounds = geometry.toRawBounds(bounds);
      } catch (error) {
        return invalidSearchCall(
          "LocalSearch.searchInBounds",
          `bounds 必须是 { southwest, northeast } 且角点为有限坐标（${
            (error as Error)?.message ?? String(error)
          }）`,
        );
      }

      return invokeSlotOperation<LocalSearchResult[]>("LocalSearch.searchInBounds", raw, () => {
        callRequired(raw, "searchInBounds", normalized.value, rawBounds);
      });
    },

    gotoPage(handle, page: number) {
      if (typeof page !== "number" || !Number.isInteger(page) || page < 0) {
        return invalidSearchCall("LocalSearch.gotoPage", "page 必须是从 0 开始的整数");
      }
      const raw = localSearchOf(handle, "ServiceDriver.gotoPage");
      // `gotoPage` 是对「上一条结果」的延续：槽位唯一就够（它必须在同一条结果集上翻页，
      // 因此也不需要自己的关键字——上一次检索的载荷本来就在同一个实例里）。
      const rejection = operationAdmissionFailure(raw, "LocalSearch.gotoPage", "disposeLocalSearch");
      if (rejection !== null) return rejectedSearchCall("LocalSearch.gotoPage", rejection);

      return invokeSlotOperation<LocalSearchResult[]>("LocalSearch.gotoPage", raw, () => {
        callRequired(raw, "gotoPage", page);
      });
    },

    /* ------------------------------------------------ 路线归一化调用面（#39） */

    searchDrivingRoute(handle, request: DrivingRouteRequest) {
      return invokeRouteSearch<RoutePlan>("DrivingRoute.search", handle, request, {
        // 驾车**没有**关键字检索（官方签名是 `Point | LocalResultPoi`）
        allowKeyword: false,
        allowWaypoints: true,
      });
    },

    searchWalkingRoute(handle, request: RouteRequest) {
      return invokeRouteSearch<RoutePlan>("WalkingRoute.search", handle, request, {
        allowKeyword: true,
        allowWaypoints: false,
      });
    },

    searchRidingRoute(handle, request: RouteRequest) {
      return invokeRouteSearch<RoutePlan>("RidingRoute.search", handle, request, {
        allowKeyword: true,
        allowWaypoints: false,
      });
    },

    searchTransitRoute(handle, request: TransitRouteRequest) {
      return invokeRouteSearch<TransitRoutePlan>("TransitRoute.search", handle, request, {
        allowKeyword: true,
        allowWaypoints: false,
      });
    },

    clearRouteResults(handle) {
      assertRouteHandle(handle, "ServiceDriver.clearRouteResults");
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.clearRouteResults");
      if (disposedInstances.has(raw)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "clearRouteResults: 该路线服务实例已被 disposeRoute() 释放，拒绝在已销毁的实例上写入；" +
            "请重建实例",
          { engine: "jsapi-v4" },
        );
      }
      callRequired(raw, "clearResults");
    },

    disposeRoute(handle) {
      assertRouteHandle(handle, "ServiceDriver.disposeRoute");
      const raw = resolve<Record<string, unknown>>(handle, "ServiceDriver.disposeRoute");
      // 与 `disposeLocalSearch` 同一套语义与实现：置终态 → 解绑订阅 → 公开的 `clearResults()`
      disposeResultHolderInstance(raw, handle, "disposeRoute");
    },

    /**
     * 清除最近一次检索的结果（`LocalSearch#clearResults`）：地图上的标注、结果面板与实例内部的
     * 结果状态一起清掉。**没有回包**，因此不是 `ServiceCall`——它是「丢弃已可见的结果」，
     * 与「取消一个在飞请求」（`ServiceCall.cancel()`）是两件事，两者互不代替。
     */
    clearLocalSearch(handle) {
      const raw = localSearchOf(handle, "ServiceDriver.clearLocalSearch");
      if (disposedInstances.has(raw)) {
        throw new BMapError(
          "BMAP_INVALID_ARGUMENT",
          "clearLocalSearch: 该 LocalSearch 实例已被 disposeLocalSearch() 释放，拒绝在已销毁的" +
            "实例上写入；请重建实例",
          { engine: "jsapi-v4" },
        );
      }
      callRequired(raw, "clearResults");
    },

    /**
     * 释放本地检索实例：Driver 侧清理（在飞检索显式失败 + 置终态）**加上公开 API**
     * `clearResults()`（官方 `LocalSearch` 没有 `dispose()`，见类型里的说明）。
     */
    disposeLocalSearch(handle) {
      const raw = localSearchOf(handle, "ServiceDriver.disposeLocalSearch");
      disposeResultHolderInstance(raw, handle, "disposeLocalSearch");
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 官方类型一致性（类型层断言，零运行时开销）                                     */
/* -------------------------------------------------------------------------- */

type ExpectTrue<T extends true> = T;

/**
 * 地理定位失败状态码与官方 `const/StatusCodes.d.ts` 一致。
 *
 * 上游改值即编译失败——比注释里写「与官方一致」可靠（同 #22 的锚点常量表口径）。
 */
type _AssertGeolocationFailureStatus =
  | typeof BMAP_STATUS_UNKNOWN_LOCATION
  | typeof BMAP_STATUS_PERMISSION_DENIED
  | typeof BMAP_STATUS_SERVICE_UNAVAILABLE
  | typeof BMAP_STATUS_TIMEOUT;
type _AssertGeolocationFailureReasons = ExpectTrue<
  _AssertGeolocationFailureStatus extends keyof typeof GEOLOCATION_FAILURE_REASONS ? true : false
>;

/** 创建面用到的构造器名必须真的在官方 `BMap` 命名空间上。 */
type ServiceCtorName =
  | "Geocoder"
  | "Convertor"
  | "Geolocation"
  | "LocalCity"
  | "Boundary"
  | "Autocomplete"
  | "LocalSearch"
  | "DrivingRoute"
  | "WalkingRoute"
  | "RidingRoute"
  | "TransitRoute"
  | "ViewAnimation";
type _AssertServiceCtors = ExpectTrue<ServiceCtorName extends keyof typeof BMap ? true : false>;
