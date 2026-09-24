/**
 * useBMapServiceTask —— 服务类 composable 的统一状态机（M7-SERVICE-CORE / issue #38）
 *
 * 这一层**不复制请求框架**：所有网络语义（超时、空结果、迟到回调、取消、先到者胜）都由
 * Driver 的 `createServiceCall` 负责（`driver/normalize/serviceCall.ts`）。这里只做四件事：
 *
 * 1. **能力门**：`capabilities.supports()` 为 false 时不发起任何请求，状态直接是
 *    `unsupported`（与 `failed` 严格区分——后者是「请求发了但结果不好」）；
 * 2. **实例缓存**：同一 Client 上服务实例只创建一次（Client 变化时重建）；
 * 3. **只读状态**：把 `ServiceResult` 写进 shallow refs，返回的全是 `Readonly<ShallowRef>`；
 * 4. **过期保护**：每次 `execute()` 递增序列号并取消上一轮在飞调用（最新者胜），
 *    回包落地前比对序列号与 `AbortSignal`；`onScopeDispose` 之后一律不回写。
 *
 * 为什么实例缓存要有「Client 变化就重建」：跨 Client 的句柄会被 Driver 拒绝
 * （`BMAP_HANDLE_FOREIGN`）。把缓存绑在 Client 身份上，重建是自动的，调用方不需要记得清缓存。
 */
import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import type { BMapClient } from "../client/types";
import { logger } from "../core/logger";
import type { MapContext } from "../core/context/types";
import type { Capability } from "../driver/capability/catalog";
import type { MapHandle } from "../driver/types/handles";
import type { ServiceCall, ServiceErrorInfo, ServiceResult } from "../driver/types/services";
import {
  createRequestGuard,
  settledServiceResult,
  toServiceErrorInfo,
  type BMapServiceStatus,
} from "../core/services";

/**
 * 新调用取代在飞调用时的三种处置。
 *
 * `"refuse"` 给「不能取代的那一类调用」用（LocalSearch 的 `gotoPage`：它是对上一条结果的延续，
 * 在上一次检索还没结算时没有意义）。
 */
export type SupersedeMode = "cancel" | "recreate" | "refuse";

export type SupersedePolicy<TArgs extends unknown[]> =
  | Exclude<SupersedeMode, "refuse">
  | ((...args: TArgs) => SupersedeMode);

/** 传给 `create` / `invoke` 的上下文（Client 已就绪、能力已通过）。 */
export interface BMapServiceInvokeContext {
  /** 已就绪的 Client（服务默认只需要它，不需要地图实例）。 */
  readonly client: BMapClient;
  /**
   * 显式传入的地图句柄；没有则为 `null`。
   *
   * 服务默认**不**依赖地图（`<BMapProvider>` 子树即可用）。需要绘制到地图上的服务
   * （当前只有 LocalSearch 的 `renderOptions.map`）必须由调用方显式给这个句柄——绘制出来的
   * 覆盖物所有权必须可验证，司机才能替调用方收回它们。
   */
  readonly map: MapHandle | null;
  /** 本次调用的取消信号（已取消时不要再发起请求）。 */
  readonly signal: AbortSignal;
}

export interface UseBMapServiceTaskOptions<
  TDriver,
  THandle,
  TArgs extends unknown[],
  TResult = TDriver,
