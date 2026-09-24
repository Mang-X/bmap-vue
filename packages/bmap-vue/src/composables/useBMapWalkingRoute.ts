/**
 * useBMapWalkingRoute —— 步行路线规划（headless，M7-ROUTES / issue #39）
 *
 * 官方 `BMap.WalkingRoute` 的 headless 封装。与 `useBMapDrivingRoute` 的**公开签名差异**（逐个核对
 * 官方 4.0.4 声明得出，不用一个最宽模型套四个服务）：
 *
 * - 起终点接受 `string | Point | LocalResultPoi` ⇒ 本库对应「地名 / 坐标 / POI 引用」，**支持关键字检索**；
 * - **没有** `waypoints`（官方 `WalkingRoute#search` 是两参数签名）；
 * - **没有**策略与页容量选项（官方 `WalkingRouteOptions` 只有 `renderOptions` 与五个回调），
 *   因此也没有 `enableTraffic`。
 *
 * 共用语义（状态口径、构造期重建、请求归属、绘制物所有权）见 `./routeServices.ts`；本文件只描述
 * 步行自己那三件事。
 */
import { toValue, type MaybeRefOrGetter } from "vue";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  RouteEndpoint,
  RouteRequest,
  WalkingRouteOptions,
  WalkingRouteResult,
} from "../driver/types/services";
import { jsapiV4ServicesOf } from "../core/services";
import { resolveMapContext } from "./resolveMapContext";
import {
  buildRouteDriverOptions,
  createRouteTask,
  requireRouteLocation,
  sameRouteState,
  snapshotRouteState,
  type BMapRouteLocation,
  type BMapRouteRenderOptions,
  type RouteConstructionState,
} from "./routeServices";
import type { BMapServiceInvokeContext } from "./useBMapServiceTask";

/** 步行构造期选项；每个字段都可以是 ref / getter，**只有它们变化才重建 SDK 实例**。 */
export interface BMapWalkingRouteOptions {
  /**
   * 检索区域：城市名 / 坐标 / `MapHandle`。不传时取当前 `<BMap>` 的**地图实例**（上下文注入）；
   * 在没有地图的 `<BMapProvider>` 子树里必须显式给，否则以 `failed(BMAP_INVALID_ARGUMENT)` 结算。
   */
  location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
  /** 绘制选项。不传 = 纯 headless */
  renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}

type WalkingSettings = Omit<WalkingRouteOptions, "renderOptions">;

export function useBMapWalkingRoute(options: MaybeRefOrGetter<BMapWalkingRouteOptions> = {}) {
  const ctx = resolveMapContext();
  const read = (): BMapWalkingRouteOptions => toValue(options) ?? {};

  const readState = (): RouteConstructionState<WalkingSettings> => {
    const current = read();
    return {
      location: toValue(current.location),
      renderOptions: toValue(current.renderOptions),
      // 官方 `WalkingRouteOptions` 没有策略 / 页容量 / 路况开关 ⇒ 构造期状态里没有 `settings`
      settings: {},
    };
  };

  const task = createRouteTask<
    WalkingRouteResult,
    ServiceHandle<"service:walking-route">,
    RouteRequest,
    ReturnType<typeof snapshotRouteState<WalkingSettings>>
  >(ctx, {
    capability: "service.walking-route",
    create: (context: BMapServiceInvokeContext): ServiceHandle<"service:walking-route"> => {
      const state = readState();
      return jsapiV4ServicesOf(context.client).createWalkingRoute(
        requireRouteLocation(state.location, context.map, "useBMapWalkingRoute"),
        buildRouteDriverOptions(state),
      );
    },
    invoke: (context: BMapServiceInvokeContext, handle, request) =>
      jsapiV4ServicesOf(context.client).searchWalkingRoute(handle, request),
    release: (context: BMapServiceInvokeContext, handle) => {
      jsapiV4ServicesOf(context.client).disposeRoute(handle);
    },
    snapshot: () => snapshotRouteState(readState()),
    sameSnapshot: sameRouteState,
  });

  /** 发起一次步行检索：起终点是地名、`{ lng, lat }` 或 POI 引用（`{ uid, point, name? }`）。 */
  const search = (start: RouteEndpoint, end: RouteEndpoint) => task.search({ start, end });

  return {
    data: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    search,
    clear: task.clear,
    cancel: task.cancel,
    reset: task.reset,
  };
}
