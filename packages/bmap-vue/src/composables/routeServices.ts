/**
 * 路线服务 composable 的**共用底座**（M7-ROUTES / issue #39）
 *
 * 四个路线 hooks（`useDrivingRoute` / `useWalkingRoute` / `useRidingRoute` /
 * `useTransitRoute`）只差三件事：能力 id、句柄种类、`search` 的入参形状。其余全部相同——
 * 因此「共用语义只写一处」，一个 hook 只描述自己那三件事：
 *
 * - **状态口径**：服务任务内核（`idle` / `loading` / `success` / `empty` / `failed` /
 *   `timeout` / `canceled` / `unsupported`）。这一层**不复制请求框架**：超时、空结果、迟到回调、
 *   先到者胜都在 Driver 的 `ServiceCall` 适配器里。
 * - **构造期状态**：`location` / `renderOptions` / 各自策略字段变化 ⇒ **丢弃旧实例**（下一次检索
 *   重建）。路线实例既持有配置又持有**结果与绘制物**，在旧实例上改配置会让「可见的路线」与
 *   「当前配置」对不上；`clear()` 也走同一条路（释放实例 = 公开的 `clearResults()`）。
 * - **请求归属**：`supersede: "recreate"`。四个路线服务的回包**没有请求身份**、官方也没承诺跨请求
 *   顺序，因此归属只能靠实例身份（见 ADR `2026-09-14-route-services-headless.md` 决策 3）：
 *   新检索取代在飞检索时换新实例，旧的迟到回包只会落到被丢弃的实例上。
 */
import { toValue, watch, type ComputedRef, type MaybeRefOrGetter, type ShallowRef } from "vue";
import type { BMapClient } from "../client/types";
import { BMapError } from "../core/errors/BMapError";
import type { MapContext } from "../core/context/types";
import type { Capability } from "../driver/capability/catalog";
import type { MapHandle, ServiceHandle } from "../driver/types/handles";
import type {
  RouteRenderOptions,
  ServiceCall,
  ServiceErrorInfo,
  ServiceResult,
} from "../driver/types/services";
import type { BMapServiceStatus } from "../core/services";
import type { GeoPoint } from "./useGeocoder";
import { useExclusiveServiceTask, type ServiceInvokeContext } from "./serviceTask";

/** 路线检索区域：城市名 / 领域 Point / 本库 `MapHandle`。不传时取当前 `<Map>` 的地图实例。 */
export type BMapRouteLocation = string | GeoPoint | MapHandle;

/**
 * 检索区域比较：字符串按值、坐标按分量、`MapHandle` 按身份。
 *
 * 三种形态混在一个字段里，因此「变没变」不能用引用比较（坐标每次都可能是新对象），也不能序列化
 * 句柄。逐形态判定：字符串与坐标是值语义，句柄是身份语义。
 */
export function sameRouteLocation(
  a: BMapRouteLocation | undefined,
  b: BMapRouteLocation | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if ("lng" in a && "lng" in b) return a.lng === b.lng && a.lat === b.lat;
  return false;
}

/**
 * 路线绘制选项（composable 层形态：`map` 可以是 ref / getter）。
 *
 * 只包含官方声明里**存在且有语义**的成员：
 * - `selectFirstResult` 不在这里（官方 `RenderOptions` 明说它「仅对 LocalSearch 有效」）；
 * - `polylineStyle` 不在这里（上游声明与官方类文档给的形状互相矛盾，见
 *   `RouteRenderOptions` 的说明）。
 */
export interface BMapRouteRenderOptions {
  /**
   * 绘制目标：本库的 `MapHandle`（或它的 ref / getter）。不传 = 纯 headless，不绘制。
   *
   * 允许 `null`：`useMap()` 返回的 `map` 是 `MapHandle | null`（地图尚未 ready 时为 `null`），
   * 直接把它传进来是最自然的写法——`null` 与 `undefined` 一样表示「现在没有绘制目标」。
   */
  map?: MaybeRefOrGetter<MapHandle | null | undefined>;
  /** 结果列表容器（元素或 id） */
  panel?: string | HTMLElement;
  /** 检索结束后是否自动调整地图视野 */
  autoViewport?: boolean;
  /** 自动调整视野时的计算选项 */
  viewportOptions?: {
    noAnimation?: boolean;
    margins?: readonly number[];
    zoomFactor?: number;
  };
}

/**
 * 构造期快照的**绘制部分**：字段级比较用（`MapHandle` 走身份，不做序列化）。
 *
 * 用字段级比较而不是「响应式对象变没变」：选项可以是 getter，每次求值都会产生新对象，
 * 按引用比较会把「没变」判成「变了」，于是每次渲染都重建一次 SDK 实例（PR #89 的「重建风暴」）。
 */
