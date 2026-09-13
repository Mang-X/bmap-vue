/**
 * UI Kit 事件载荷 → 公共 DTO 的投影（R25-D / issue #73）
 *
 * 上游把原始 POI / 建议对象直接交给 `on()` 回调，其中 `point` 是 `BMapGL.Point` 实例。
 * 本库的公共事件必须把它们**投影成纯数据**：
 * - 公共类型里不出现 `BMapGL.*`（`check:public-dts` 会拦）；
 * - 消费者拿到的事件载荷与 `raw` SDK 解耦，序列化 / 存 store 都安全；
 * - 上游新增字段不会自动泄进我们的公开契约（少一处隐式依赖）。
 *
 * 投影是**纯函数**、不做网络与 DOM 访问，因此可以在无 widget 的情况下单测。
 */
import type {
  PlaceHighlightDTO,
  PlacePointDTO,
  PlacePoiDTO,
  PlaceSuggestionDTO,
} from "./types";

/** 读一个可能是任意值的字段并转成字符串；缺失时给空串（上游契约里这些字段必定是字符串）。 */
function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

/** 可选字符串：缺失给 `undefined`，避免把「没有」写成空串。 */
function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 原始点 → `{ lng, lat }`。
 *
 * 非对象、缺字段、`NaN` / `Infinity` 一律返回 `undefined`：宁可让业务看到「没有坐标」，
 * 也不要给一个会让后续 `toRawPoint()` 抛错的坏点。
 */
export function toPointDTO(value: unknown): PlacePointDTO | undefined {
  if (!isRecord(value)) return undefined;
  const { lng, lat } = value as { lng?: unknown; lat?: unknown };
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  return { lng: lng as number, lat: lat as number };
}

/** 建议对象 → DTO。输入不是对象时返回 `null`（调用方应丢弃该事件）。 */
export function toSuggestionDTO(value: unknown): PlaceSuggestionDTO | null {
  if (!isRecord(value)) return null;
  const point = toPointDTO(value.point);
  const dto: PlaceSuggestionDTO = {
    name: readString(value, "name"),
    province: readString(value, "province"),
    city: readString(value, "city"),
    district: readString(value, "district"),
    business: readString(value, "business"),
    address: readString(value, "address"),
  };
  const tag = readOptionalString(value, "tag");
  const uid = readOptionalString(value, "uid");
  if (tag !== undefined) dto.tag = tag;
  if (uid !== undefined) dto.uid = uid;
  if (point) dto.point = point;
  return dto;
}

/** `suggest` 载荷 → DTO 数组。非数组（上游异常形态）按空数组处理，不抛。 */
export function toSuggestionList(value: unknown): PlaceSuggestionDTO[] {
  if (!Array.isArray(value)) return [];
  const out: PlaceSuggestionDTO[] = [];
  for (const item of value) {
    const dto = toSuggestionDTO(item);
    if (dto) out.push(dto);
  }
  return out;
}

/** `highlight` 载荷 → DTO。缺少可用的 `value` 时返回 `null`。 */
export function toHighlightDTO(value: unknown): PlaceHighlightDTO | null {
  if (!isRecord(value)) return null;
  const suggestion = toSuggestionDTO(value.value);
  if (!suggestion) return null;
  const index = value.index;
  if (!Number.isFinite(index)) return null;
  return { index: index as number, value: suggestion };
}

/** POI 对象 → DTO。输入不是对象时返回 `null`。 */
export function toPoiDTO(value: unknown): PlacePoiDTO | null {
  if (!isRecord(value)) return null;
  const point = toPointDTO(value.point);
  const dto: PlacePoiDTO = {
    title: readString(value, "title"),
    address: readString(value, "address"),
  };
  const uid = readOptionalString(value, "uid");
  const tel = readOptionalString(value, "tel");
  if (uid !== undefined) dto.uid = uid;
  if (tel !== undefined) dto.tel = tel;
  if (point) dto.point = point;
  return dto;
}

/** `load` 载荷 → DTO 数组。上游回包为数组，异常形态按空数组处理。 */
export function toPoiList(value: unknown): PlacePoiDTO[] {
  if (!Array.isArray(value)) return [];
  const out: PlacePoiDTO[] = [];
  for (const item of value) {
    const dto = toPoiDTO(item);
    if (dto) out.push(dto);
  }
  return out;
}
