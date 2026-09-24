/**
 * useRidingRoute —— 骑行路线规划（headless，M7-ROUTES / issue #39）
 *
 * 官方 `BMap.RidingRoute` 的 headless 封装。它的公开签名与 `WalkingRoute` **完全一致**
 * （`search(string | Point | LocalResultPoi, …)`、构造选项只有 `renderOptions`），差异在结果里：
 * `Route#getRouteType()` 会给出 `BMAP_ROUTE_TYPE_RIDING`（6）。
 *
 * 刻意**不**把两者合成一个 `useRoute(mode)`：两个服务在 SDK 里就是两个类、两个能力 id，
 * 合并只会让「其中一个加了选项」时要在共享类型上开洞。共用语义（状态口径、构造期重建、请求归属、
 * 绘制物所有权）见 `./routeServices.ts`。
 */
import { toValue, type MaybeRefOrGetter } from "vue";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  RidingRouteOptions,
  RidingRouteResult,
  RouteEndpoint,
  RouteRequest,
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
import type { ServiceInvokeContext } from "./useServiceTask";

/** 骑行构造期选项；每个字段都可以是 ref / getter，**只有它们变化才重建 SDK 实例**。 */
export interface BMapRidingRouteOptions {
  /**
   * 检索区域：城市名 / 坐标 / `MapHandle`。不传时取当前 `<Map>` 的**地图实例**（上下文注入）；
   * 在没有地图的 `<BMapProvider>` 子树里必须显式给，否则以 `failed(BMAP_INVALID_ARGUMENT)` 结算。
   */
  location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
  /** 绘制选项。不传 = 纯 headless */
  renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}

type RidingSettings = Omit<RidingRouteOptions, "renderOptions">;

export function useRidingRoute(options: MaybeRefOrGetter<BMapRidingRouteOptions> = {}) {
  const ctx = resolveMapContext();
  const read = (): BMapRidingRouteOptions => toValue(options) ?? {};

  const readState = (): RouteConstructionState<RidingSettings> => {
    const current = read();
    return {
      location: toValue(current.location),
      renderOptions: toValue(current.renderOptions),
      settings: {},
    };
  };

  const task = createRouteTask<
    RidingRouteResult,
    ServiceHandle<"service:riding-route">,
    RouteRequest,
    ReturnType<typeof snapshotRouteState<RidingSettings>>
  >(ctx, {
    capability: "service.riding-route",
    create: (context: ServiceInvokeContext): ServiceHandle<"service:riding-route"> => {
      const state = readState();
      return jsapiV4ServicesOf(context.client).createRidingRoute(
        requireRouteLocation(state.location, context.map, "useRidingRoute"),
        buildRouteDriverOptions(state),
      );
    },
    invoke: (context: ServiceInvokeContext, handle, request) =>
      jsapiV4ServicesOf(context.client).searchRidingRoute(handle, request),
    release: (context: ServiceInvokeContext, handle) => {
      jsapiV4ServicesOf(context.client).disposeRoute(handle);
    },
    snapshot: () => snapshotRouteState(readState()),
    sameSnapshot: sameRouteState,
  });

  /** 发起一次骑行检索：起终点是地名、`{ lng, lat }` 或 POI 引用（`{ uid, point, name? }`）。 */
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
