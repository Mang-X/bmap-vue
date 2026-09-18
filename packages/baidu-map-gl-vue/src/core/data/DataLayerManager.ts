/**
 * 批量资源管理器（M6-MARKER-POINTCOLLECTION / issue #34，重写自旧的 `DataLayerManager`）
 *
 * 一个组件管理一批 SDK 资源（当前是逐项 Marker），做 keyed diff 与 RAF 合帧，
 * 并为「事件回传**最新**业务 item」维护 `key → item` 账本。
 *
 * ## 与旧实现的差别（旧语义的三处「声明了但没人读」）
 *
 * | 旧实现 | 问题 | 现语义 |
 * | --- | --- | --- |
 * | `sync(items, getKey, itemVersion, force)` | `itemVersion` 与 `force` 进了签名却**从未被读**（组件永远传 `false`），`dataVersion` 是死参数 | `version` 真实生效：同一引用 + 同一版本 ⇒ **零 SDK 调用**；版本变化 ⇒ 重新读坐标并逐项下发 |
 * | `itemKeys: Map<key, Item>` | 写了但从不读，事件回调闭包捕获的是**创建时**的旧对象 | `latest(key)` / `latestOf(resource)` 成为公开读数，事件路径据此回传最新业务项 |
 * | 坏数据（缺 key / 非法坐标）直接进 SDK | 造出「画不出来」或身份错乱的资源，且没有任何提示 | 由 `./itemScan.ts` 统一跳过并报告（同一份规则也服务 GeoJSON 适配） |
 *
 * ## 三条时序约定
 *
 * - **合帧**：`sync()` 只登记「最近一次输入」，同一帧内多次调用只执行最后一次（`flush()` 立刻执行）；
 * - **短路**：`apply()` 以「入参引用 + 版本」为判据，完全相同的输入不产生任何 SDK 调用
 *   （这是「大数组重复渲染不付出代价」的落点）；
 * - **版本变化 ⇒ 重新下发坐标**：`dataVersion` 的语义就是「引用没变、内容变了」，
 *   因此此时不依赖 item 引用比较，逐项把坐标写一遍。
 */
import { createFrameScheduler, type FrameScheduler } from "../scheduler/FrameScheduler";
import { createItemIndex, type ItemIndex } from "./itemIndex";
import { scanValidItems, type ItemProblem } from "./itemScan";
import type { PointLike } from "./points";

/**
 * 一次同步的输入。
 *
 * 收成一个对象（而不是位置参数）是这次重写的一部分：旧签名有 4 个位置参数、其中两个从未生效，
 * 调用点只能靠数参数位置来读；对象入参让「这一项到底有没有表态」在代码里可见。
 */
export interface DataLayerSync<Item> {
  readonly items: readonly Item[];
  readonly getKey: (item: Item) => PropertyKey;
  readonly getPosition: (item: Item) => PointLike | null | undefined;
  /** 数据版本：`items` 根引用不变、内容却变了时递增它。 */
  readonly version?: PropertyKey;
}

/**
 * 宿主：把「一批业务项」落到具体 SDK 资源上。
 *
 * `createMarker` / `updatePosition` 都**接收已校验的坐标**：位置只从 `getPosition` 读一次
 * （校验与应用共用同一份取值），避免「校验用的坐标」与「实际下发的坐标」来自两次调用。
 */
export interface DataLayerHost<Item, Resource> {
  createMarker(item: Item, point: PointLike): Resource;
  removeMarker(resource: Resource): void;
  updatePosition(resource: Resource, point: PointLike, item: Item): void;
  /**
   * 资源级显隐（宿主通常映射到 `driver.overlays.show/hide`）。
   *
   * 返回「真的应用了没有」：SDK 没有该能力时返回 `false`，由管理器告警一次而不是假装成功。
   */
  setVisible?(resource: Resource, visible: boolean): boolean;
}

export interface DataLayerManagerOptions {
  /** 诊断文案里的组件名。 */
  readonly label?: string;
  /** 数据问题出口（组件转成开发期告警）。 */
  readonly onProblem?: (problem: ItemProblem) => void;
  /** 告警出口；缺省是 `logger.warn` 之外的空实现（由调用方决定怎么报）。 */
  readonly warn?: (message: string) => void;
}

