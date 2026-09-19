/**
 * 批量点层管理器
 *
 * 用单个 SDK 对象承载一批点(通过 addEventListener 委托),避免为每个点
 * 创建独立 Vue 组件和多套 SDK listener。
 *
 * 设计:
 * - `sync(points, options)` 用 data diff 计算增删改,批量更新
 * - 事件委托:只注册一个 listener,用 item key 回传 `item-click`
 * - RAF 合并:高频 sync 每帧只执行一次
 */
import { createFrameScheduler, type FrameScheduler } from "../scheduler/FrameScheduler";
import { diffData, type DataDiff } from "../data/diffData";

export interface DataLayerHost<Resource> {
  createMarker(item: unknown): Resource;
  removeMarker(resource: Resource): void;
  updatePosition(resource: Resource, item: unknown): void;
  onItemEvent?(type: string, event: unknown): void;
}

export class DataLayerManager<Item, Resource> {
  private scheduler: FrameScheduler = createFrameScheduler();
  private resources = new Map<PropertyKey, Resource>();
  private itemKeys = new Map<PropertyKey, Item>();
  private lastItems: readonly Item[] = [];

  constructor(private readonly host: DataLayerHost<Resource>) {}

  /**
   * 同步一批点:diff + 批量增删改(RAF 合并)
   *
   * `itemVersion` 当前**不参与判定**：内容变了要重算是靠调用方 `watch([data, dataVersion])` 再
   * `sync()` 一次，diff 只看 key。形参留着只为 `./core` 的既有位置签名（#104 审计第 5 节，删它归 #44）。
   */
  sync(
    items: readonly Item[],
    getKey: (item: Item) => PropertyKey,
    itemVersion?: PropertyKey,
    force = false,
  ) {
    this.scheduler.schedule("data-layer:sync", () => {
      this.apply(items, getKey, itemVersion, force);
    });
  }

  /** 立即刷新已排队的任务(测试/需要同步时用) */
  flush() {
    this.scheduler.flush();
  }

  private apply(
    items: readonly Item[],
    getKey: (item: Item) => PropertyKey,
    itemVersion?: PropertyKey,
    force = false,
  ) {
    if (force) {
      // 全量替换
      this.clear();
      for (const item of items) {
        const key = getKey(item);
        const res = this.host.createMarker(item);
        this.resources.set(key, res);
        this.itemKeys.set(key, item);
      }
      this.lastItems = items;
      return;
    }

    const diff = diffData(this.lastItems, items, getKey);
    this.applyDiff(diff, getKey);
    this.lastItems = items;
  }

  private applyDiff(diff: DataDiff<Item>, getKey: (item: Item) => PropertyKey) {
    for (const item of diff.removed) {
      const key = getKey(item);
      const res = this.resources.get(key);
      if (res) {
        this.host.removeMarker(res);
        this.resources.delete(key);
        this.itemKeys.delete(key);
      }
    }
    for (const item of diff.added) {
      const key = getKey(item);
      const res = this.host.createMarker(item);
      this.resources.set(key, res);
      this.itemKeys.set(key, item);
    }
    for (const item of diff.updated) {
      const key = getKey(item);
      const res = this.resources.get(key);
      if (res) this.host.updatePosition(res, item);
      this.itemKeys.set(key, item);
    }
  }

  get size() {
    return this.resources.size;
  }

  clear() {
    for (const res of this.resources.values()) this.host.removeMarker(res);
    this.resources.clear();
    this.itemKeys.clear();
    this.lastItems = [];
  }

  dispose() {
    this.clear();
    this.scheduler.dispose();
  }
}
