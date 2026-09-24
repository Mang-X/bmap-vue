/**
 * 服务实例通道 —— 任务内核的「实例所有权」策略（issue #139）
 *
 * #139 的判据：**这个服务的 SDK 实例有没有公开的释放入口**。这是唯一让「释放失败重试」与
 * 「取消 / 超时后实例过期」不再是猜测的事实：
 *
 * - Geocoder / Convertor / Boundary / Geolocation / LocalCity / PanoramaService 官方**没有**
 *   `destroy` / `dispose`，实例随 Client 被 GC 回收 ⇒ `createSharedInstanceChannel()`：
 *   只有「按 Client 缓存一个实例」这一件事，**没有**取代 / 过期 / 待释放队列；
 * - LocalSearch（`clearResults`）与四个路线服务（`clearResults`）有公开释放入口 ⇒
 *   `createExclusiveInstanceChannel()`：回包归属依赖**实例身份**，取消 / 超时 / 取代都必须换新实例。
 *
 * 因此「带释放入口」在本仓恰好等价于「需要 supersede 语义」——分档依据的是官方成员，不是
 * 「哪个服务看起来复杂」。
 *
 * 本文件**框架无关**（不 import vue、不 import SDK），与 `core/services/` 其余部分同档。
 */
import type { BMapClient } from "../../client/types";
import type { ServiceCallStatus } from "../../driver/types/services";
import { logger } from "../logger";

/**
 * 新调用取代在飞调用时的三种处置。
 *
 * `"refuse"` 给「不能取代的那一类调用」用（LocalSearch 的 `gotoPage`：它是对上一条结果的延续，
 * 在上一次检索还没结算时没有意义）。
 */
export type SupersedeMode = "cancel" | "recreate" | "refuse";

/**
 * 取代策略。**字符串形式只能是 `"cancel"` / `"recreate"`**（二者都真的会取代在飞调用），
 * 只有**函数**形式才可能返回 `"refuse"`——这样类型就不会谎称「固定字符串也能拒绝」。
 */
export type SupersedePolicy<TArgs extends unknown[]> =
  | Exclude<SupersedeMode, "refuse">
  | ((...args: TArgs) => SupersedeMode);

/**
 * 实例通道：任务内核**唯一**与「实例生命周期」打交道的面。
 *
 * 内核只通过这个面问实例所有权，不持有任何通道相关状态——因此简单通道真的**没有**那些
 * 字段，而不是「有但恒为空」。成员数（9 个）是接口形状，不是「几个问题」的计数：
 * `refuseMessage` 是只读值、`releaseAll` / `superseded` / `afterSettle` / `onCancel` /
 * `invalidate` 各对应内核的一处明确调用点。
 */
export interface ServiceInstanceChannel<THandle> {
  /**
   * 取得可用的句柄；同一 Client 只建一次，Client 变化即释放旧实例再建。
   *
   * `create` 收到的就是本次调用的 `ServiceInvokeContext`（Client / map / signal）——通道把它
   * 连同句柄一起记住，因此 `release` 之后仍能拿到当初那个 Client（跨 Client 的句柄会被
   * Driver 拒绝，释放必须用**当初的**那个 client）。
   */
  acquire(client: BMapClient, create: (client: BMapClient) => THandle): THandle;
  /** 释放通道持有的全部实例（scope 卸载 / `dispose`）。 */
  releaseAll(): void;
  /**
   * 「忙」判定里属于**通道**的那一半。
   *
   * 共享通道恒 `false`；独占通道为「实例已过期」——此时新检索不能落在旧实例上
   * （`gotoPage` 因此被拒绝）。
   */
  isBlocked(): boolean;
  /** 解析本次调用的取代策略。共享通道恒 `"cancel"`。 */
  resolveSupersede(args: readonly unknown[]): SupersedeMode;
  /** `resolveSupersede` 得到 `"refuse"` 时的说明；共享通道恒 `undefined`（永不 refuse）。 */
  readonly refuseMessage: string | undefined;
  /** 本次调用取代了上一轮（`mode` ∈ `cancel` / `recreate`）。 */
  superseded(mode: Exclude<SupersedeMode, "refuse">): void;
  /** 一次调用结算后：独占通道据 `canceled` / `timeout` 标记实例过期。 */
  afterSettle(status: ServiceCallStatus): void;
  /** `cancel()`：只有**确实有在飞调用**才把实例标记为过期。 */
  onCancel(hadInflight: boolean): void;
  /** 显式丢弃实例（构造期变化 / 公开 `clear()`）。 */
  invalidate(): void;
}

