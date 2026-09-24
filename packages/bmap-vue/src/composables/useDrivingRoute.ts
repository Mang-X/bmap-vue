/**
 * useDrivingRoute —— 驾车路线规划（headless，M7-ROUTES / issue #39）
 *
 * 官方 `BMap.DrivingRoute` 的 headless 封装：结果是**强类型**的方案 / 路线 / 关键点
 * （`DrivingRouteResult` → `RoutePlan` → `RouteLeg` → `RouteStep`），不提供任何 UI。
 *
 * 三条对外承诺：
 *
 * 1. **默认不绘制**。要画就必须显式给 `renderOptions.map`（本库 `MapHandle`）；那时路线与标注由
 *    服务自己画，所有权可验证——`clear()` 与组件卸载会走公开的 `clearResults()` 把它们收回；
 * 2. **驾车端点比其它三种服务窄**：官方 `DrivingRoute#search` 只接受 `Point | LocalResultPoi`
 *    （驾车没有关键字检索），传地名会以 `failed(BMAP_INVALID_ARGUMENT)` 结算；
 * 3. **只有驾车有途经点**：`search(start, end, { waypoints })`。
 *
 * 与官方 UI Kit 的分流：`RoutePlan`（`bmap-vue/ui-kit`）是标准面板，它自己发请求、自己画；
 * 本 hooks 是**完全自定义 UI** 那条路。**同一次界面操作只走其中一条**——两条都接上会让一次点击
 * 发出两次检索（见 `docs/zh-CN/hooks/useDrivingRoute.md` 的「与标准面板互斥」一节）。
 */
import { toValue, type MaybeRefOrGetter } from "vue";
import type { BMapClient } from "../client/types";
import type { Point } from "../driver/types/geometry";
import type { ServiceHandle } from "../driver/types/handles";
import type {
  DrivingPolicy,
  DrivingRouteEndpoint,
  DrivingRouteOptions,
  DrivingRouteRequest,
  DrivingRouteResult,
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

/** 驾车构造期选项；每个字段都可以是 ref / getter，**只有它们变化才重建 SDK 实例**。 */
export interface BMapDrivingRouteOptions {
  /**
   * 检索区域：城市名 / 坐标 / `MapHandle`。不传时取当前 `<Map>` 的**地图实例**（上下文注入）；
   * 在没有地图的 `<BMapProvider>` 子树里必须显式给，否则以 `failed(BMAP_INVALID_ARGUMENT)` 结算。
   */
  location?: MaybeRefOrGetter<BMapRouteLocation | undefined>;
  /** 驾车策略（`DrivingPolicy.*`），官方默认 `0`（时间最短） */
  policy?: MaybeRefOrGetter<DrivingPolicy | undefined>;
  /** 是否显示实时路况（官方 4.0 默认 `false`） */
  enableTraffic?: MaybeRefOrGetter<boolean | undefined>;
  /** 绘制选项。不传 = 纯 headless */
  renderOptions?: MaybeRefOrGetter<BMapRouteRenderOptions | undefined>;
}

/** 服务专属构造选项（`renderOptions` 由共用底座统一收口）。 */
type DrivingSettings = Omit<DrivingRouteOptions, "renderOptions">;

export function useDrivingRoute(options: MaybeRefOrGetter<BMapDrivingRouteOptions> = {}) {
  const ctx = resolveMapContext();
  const read = (): BMapDrivingRouteOptions => toValue(options) ?? {};

  /** 当前构造期状态（每次都从可能变化的 ref / getter 里读一遍）。 */
  const readState = (): RouteConstructionState<DrivingSettings> => {
    const current = read();
    const policy = toValue(current.policy);
    const enableTraffic = toValue(current.enableTraffic);
    return {
      location: toValue(current.location),
      renderOptions: toValue(current.renderOptions),
      settings: {
        ...(policy !== undefined ? { policy } : {}),
        ...(enableTraffic !== undefined ? { enableTraffic } : {}),
      },
    };
  };

  const task = createRouteTask<
    DrivingRouteResult,
    ServiceHandle<"service:driving-route">,
    DrivingRouteRequest,
    ReturnType<typeof snapshotRouteState<DrivingSettings>>
  >(ctx, {
    capability: "service.driving-route",
    create: (context: ServiceInvokeContext): ServiceHandle<"service:driving-route"> => {
      const state = readState();
      return jsapiV4ServicesOf(context.client).createDrivingRoute(
        requireRouteLocation(state.location, context.map, "useDrivingRoute"),
        buildRouteDriverOptions(state),
      );
    },
    invoke: (context: ServiceInvokeContext, handle, request) =>
      jsapiV4ServicesOf(context.client).searchDrivingRoute(handle, request),
    release: (client: BMapClient, handle) => {
      jsapiV4ServicesOf(client).disposeRoute(handle);
    },
    snapshot: () => snapshotRouteState(readState()),
    sameSnapshot: sameRouteState,
  });

  /**
   * 发起一次驾车检索。
   *
   * 起终点是 `Point`（`{ lng, lat }`）或 POI 引用（`{ uid, point, name? }`）——**不接受地名**，
   * 要按地址出发请先经 `useGeocoder` / `useLocalSearch` 拿到坐标或 POI。
   * `waypoints` **只有驾车支持**（官方 `DrivingRoute#search` 的第三个参数里只有它）。
   */
  const search = (
    start: DrivingRouteEndpoint,
    end: DrivingRouteEndpoint,
    searchOptions?: { waypoints?: readonly Point[] },
  ) =>
    task.search({
      start,
      end,
      ...(searchOptions?.waypoints !== undefined ? { waypoints: searchOptions.waypoints } : {}),
    });

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
    /** 丢弃当前实例与结果：下一次 `search` 会重建，且公开的 `clearResults()` 会收回地图上的路线与标注 */
    clear: task.clear,
    cancel: task.cancel,
    reset: task.reset,
  };
}
