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

/**
 * 位置指纹（「SDK 侧当前坐标是什么」的判定依据）。
 *
 * 用它而不是 `item` 引用：引用比较会漏掉「换根引用 + 复用同一个 item 对象 + 原地改坐标」，
 * 也会在「换根引用但坐标没变」时产生多余的下发（评审 #102 F1 的两个方向）。
 */
function positionFingerprint(point: PointLike): string {
  return `${point.lng},${point.lat}`;
}

export class DataLayerManager<Item, Resource> {
  private readonly scheduler: FrameScheduler = createFrameScheduler();
  private readonly resources = new Map<PropertyKey, Resource>();
  /** 资源 → key（事件委托要由实例反查业务项；`WeakMap` 不延长资源寿命）。 */
  private readonly keyOfResource = new WeakMap<object, PropertyKey>();
  /**
   * 「**SDK 侧当前是什么坐标**」的按 key 记账（评审 #102 F1/F2）。
   *
   * 位置下发由**值**决定，不由 `item` 引用决定：引用比较是一个未公开的短路条件——`data` 换了
   * 根引用、但复用了同一个 item 对象（`item.lng = 2; data.value = [item]`）时，公开契约说
   * 「根引用变化就该重新读取」，而引用比较会把这次变化吞掉（Marker 停在旧坐标）。
   *
   * 与其它记账同一条规则：**只在 SDK 调用成功返回之后**才提交；失败时保持旧值，下一次同步
   * （或下一次 `version` 变化）会重试。
   */
  private readonly appliedPositions = new Map<PropertyKey, string>();
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

  /**
   * 全员显隐；之后新建的资源也按当前状态落。
   *
   * **逐条隔离 + 全部成功才提交**：`applyVisibility` 会抛（SDK 的 `show/hide` 走 `sdkCall`），
   * 因此这里先把目标值记在局部、逐个尽力对齐，任一条失败就不推进内部 `this.visible`
   * 并把错误交给调用方。这样下一次显隐请求**不会**被顶部短路吞掉（`this.visible === visible`
   * 直接 return），会把**所有**资源重新对齐一遍 —— 否则「一个 Marker hide 失败」会永久留下
   * 「部分可见、部分不可见」而调用方以为已经生效。
   */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    let failure: unknown = null;
    for (const [key, resource] of [...this.resources]) {
      try {
        this.applyVisibility(resource, visible, key);
      } catch (error) {
        // 逐条隔离：一条失败不该让后面的资源也不再对齐（与 `clear()` / diff 删除同口径）
        if (failure === null) failure = error;
      }
    }
    if (failure !== null) throw failure;
    this.visible = visible;
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