/**
 * 共享实例通道：官方没有释放入口的那 7 个服务。
 *
 * 这个对象是**无状态**的——除了一个按 Client 缓存的槽位，没有 `pendingReleases`、
 * 没有 `instanceStale`、没有 `refuseMessage`、没有策略闭包。`#139` 的验收项
 * 「simple services 不携带无消费者的 recreate/refuse/pending-release 状态」由此在**结构上**成立。
 */
export function createSharedInstanceChannel<THandle>(): ServiceInstanceChannel<THandle> {
  let cached: { client: BMapClient; handle: THandle } | null = null;

  return {
    acquire(client, create) {
      if (cached && cached.client === client) return cached.handle;
      // Client 变化（例如 `<Map>` 重挂）：旧实例属于旧 Client，句柄跨 Client 会被 Driver 拒绝。
      // 官方没有释放入口，丢弃引用即可——随旧 Client 一起被 GC。
      cached = null;
      const handle = create(client);
      cached = { client, handle };
      return handle;
    },
    releaseAll() {
      // 没有释放入口：清掉引用，别让它在 scope 卸载后仍然可达。
      cached = null;
    },
    isBlocked() {
      return false;
    },
    resolveSupersede() {
      return "cancel";
    },
    get refuseMessage() {
      return undefined;
    },
    superseded() {
      /* 共享通道复用同一实例，取代不需要任何额外动作 */
    },
    afterSettle() {
      /* 正常结算（含服务端报失败）都表示回调已到达、槽位已释放，实例可继续用 */
    },
    onCancel() {
      /* 没有「迟到回包无法区分」的问题：共享通道的回包归属不依赖实例身份 */
    },
    invalidate() {
      cached = null;
    },
  };
}

/** 独占通道的构造项。 */
export interface ExclusiveInstanceChannelOptions<THandle, TArgs extends unknown[]> {
  /**
   * 释放服务实例。只有**有清理入口**的服务需要给：当前是 LocalSearch（`disposeLocalSearch`）
   * 与四个路线服务（`disposeRoute`）。
   *
   * 释放失败**不吞掉**：失败的实例留在待释放队列里，下一次释放重试，并告警一次——
   * 否则「释放失败」会变成静默泄漏（PR #89 评审 P2-1）。
   */
  release: (client: BMapClient, handle: THandle) => void;
  /** 取代策略（默认 `"cancel"`；独占服务通常给 `"recreate"` 或函数形式）。 */
  supersede?: SupersedePolicy<TArgs>;
  /** 策略判定为 `"refuse"` 时的说明（进 `error.message`）。 */
  refuseMessage?: string;
  /** 诊断用的能力 id（告警文案里点名哪个服务）。 */
  label: string;
}

interface CachedEntry<THandle> {
  readonly client: BMapClient;
  readonly handle: THandle;
}

/**
 * 独占实例通道：回包归属依赖**实例身份**的那些服务（LocalSearch / 四个路线服务）。
 *
 * 复杂度全部来自一条可在官方声明里核对到的事实：**这些服务在取消 / 超时 / 取代之后，
 * 旧实例上可能仍有回包在路上，而它与后续请求无法区分**。因此「换新实例」不是保守，
 * 而是唯一能让「这条结果属于哪次调用」可判定的做法。
 *
 * 状态：`pendingReleases`（释放失败待重试）+ `instanceStale`（实例不再是可用的请求通道）。
 */
