/**
 * 通用 data diff
 *
 * 用 key 对海量数据做过增删改 diff:
 * - 使用 Map<PropertyKey, Record> 建索引
 * - 默认以根数组引用 + item key 比较
 * - 不默认深比较完整 item
 *
 * ⚠️ 旧的 `shouldFullReplace()` 已删除（M6-MARKER-POINTCOLLECTION / #34）：它把「根引用相同、
 * 长度变化」判成「整批替换」，而长度变化本来就由 diff 正确处理；真正的 `dataVersion` 语义
 * （引用不变、内容变了 ⇒ 重新读一遍）在 `DataLayerManager` 里实现。该函数只有一个测试消费者，
 * 没有任何生产调用点——留着只会让下一个人以为「整批替换」是既定语义。
 */
export interface DataDiff<Item> {
  added: Item[];
  updated: Item[];
  removed: Item[];
  unchanged: number;
}

export type ItemKeyFn<Item> = (item: Item) => PropertyKey;

/** 从数组或 key 函数构造 key 提取器 */
export function getItemKey<Item>(itemKey: PropertyKey | ItemKeyFn<Item>): ItemKeyFn<Item> {
  if (typeof itemKey === "function") return itemKey as ItemKeyFn<Item>;
  return (item) => (item as any)[itemKey];
}

/**
 * 计算 prev → next 的增删改。
 *
 * @param prevPrevious 旧数组
 * @param next 新数组
 * @param itemKey 提取 item 的唯一 key
 * @param compareItem 可选:判断是否视为"更新"(默认按 === 根引用比较)
 */
export function diffData<Item>(
  previous: readonly Item[] | null,
  next: readonly Item[],
  itemKey: PropertyKey | ItemKeyFn<Item>,
  compareItem: (a: Item, b: Item) => boolean = (a, b) => a === b,
): DataDiff<Item> {
  const keyFn = getItemKey(itemKey);
  const added: Item[] = [];
  const updated: Item[] = [];
  const removed: Item[] = [];

  const prevMap = new Map<PropertyKey, Item>();
  for (const item of previous ?? []) {
    const key = keyFn(item);
    if (prevMap.has(key)) continue;
    prevMap.set(key, item);
  }

  const nextKeys = new Set<PropertyKey>();
  for (const item of next) {
    const key = keyFn(item);
    if (nextKeys.has(key)) continue;
    nextKeys.add(key);
    const prev = prevMap.get(key);
    if (prev === undefined) {
      added.push(item);
    } else if (!compareItem(prev, item)) {
      updated.push(item);
    }
  }

  for (const [key, item] of prevMap) {
    if (!nextKeys.has(key)) removed.push(item);
  }

  const unchanged = next.length - added.length - updated.length;
  return { added, updated, removed, unchanged };
}