export interface RouteRenderSnapshot {
  map: MapHandle | null | undefined;
  panel: string | HTMLElement | undefined;
  autoViewport: boolean | undefined;
  noAnimation: boolean | undefined;
  zoomFactor: number | undefined;
  /** `margins` 的**内容键**（数组按内容比较，不能用引用比较） */
  marginsKey: string;
  /** `margins` 的原始值（还原成 SDK 选项时用它，不做序列化往返） */
  margins: readonly number[] | undefined;
}

export function snapshotRouteRender(
  value: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>,
): RouteRenderSnapshot | null {
  const render = toValue(value);
  if (!render) return null;
  const margins = toValue(render.viewportOptions?.margins);
  return {
    map: toValue(render.map),
    panel: render.panel,
    autoViewport: render.autoViewport,
    noAnimation: render.viewportOptions?.noAnimation,
    zoomFactor: render.viewportOptions?.zoomFactor,
    marginsKey: JSON.stringify(margins ?? []),
    margins,
  };
}

export function sameRouteRender(
  a: RouteRenderSnapshot | null,
  b: RouteRenderSnapshot | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.map === b.map &&
    a.panel === b.panel &&
    a.autoViewport === b.autoViewport &&
    a.noAnimation === b.noAnimation &&
    a.zoomFactor === b.zoomFactor &&
    a.marginsKey === b.marginsKey
  );
}

/** 把绘制快照还原成 Driver 认得的选项（Driver 会再校验一次句柄品牌）。 */
export function toRouteRenderOptions(
  snapshot: RouteRenderSnapshot | null,
): RouteRenderOptions | undefined {
  if (!snapshot) return undefined;
  const viewport: { noAnimation?: boolean; margins?: readonly number[]; zoomFactor?: number } = {};
  if (snapshot.noAnimation !== undefined) viewport.noAnimation = snapshot.noAnimation;
  if (snapshot.margins !== undefined) viewport.margins = snapshot.margins;
  if (snapshot.zoomFactor !== undefined) viewport.zoomFactor = snapshot.zoomFactor;

  return {
    // 不传 `map` 就是纯 headless；传了必须是 MapHandle（Driver 会再校验一次）
    ...(snapshot.map ? { map: snapshot.map } : {}),
    ...(snapshot.panel !== undefined ? { panel: snapshot.panel } : {}),
    ...(snapshot.autoViewport !== undefined ? { autoViewport: snapshot.autoViewport } : {}),
    ...(Object.keys(viewport).length > 0 ? { viewportOptions: viewport } : {}),
  };
}

/**
 * 路线实例的**构造期状态**（四个 hook 各自把 options 读成它）。
 *
 * `TSettings` 是服务专属的构造选项（驾车 / 公交的策略、公交的页容量、路况开关）。参数化而不是收成
 * `Record<string, unknown>`：这样「hook 里写了一个官方声明里没有的构造选项」会被编译期挡下来
 * （各 hook 用 `Omit<DrivingRouteOptions, "renderOptions">` 这类类型收窄）——「收进来再丢掉」
 * 属于假支持，而它最容易从这一个字段溜进来。
 */
export interface RouteConstructionState<TSettings extends object = Record<string, never>> {
  location: BMapRouteLocation | undefined;
  renderOptions: BMapRouteRenderOptions | undefined;
  settings: TSettings;
}

export interface RouteStateSnapshot<TSettings extends object = Record<string, never>> {
  location: BMapRouteLocation | undefined;
  render: RouteRenderSnapshot | null;
  /** `settings` 的内容键（值只有数字 / 布尔 / 字符串，因此 `JSON.stringify` 是稳定的） */
  settingsKey: string;
  /** 原始状态（还原成 SDK 选项时用它，不做序列化往返） */
  state: RouteConstructionState<TSettings>;
}

export function snapshotRouteState<TSettings extends object>(
  state: RouteConstructionState<TSettings>,
): RouteStateSnapshot<TSettings> {
  return {
    location: state.location,
    render: snapshotRouteRender(state.renderOptions),
    settingsKey: JSON.stringify(state.settings),
    state,
  };
}

export function sameRouteState<T extends object>(
  a: RouteStateSnapshot<T>,
  b: RouteStateSnapshot<T>,
): boolean {
  return (
    sameRouteLocation(a.location, b.location) &&
    a.settingsKey === b.settingsKey &&
    sameRouteRender(a.render, b.render)
  );
}

/**
 * 检索区域：显式给的优先，否则取当前 `<Map>` 的地图实例。
 *
 * 两者都没有（`<BMapProvider>` 子树里没给 `location`）时**显式失败**而不是把 `undefined` 传给
 * SDK——那样只会得到一个不可解释的 SDK 侧异常。
 */
export function requireRouteLocation(
  location: BMapRouteLocation | undefined,
  map: MapHandle | null,
  hookName: string,
): BMapRouteLocation {
  const resolved = location ?? map;
  if (resolved === undefined || resolved === null) {
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `${hookName}: 缺少检索区域。在没有地图的 <BMapProvider> 子树里必须显式给 ` +
        "`location`（城市名 / 坐标 / MapHandle）",
    );
  }
  return resolved;
}