  /**
   * 当前**仍归本管理器所有**的资源数（含「摘除失败、按所有权保留下来」的那些）。
   *
   * 它是「摘干净了没有」唯一的机器读数：`clear()` 是逐条隔离的、不抛错，所以需要**确认**摘净的
   * 调用方（替换 / 换引擎路径）只能靠这个计数判断，而不是「`clear()` 没抛 ⇒ 一定摘干净了」。
   * 配合 `clear()` 的「失败保留所有权」语义：计数归零 ⟺ 全部确认摘除。
   */
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
          `${this.label}: 摘除资源失败（key=${String(key)}），它可能仍在图上：` +
            `${(error as Error)?.message ?? String(error)}`,
        );
        // **保留所有权**（与 diff 删除路径同一条原则，评审 #102 F3）：SDK 可能是「还没产生副作用
        // 就抛错」，此时旧资源仍在图上；删掉记账会让之后为同一个 key 再建一份，图上出现两份/泄漏。
        continue;
      }
      this.resources.delete(key);
      this.appliedPositions.delete(key);
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
    /**
     * `version` 变化的语义是「内容变了，请重新下发」——**逐项写一遍**。
     *
     * 它是公开的逃生口（公开类型注释：根引用不变、内容却变了时递增它），也用于「宿主侧自行改过
     * 位置、需要重新对齐」这种场景：那时位置指纹相同、只有版本变化能触发写入。
     */
    const versionChanged = this.everSynced && version !== this.lastVersion;
    const nextKeys = new Set(scanned.map((entry) => entry.key));
    /** 本次有没有 SDK 调用失败（有 ⇒ 不推进短路基线，同一批输入能重试，评审 #102 F2）。 */
    let failed = false;

    // 1. 删除：账本里存在、本次数据里没有的 key
    for (const [key, resource] of [...this.resources]) {
      if (nextKeys.has(key)) continue;
      // 逐条隔离（与 `clear()` 同口径）：一次摘除失败不该让后面的项也不再摘除。
      // 失败时**保留**账本条目 —— 那条资源可能仍在图上，所有权留给下一次摘除（或永久销毁）：
      // 删掉记账会让它彻底没人认领，那比「重复摘一次」糟得多。
      try {
        this.host.removeMarker(resource);
      } catch (error) {
        failed = true;
        this.options.warn?.(
          `${this.label}: 摘除资源失败（key=${String(key)}），它可能仍在图上：` +
            `${(error as Error)?.message ?? String(error)}`,
        );
        continue;
      }
      this.resources.delete(key);
      this.appliedPositions.delete(key);
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
          failed = true;
          this.options.warn?.(
            `${this.label}: 创建资源失败（key=${String(entry.key)}），本项会等下次同步重试：` +
              `${(error as Error)?.message ?? String(error)}`,
          );
          continue;
        }
        this.resources.set(entry.key, resource);
        // 资源是**按这个坐标建出来**的 ⇒ 直接提交位置记账（不需要再 setPosition 一次）
        this.appliedPositions.set(entry.key, positionFingerprint(entry.point));
        if (typeof resource === "object" && resource !== null) {
          this.keyOfResource.set(resource as object, entry.key);
        }
        // 新建的资源也要服从当前的显隐状态（否则 `visible=false` 期间新来的点会「亮」着出现在图上）。
        // 只在隐藏态时下发一次：新建的资源本来就是可见的，再 show 一次是无谓的 SDK 调用。
        if (!this.visible) this.applyVisibility(resource, this.visible, entry.key);
        continue;
      }
      // 位置下发由**值**决定（不再用 item 引用做第二层短路）：根引用变化 ⇒ 重新读取；
      // 坐标真的变了才写。`version` 变化时逐项写一遍（见上）。
      const fingerprint = positionFingerprint(entry.point);
      if (!versionChanged && this.appliedPositions.get(entry.key) === fingerprint) continue;
      try {
        this.host.updatePosition(existing, entry.point, entry.item);
      } catch (error) {
        // 位置没更新成功 ⇒ **不提交**位置记账，下一次同步会再试（评审 #102 F2）。
        failed = true;
        this.options.warn?.(
          `${this.label}: 更新位置失败（key=${String(entry.key)}）：${(error as Error)?.message ?? String(error)}`,
        );
        continue;
      }
      this.appliedPositions.set(entry.key, fingerprint);
    }

    this.index.replace(scanned.map((entry) => ({ key: entry.key, item: entry.item })));
    // 有失败 ⇒ **不推进**短路基线：同一批输入再 `sync()` 时会重跑一遍（各项按自己的记账重试），
    // 而不是被顶部短路吞掉。`index`/`resources` 的记账照常推进（它们回答的是「当前业务对象是哪个」，
    // 与「SDK 写成功没有」无关）。
    if (!failed) {
      this.lastItems = items;
      this.lastVersion = version;
    }
    this.everSynced = true;
  }

  /**
   * 把一个资源的显隐**显式**对齐到 `desired`（调用方负责只在需要时调，见两处调用点）。
   *
   * `desired` 由调用方传入而不是读 `this.visible`：`setVisible` 只在全部成功后推进内部记账，
   * 因此循环进行中 `this.visible` 仍是**旧值**（这正是「失败可重试」的前提）。
   * 错误不在这里吞：SDK 的 `show/hide` 抛错必须让调用方知道这一次没写成功。
   */
  private applyVisibility(resource: Resource, desired: boolean, key?: PropertyKey): void {
    const applied = this.host.setVisible?.(resource, desired) ?? false;
    if (applied || this.warnedVisibilityUnsupported) return;
    this.warnedVisibilityUnsupported = true;
    this.options.warn?.(
      `${this.label}: 资源不支持显隐（宿主没有实现 setVisible 或 SDK 无 show/hide）` +
        `${key === undefined ? "" : `，key=${String(key)}`}：本次 visible=${String(desired)} 被忽略`,
    );
  }
}
