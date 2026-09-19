/**
 * 原生批量图层的**拾取读取**（M6 / issue #36）
 *
 * 官方四类专页图层（`PointIconLayer` / `PointShapeLayer` / `LineLayer` / `FillLayer`）的事件都是
 * `NormalLayerPickEvent`：
 *
 * ```ts
 * interface NormalLayerPickEvent<T> { type; target; currentTarget; pixel: Pixel; latLng: Point;
 *   value: object | null | undefined }
 * ```
 *
 * 声明的类型是 `value: object | null | undefined` —— 也就是说**外壳**有声明，而 `value` 里的
 * **字段**（`dataIndex` / `dataItem`）是**运行时约定**（官方示例用
 * `event.value.dataItem.properties.id` 取业务键）。因此这里做的是**结构化读取**：
 *
 * - **未命中也会派发事件**，且 `value` 是 `{ dataIndex: -1, dataItem: undefined }`（真值）
 *   ⇒ 命中判定只能用 `dataIndex !== -1`；`if (event.value)` 会把未命中当成命中；
 * - 读不到 `dataItem` / `properties` 时**如实返回 null**，由调用方按「身份未知」处理；
 *   不猜一个业务项出来（issue 的验收补充：「未知 identity 不靠 FIFO/计数/时序恢复」）。
 *
 * 坐标 / 像素优先取 Driver 归一化后的字段（`point` / `pixel`），退化到 raw 事件上的
 * `latLng` / `pixel`——回调拿到的是 `DriverEvent`，它公开契约里 `raw` 就是「访问未归一化字段」
 * 的入口，而 `value` 属于 facet 独有的字段。
 *
 * 本文件**框架无关**（不 import vue、不 import Driver 实现），可以在单测里直接喂事件对象。
 */

import { normalizeIdField } from "../data/identity";

export interface NativeLayerPickPoint {
  readonly lng: number;
  readonly lat: number;
}

export interface NativeLayerPickPixel {
  readonly x: number;
  readonly y: number;
}

/** 一次拾取的结构化读数（身份还没解析，见 `readFeatureId`）。 */
export interface NativeLayerPickSnapshot {
  /** 是否命中要素（官方：未命中时 `dataIndex === -1`）。 */
  readonly hit: boolean;
  /** 命中的要素在**本次 `setData`** 里的下标；未命中为 `-1`。 */
  readonly dataIndex: number;
  /** 官方 `value.dataItem`（通常是一条要素）；读不到为 `null`。 */
  readonly dataItem: unknown;
  readonly latLng: NativeLayerPickPoint | null;
  readonly pixel: NativeLayerPickPixel | null;
}

/**
 * 读官方拾取事件。
 *
 * ⚠️ 入参是 **Driver 归一化后的 `DriverEvent`**：`point` / `pixel` 是归一化字段，`raw` 是原事件。
 */
export function readNativeLayerPick(event: unknown): NativeLayerPickSnapshot {
  const normalized = (event ?? {}) as { raw?: unknown; point?: unknown; pixel?: unknown };
  const raw = (normalized.raw ?? event) as { value?: unknown; latLng?: unknown; pixel?: unknown };
  const value = raw?.value as { dataIndex?: unknown; dataItem?: unknown } | null | undefined;
  const dataIndex = typeof value?.dataIndex === "number" ? value.dataIndex : -1;
  return {
    hit: dataIndex !== -1,
    dataIndex,
    dataItem: value?.dataItem ?? null,
    latLng: readPoint(normalized.point) ?? readPoint(raw?.latLng),
    pixel: readPixel(normalized.pixel) ?? readPixel(raw?.pixel),
  };
}

/**
 * 从命中的要素里取出 `properties`。
 *
 * 只认 `dataItem.properties`：官方示例就是这么取业务键的，而「dataItem 本身就是属性袋」这种
 * 形状没有任何依据——猜它会把一个身份读错的要素当成命中。
 */
export function readFeatureProperties(dataItem: unknown): Record<string, unknown> | null {
  if (dataItem === null || typeof dataItem !== "object") return null;
  const properties = (dataItem as { properties?: unknown }).properties;
  return properties !== null && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : null;
}

/**
 * 业务身份（`properties[idKey]` 的值）。
 *
 * 判据与 `core/data/featureState.ts` 的 id 判定一致（有限数字 / 字符串）——写入与读取必须是
 * 同一个口径，否则「写进去的状态查不回来」会表现为 SDK 的问题。官方 `updateState(keys: string |
 * number | …)` 的取值域也只有这两种，因此 **symbol 型身份不支持**（数据组件的 `itemKey` 允许
 * symbol，但那种 key 走到这里会如实返回 `null` 而不是被猜出来；见 ADR 的已知限制）。
 *
 * `idKey` 没表态时**返回 null**（= 身份未知），而不是猜一个 `"id"`：官方 `idKey` 是可选项，
 * 它的默认值没有公开说明，猜错会让拾取稳定地认到错误的要素上。
 */
export function readFeatureId(
  properties: Record<string, unknown> | null,
  idKey: string | undefined,
): string | number | null {
  // 判定走 `normalizeIdField`（唯一判定点）：`""` / `undefined` 一律算「未声明身份」，
  // 与要素状态命令面的前置条件用**同一个**判据（否则同一张图层上会出现两套身份语义）。
  const field = normalizeIdField(idKey);
  if (!properties || !field) return null;
  const candidate = properties[field];
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "number") return Number.isFinite(candidate) ? candidate : null;
  return null;
}

