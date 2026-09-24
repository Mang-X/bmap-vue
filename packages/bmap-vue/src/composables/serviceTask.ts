/**
 * 服务任务的 Vue 绑定（issue #139）
 *
 * 这一层只做四件事，与框架无关的状态机在 `core/services/serviceTaskCore.ts`：
 *
 * 1. **只读状态**：把 `ServiceTaskState` 写进 shallow refs，返回的全是 `Readonly<ShallowRef>`
 *    （SDK 实例绝不进 deep `ref` / `reactive`）；
 * 2. **能力门**：`supports()` 为 false 时状态直接 `unsupported`（与 `failed` 严格区分）；
 * 3. **生命周期**：`onScopeDispose` 冻结回写并释放实例；
 * 4. **分档**：简单服务用**无状态**通道且**不暴露** `invalidateService`；只有回包归属依赖
 *    实例身份的服务（`useLocalSearch` / 四个路线 composable）才用独占通道与可丢弃实例。
 *    名单与判据见 `core/services/instanceChannel.ts` 文件头。
 *
 * 为什么实例缓存要「Client 变化就重建」：跨 Client 的句柄会被 Driver 拒绝
 * （`BMAP_HANDLE_FOREIGN`）。把缓存绑在 Client 身份上，重建是自动的，调用方不需要记得清缓存。
 */
