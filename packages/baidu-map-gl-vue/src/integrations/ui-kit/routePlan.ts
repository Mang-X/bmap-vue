/**
 * `RoutePlan` 的**载荷 / 参数转换**（UIKIT-02 / issue #75）
 *
 * 两个方向都收在这里，让 SFC 只剩 Vue 绑定：
 * - **上游 → 本库**：事件载荷与回包投影成公共 DTO（`toRoutePlan*DTO`）；
 * - **本库 → 上游**：公共搜索参数换成上游能用的形状（`toUpstreamRouteSearchOptions()`，
 *   坐标经 Driver 的 `toRawPoint()` 换成引擎原生点）；
 * - 以及失败归一（`createRoutePlanErrorMapper()` / `routePlanUnrecognized()`）。
 *
 * 上游 `RoutePlan` 的载荷已经是**归一化**的（`NormalizedRouteResult` 里没有 `BMapGL.*`），
 * 但仍然不能直接当公共契约用，理由和 `points.ts` 一样：
 * - 公共类型必须**自持**（`check:public-dts` 不允许引用上游类型包，消费者也不该为了
 *   拿到我们的声明去装 `@baidumap/jsapi-ui-kit`）；
 * - 上游新增字段不应自动泄进我们的公开契约；
 * - 上游形状漂移时必须**可观察**（投影失败 → 报错 / 不发事件），而不是把错形状原样透传。
 *
 * 因此这里逐字段读、逐个判别键校验，并把「不可用」与「没有」区分开：
 * - 顶层不可用（类型不认识、`plans` 不是数组、起点/终点缺坐标）→ 整个结果返回 `null`；
 * - 数组项不可用（某条方案缺 `distance`、某个路段判别键不认识）→ **丢弃该项**，
 *   其余照常保留（与 `toPoiList` 丢坏 POI 的口径一致）。
 *
 * 投影是**纯函数**、不做网络与 DOM 访问，因此可以在无 widget 的情况下单测。
 */
import { BMapError } from "../../core/errors/BMapError";
import { redactAk } from "../../core/logger";
import { toPointDTO } from "./points";
import {
  collect,
  isRecord,
  readOptionalNumber,
  readOptionalString,
  readString,
  readStringList,
} from "./readers";
import type {
  PlacePointDTO,
  RouteDriveSegmentDTO,
  RoutePlanDTO,
  RoutePlanEndpointInput,
  RoutePlanMode,
  RoutePlanNavClickDTO,
  RoutePlanPlanSelectDTO,
  RoutePlanResultDTO,
  RoutePlanSearchOptionsDTO,
  RoutePlanTypeChangeDTO,
  RoutePointDTO,
  RouteSegmentBaseDTO,
  RouteSegmentDTO,
  RouteSegmentType,
  RouteTransitSubType,
} from "./types";

/** 数据面允许的规划类型（与上游 `RoutePlanType` 对齐，对齐关系由契约测试锁定）。 */
const ROUTE_MODES: readonly RoutePlanMode[] = ["driving", "transit", "riding", "walking"];

const SEGMENT_TYPES: readonly RouteSegmentType[] = ["drive", "walk", "transit", "riding"];

const TRANSIT_SUB_TYPES: readonly RouteTransitSubType[] = [
  "bus",
  "subway",
  "ferry",
  "train",
  "airplane",
  "coach",
];

/** 规划类型判别：只接受上游声明的四个取值，别的字符串一律「不认识」。 */
export function toRouteMode(value: unknown): RoutePlanMode | undefined {
  return typeof value === "string" && (ROUTE_MODES as readonly string[]).includes(value)
    ? (value as RoutePlanMode)
    : undefined;
}

function isSegmentType(value: unknown): value is RouteSegmentType {
  return typeof value === "string" && (SEGMENT_TYPES as readonly string[]).includes(value);
}

function isTransitSubType(value: unknown): value is RouteTransitSubType {
  return typeof value === "string" && (TRANSIT_SUB_TYPES as readonly string[]).includes(value);
}

/**
 * 坐标数组 → DTO 数组。
 *
 * 非数组返回 `undefined`（「没有这个字段」）；是数组时**保留空数组的语义**（上游确实会给
 * 空 `path`），只丢掉里面解析不出来的坏点 —— 把 `[]` 读成 `undefined` 会让调用方多一次判空。
 */
function toPointList(value: unknown): PlacePointDTO[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(toPointDTO).filter((point): point is PlacePointDTO => point !== undefined);
}

/** 路段里「有就给、没有就不给」的两个可选字段。 */
function readSegmentPathAndDuration(
  value: Record<string, unknown>,
): Partial<Pick<RouteSegmentBaseDTO, "path" | "duration">> {
  const out: Partial<Pick<RouteSegmentBaseDTO, "path" | "duration">> = {};
  const path = toPointList(value.path);
  const duration = readOptionalNumber(value, "duration");
  if (path !== undefined) out.path = path;
  if (duration !== undefined) out.duration = duration;
  return out;
}