> {
  /** 能力 id：不满足时状态为 `unsupported`，且不创建实例、不发起请求。 */
  capability: Capability;
  /** 创建服务实例（每个 Client 一次）。抛错会被归一成 `failed`。 */
  create: (context: BMapServiceInvokeContext) => THandle;
  /** 发起一次归一化调用（返回值即 Driver 的 `ServiceCall`，网络语义全在那边）。 */
  invoke: (
    context: BMapServiceInvokeContext,
    handle: THandle,
    ...args: TArgs
  ) => ServiceCall<TDriver>;
  /**
   * 把 Driver 的 DTO 投影成 composable 对外的数据（省略则原样透传）。
   *
   * 为什么需要它：Driver 的 DTO 是「引擎回包的领域投影」，而 composable 对外承诺的形态
   * 是文档里那一个（`BMapGeoResult` / `Boundary` 的字符串点串）。两者相同（如 `Point`）
   * 时不用给；不同时必须在**一个**地方转换——否则 `data` 是 Driver 形态、而 `get()` 返回
   * 文档形态，同一份数据两个形状。
   */
  project?: (data: TDriver, ...args: TArgs) => TResult;
  /**
   * 释放服务实例（可选）。只有**有清理入口**的服务需要给：当前是 LocalSearch
   * （`disposeLocalSearch`）；其余服务（Geocoder / Convertor / Boundary / Geolocation /
   * LocalCity）官方没有销毁入口，随 Client 被 GC 回收。
   *
   * 释放失败**不吞掉**：失败的实例留在待释放队列里，下一次释放（下一次取代 / `invalidateService()`
   * / scope 卸载）会重试，并告警一次——否则「释放失败」会变成静默泄漏。
   */
  release?: (context: BMapServiceInvokeContext, handle: THandle) => void;
  /**
   * 新调用取代**在飞调用**时的策略（默认 `"cancel"`）。
   *
   * - `"cancel"`：只逻辑取消上一次调用，实例**复用**（适用于回包归属不依赖实例身份的 SDK）。
   * - `"recreate"`：取消 + **释放旧实例**，并为新调用建一个新实例。该策略下，上一次调用以
   *   `canceled` / `timeout` 收场后，下一次调用同样会重建实例（那两种情况下 SDK 侧可能仍有回包
   *   在路上，旧实例不再可用）——适用于**归属依赖实例身份**的 SDK（LocalSearch）。
   * - 函数形式：**按调用参数逐次决定**，可返回 `"refuse"`：本次调用不能取代在飞调用（或实例已
   *   过期），直接以 `failed` 结算（说明取 `refuseMessage`），**不**发起请求。
   */
  supersede?: SupersedePolicy<TArgs>;
  /** `supersede` 判定为 `"refuse"` 时的说明（进 `error.message`） */
  refuseMessage?: string;
}

export interface BMapServiceTask<TResult, TArgs extends unknown[], THandle = unknown> {
  data: Readonly<ShallowRef<TResult | null>>;
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
  status: Readonly<ShallowRef<BMapServiceStatus>>;
  /** SDK 公开的状态码（`BMAP_STATUS_*` 等）；拿不到时为 `null`（不伪装成 0）。 */
  sdkStatus: Readonly<ShallowRef<number | null>>;
  isLoading: Readonly<ShallowRef<boolean>>;
  /** 当前引擎是否支持该能力（Client 就绪后立即判定，不需要先发一次请求）。 */
  supported: Readonly<ShallowRef<boolean>>;
  /** 别名：`status === "failed"`（v2/v3 既有用法）。 */
  isError: ComputedRef<boolean>;
  /** 别名：`data === null`（v2/v3 既有用法）；注意 `empty` / `canceled` 也会是 `true`。 */
  isEmpty: ComputedRef<boolean>;
  /** 发起一次调用；**恒 resolve**（失败/超时/取消都在返回值里）。 */
  execute: (...args: TArgs) => Promise<ServiceResult<TResult>>;
  /** 逻辑取消在飞调用：不标记 error（SDK 侧请求收不回，见 `ServiceCall.cancel`）。 */
  cancel: () => void;
  /** 取消 + 清空 data/error/status。 */
  reset: () => void;
  /**
   * 丢弃缓存的服务实例（下一次调用重建）：先取消在飞调用，再释放旧实例，并把实例标记为过期
   * ——因此 `supersede` 判定为 `"refuse"` 的那些调用（如 LocalSearch 的 `gotoPage`）随后会被拒绝。
   */
  invalidateService: () => void;
}