/** 构造期状态 → Driver 的构造选项（四个 hook 共用；`undefined` 字段不写）。 */
export function buildRouteDriverOptions<TSettings extends object>(
  state: RouteConstructionState<TSettings>,
): TSettings & { renderOptions?: RouteRenderOptions } {
  const renderOptions = toRouteRenderOptions(snapshotRouteRender(state.renderOptions));
  return {
    ...state.settings,
    ...(renderOptions ? { renderOptions } : {}),
  };
}

/**
 * 路线 composable 的公共返回面（四类服务完全一致的部分）。
 *
 * 没有 `gotoPage` 之类的「延续上一条结果」的入口：四个路线服务的检索都是**独立的一次规划**，
 * 不共享结果集状态。
 */
export interface BMapRouteTask<TResult, TRequest> {
  /** 最近一次检索的结果（`success` 之外为 `null`） */
  data: Readonly<ShallowRef<TResult | null>>;
  error: Readonly<ShallowRef<ServiceErrorInfo | null>>;
  status: Readonly<ShallowRef<BMapServiceStatus>>;
  /** SDK 公开的状态码（`BMAP_STATUS_*`）；拿不到时为 `null` */
  sdkStatus: Readonly<ShallowRef<number | null>>;
  isLoading: Readonly<ShallowRef<boolean>>;
  supported: Readonly<ShallowRef<boolean>>;
  isError: ComputedRef<boolean>;
  isEmpty: ComputedRef<boolean>;
  /** 发起一次检索；**恒 resolve**（失败 / 超时 / 取消都在返回值里） */
  search: (request: TRequest) => Promise<ServiceResult<TResult>>;
  /** 取消在飞检索（逻辑取消：SDK 侧请求收不回），已经画出来的结果不动 */
  cancel: () => void;
  /** 丢弃当前实例与结果：下一次 `search` 会建新实例，且公开的 `clearResults()` 会收回绘制物 */
  clear: () => void;
  /** 取消 + 清空 data/error/status */
  reset: () => void;
}

export interface CreateRouteTaskInput<TResult, THandle extends ServiceHandle<string>, TRequest, TSnapshot> {
  capability: Capability;
  /** 创建服务实例（每个 Client 一次；抛错会被归一成 `failed`） */
  create: (context: ServiceInvokeContext) => THandle;
  /** 发起一次归一化调用（返回值即 Driver 的 `ServiceCall`） */
  invoke: (context: ServiceInvokeContext, handle: THandle, request: TRequest) => ServiceCall<TResult>;
  /** 释放实例（四类路线服务都走 `disposeRoute` → 公开的 `clearResults()`） */
  /**
   * 释放服务实例。只有 `client` 与 `handle`：Driver 的 `disposeRoute` 只需要它们，且句柄
   * 必须用**实例当初所属的那个** client 释放（跨 Client 会被 Driver 拒绝）。
   */
  release: (client: BMapClient, handle: THandle) => void;
  /** 构造期快照（每次都从可能变化的 ref / getter 里读一遍） */
  snapshot: () => TSnapshot;
  sameSnapshot: (a: TSnapshot, b: TSnapshot) => boolean;
}

/**
 * 建一个路线任务：`useExclusiveServiceTask`（独占档：官方有 `disposeRoute`，回包归属依赖
 * 实例身份）+「构造期状态变化 ⇒ 丢弃实例」。
 *
 * 返回的是完整任务（含 `invalidateService` 之外的一切），供四个 hook 直接转成自己的公开面。
 */
export function createRouteTask<
  TResult,
  THandle extends ServiceHandle<string>,
  TRequest,
  TSnapshot,
>(
  ctx: MapContext,
  input: CreateRouteTaskInput<TResult, THandle, TRequest, TSnapshot>,
): BMapRouteTask<TResult, TRequest> {
  const task = useExclusiveServiceTask<TResult, THandle, [TRequest]>(ctx, {
    capability: input.capability,
    create: input.create,
    invoke: input.invoke,
    release: input.release,
    // 归属依赖**实例身份**（见文件头）：取代在飞检索 ⇒ 换新实例；上一次以 `canceled` / `timeout`
    // 收场 ⇒ 下一次同样换新实例（那两种情况下 SDK 侧可能仍有回包在路上）。
    supersede: "recreate",
  });

  // 构造字段变化 ⇒ 丢弃旧实例（下一次调用重建）。`watch` 随 effect scope 自动停止。
  let previous = input.snapshot();
  watch(
    () => input.snapshot(),
    (next) => {
      if (input.sameSnapshot(previous, next)) return;
      previous = next;
      task.invalidateService();
      task.reset();
    },
  );

  const clear = (): void => {
    task.invalidateService();
    task.reset();
  };

  return {
    data: task.data,
    error: task.error,
    status: task.status,
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    isError: task.isError,
    isEmpty: task.isEmpty,
    search: (request: TRequest) => task.execute(request),
    cancel: task.cancel,
    clear,
    reset: task.reset,
  };
}