/** 路线端点 → DTO。`location` 是上游的必填字段，缺了（或坐标非法）视为该项不可用。 */
export function toRoutePointDTO(value: unknown): RoutePointDTO | null {
  if (!isRecord(value)) return null;
  const location = toPointDTO(value.location);
  if (!location) return null;
  const dto: RoutePointDTO = { title: readString(value, "title"), location };
  const city = readOptionalString(value, "city");
  const uid = readOptionalString(value, "uid");
  if (city !== undefined) dto.city = city;
  if (uid !== undefined) dto.uid = uid;
  return dto;
}

/** 路段 → DTO。判别键（`type`，公交还要 `subType`）不认识时返回 `null`。 */
export function toRouteSegmentDTO(value: unknown): RouteSegmentDTO | null {
  if (!isRecord(value)) return null;
  const type = value.type;
  const distance = readOptionalNumber(value, "distance");
  if (!isSegmentType(type) || distance === undefined) return null;

  const base = {
    distance,
    distanceText: readString(value, "distanceText"),
    ...readSegmentPathAndDuration(value),
  };

  switch (type) {
    case "drive": {
      const location = toPointDTO(value.location);
      if (!location) return null;
      const segment: RouteDriveSegmentDTO = {
        ...base,
        type,
        description: readString(value, "description"),
        location,
      };
      const roadName = readOptionalString(value, "roadName");
      if (roadName !== undefined) segment.roadName = roadName;
      return segment;
    }
    case "walk":
      return { ...base, type, description: readOptionalString(value, "description") };
    case "riding":
      return { ...base, type, description: readOptionalString(value, "description") };
    case "transit": {
      const subType = value.subType;
      const stopCount = readOptionalNumber(value, "stopCount");
      if (!isTransitSubType(subType) || stopCount === undefined) return null;
      return {
        ...base,
        type,
        subType,
        lineName: readString(value, "lineName"),
        onStop: readString(value, "onStop"),
        offStop: readString(value, "offStop"),
        stopCount,
      };
    }
  }
}

/** 方案 → DTO。`distance` / `duration` 是判据：缺任一项说明这不是一条能用的方案。 */
export function toRoutePlanDTO(value: unknown): RoutePlanDTO | null {
  if (!isRecord(value)) return null;
  const distance = readOptionalNumber(value, "distance");
  const duration = readOptionalNumber(value, "duration");
  if (distance === undefined || duration === undefined) return null;

  const dto: RoutePlanDTO = {
    distance,
    distanceText: readString(value, "distanceText"),
    duration,
    durationText: readString(value, "durationText"),
    segments: collect(value.segments, toRouteSegmentDTO),
  };

  const toll = readOptionalNumber(value, "toll");
  const tollDistance = readOptionalNumber(value, "tollDistance");
  const trafficLights = readOptionalNumber(value, "trafficLights");
  const transitType = readOptionalNumber(value, "transitType");
  const tag = readOptionalString(value, "tag");
  const walkDistance = readOptionalString(value, "walkDistance");
  const waypoints = readStringList(value, "waypoints");
  const path = toPointList(value.path);
  if (toll !== undefined) dto.toll = toll;
  if (tollDistance !== undefined) dto.tollDistance = tollDistance;
  if (trafficLights !== undefined) dto.trafficLights = trafficLights;
  if (transitType !== undefined) dto.transitType = transitType;
  if (tag !== undefined) dto.tag = tag;
  if (walkDistance !== undefined) dto.walkDistance = walkDistance;
  if (waypoints !== undefined) dto.waypoints = waypoints;
  if (path !== undefined) dto.path = path;
  return dto;
}

/**
 * 路线结果 → DTO（`result` 事件载荷与 `search()` 的返回值共用）。
 *
 * 两种载荷的字段名不同：`result` 事件用 `type`，`search()` 的返回值用 `routeType`
 * （同一实现里两者相等，见 `types.ts` 的归一化说明）。这里两个都认，先看 `type` 再看
 * `routeType`；两个都不是已知取值 → 返回 `null`（调用方据此「不发事件」/「动作拒绝」，
 * 而不是发一条 `type: undefined` 的假结果）。
 */
export function toRoutePlanResultDTO(value: unknown): RoutePlanResultDTO | null {
  if (!isRecord(value)) return null;
  const type = toRouteMode(value.type) ?? toRouteMode(value.routeType);
  if (!type) return null;
  if (!Array.isArray(value.plans)) return null;
  const start = toRoutePointDTO(value.start);
  const end = toRoutePointDTO(value.end);
  if (!start || !end) return null;
  return { type, start, end, plans: collect(value.plans, toRoutePlanDTO) };
}

/** `typechange` 载荷 → DTO。 */
export function toRoutePlanTypeChangeDTO(value: unknown): RoutePlanTypeChangeDTO | null {
  if (!isRecord(value)) return null;
  const type = toRouteMode(value.type);
  return type ? { type } : null;
}

