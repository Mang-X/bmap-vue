/**
 * 服务任务内核（issue #139）
 *
 * `useServiceTask` 原本把「所有服务共有的状态口径」与「只有 LocalSearch / 路线服务才需要的
 * 实例身份语义」焊在一个闭包里，于是 7 个官方**没有**释放入口的服务也背着
 * `pendingReleases` / `instanceStale` / `refuseMessage` 这几个恒为空的状态。
 *
 * 这里把两者拆开：内核**只**拥有共有部分（能力门 / 按 Client 缓存 / 只读状态 / 过期保护 /
 * 投影），实例所有权全部交给 `ServiceInstanceChannel`（`instanceChannel.ts`）。简单通道是
 * **无状态**单例，于是简单路径的闭包里根本没有那些字段——这满足 #139 的验收项，而不只是
 * 「有字段但没人用」。
 *
 * **框架无关**：本文件不 import vue。Vue 侧的 shallow refs 与生命周期绑定在
 * `composables/serviceTask.ts`，本内核只经 `onState(patch)` 回写。
 */
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";
import type { Capability } from "../../driver/capability/catalog";
import type { ServiceCall, ServiceErrorInfo, ServiceResult } from "../../driver/types/services";
import type { BMapServiceStatus } from "./serviceStatus";
import { settledServiceResult, toServiceErrorInfo } from "./serviceStatus";
import { createRequestGuard } from "./requestGuard";
import type { ServiceInstanceChannel } from "./instanceChannel";