const SYNC_KEY = "data-layer:sync";

export class DataLayerManager<Item, Resource> {
  private readonly scheduler: FrameScheduler = createFrameScheduler();
  private readonly resources = new Map<PropertyKey, Resource>();
  /** 资源 → key（事件委托要由实例反查业务项；`WeakMap` 不延长资源寿命）。 */
  private readonly keyOfResource = new WeakMap<object, PropertyKey>();
  private readonly index: ItemIndex<Item> = createItemIndex<Item>();
  private readonly label: string;
  private visible = true;
  private warnedVisibilityUnsupported = false;

  /** 上一次**已应用**的输入（短路判据；`clear()` 会复位）。 */
  private lastItems: readonly Item[] | null = null;
  private lastVersion: PropertyKey | undefined = undefined;
  private everSynced = false;

  constructor(
    private readonly host: DataLayerHost<Item, Resource>,
    private readonly options: DataLayerManagerOptions = {},
  ) {
    this.label = options.label ?? "DataLayerManager";
  }

  /**
   * 同步一批数据（RAF 合帧：同一帧内多次调用只执行最后一次）。
   *
   * 刻意**不**在这里做短路：合帧已经保证「同一帧内只有最后一次输入被执行」，而在 flush 时
   * 比较「与上次**已应用**的输入是否相同」才是真正的判据（sync 时比较会把两次相同输入之间的
   * 变化漏掉）。
   */
  sync(input: DataLayerSync<Item>): void {
    this.scheduler.schedule(SYNC_KEY, () => this.apply(input));
  }

  /** 立即执行已排队的同步（测试与需要同步语义的调用方用）。 */
  flush(): void {
    this.scheduler.flush();
  }