import { computed, onScopeDispose, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import type { BMapClient } from "../client/types";
import type { MapContext } from "../core/context/types";
import type { Capability } from "../driver/capability/catalog";
import type { ServiceCall, ServiceErrorInfo, ServiceResult } from "../driver/types/services";
import type { BMapServiceStatus } from "../core/services";
import {
  createServiceTaskCore,
  type ServiceInvokeContext,
  type ServiceTaskState,
} from "../core/services/serviceTaskCore";
import {
  createSharedInstanceChannel,
  createExclusiveInstanceChannel,
  type SupersedePolicy,
} from "../core/services/instanceChannel";

export type { ServiceInvokeContext };
export type { SupersedeMode, SupersedePolicy } from "../core/services/instanceChannel";

/** 两档共有的构造项。 */
interface CommonOptions<TDriver, THandle, TArgs extends unknown[], TResult> {
  /** 能力 id：不满足时状态为 `unsupported`，且不创建实例、不发起请求。 */
  capability: Capability;
  /** 创建服务实例（每个 Client 一次）。抛错会被归一成 `failed`。 */
  create: (context: ServiceInvokeContext) => THandle;
  /** 发起一次归一化调用（返回值即 Driver 的 `ServiceCall`，网络语义全在那边）。 */
  invoke: (context: ServiceInvokeContext, handle: THandle, ...args: TArgs) => ServiceCall<TDriver>;
  /**
   * 把 Driver 的 DTO 投影成 composable 对外的数据（省略则原样透传）。
   *
   * 为什么需要它：Driver 的 DTO 是「引擎回包的领域投影」，而 composable 对外承诺的形态是
   * 文档里那一个（`BMapGeoResult` / `Boundary` 的字符串点串）。两者相同时不用给；不同时
   * 必须**在一个**地方转换——否则 `data` 是 Driver 形态、而 `get()` 返回文档形态。
   */
  project?: (data: TDriver, ...args: TArgs) => TResult;
}

/**
 * 简单服务的构造项。
 *
 * **刻意不接受** `release` / `supersede` / `refuseMessage`：官方没有为这些服务提供实例的
 * 销毁入口，Driver 侧也不持有任何资源，因此「释放失败重试」「取消后实例过期」这些机制在
 * 这里是**无消费者的状态**。#139 把它们从这个面上彻底拿掉。
 */
export type SimpleServiceTaskOptions<TDriver, THandle, TArgs extends unknown[], TResult = TDriver> =
  CommonOptions<TDriver, THandle, TArgs, TResult>;

/** 简单服务任务的公开面。**没有** `invalidateService`——官方没有释放入口，实例只在 Client 变化时重建。 */
export interface SimpleServiceTask<TResult, TArgs extends unknown[]> {
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
}

/** 独占服务任务的构造项：`release` 是**唯一**让 supersede 语义非猜测的官方事实。 */
export interface ExclusiveServiceTaskOptions<TDriver, THandle, TArgs extends unknown[], TResult = TDriver>
  extends CommonOptions<TDriver, THandle, TArgs, TResult> {
  /**
   * 释放服务实例。只有**有清理入口**的服务需要给：当前是 LocalSearch
   * （`disposeLocalSearch`）与四个路线服务（`disposeRoute`）；其余服务官方没有销毁入口。
   *
   * 参数只给 `client` 与 `handle`，因为**所有真实释放入口都只需要这两样**（Driver 的
   * `disposeLocalSearch` / `disposeRoute`）。传一个用不上的 `signal` 只会诱使调用方以为
   * 「取消会连带释放」——那不是事实。释放用**实例当初所属的那个** client（跨 Client 的句柄
   * 会被 Driver 拒绝）。
   *
   * 释放失败**不吞掉**：失败的实例留在待释放队列里，下一次释放（下一次取代 / `invalidate()`
   * / scope 卸载）会重试，并告警一次——否则「释放失败」会变成静默泄漏。
   */
  release: (client: BMapClient, handle: THandle) => void;
  /**
   * 新调用取代**在飞调用**时的策略（默认 `"cancel"`）。
   *
   * - `"cancel"`：只逻辑取消上一次调用，实例**复用**。
   * - `"recreate"`：取消 + **释放旧实例**，并为新调用建一个新实例。该策略下，上一次调用以
   *   `canceled` / `timeout` 收场后，下一次同样会重建实例（那两种情况下 SDK 侧可能仍有回包
   *   在路上，旧实例不再可用）。
   * - 函数形式：**按调用参数逐次决定**，可返回 `"refuse"`：本次调用不能取代在飞调用（或实例
   *   已过期），直接以 `failed` 结算（说明取 `refuseMessage`），**不**发起请求。
   */
  supersede?: SupersedePolicy<TArgs>;
  /** `supersede` 判定为 `"refuse"` 时的说明（进 `error.message`） */
  refuseMessage?: string;
}

/** 独占服务任务的公开面：多一个 `invalidateService`（丢弃缓存实例）。 */
export interface ExclusiveServiceTask<TResult, TArgs extends unknown[]>
  extends SimpleServiceTask<TResult, TArgs> {
  /**
   * 丢弃缓存的服务实例（下一次调用重建）：先取消在飞调用，再释放旧实例，并把实例标记为过期
   * ——因此判定为 `"refuse"` 的那些调用（如 LocalSearch 的 `gotoPage`）随后会被拒绝。
   */
  invalidateService: () => void;
}

/**
 * 建任务：把内核状态写进 shallow refs，并把生命周期接到 Vue 上。
 *
 * 简单档与独占档的**唯一**差别是传进去的通道、以及是否多暴露 `invalidateService`——
 * 状态机只有这一份（#139 的「口径只有一个」）。
 */
function bindTask<TDriver, THandle, TArgs extends unknown[], TResult>(
  ctx: MapContext,
  options: CommonOptions<TDriver, THandle, TArgs, TResult>,
  channel: import("../core/services/instanceChannel").ServiceInstanceChannel<THandle>,
): {
  task: SimpleServiceTask<TResult, TArgs>;
  core: import("../core/services/serviceTaskCore").ServiceTaskCore<TDriver, THandle, TArgs, TResult>;
} {
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

  const core = createServiceTaskCore<TDriver, THandle, TArgs, TResult>({
    ...options,
    channel,
    whenReady: (signal) => ctx.whenReady(signal),
    onState: (patch: Partial<ServiceTaskState<TResult>>) => {
      if (patch.status !== undefined) status.value = patch.status;
      if (patch.data !== undefined) data.value = patch.data;
      if (patch.error !== undefined) error.value = patch.error;
      if (patch.sdkStatus !== undefined) sdkStatus.value = patch.sdkStatus;
      if (patch.isLoading !== undefined) isLoading.value = patch.isLoading;
      if (patch.supported !== undefined) supported.value = patch.supported;
    },
  });

  // Client 一出现就判能力：`supported` 因此不需要「先失败一次」才知道答案。
  // `watch` 随 effect scope 自动停止（composable 卸载时不需要手动解绑）。
  watch(
    () => ctx.client.value,
    (client) => {
      if (!client) return;
      core.setSupported(client.capabilities.supports(options.capability));
    },
    { immediate: true },
  );

  onScopeDispose(() => core.dispose());

  const task: SimpleServiceTask<TResult, TArgs> = {
    data: data as Readonly<ShallowRef<TResult | null>>,
    error: error as Readonly<ShallowRef<ServiceErrorInfo | null>>,
    status: status as Readonly<ShallowRef<BMapServiceStatus>>,
    sdkStatus: sdkStatus as Readonly<ShallowRef<number | null>>,
    isLoading: isLoading as Readonly<ShallowRef<boolean>>,
    supported: supported as Readonly<ShallowRef<boolean>>,
    isError: computed(() => status.value === "failed"),
    isEmpty: computed(() => data.value === null),
    execute: (...args: TArgs) => core.execute(...args),
    cancel: () => core.cancel(),
    reset: () => core.reset(),
  };
  return { task, core };
}

/** 简单服务任务：官方没有实例释放入口的那 7 个 composable（见 `instanceChannel.ts` 文件头）。 */
export function useSimpleServiceTask<TDriver, THandle, TArgs extends unknown[], TResult = TDriver>(
  ctx: MapContext,
  options: SimpleServiceTaskOptions<TDriver, THandle, TArgs, TResult>,
): SimpleServiceTask<TResult, TArgs> {
  return bindTask(ctx, options, createSharedInstanceChannel<THandle>()).task;
}

/** 独占服务任务：回包归属依赖实例身份的那一类（LocalSearch / 四个路线服务）。 */
export function useExclusiveServiceTask<TDriver, THandle, TArgs extends unknown[], TResult = TDriver>(
  ctx: MapContext,
  options: ExclusiveServiceTaskOptions<TDriver, THandle, TArgs, TResult>,
): ExclusiveServiceTask<TResult, TArgs> {
  const { release, supersede, refuseMessage, ...common } = options;
  const channel = createExclusiveInstanceChannel<THandle, TArgs>({
    label: options.capability,
    // 通道记住实例当初所属的 Client 并原样交回——跨 Client 的句柄会被 Driver 拒绝，
    // 释放必须用**当初那个** client。
    release: (client, handle) => release(client, handle),
    ...(supersede ? { supersede } : {}),
    ...(refuseMessage ? { refuseMessage } : {}),
  });
  const { task, core } = bindTask(ctx, common, channel);
  return { ...task, invalidateService: () => core.invalidate() };
}