/** 传给 `create` / `invoke` 的上下文（Client 已就绪、能力已通过）。 */
export interface ServiceInvokeContext {
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

/** 任务状态的一份快照（内核持有，Vue 侧据此写 shallow refs）。 */
export interface ServiceTaskState<TResult> {
  readonly status: BMapServiceStatus;
  readonly data: TResult | null;
  readonly error: ServiceErrorInfo | null;
  readonly sdkStatus: number | null;
  readonly isLoading: boolean;
  readonly supported: boolean;
}

/** 发起一次调用所需的「本调用上下文」。 */
export interface ServiceTaskReady {
  readonly client: BMapClient;
  readonly map: MapHandle | null;
}

export interface ServiceTaskCoreOptions<TDriver, THandle, TArgs extends unknown[], TResult> {
  /** 能力 id：不满足时状态为 `unsupported`，且不创建实例、不发起请求。 */
  capability: Capability;
  /** 创建服务实例（每个 Client 一次）。抛错会被归一成 `failed`。 */
  create: (context: ServiceInvokeContext) => THandle;
  /** 发起一次归一化调用（网络语义全在 Driver 的 `ServiceCall` 里）。 */
  invoke: (context: ServiceInvokeContext, handle: THandle, ...args: TArgs) => ServiceCall<TDriver>;
  /**
   * 把 Driver 的 DTO 投影成对外的数据（省略则原样透传）。投影**只作用于 `data`**——
   * `status` / `error` / `sdkStatus` 是引擎结论，必须原样透传。
   */
  project?: (data: TDriver, ...args: TArgs) => TResult;
  /** 实例所有权通道（简单档 / 独占档）。 */
  channel: ServiceInstanceChannel<THandle>;
  /** 上下文就绪（Client + 可选地图句柄）。 */
  whenReady: (signal: AbortSignal) => Promise<ServiceTaskReady>;
  /** 状态变更回调（Vue 侧写 shallow refs）。 */
  onState: (patch: Partial<ServiceTaskState<TResult>>) => void;
}

export interface ServiceTaskCore<TDriver, THandle, TArgs extends unknown[], TResult> {
  execute(...args: TArgs): Promise<ServiceResult<TResult>>;
  cancel(): void;
  reset(): void;
  /** 丢弃缓存实例（下一次调用重建）。独占档才有。 */
  invalidate(): void;
  /** Client 变化时重判能力。 */
  setSupported(supported: boolean): void;
  /**
   * scope 卸载：取消在飞调用 + 释放实例 + **冻结回写**。
   *
   * 「冻结」也是对**后续** `execute()` 的约束（见 `execute` 开头的注释），而不只是让在飞
   * 的那一次不回写。这里刻意**不**暴露 `isDisposed`：内核内部有 `disposed` 闭包变量，
   * 而外部没有任何消费者读它——按本仓「零消费者的扩展面一律删掉，不留给以后可能有用」的
   * 规则，它不该进接口面。
   */
  dispose(): void;
}

export function createServiceTaskCore<TDriver, THandle, TArgs extends unknown[], TResult>(
  options: ServiceTaskCoreOptions<TDriver, THandle, TArgs, TResult>,
): ServiceTaskCore<TDriver, THandle, TArgs, TResult> {
  const { capability, channel, whenReady, onState } = options;

  const guard = createRequestGuard();
  let disposed = false;
  let activeCall: ServiceCall<TDriver> | null = null;
  let activeController: AbortController | null = null;

  const invokeContext = (
    client: BMapClient,
    map: MapHandle | null,
    signal: AbortSignal,
  ): ServiceInvokeContext => ({ client, map, signal });

  const ensureHandle = (
    client: BMapClient,
    map: MapHandle | null,
    signal: AbortSignal,
  ): THandle =>
    channel.acquire(client, (owningClient) =>
      options.create(invokeContext(owningClient, map, signal)),
    );

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

  /**
   * 把「不支持」写进状态：**没有发起任何请求**，因此不产生 sdkStatus。
   *
   * 返回的 `ServiceResult` 是 `failed` + `BMAP_CAPABILITY_UNSUPPORTED`，而**任务状态**是更细的
   * `unsupported`。两者刻意不同：`ServiceResult` 的终态集合由 Driver 冻结
   * （`ServiceCallStatus` 五项），往里塞第六项会破坏所有既有消费者；而「这个能力在当前引擎上
   * 没有」与「请求发了但结果不好」是调用方必须能区分的两件事。
   */
  const settleUnsupported = (): ServiceResult<TResult> => {
    onState({ status: "unsupported", data: null, error: null, sdkStatus: null, isLoading: false });
    return settledServiceResult<TResult>("failed", {
      code: "BMAP_CAPABILITY_UNSUPPORTED",
      message: `当前引擎不支持 ${capability}：本次调用没有发出请求`,
    });
  };

  async function execute(...args: TArgs): Promise<ServiceResult<TResult>> {
    /**
     * scope 已卸载 ⇒ 直接结算为 `canceled`，**一个 ref 都不写**。
     *
     * 这条必须在最前面：下面的 `onState({ status: "loading" })` 位于首个 `disposed` 检查
     * （`await whenReady` 之后）**之前**，而 `execute` 是可能被**保留**的公开句柄——
     * watcher 回调、`setTimeout`、事件处理器，或某个 `await search()` 的续体在组件卸载后才
     * 跑到这里。没有这道门时，那次调用会把 `status` 永久钉在 `loading` / `isLoading: true`
     * （实测），也就是「卸载后回写 ref」——与本模块「dispose 之后状态冻结」的契约直接冲突。
     *
     * 旧实现有同一个洞（它的 `status.value = "loading"` 同样在守卫之外），所以这不是
     * 回归；但新代码把「冻结回写」写进了接口注释，就得真的守住。
     */
    if (disposed) return settledServiceResult<TResult>("canceled");

    // **取代判定必须在 `guard.next()` 之前**：拒绝本次调用时不能作废在飞调用 —— 它还在跑，
    // 它的结果仍然属于它自己。
    const mode = channel.resolveSupersede(args);
    /**
     * 「忙」必须包含**已经进入 `execute`、但还没拿到 `ServiceCall`** 的那一步
     * （`await whenReady()` 期间：Client/Map 还在加载）。
     *
     * 只判 `activeCall !== null` 会在异步加载场景漏掉它：第二次调用会以为「没人忙」，
     * 于是既不走 `refuse`、又用 `guard.next()` 把**还在等 ready 的那条**作废 ——
     * 与「上一次还没结算时不能取代它」的公开契约直接冲突（PR #89 复审 P1）。
     */
    const busy = activeController !== null || channel.isBlocked();
    if (busy && mode === "refuse") {
      const info = {
        code: "BMAP_SERVICE_FAILED",
        // 拒绝是「已结算的失败」，**不写状态**：`status` / `error` 属于在飞的那一次调用
        message:
          channel.refuseMessage ??
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
      channel.superseded(mode === "refuse" ? "cancel" : mode);
    }
    const controller = new AbortController();
    activeController = controller;

    onState({ status: "loading", isLoading: true, error: null });

    try {
      const ready = await whenReady(controller.signal);
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      const client = ready.client;
      const map = ready.map ?? null;
      const supported = client.capabilities.supports(capability);
      onState({ supported });
      if (!supported) return settleUnsupported();

      const handle = ensureHandle(client, map, controller.signal);
      const call = options.invoke(invokeContext(client, map, controller.signal), handle, ...args);
      activeCall = call;
      const driverResult = await call.result;
      // 卸载 / 被更新的请求取代 / 已取消：一律不回写（`dispose()` 之后也不回写），
      // 并且**不把这个结果交回调用方**——它对调用方来说等于「没发生过」。
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      const result = toPublicResult(driverResult, args);
      channel.afterSettle(driverResult.status);
      onState({
        status: result.status,
        data: result.data,
        error: result.error,
        sdkStatus: result.sdkStatus,
        isLoading: false,
      });
      return result;
    } catch (caught) {
      // `whenReady` 失败、句柄守卫抛错、`create*` 的 SDK 失败：归一成 `failed` 载荷，
      // 而不是让调用方同时处理 error 载荷与原生异常两套。
      const info = toServiceErrorInfo(caught);
      if (disposed || !guard.isCurrent(id) || controller.signal.aborted) {
        return settledServiceResult<TResult>("canceled");
      }
      onState({ status: "failed", data: null, error: info, sdkStatus: null, isLoading: false });
      return settledServiceResult<TResult>("failed", info);
    } finally {
      if (guard.isCurrent(id)) {
        activeCall = null;
        activeController = null;
        if (!disposed) onState({ isLoading: false });
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
    // 取消的是**还在跑**的调用 ⇒ SDK 侧的回包可能仍在路上，实例不再可靠。
    // 没有在飞调用时 `cancel()` 是 no-op，不能因此把实例标记为过期。
    channel.onCancel(hadInflight);
    if (disposed) return;
    // 取消不是失败：状态回到 `idle`，data 保留（「上一次的结果」仍在，调用方自己决定要不要清）
    onState({ status: "idle", isLoading: false });
  }

  function reset(): void {
    cancel();
    if (disposed) return;
    onState({ data: null, error: null, sdkStatus: null, status: "idle" });
  }

  function invalidate(): void {
    cancel();
    channel.invalidate();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    guard.invalidate();
    activeCall?.cancel();
    activeCall = null;
    activeController?.abort("scope-disposed");
    activeController = null;
    channel.releaseAll();
  }

  return {
    execute,
    cancel,
    reset,
    invalidate,
    setSupported: (supported) => onState({ supported }),
    dispose,
  };
}