/** `planselect` 载荷 → DTO。`plan` 取不到时整条不发（缺了方案的选择事件没有意义）。 */
export function toRoutePlanPlanSelectDTO(value: unknown): RoutePlanPlanSelectDTO | null {
  if (!isRecord(value)) return null;
  const type = toRouteMode(value.type);
  const planIndex = readOptionalNumber(value, "planIndex");
  const plan = toRoutePlanDTO(value.plan);
  if (!type || planIndex === undefined || !plan) return null;
  return { type, planIndex, plan };
}

/**
 * `navclick` 载荷 → DTO。
 *
 * `result` / `plan` 在上游可能为空（还没搜索过就点击），这是**合法取值**：照常发事件，
 * `result` 给 `null`、`plan` 省略 —— 不发事件会让调用方以为点击没被识别。
 */
export function toRoutePlanNavClickDTO(value: unknown): RoutePlanNavClickDTO | null {
  if (!isRecord(value)) return null;
  const type = toRouteMode(value.type);
  const planIndex = readOptionalNumber(value, "planIndex");
  if (!type || planIndex === undefined) return null;
  const dto: RoutePlanNavClickDTO = {
    type,
    planIndex,
    result: toRoutePlanResultDTO(value.result),
  };
  const plan = toRoutePlanDTO(value.plan);
  if (plan) dto.plan = plan;
  return dto;
}

/** 把公共搜索参数换成上游能用的形状（坐标经 `toRawPoint` 转成引擎原生点）。 */
export async function toUpstreamRouteSearchOptions(
  options: RoutePlanSearchOptionsDTO,
  toRawPoint: (point: PlacePointDTO) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const endpoint = async (value: RoutePlanEndpointInput): Promise<unknown> =>
    typeof value === "string" ? value : toRawPoint(value);

  const out: Record<string, unknown> = {
    start: await endpoint(options.start),
    end: await endpoint(options.end),
  };
  if (options.startName !== undefined) out.startName = options.startName;
  if (options.endName !== undefined) out.endName = options.endName;
  if (options.startUid !== undefined) out.startUid = options.startUid;
  if (options.endUid !== undefined) out.endUid = options.endUid;
  if (options.waypoints !== undefined) {
    const waypoints: unknown[] = [];
    for (const point of options.waypoints) waypoints.push(await toRawPoint(point));
    out.waypoints = waypoints;
  }
  return out;
}

/**
 * 上游错误的**脱敏副本**。
 *
 * `cause` 是对外出口：`BMapError.toJSON()` 会带上它，Sentry / OpenTelemetry 这类上报工具
 * 还会直接读 `cause.message`。UI Kit 的请求 URL 里带 `ak=`（发布产物里是
 * `...&ie=utf-8&oue=1&fromproduct=jsapi&ak=${a}`），一旦上游把 URL 写进错误文案，
 * 原样挂上游 Error 就会把凭据漏出去。因此这里只保留 `name` 与过了一遍 `redactAk` 的文本。
 */
function sanitizeUpstreamError(raw: object): { name: string; message: string; stack: string } {
  const isError = raw instanceof Error;
  return {
    name: isError ? raw.name : "Error",
    message: redactAk(isError ? raw.message : String(raw)),
    stack: redactAk(isError ? (raw.stack ?? "") : ""),
  };
}

/**
 * 造一个「上游失败 → 对外的那一条 `BMapError`」映射器，**每个组件实例一个**。
 *
 * 上游 `searchByType()` 先 `emit("error", e)` 再把**同一个** `e` 抛出去，所以「事件里看到的」
 * 与「`await search()` 拿到的」本来就是同一条错误对象。本库把它包成 `BMapError` 之后必须维持
 * 这个性质（评审 #73 的口径），用 `WeakMap` 按上游错误身份缓存即可 ——
 * 不需要「最近一次错误」这种会被并发覆盖的可变状态。
 *
 * 之所以是**工厂**而不是模块级单例：缓存的生命周期应当跟组件实例走（卸载后不留下指向
 * 已销毁组件的长尾引用）。
 */
export function createRoutePlanErrorMapper(component: string): (raw: unknown) => BMapError {
  const cache = new WeakMap<object, BMapError>();
  return (raw: unknown): BMapError => {
    if (raw instanceof BMapError) return raw;
    if (isRecord(raw)) {
      const cached = cache.get(raw);
      if (cached) return cached;
      const message = raw instanceof Error ? raw.message : String(raw);
      const wrapped = new BMapError("BMAP_SERVICE_FAILED", `${component}: ${redactAk(message)}`, {
        cause: sanitizeUpstreamError(raw),
        component,
      });
      cache.set(raw, wrapped);
      return wrapped;
    }
    return new BMapError("BMAP_SERVICE_FAILED", `${component}: ${redactAk(String(raw))}`, {
      component,
    });  };
}

/** 上游回包形状不认识时的统一失败：**不**用「空结果」冒充成功。 */
export function routePlanUnrecognized(component: string, message: string): BMapError {
  return new BMapError("BMAP_SERVICE_FAILED", `${component}: ${message}`, { component });
}
