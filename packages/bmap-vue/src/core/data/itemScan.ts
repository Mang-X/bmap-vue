/**
 * 一批业务数据的**可用项**扫描（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 「哪些项能变成资源、哪些必须跳过」的判定只有这一份实现：三条数据路径（逐项 Marker 的
 * `DataLayerManager`、批量图层的 `geojsonAdapter`、以及聚合组件的输入）都从这里出。
 * 两份同源实现会分叉在「什么算坏数据」这类细节上，而分叉的表现是**同一份数据在两种组件里
 * 得到不同的结果**——那是最难向使用者解释的一类缺陷。
 *
 * ## 三条规则
 *
 * | 规则 | 处置 | 依据 |
 * | --- | --- | --- |
 * | `getKey` 取不到可用 key（`undefined` / `null` / `NaN`） | 跳过 + 报 | `NaN !== NaN`，登记进去会让每次 diff 都判成新增（同 key 反复建资源）；没有身份就没法做 keyed diff |
 * | `getPosition` 不是合法坐标 | 跳过 + 报 | 见 `./points.ts` 的三条判定 |
 * | 同一批数据里 key 重复 | **后者胜**，报一条 | SDK 对重复 id 的行为没有任何声明（`PointShapeLayer.d.ts` 里没有相关文字），因此不能把重复项交给它；`Map.set` 语义也是「后者胜」 |
 *
 * 「跳过」而不是「抛错」：数据驱动组件面对的是外部数据源，一条坏数据不该让整层消失。
 * 但**不静默**——每个被跳过的项都产生一条 `ItemProblem`，调用方负责转成开发期告警（点名原因与下标）。
 *
 * 顺序按**首次出现**的 key 固定（重复 key 覆盖值时不再挪到末尾）：要素顺序会决定 SDK 侧的
 * `dataIndex`，稳定顺序让 `hitTest` 与状态 API 的下标可预期。
 */
import { readValidPoint, type PointLike } from "./points";

/**
 * key 是否可用作**身份**。
 *
 * 空字符串是合法 `PropertyKey`，照收（不去发明「空白算缺失」的规则）；`NaN` 例外，理由见文件头。
 */
export function isUsableItemKey(key: unknown): key is PropertyKey {
  if (typeof key === "number") return Number.isFinite(key);
  return typeof key === "string" || typeof key === "symbol";
}

export type ItemProblemKind = "missing-key" | "duplicate-key" | "invalid-position";

export interface ItemProblem {
  readonly kind: ItemProblemKind;
  /** 出事的那一项在**入参数组**里的下标（诊断要能直接定位到数据行）。 */
  readonly index: number;
  /** 能取到 key 时带上（`missing-key` 没有）。 */
  readonly key?: PropertyKey;
  /** 人读细节。 */
  readonly detail: string;
}

/** 通过扫描的项：业务对象 + 它的 key + 已校验的坐标。 */
export interface ScannedItem<Item> {
  readonly item: Item;
  readonly key: PropertyKey;
  readonly point: PointLike;
  /** 在**入参数组**里的下标（诊断与「最新项」定位用）。 */
  readonly index: number;
}

/**
 * `itemKey` 的统一取值函数：`keyof Item`（属性名）与取值函数两种形态收敛成一种。
 *
 * 三个数据组件与 GeoJSON 适配层都用它：各写一份会让「同一个 itemKey 在不同组件里行为不同」
 * 这类分叉无法被类型层发现。
 */
export function itemKeyReader<Item>(
  itemKey: keyof Item | ((item: Item) => PropertyKey),
): (item: Item) => PropertyKey {
  if (typeof itemKey === "function") return itemKey as (item: Item) => PropertyKey;
  return (item) => (item as Record<PropertyKey, unknown>)[itemKey as PropertyKey] as PropertyKey;
}

export interface ItemScanOptions<Item> {
  readonly getKey: (item: Item) => PropertyKey;
  readonly getPosition: (item: Item) => PointLike | null | undefined;
  readonly onProblem?: (problem: ItemProblem) => void;
}

/**
 * 扫描出一批数据的可用项（key + 坐标都合法），并报告被跳过 / 被覆盖的项。
 *
 * 重复 key 时**后一项替换前一项，但保留前一项的位置**（顺序稳定）；返回值里出现的 key 保证唯一。
 */
export function scanValidItems<Item>(
  items: readonly Item[],
  options: ItemScanOptions<Item>,
): ScannedItem<Item>[] {
  const { getKey, getPosition, onProblem } = options;
  const byKey = new Map<PropertyKey, ScannedItem<Item>>();
  const report = (problem: ItemProblem): void => onProblem?.(problem);

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as Item;
    const key = getKey(item);
    if (!isUsableItemKey(key)) {
      report({
        kind: "missing-key",
        index,
        detail: `itemKey 取不到可用的 key（实际 ${describe(key)}）：这一项被跳过，不会创建任何资源`,
      });
      continue;
    }

    const position = readValidPoint(getPosition(item));
    if (!position.ok) {
      report({
        kind: "invalid-position",
        index,
        key,
        detail: `getPosition 返回的不是合法坐标（${position.reason}）：${position.detail}。这一项被跳过`,
      });
      continue;
    }

    if (byKey.has(key)) {
      report({
        kind: "duplicate-key",
        index,
        key,
        detail: `key ${String(key)} 重复：保留后一项（重复 id 的行为官方没有声明，不能交给 SDK；顺序仍按首次出现的位置）`,
      });
    }
    byKey.set(key, { item, key, point: position.point, index });
  }

  return [...byKey.values()];
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return typeof value;
}
