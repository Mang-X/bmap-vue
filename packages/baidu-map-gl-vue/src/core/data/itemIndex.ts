/**
 * key → 最新业务 item 的账本（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 数据组件的验收之一是「点击返回**最新**业务 item」：SDK 的事件回调里只有 marker / 要素，
 * 没有业务对象；而业务对象在每次 `data` 更新时都可能被换成新引用（Vue 里这是常态：
 * 父级 `data.value = list.map(...)`）。两种常见错法：
 *
 * - 在**创建时**把 item 闭包进事件回调 ⇒ 回调拿到的是创建那一刻的旧对象（改动不可见）；
 * - 只留 `key → Resource`，事件里再去 `data` 数组里 `find` ⇒ 每次点击 O(n) 且要拿到「当前」数组引用。
 *
 * 因此这里维护 `key → 最近一次同步进来的 item`，两处消费者共用同一份实现：
 * `DataLayerManager`（逐项 Marker 路径）与 `BPointCollection`（批量图层拾取路径）。
 *
 * 三条语义：
 *
 * 1. `replace()` 是**整体替换**（数据是快照，不是增量）：`data` 里删掉的 key 不会再被查到，
 *    这是「点击一个刚被删掉的要素」返回 `undefined` 而不是返回幽灵对象的依据；
 * 2. 同一个 key 出现多次时**后者覆盖前者**（与 `Map.set` 同义）——去重本身由 `./itemScan.ts`
 *    负责（它在扫描阶段就会报重复并只放行最后一项），本模块只接收已经去重的条目；
 * 3. 有效 key 的判定同样在 `itemScan` 的 `isUsableItemKey()` 里（单一事实源），
 *    本模块不再自己判一遍。
 */
export interface IndexedItem<Item> {
  readonly key: PropertyKey;
  readonly item: Item;
}

export interface ItemIndex<Item> {
  /** 用一批**已去重**的条目整体替换账本。 */
  replace(entries: readonly IndexedItem<Item>[]): void;
  /** 该 key 当前对应的业务项；不存在时为 `undefined`。 */
  latest(key: PropertyKey): Item | undefined;
  /** 清空账本。 */
  clear(): void;
}

export function createItemIndex<Item>(): ItemIndex<Item> {
  let items = new Map<PropertyKey, Item>();
  return {
    replace(entries) {
      const next = new Map<PropertyKey, Item>();
      for (const entry of entries) next.set(entry.key, entry.item);
      items = next;
    },
    latest(key) {
      return items.get(key);
    },
    clear() {
      items = new Map();
    },
  };
}
