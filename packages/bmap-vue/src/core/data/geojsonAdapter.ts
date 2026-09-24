/**
 * Item[] → GeoJSON FeatureCollection 适配（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * v4 的批量点图层（官方 `PointShapeLayer` / `PointIconLayer`）只吃 GeoJSON：`setData()` 收一份
 * `FeatureCollection`，`idKey` 声明「哪个 properties 字段是要素身份」。业务侧手上是 `Item[]`
 * 与 `getPosition` / `properties` 两个取值函数，因此需要一层**明确的投影**，而不是让每个组件
 * 各写一遍 `features.map(...)`。
 *
 * ## 设计（替代方案与取舍写在 ADR `2026-09-18-data-layer-manager-and-point-collection`）
 *
 * 1. **idKey 必须真的写进 properties**：拾取事件只回传要素的 `properties`
 *    （`event.value.dataItem.properties`，见 `.agents/skills/bmap-jsapi-v4/references/visualization-layers.md`），
 *    业务键不写进去就「点得到要素、认不出业务项」。字段名 = `itemKey`（字符串时）或保留字段
 *    `__id`（`itemKey` 是函数时，函数没有可用的属性名）。**该字段由本适配器最后写入**，
 *    用户 `properties()` 里同名的值会被覆盖并报 `id-field-overwritten`（否则 SDK 的 idKey
 *    指向的会是用户那份值，要素身份被悄悄换掉）。
 * 2. **坏数据跳过 + 报告，不抛错**：规则的唯一实现在 `./itemScan.ts`（与逐项 Marker 路径共用，
 *    见该文件的三条规则），本模块只把它投影成 Feature —— 两条路径的「什么算坏数据」不会分叉。
 * 3. **只做 Point**：批量点图层的输入语义是点；线面由其它 kind（`LineLayer` / `FillLayer`，见 #36）
 *    承担，混进来会让「这个组件的输入是什么」变模糊。
 *
 * 本模块是**框架无关**的（不 import vue、不 import Driver）：可以在没有 Vue、没有 SDK 的测试里
 * 直接调用。
 */
import { itemKeyReader, scanValidItems, type ScannedItem } from "./itemScan";
import type { DataProblem, DataProblemKind } from "./problems";
import type { PointLike } from "./points";

/** GeoJSON Point Feature（自持的结构，不 import 上游类型包：公共类型不得依赖 SDK 声明）。 */
export interface GeoJsonPointFeature {
  readonly type: "Feature";
  readonly geometry: { readonly type: "Point"; readonly coordinates: readonly [number, number] };
  readonly properties: Record<string, unknown>;
}

export interface GeoJsonFeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: GeoJsonPointFeature[];
}

/**
 * 生成 id 字段时用的保留字段名（`itemKey` 是函数时唯一的落点）。
 *
 * 取 `__id` 而不是 `id`：函数式 key 的调用方并没有表态「业务数据里有个 id 字段」，
 * 占用通用名 `id` 会把用户自己的 `properties()` 输出撞掉。
 */
export const GENERATED_ID_FIELD = "__id";

/**
 * 适配层的问题码 = 共用的问题码集合（扫描的三条 + 「用户 properties 覆盖了要素身份」）。
 *
 * 这里只做**改名别名**：调用方读 `GeoJsonProblem` 时语义更清楚，而实现只有一份（`./problems.ts`）。
 */
export type GeoJsonProblemKind = DataProblemKind;
export type GeoJsonProblem = DataProblem;

export interface GeoJsonAdaptOptions<Item> {
  /** `keyof Item` 或取值函数；决定 id 字段名（字符串时用该名，函数时用 `GENERATED_ID_FIELD`）。 */
  readonly itemKey: keyof Item | ((item: Item) => PropertyKey);
  /** 取坐标；返回 `null` / `undefined` = 这一项没有位置（会被跳过并报告）。 */
  readonly getPosition: (item: Item) => PointLike | null | undefined;
  /** 属性映射（写进 `feature.properties`）；缺省时只有 id 字段。 */
  readonly properties?: (item: Item) => Record<string, unknown> | null | undefined;
  /** 每条问题的回调（组件转成开发期告警；测试拿它当断言出口）。 */
  readonly onProblem?: (problem: GeoJsonProblem) => void;
}

export interface AdaptedPoints<Item> {
  readonly data: GeoJsonFeatureCollection;
  /** 与 `features` **同序**的业务项（被跳过的项不在里面）。 */
  readonly items: Item[];
  /** 实际写进 properties 的 id 字段名（= SDK 的 `idKey`）。 */
  readonly idKey: string;
  readonly problems: readonly GeoJsonProblem[];
}

/** 从 `itemKey` 解析出 id 字段名（唯一定义点：适配器与组件都用它，不能各推一次）。 */
export function resolveIdField<Item>(itemKey: keyof Item | ((item: Item) => PropertyKey)): string {
  // 函数式 key 没有可用的属性名（`String(fn)` 是函数源码，不能当字段名）⇒ 用保留字段。
  return typeof itemKey === "function" ? GENERATED_ID_FIELD : String(itemKey);
}

/**
 * 业务数据 → GeoJSON `FeatureCollection`。
 *
 * 被跳过的项（key 缺失 / 坐标非法 / 重复覆盖）只出现在 `problems` 里，不产生 Feature；
 * `items` 与 `features` 严格同序，供调用方按要素下标反查业务项。
 */
export function adaptPoints<Item>(
  items: readonly Item[],
  options: GeoJsonAdaptOptions<Item>,
): AdaptedPoints<Item> {
  const { itemKey, getPosition, properties, onProblem } = options;
  const idKey = resolveIdField(itemKey);
  const problems: GeoJsonProblem[] = [];
  const report = (problem: GeoJsonProblem): void => {
    problems.push(problem);
    onProblem?.(problem);
  };

  const scanned = scanValidItems(items, {
    getKey: itemKeyReader(itemKey),
    getPosition,
    onProblem: report,
  });

  const features = scanned.map((entry) => {
    const featureProperties = buildProperties(entry, idKey, properties, report);
    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [entry.point.lng, entry.point.lat] as const,
      },
      properties: featureProperties,
    };
  });

  return { data: { type: "FeatureCollection", features }, items: scanned.map((e) => e.item), idKey, problems };
}

/**
 * 组装 `feature.properties`。
 *
 * id 字段**最后写**：要素身份不接受用户 `properties()` 的覆盖（否则 SDK 的 `idKey` 认的是
 * 用户那份值，拾取回来的 key 与业务键对不上）。覆盖时报告，不静默。
 */
function buildProperties<Item>(
  entry: ScannedItem<Item>,
  idKey: string,
  properties: GeoJsonAdaptOptions<Item>["properties"],
  report: (problem: GeoJsonProblem) => void,
): Record<string, unknown> {
  const mapped = properties?.(entry.item);
  const result: Record<string, unknown> = { ...(mapped ?? {}) };
  if (mapped && idKey in mapped && mapped[idKey] !== entry.key) {
    report({
      kind: "id-field-overwritten",
      index: entry.index,
      key: entry.key,
      detail: `properties() 里的 ${idKey}=${describe(mapped[idKey])} 会被要素身份覆盖为 ${describe(
        entry.key,
      )}（idKey 必须指向要素身份）`,
    });
  }
  result[idKey] = entry.key;
  return result;
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}