export function useBMapServiceTask<TDriver, THandle, TArgs extends unknown[], TResult = TDriver>(
  ctx: MapContext,
  options: UseBMapServiceTaskOptions<TDriver, THandle, TArgs, TResult>,
): BMapServiceTask<TResult, TArgs, THandle> {
  const data = shallowRef<TResult | null>(null);
  const error = shallowRef<ServiceErrorInfo | null>(null);
  const status = shallowRef<BMapServiceStatus>("idle");
  const sdkStatus = shallowRef<number | null>(null);
  const isLoading = shallowRef(false);
  /**
   * 初始 `true` = **尚未判定**（Client 还没就绪）。Client 一落地就按 `supports()` 判定，
   * 因此调用方读到的 `false` 一定来自真实的能力探测，而不是「还没加载」。
   */
  const supported = shallowRef(true);

  const guard = createRequestGuard();
  let disposed = false;
  let activeCall: ServiceCall<TDriver> | null = null;
  let activeController: AbortController | null = null;
  interface CachedService {
    client: BMapClient;
    handle: THandle;
    context: BMapServiceInvokeContext;
  }

  let cached: CachedService | null = null;
  /**
   * 释放失败、等待重试的实例。
   *
   * 为什么不是「释放失败就丢掉引用」：`release()` 的失败通常意味着 SDK 侧的清理没走完（例如
   * `clearResults()` 抛错），把引用丢掉就既无法重试、也没有任何可观察信号 —— 静默泄漏。
   * 失败时保留引用 + 告警，下一次释放（下一次取代 / `invalidateService()` / scope 卸载）重试。
   */
  const pendingReleases: CachedService[] = [];
  /**
   * 缓存实例是否**不再是可用的请求通道**。
   *
   * 两种来源：① 上一次调用以 `canceled` / `timeout` 收场（SDK 侧的回包可能仍在路上）；
   * ② `invalidateService()`。只对声明了 `supersede` 策略的服务生效（默认策略下恒为 `false`，
   * 其余服务的行为完全不变）。
   */
  let instanceStale = false;
  /** 声明了取代策略（`"recreate"` 或函数形式）的服务才需要「过期即重建」。 */
  const supersedePolicy = options.supersede;
  const marksStale = supersedePolicy !== undefined && supersedePolicy !== "cancel";

  const invokeContext = (
    client: BMapClient,
    map: MapHandle | null,
    signal: AbortSignal,
  ): BMapServiceInvokeContext => ({ client, map, signal });

  /** 当前 Client（`<BMap>` 子树里通常已经就绪；Provider-only 场景要等 `whenReady`）。 */
  const clientRef = (): BMapClient | null => ctx.client.value ?? null;

  // Client 一出现就判定能力：`supported` 因此不需要「先失败一次」才知道答案。
  // `watch` 随 effect scope 自动停止（composable 卸载时不需要手动解绑）。
  watch(
    clientRef,
    (client) => {
      if (!client) return;
      supported.value = client.capabilities.supports(options.capability);
    },
    { immediate: true },
  );

  /** 释放一个实例；失败时告警并保留以便重试（返回是否成功）。 */
  const tryRelease = (entry: CachedService): boolean => {
    if (!options.release) return true;
    try {
      options.release(entry.context, entry.handle);
      return true;
    } catch (error) {
      logger.warn(
        `useBMapServiceTask: 释放 ${options.capability} 的实例失败，已保留引用待下一次释放重试（` +
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
    // 仍失败就继续留着，等下一次或 scope 卸载
    for (let index = pendingReleases.length - 1; index >= 0; index -= 1) {
      const pending = pendingReleases[index];
      if (pending && tryRelease(pending)) pendingReleases.splice(index, 1);
    }
  };

  const ensureHandle = (
    client: BMapClient,
    map: MapHandle | null,
    signal: AbortSignal,
  ): THandle => {
    if (cached && cached.client === client) return cached.handle;
    // Client 变化（例如 `<BMap>` 重挂）：旧实例属于旧 Client，句柄跨 Client 会被 Driver 拒绝
    releaseCached();
    const context = invokeContext(client, map, signal);
    const handle = options.create(context);
    cached = { client, handle, context };
    return handle;
  };

  /** 解析本次调用的取代策略（未声明时是默认的 `"cancel"`）。 */
  const resolveSupersede = (args: TArgs): SupersedeMode => {
    if (typeof supersedePolicy === "function") return supersedePolicy(...args);
    return supersedePolicy ?? "cancel";
  };

  /**
   * 把 Driver 的 `ServiceResult<TDriver>` 收敛成对外载荷。
   *
   * 投影只发生在 `data` 上：`status` / `error` / `sdkStatus` 是**引擎结论**，调用方拿到的
   * 必须是原样的值（把 SDK 状态码经过一层投影会让人无法解释它是什么）。
   */
  const toPublicResult = (
    result: ServiceResult<TDriver>,
    args: TArgs,
  ): ServiceResult<TResult> => {
    if (result.data === null) {
      return {
        status: result.status,
        data: null,
        error: result.error,
        sdkStatus: result.sdkStatus,
      };
    }
    return {
      status: result.status,
      data: options.project
        ? options.project(result.data, ...args)
        : (result.data as unknown as TResult),
      error: result.error,
      sdkStatus: result.sdkStatus,
    };
  };

  const applyResult = (result: ServiceResult<TResult>): void => {
    status.value = result.status;
    data.value = result.data;
    error.value = result.error;
    sdkStatus.value = result.sdkStatus;
    isLoading.value = false;
  };

  /**
   * 把「不支持」写进状态：**没有发起任何请求**，因此不产生 sdkStatus。
   *
   * 返回的 `ServiceResult` 是 `failed` + `BMAP_CAPABILITY_UNSUPPORTED`，而**任务状态**是更细的
   * `unsupported`。两者刻意不同：`ServiceResult` 的终态集合由 Driver 冻结（`ServiceCallStatus`
   * 五项，`assertServiceResultShape` 逐项断言），往里塞第六项会破坏所有既有消费者；而
   * 「这个能力在当前引擎上没有」与「请求发了但失败了」是调用方必须能区分的两件事，
   * 因此把它放在任务状态与 `supported` 上表达。
   */
  const settleUnsupported = (): ServiceResult<TResult> => {
    status.value = "unsupported";
    data.value = null;
    error.value = null;
    sdkStatus.value = null;
    isLoading.value = false;
    return settledServiceResult<TResult>("failed", {
      code: "BMAP_CAPABILITY_UNSUPPORTED",
      message: `当前引擎不支持 ${options.capability}：本次调用没有发出请求`,
    });
  };

  async function execute(...args: TArgs): Promise<ServiceResult<TResult>> {
    // **取代判定必须在 `guard.next()` 之前**：拒绝本次调用时不能作废在飞调用 —— 它还在跑，
    // 它的结果仍然属于它自己。
    const mode = resolveSupersede(args);
    /**
     * 「忙」必须包含**已经进入 `execute`、但还没拿到 `ServiceCall`** 的那一步
     * （`await ctx.whenReady()` 期间：Client/Map 还在加载）。
     *
     * 只判 `activeCall !== null` 会在异步加载场景漏掉它：第二次调用会以为「没人忙」，
     * 于是既不走 `refuse`、又用 `guard.next()` 把**还在等 ready 的那条**作废 ——
     * 与「上一次还没结算时不能取代它」的公开契约直接冲突（PR #89 复审 P1）。
     */
    const busy = activeController !== null || instanceStale;
    if (busy && mode === "refuse") {
      const info = {
        code: "BMAP_SERVICE_FAILED",
        // 拒绝是「已结算的失败」，**不写状态**：`status` / `error` 属于在飞的那一次调用
        message:
          options.refuseMessage ??
          "上一次调用尚未结算，本次调用被拒绝（它不能取代在飞调用，也没有独立的结果可归属）",
      };
      return settledServiceResult<TResult>("failed", info);
    }

    const id = guard.next();
    if (busy) {
      // 上一轮仍在跑 ⇒ 逻辑取消（最新者胜）。**无条件收掉上一次 execution**：它可能已经有
      // `ServiceCall`（在飞请求），也可能还停在 `await whenReady()`（此时 `activeCall` 仍是
      // null，但它的 controller 必须被 abort，否则它会继续跑到 `ensureHandle` 才发现自己已被取代）。
      activeCall?.cancel();
      activeCall = null;
      activeController?.abort("superseded");
      activeController = null;
    }
    if (busy && mode === "recreate") {
      // 该 SDK 的回包归属依赖**实例身份**：旧实例（含它交付出去、可能仍画在地图上的结果）
      // 交还给 Driver 清理，本次调用用新实例。
      releaseCached();
      instanceStale = false;
    }
    const controller = new AbortController();
    activeController = controller;

    status.value = "loading";
    isLoading.value = true;
    error.value = null;

    try {
      const ready = await ctx.whenReady(controller.signal);
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      const client = ready.client;
      const map = (ready.map as MapHandle | null) ?? null;
      supported.value = client.capabilities.supports(options.capability);
      if (!supported.value) return settleUnsupported();

      const handle = ensureHandle(client, map, controller.signal);
      const call = options.invoke(invokeContext(client, map, controller.signal), handle, ...args);
      activeCall = call;
      const driverResult = await call.result;
      // 卸载 / 被更新的请求取代 / 已取消：一律不回写（`onScopeDispose` 之后也不回写），
      // 并且**不把这个结果交回调用方**——它对调用方来说等于「没发生过」。
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      const result = toPublicResult(driverResult, args);
      if (marksStale) {
        // `canceled` / `timeout` 都意味着 SDK 侧的回包**可能仍在路上**（那时槽位仍被占用），
        // 因此这个实例不再是可靠的请求通道；正常结算（含服务端报失败）则表示回调已到达、
        // 槽位已释放，实例可以继续用（`gotoPage` 依赖这一点）。
        instanceStale = driverResult.status === "canceled" || driverResult.status === "timeout";
      }
      applyResult(result);
      return result;
    } catch (caught) {
      // `whenReady` 失败、句柄守卫抛错、`create*` 的 SDK 失败：归一成 `failed` 载荷，
      // 而不是让调用方同时处理 error 载荷与原生异常两套。
      const info = toServiceErrorInfo(caught);
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      status.value = "failed";
      data.value = null;
      error.value = info;
      sdkStatus.value = null;
      isLoading.value = false;
      return settledServiceResult<TResult>("failed", info);
    } finally {
      if (guard.isCurrent(id)) {
        activeCall = null;
        activeController = null;
        if (!disposed) isLoading.value = false;
      }
    }
  }

  function cancel(): void {
    guard.invalidate();
    const hadInflight = activeCall !== null;
    activeCall?.cancel();
    activeCall = null;
    activeController?.abort("canceled");
    activeController = null;
    // 取消的是**还在跑**的调用 ⇒ SDK 侧的回包可能仍在路上，实例不再可靠（下一次调用重建）。
    // 没有在飞调用时 cancel() 是 no-op，不能因此把实例标记为过期。
    if (hadInflight && marksStale) instanceStale = true;
    if (disposed) return;
    // 取消不是失败：状态回到 `idle`，data 保留（「上一次的结果」仍在，调用方自己决定要不要清）
    status.value = "idle";
    isLoading.value = false;
  }

  function reset(): void {
    cancel();
    if (disposed) return;
    data.value = null;
    error.value = null;
    sdkStatus.value = null;
    status.value = "idle";
  }

  function invalidateService(): void {
    cancel();
    releaseCached();
    // 明确要求「丢弃实例」⇒ 下一次调用重建（`"refuse"` 类调用也会因此被拒绝：
    // 例如 `gotoPage` 在结果被清掉 / 实例被丢弃之后没有意义）
    instanceStale = true;
  }

  onScopeDispose(() => {
    disposed = true;
    guard.invalidate();
    activeCall?.cancel();
    activeCall = null;
    activeController?.abort("scope-disposed");
    activeController = null;
    releaseCached();
  });

  return {
    data: data as Readonly<ShallowRef<TResult | null>>,
    error: error as Readonly<ShallowRef<ServiceErrorInfo | null>>,
    status: status as Readonly<ShallowRef<BMapServiceStatus>>,
    sdkStatus: sdkStatus as Readonly<ShallowRef<number | null>>,
    isLoading: isLoading as Readonly<ShallowRef<boolean>>,
    supported: supported as Readonly<ShallowRef<boolean>>,
    isError: computed(() => status.value === "failed"),
    isEmpty: computed(() => data.value === null),
    execute,
    cancel,
    reset,
    invalidateService,
  };
}