  /** 全员显隐；之后新建的资源也按当前状态落。 */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    for (const resource of this.resources.values()) this.applyVisibility(resource);
  }
  /** 该 key 当前对应的**最新**业务项（数据里已删除时为 `undefined`）。 */
  latest(key: PropertyKey): Item | undefined {
    return this.index.latest(key);
  }

  /**
   * 由 SDK 资源反查它当前对应的业务项（事件委托用）。
   *
   * 事件回调发生在**回调注册之后**的任意时刻，因此这里必须读账本而不是闭包里的旧对象。
   */
  latestOf(resource: Resource): Item | undefined {
    if (typeof resource !== "object" || resource === null) return undefined;
    // `Resource` 是泛型，TS 不会因为上面那次运行时检查就收窄它，这里显式转成 WeakMap 的键类型。
    const key = this.keyOfResource.get(resource as unknown as object);
    return key === undefined ? undefined : this.index.latest(key);
  }

  get size(): number {
    return this.resources.size;
  }

  /**
   * 摘掉全部资源，并把短路基线一并复位（下一次 `sync` 会重建）。
   *
   * **逐条隔离**：任何一个 `removeMarker` 抛错都不许中断整轮摘除——否则剩下的资源连同它们的
   * 事件绑定会永久留着，`scheduler` 也不会被释放（`LayerRegistry` / `OverlayRegistry` /
   * `useSdkResource` 三处同类循环都是这个口径）。失败经 `warn` 出口交出，不静默。
   */
  clear(): void {
    for (const [key, resource] of [...this.resources]) {
      try {
        this.host.removeMarker(resource);
      } catch (error) {
        this.options.warn?.(
          `${this.label}: 摘除资源失败（key=${String(key)}），SDK 侧可能仍有残留：` +
            `${(error as Error)?.message ?? String(error)}`,
        );
      }
      this.resources.delete(key);
      if (typeof resource === "object" && resource !== null) {
        this.keyOfResource.delete(resource as unknown as object);
      }
    }
    this.index.clear();
    this.lastItems = null;
    this.lastVersion = undefined;
    this.everSynced = false;
  }

  dispose(): void {
    try {
      this.clear();
    } finally {
      // `finally`：`clear()` 已经不会抛（逐条隔离），但这条 `finally` 保证「即使将来有人在
      // clear 里加了会抛的步骤」，帧调度器也一定被释放（它是 RAF / 定时器持有者）。
      this.scheduler.dispose();
    }
  }

  private apply(input: DataLayerSync<Item>): void {
    const { items, getKey, getPosition, version } = input;
    // 短路：入参引用与版本都没变 ⇒ 一个字都不下发。这是「大数组每次渲染都重传」的代价控制点。
    if (this.everSynced && items === this.lastItems && version === this.lastVersion) return;

    const scanned = scanValidItems(items, { getKey, getPosition, onProblem: this.options.onProblem });
    const versionChanged = this.everSynced && version !== this.lastVersion;
    const nextKeys = new Set(scanned.map((entry) => entry.key));

    // 1. 删除：账本里存在、本次数据里没有的 key
    for (const [key, resource] of [...this.resources]) {
      if (nextKeys.has(key)) continue;
      // 逐条隔离（与 `clear()` 同口径）：一次摘除失败不该让后面的项也不再摘除。
      // 失败时**保留**账本条目 —— 那条资源可能仍在图上，所有权留给下一次摘除（或永久销毁）：
      // 删掉记账会让它彻底没人认领，那比「重复摘一次」糟得多。
      try {
        this.host.removeMarker(resource);
      } catch (error) {
        this.options.warn?.(
          `${this.label}: 摘除资源失败（key=${String(key)}），它可能仍在图上：` +
            `${(error as Error)?.message ?? String(error)}`,
        );
        continue;
      }
      this.resources.delete(key);
      if (typeof resource === "object" && resource !== null) {
        this.keyOfResource.delete(resource as unknown as object);
      }
    }

    // 2. 新增 / 位置更新
    for (const entry of scanned) {
      const existing = this.resources.get(entry.key);
      if (!existing) {
        let resource: Resource;
        try {
          resource = this.host.createMarker(entry.item, entry.point);
        } catch (error) {
          // 记账**不写**：这一项下次同步会重试（写进去就再也不会补建了）。
          this.options.warn?.(
            `${this.label}: 创建资源失败（key=${String(entry.key)}），本项会等下次同步重试：` +
              `${(error as Error)?.message ?? String(error)}`,
          );
          continue;
        }
        this.resources.set(entry.key, resource);
        if (typeof resource === "object" && resource !== null) {
          this.keyOfResource.set(resource as object, entry.key);
        }
        // 新建的资源也要服从当前的显隐状态（否则 `visible=false` 期间新来的点会「亮」着出现在图上）。
        // 只在隐藏态时下发一次：新建的资源本来就是可见的，再 show 一次是无谓的 SDK 调用。
        if (!this.visible) this.applyVisibility(resource, entry.key);
        continue;
      }
      // 版本变化 ⇒ 视为「内容变了」（这正是 dataVersion 的语义：引用不变、内容不同），
      // 不依赖 item 引用比较；否则只在业务对象换了引用时下发位置。
      const previous = this.index.latest(entry.key);
      if (versionChanged || previous !== entry.item) {
        try {
          this.host.updatePosition(existing, entry.point, entry.item);
        } catch (error) {
          // 位置没更新成功 ⇒ 下一次同步会再试（`previous !== entry.item` 仍成立）。
          this.options.warn?.(
            `${this.label}: 更新位置失败（key=${String(entry.key)}）：${(error as Error)?.message ?? String(error)}`,
          );
        }
      }
    }

    this.index.replace(scanned.map((entry) => ({ key: entry.key, item: entry.item })));
    this.lastItems = items;
    this.lastVersion = version;
    this.everSynced = true;
  }

  /** 把**当前**显隐状态下发给一个资源（调用方负责只在需要时调，见两处调用点）。 */
  private applyVisibility(resource: Resource, key?: PropertyKey): void {
    const applied = this.host.setVisible?.(resource, this.visible) ?? false;
    if (applied || this.warnedVisibilityUnsupported) return;
    this.warnedVisibilityUnsupported = true;
    this.options.warn?.(
      `${this.label}: 资源不支持显隐（宿主没有实现 setVisible 或 SDK 无 show/hide）` +
        `${key === undefined ? "" : `，key=${String(key)}`}：本次 visible=${String(this.visible)} 被忽略`,
    );
  }
}