/**
 * 「本次 `setData` 送出的那份数据」里第 `index` 条要素的 `properties`。
 *
 * 用途只有一个：`dataItem` 读不出身份时的**兜底**——下标指向的正是我们自己送出去的数据，
 * 因此它仍然是**公开身份**（我们自己的输入），不是从内部对象 / 事件顺序里恢复出来的猜测。
 *
 * 数据形状是调用方给的（官方 `setData(geojson: object)`），因此这里只做最小结构读取：
 * `features[index].properties` 读不到就返回 `null`。
 */
export function readFeaturePropertiesAt(
  data: object | null | undefined,
  index: number,
): Record<string, unknown> | null {
  if (!data || index < 0) return null;
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) return null;
  return readFeatureProperties(features[index]);
}

function readPoint(value: unknown): NativeLayerPickPoint | null {
  if (value === null || typeof value !== "object") return null;
  const { lng, lat } = value as { lng?: unknown; lat?: unknown };
  return typeof lng === "number" && typeof lat === "number" ? { lng, lat } : null;
}

function readPixel(value: unknown): NativeLayerPickPixel | null {
  if (value === null || typeof value !== "object") return null;
  const { x, y } = value as { x?: unknown; y?: unknown };
  return typeof x === "number" && typeof y === "number" ? { x, y } : null;
}

/* ------------------------------------------------------------------ 领域载荷 */

/**
 * 领域拾取载荷（与 `types/components.ts` 的 `BMapPointPick` / `BMapFeaturePick` 同形）。
 *
 * 这里刻意**不** import 公共类型文件：`core` 是 `types` 的下游，反向依赖会让公共类型的变化
 * 牵动内核（而内核的用例只需要这个形状本身）。
 */
export interface NativeLayerFeaturePickPayload<Item> {
  readonly hit: boolean;
  readonly dataIndex: number;
  readonly id: string | number | null;
  readonly item: Item | null;
  readonly latLng: NativeLayerPickPoint | null;
  readonly pixel: NativeLayerPickPixel | null;
}

export interface ResolveFeaturePickInput<Item> {
  /** Driver 归一化后的事件对象（见 `readNativeLayerPick`）。 */
  readonly event: unknown;
  /** 业务身份字段名（构造期 `idKey`）；没表态时身份**如实为 null**。 */
  readonly idKey: string | undefined;
  /**
   * 「最近一次成功送出的数据」的取值器（`dataIndex` 兜底要用它与 SDK 侧保持同一份）。
   * 不给就不做兜底。
   */
  readonly sentData?: () => object | null;
  /**
   * 身份 → 业务项。缺省时把 `properties` 本身当业务项（线 / 面图层的语义：数据就是 GeoJSON）。
   *
   * 判「找没找到」的返回值用 `undefined` 表示；实现**不要**用真值判断——`0` / `false` / `""`
   * 都是合法业务项（`BPointCollection` 的评审 #102 F4 就是这条）。
   */
  readonly itemOf?: (id: string | number | null, properties: Record<string, unknown>) => Item | undefined;
}

/**
 * 事件 → 领域拾取载荷（线 / 面 / 点批量图层共用的那一段）。
 *
 * 身份来源**只有两处，都是公开的**：
 *
 * 1. 官方回包 `value.dataItem.properties[idKey]`（官方示例的取法）；
 * 2. 兜底：`dataIndex` 指向**我们自己送出去的那份数据**的对应要素——它仍然是我们自己的输入，
 *    不是从内部对象 / 事件顺序里恢复出来的猜测。
 *
 * 三个字段各自表达一件事，**不要把它们混起来看**：
 *
 * - `hit`：官方是否命中（`dataIndex !== -1`）；
 * - `item`：命中的那条要素的**业务项**（默认就是它的 `properties`）——它不依赖 `idKey`，因为
 *   「属性袋」是官方回包直接给出的；未命中时为 `null`；
 * - `id`：**业务身份**（`properties[idKey]`）。`idKey` 没表态、或那个字段不是有限数字 / 字符串时
 *   如实为 `null` —— 本库不猜官方的默认 `idKey`，也不会拿别的字段凑一个身份出来。
 *
 * `itemOf` 是给「业务对象与要素分离」的组件用的（`BPointCollection` 的 `Item[]`）：它一旦提供就是
 * **权威**的，返回 `undefined` 表示「按这个身份找不到业务项」，此时 `item` 为 `null`——而不是退回
 * 「拿 properties 当业务项」（那会把「找不到」变成「找到了一个形状不对的东西」）。
 */
export function resolveFeaturePick<Item = Record<string, unknown>>(
  input: ResolveFeaturePickInput<Item>,
): NativeLayerFeaturePickPayload<Item> {
  const snapshot = readNativeLayerPick(input.event);
  const properties =
    readFeatureProperties(snapshot.dataItem) ??
    readFeaturePropertiesAt(input.sentData?.() ?? null, snapshot.dataIndex);
  const id = readFeatureId(properties, input.idKey);
  const item =
    snapshot.hit && properties
      ? input.itemOf
        ? input.itemOf(id, properties)
        : (properties as unknown as Item)
      : undefined;
  return {
    hit: snapshot.hit,
    dataIndex: snapshot.dataIndex,
    id,
    item: item === undefined ? null : item,
    latLng: snapshot.latLng,
    pixel: snapshot.pixel,
  };
}
