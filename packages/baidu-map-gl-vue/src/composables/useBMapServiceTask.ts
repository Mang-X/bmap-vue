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
   * 释放服务实例（可选）。只有**有释放入口**的服务需要给：当前是 LocalSearch
   * （`disposeLocalSearch`）；其余服务（Geocoder / Convertor / Boundary / Geolocation /
   * LocalCity）官方没有销毁入口，随 Client 被 GC 回收。
   */
  release?: (context: BMapServiceInvokeContext, handle: THandle) => void;
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
  /** 丢弃缓存的服务实例（下一次调用重建）；会先取消在飞调用并释放旧实例。 */
  invalidateService: () => void;
  /**
   * 当前缓存的服务实例；**不会创建**实例（Client 未就绪或还没调用过时为 `null`）。
   *
   * 给「不需要发请求、但要操作已有实例」的动作留的口子（当前只有 LocalSearch 的
   * `clearLocalSearch` —— 它清的是 SDK 侧已产生的可见结果，不是一次调用）。
   */
  peekService: () => THandle | null;
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
  let cached:
    | { client: BMapClient; handle: THandle; context: BMapServiceInvokeContext }
    | null = null;

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

  const releaseCached = (): void => {
    const entry = cached;
    cached = null;
    if (!entry || !options.release) return;
    try {
      options.release(entry.context, entry.handle);
    } catch {
      // 释放失败不改变本地状态：实例缓存已经丢弃，下一次调用会重建；
      // 把失败吞掉是刻意的——否则「释放一个已经出问题的实例」会连累取消路径。
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
    const id = guard.next();
    // 上一轮仍在飞 ⇒ 逻辑取消（最新者胜）。SDK 侧请求收不回，但它的回包会被序列号挡掉，
    // 且不会有人把它当成「本次的结果」。
    activeCall?.cancel();
    activeCall = null;
    activeController?.abort("superseded");
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
    activeCall?.cancel();
    activeCall = null;
    activeController?.abort("canceled");
    activeController = null;
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
    peekService: () => cached?.handle ?? null,
  };
}
