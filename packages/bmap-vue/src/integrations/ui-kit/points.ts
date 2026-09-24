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
import { collect, isRecord, readOptionalString, readString } from "./readers";
import type {
  PlaceDetailDTO,
  PlaceHighlightChangeDTO,
  PlaceHighlightDTO,
  PlacePointDTO,
  PlacePoiDTO,
  PlaceSuggestionDTO,
} from "./types";

/**
 * 构造期输入的**稳定串**：嵌套对象按排序后的键序列化，因此「每次渲染传一个新对象字面量、
 * 但内容相同」不会被误判成变更（否则内联对象会引发重建风暴）。
 *
 * 口径与官方 react-bmap 的 `stableStringify`（用作 effect 依赖 key）一致。
 */
export function canonicalKey(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item !== undefined) out[key] = canonicalize(item);
    }
    return out;
  }
  return value;
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
  return collect(value, toSuggestionDTO);
}

/**
 * 高亮端点 `{ index, value }` → DTO。缺 `index` 或 `value` 不可解析时返回 `null`。
 */
export function toHighlightItemDTO(value: unknown): PlaceHighlightDTO | null {
  if (!isRecord(value)) return null;
  const suggestion = toSuggestionDTO(value.value);
  if (!suggestion) return null;
  const index = value.index;
  if (!Number.isFinite(index)) return null;
  return { index: index as number, value: suggestion };
}

/**
 * `highlight` 载荷 → 变更对 DTO。
 *
 * 上游真实载荷是 `{ from: HighlightItem | null, to: HighlightItem }`
 * （形状锁见 `v3-ui-kit-widget-contract.test.ts`）：
 * - `to` 不可解析 → 整条事件不发（返回 `null`），不制造「看起来高亮变了」的假信号；
 * - `from` **为 `null`** → 规范化为 `null`：这是上游表达「此前没有高亮项」的合法取值；
 * - `from` **存在却解析不出来** → 同样整条不发。这里**不能**降级成 `null` ——
 *   那会把「形状变了」伪装成「首次高亮」，属于同一类假信号，只是方向相反。
 *
 * ⚠️ 历史教训：本函数的前身按 `{ index, value }` 解析，而夹具照抄了同一个错误假设，
 * 于是「真实运行时事件被静默丢弃」在测试里是全绿的。形状断言必须对着**发布产物**，不能对着夹具。
 */
export function toHighlightChangeDTO(value: unknown): PlaceHighlightChangeDTO | null {
  if (!isRecord(value)) return null;
  const to = toHighlightItemDTO(value.to);
  if (!to) return null;

  const rawFrom = value.from;
  if (rawFrom === null || rawFrom === undefined) return { from: null, to };
  const from = toHighlightItemDTO(rawFrom);
  if (!from) return null;
  return { from, to };
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
  return collect(value, toPoiDTO);
}

/**
 * `PlaceDetail.load` 载荷 → DTO（UIKIT-02 / issue #75）。
 *
 * 与 `toPoiDTO` **逐字段同形**，这跟上游一致：`It()`（详情）与 `wt()`（POI）在上游产物里
 * 是逐字相同的两个函数（`{ title: String(e.name ?? e.title ?? ""), address: …, uid, point, tel }`）。
 * 所以这里直接复用那份读法，而不是抄一遍 —— 抄一遍的唯一后果是两份将来会漂移。
 *
 * 两者的**差异只在输入来源**：详情可能是 uid 模式（详情接口回包，`point` 是 `{lng,lat}`），
 * 也可能是 POI 模式（本地渲染，`point` 可能是引擎原生点实例）。`toPoiDTO` 里的坐标校验
 * 两种情况都覆盖（非有限数 → 丢弃）。
 *
 * 输入不是对象时返回 `null`（调用方应丢弃该事件，而不是合成一条空详情）。
 */
export function toPlaceDetailDTO(value: unknown): PlaceDetailDTO | null {
  return toPoiDTO(value);
}