export function createExclusiveInstanceChannel<THandle, TArgs extends unknown[]>(
  options: ExclusiveInstanceChannelOptions<THandle, TArgs>,
): ServiceInstanceChannel<THandle> {
  const { release, supersede, refuseMessage, label } = options;

  let cached: CachedEntry<THandle> | null = null;
  /**
   * 释放失败、等待重试的实例。
   *
   * 为什么不是「释放失败就丢掉引用」：释放失败通常意味着 SDK 侧的清理没走完，把引用丢掉就
   * 既无法重试、也没有任何可观察信号 —— 静默泄漏。失败时保留引用 + 告警，下一次释放
   * （下一次取代 / `invalidate()` / scope 卸载）重试。
   */
  const pendingReleases: CachedEntry<THandle>[] = [];
  /**
   * 缓存实例是否**不再是可用的请求通道**。
   *
   * 两种来源：① 上一次调用以 `canceled` / `timeout` 收场（SDK 侧的回包可能仍在路上）；
   * ② `invalidate()`。
   */
  let instanceStale = false;
  /** 声明了非默认策略的服务才需要「过期即重建」。 */
  const marksStale = supersede !== undefined && supersede !== "cancel";

  /** 释放一个实例；失败时告警并保留以便重试（返回是否成功）。 */
  const tryRelease = (entry: CachedEntry<THandle>): boolean => {
    try {
      // 用**当初那个** Client 释放：句柄跨 Client 会被 Driver 拒绝。
      release(entry.client, entry.handle);
      return true;
    } catch (error) {
      logger.warn(
        `服务任务: 释放 ${label} 的实例失败，已保留引用待下一次释放重试（` +
          `${(error as Error)?.message ?? String(error)}）`,
      );
      return false;
    }
  };

  const releaseCached = (): void => {
    const entry = cached;
    cached = null;
    if (entry && !tryRelease(entry)) pendingReleases.push(entry);
    // 顺带重试历史失败项（释放是幂等的：`disposeLocalSearch` / `clearResults` 都可重复调用）；
    // 仍失败就继续留着，等下一次或 scope 卸载。
    for (let index = pendingReleases.length - 1; index >= 0; index -= 1) {
      const pending = pendingReleases[index];
      if (pending && tryRelease(pending)) pendingReleases.splice(index, 1);
    }
  };

  return {
    acquire(client, create) {
      if (cached && cached.client === client && !instanceStale) return cached.handle;
      // Client 变了、或实例已过期：交还旧实例（释放 = 公开的 `clearResults()`，顺带清掉它
      // 交付出去、可能仍画在地图上的结果），再为本次调用建一个新实例。
      releaseCached();
      instanceStale = false;
      const handle = create(client);
      cached = { client, handle };
      return handle;
    },
    releaseAll() {
      releaseCached();
    },
    isBlocked() {
      return instanceStale;
    },
    resolveSupersede(args) {
      return typeof supersede === "function" ? supersede(...(args as TArgs)) : (supersede ?? "cancel");
    },
    get refuseMessage() {
      return refuseMessage;
    },
    superseded(mode) {
      if (mode !== "recreate") return;
      // 该 SDK 的回包归属依赖**实例身份**：旧实例（含它交付出去、可能仍画在地图上的结果）
      // 交还给 Driver 清理，本次调用用新实例。
      releaseCached();
      instanceStale = false;
    },
    afterSettle(status) {
      if (!marksStale) return;
      // `canceled` / `timeout` 都意味着 SDK 侧的回包**可能仍在路上**（那时槽位仍被占用），
      // 因此这个实例不再是可靠的请求通道；正常结算（含服务端报失败）则表示回调已到达、
      // 槽位已释放，实例可以继续用（`gotoPage` 依赖这一点）。
      instanceStale = status === "canceled" || status === "timeout";
    },
    onCancel(hadInflight) {
      // 取消的是**还在跑**的调用 ⇒ SDK 侧的回包可能仍在路上，实例不再可靠。
      // 没有在飞调用时 `cancel()` 是 no-op，不能因此把实例标记为过期。
      if (hadInflight && marksStale) instanceStale = true;
    },
    invalidate() {
      releaseCached();
      // 明确要求「丢弃实例」⇒ 下一次调用重建（`"refuse"` 类调用也会因此被拒绝：
      // 例如 `gotoPage` 在结果被清掉 / 实例被丢弃之后没有意义）。
      instanceStale = true;
    },
  };
}
