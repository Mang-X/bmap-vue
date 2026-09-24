/**
 * useTransitRoute —— 公交路线规划（headless，M7-ROUTES / issue #39）
 *
 * 官方 `BMap.TransitRoute` 的 headless 封装。四个路线服务里它的**配置面最宽**，也是唯一一处结果
 * 与其余三个**刻意不同构**的地方：
 *
 * - 构造选项比其余三个多：市内策略（`policy`）、跨城策略（`intercityPolicy`）、跨城交通方式
 *   （`transitTypePolicy`）、每页方案数（`pageCapacity`，官方范围 1-5）、以及 `enableTraffic`；
 * - 结果是一条**乘车段 + 步行段**的序列（`TransitRoutePlan.segments`），而不是「方案 → 路线 →
 *   关键点」的树。硬套 `RoutePlan` 会逼调用方从 `description` 文本里还原换乘信息，因此 DTO 分开
 *   （见 `TransitRoutePlan` 与 `RoutePlan` 的说明）；
 * - `result.transitType` 用官方 `getTransitType()` 给出「市内 / 跨城」（其余三个服务恒为 `null`）。
 *
 * 与 `WalkingRoute` / `RidingRoute` 一样：起终点支持地名（关键字检索），**没有**途经点。
 * 共用语义见 `./routeServices.ts`。
 */
import { toValue, type MaybeRefOrGetter } from "vue";
import type { BMapClient } from "../client/types";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  IntercityPolicy,
  RouteEndpoint,
  TransitPolicy,
  TransitRouteOptions,
  TransitRouteRequest,
  TransitRouteResult,
  TransitVehiclePolicy,
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
import type { ServiceInvokeContext } from "./serviceTask";

/** 公交构造期选项；每个字段都可以是 ref / getter，**只有它们变化才重建 SDK 实例**。 */
export interface BMapTransitRouteOptions {
  /**
   * 检索区域：城市名 / 坐标 / `MapHandle`。不传时取当前 `<Map>` 的**地图实例**（上下文注入）；
   * 在没有地图的 `<BMapProvider>` 子树里必须显式给，否则以 `failed(BMAP_INVALID_ARGUMENT)` 结算。
   */
  location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
  /** 市内公交换乘策略（`TransitPolicy.*`），官方默认 `0`（推荐方案） */
  policy?: MaybeRefOrGetter<TransitPolicy | undefined>;
  /** 跨城公交换乘策略（`IntercityPolicy.*`，仅跨城检索有效） */
  intercityPolicy?: MaybeRefOrGetter<IntercityPolicy | undefined>;
  /** 跨城交通方式策略（`TransitVehiclePolicy.*`，仅跨城检索有效） */
  transitTypePolicy?: MaybeRefOrGetter<TransitVehiclePolicy | undefined>;
  /** 每页返回的方案个数（官方范围 1 - 5，超出时由 SDK 自行重置） */
  pageCapacity?: MaybeRefOrGetter<number | undefined>;
  /** 是否显示实时路况（官方 4.0 默认 `false`） */
  enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
  /** 绘制选项。不传 = 纯 headless */
  renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}

type TransitSettings = Omit<TransitRouteOptions, "renderOptions">;

export function useTransitRoute(options: MaybeRefOrGetter<BMapTransitRouteOptions> = {}) {
  const ctx = resolveMapContext();
  const read = (): BMapTransitRouteOptions => toValue(options) ?? {};

  const readState = (): RouteConstructionState<TransitSettings> => {
    const current = read();
    const policy = toValue(current.policy);
    const intercityPolicy = toValue(current.intercityPolicy);
    const transitTypePolicy = toValue(current.transitTypePolicy);
    const pageCapacity = toValue(current.pageCapacity);
    const enableTraffic = toValue(current.enableTraffic);
    return {
      location: toValue(current.location),
      renderOptions: toValue(current.renderOptions),
      settings: {
        ...(policy !== undefined ? { policy } : {}),
        ...(intercityPolicy !== undefined ? { intercityPolicy } : {}),
        ...(transitTypePolicy !== undefined ? { transitTypePolicy } : {}),
        ...(pageCapacity !== undefined ? { pageCapacity } : {}),
        ...(enableTraffic !== undefined ? { enableTraffic } : {}),
      },
    };
  };

  const task = createRouteTask<
    TransitRouteResult,
    ServiceHandle<"service:transit-route">,
    TransitRouteRequest,
    ReturnType<typeof snapshotRouteState<TransitSettings>>
  >(ctx, {
    capability: "service.transit-route",
    create: (context: ServiceInvokeContext): ServiceHandle<"service:transit-route"> => {
      const state = readState();
      return jsapiV4ServicesOf(context.client).createTransitRoute(
        requireRouteLocation(state.location, context.map, "useTransitRoute"),
        buildRouteDriverOptions(state),
      );
    },
    invoke: (context: ServiceInvokeContext, handle, request) =>
      jsapiV4ServicesOf(context.client).searchTransitRoute(handle, request),
    release: (client: BMapClient, handle) => {
      jsapiV4ServicesOf(client).disposeRoute(handle);
    },
    snapshot: () => snapshotRouteState(readState()),
    sameSnapshot: sameRouteState,
  });

  /** 发起一次公交检索：起终点是地名、`{ lng, lat }` 或 POI 引用（`{ uid, point, name? }`）。 */
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
    /** `data.transitType` 用官方 `getTransitType()` 表达市内 / 跨城（`BMAP_TRANSIT_TYPE_*`） */
    search,
    clear: task.clear,
    cancel: task.cancel,
    reset: task.reset,
  };
}
