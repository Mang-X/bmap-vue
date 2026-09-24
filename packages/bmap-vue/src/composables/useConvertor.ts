/**
 * useConvertor —— 坐标转换
 *
 * 走 Driver 的归一化调用面（`driver.services.convert`）：失败/超时/取消/非法参数都由
 * `ServiceResult` 表达，不再自己拼 Promise 与超时。
 *
 * 需要 Map 上下文；本服务只需要 Client。
 *
 * `CoordinatesFromType` / `CoordinatesToType` 是 v2 遗留的**数值枚举**（官方
 * `Convertor#translate` 收的就是数值），因此这里继续导出同名常量以保证既有代码可编译：
 * 数值本身由官方定义，本库不另立取值域。
 */
import type { ServiceHandle } from "../driver/types/handles";
import { resolveMapContext } from "./resolveMapContext";
import { useServiceTask } from "./useServiceTask";
import { jsapiV4ServicesOf } from "../core/services";
import type { CoordinateFromType, CoordinateToType } from "../driver/types/services";
import type { GeoPoint } from "./useGeocoder";

export enum CoordinatesFromType {
  COORDINATES_WGS84 = 1,
  COORDINATES_WGS84_MC = 2,
  COORDINATES_GCJ02 = 3,
  COORDINATES_GCJ02_MC = 4,
  COORDINATES_BD09 = 5,
  COORDINATES_BD09_MC = 6,
  COORDINATES_MAPBAR = 7,
  COORDINATES_51 = 8,
}

export enum CoordinatesToType {
  COORDINATES_GCJ02 = 3,
  COORDINATES_BD09 = 5,
  COORDINATES_BD09_MC = 6,
}

export type { GeoPoint };

export function useConvertor(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useServiceTask<
    GeoPoint[],
    ServiceHandle<"service:convertor">,
    [readonly GeoPoint[], CoordinatesFromType, CoordinatesToType],
    GeoPoint[]
  >(ctx, {
    capability: "service.convertor",
    create: (context) => jsapiV4ServicesOf(context.client).createConvertor(),
    invoke: (context, handle, points, from, to) =>
      jsapiV4ServicesOf(context.client).convert(handle, {
        points,
        from: from as CoordinateFromType,
        to: to as CoordinateToType,
      }),
  });

  /** 坐标互转。`points` / `from` / `to` 的非法取值由 Driver 以 `failed(BMAP_INVALID_ARGUMENT)` 结算。 */
  const convert = (points: readonly GeoPoint[], from: CoordinatesFromType, to: CoordinatesToType) =>
    task.execute(points, from, to);

  return {
    data: task.data,
    /** 结果别名(v2 习惯) */
    result: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** `Convertor#translate` 回包的公开状态码（0 = 成功） */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    convert,
    /** v2 习惯别名 */
    get: convert,
    cancel: task.cancel,
    reset: task.reset,
  };
}
