/**
 * useGeocoder —— 地址解析坐标（正地址解析）
 *
 * 走 Driver 的**归一化调用面**（`driver.services.geocode` → `ServiceCall<ServiceResult>`），
 * 因此不再自己写「超时 / 空结果 / 迟到回调」三件套，也不再读 `handle.raw`（`#38` 把
 * `#23` 留下的这条欠账收口）。
 *
 * 统一状态（所有服务类 composable 一致）：`data` / `error` / `status` / `sdkStatus` /
 * `isLoading` / `supported`，全部是只读 shallow refs；`get` / `getBatch` 的参数与结果强类型，
 * `cancel()` 是**逻辑取消**（SDK 侧请求收不回，见 Driver 的 `ServiceCall.cancel`）。
 *
 * 需要 Map 上下文：`<Map>` 子树，或（client-only 服务）`<BMapProvider>` 子树——本服务
 * **不需要地图实例**，因此 Provider 子树内同样可用。
 */
import type { ServiceHandle } from "../driver/types/handles";
import { resolveMapContext } from "./resolveMapContext";
import { useServiceTask } from "./useServiceTask";
import { jsapiV4ServicesOf, runSequential, type BMapServiceStatus } from "../core/services";
import type { ServiceErrorInfo } from "../driver/types/services";

export interface GeoPoint {
  lng: number;
  lat: number;
}

/** 批量解析里单项的结果（**部分成功**的载体：每一项都有自己的终态与错误）。 */
export interface GeocodeItemResult {
  address: string;
  /** 该项成功时的坐标；非 `success` 时为 `null` */
  point: GeoPoint | null;
  status: BMapServiceStatus;
  error: ServiceErrorInfo | null;
}

export function useGeocoder(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useServiceTask<
    GeoPoint,
    ServiceHandle<"service:geocoder">,
    [string, string | undefined]
  >(ctx, {
    capability: "service.geocoder",
    create: (context) => jsapiV4ServicesOf(context.client).createGeocoder(),
    invoke: (context, handle, address, city) =>
      jsapiV4ServicesOf(context.client).geocode(
        handle,
        // `city` 是**可选**的（官方 `Geocoder#getPoint(address, cb, city?)`）：不传就是
        // 不做城市限定，而不是「参数缺失」——旧实现把它当必填并抛错，属于过头校验。
        city === undefined ? { address } : { address, city },
      ),
  });

  /** 单个地址解析。`city` 省略时由服务自行判定城市。 */
  const get = (address: string, city?: string) => task.execute(address, city);

  /**
   * 批量解析：**顺序执行、逐项保留结果**——单项失败不会丢掉其它项，也不会把整批变成失败。
   *
   * 每项带着自己的 `status` / `error` 返回，因此「部分成功」不需要调用方再回读 `data`。
   */
  function getBatch(addresses: readonly string[], city?: string): Promise<GeocodeItemResult[]> {
    return runSequential(addresses, async (address) => {
      const result = await get(address, city);
      return {
        address,
        point: result.data,
        // 用**本次调用**的结论，而不是回读 `task.status`：并发/被取代时后者可能已经是
        // 另一次调用的状态（`execute` 的返回值才是这次调用的结算）。
        status: result.status,
        error: result.error,
      };
    });
  }

  return {
    data: task.data,
    /** 定位结果别名(v2 习惯) */
    location: task.data,
    /** 点结果别名(模板 point?.lat 习惯) */
    point: task.data,
    result: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** SDK 公开的状态码；本服务没有公开错误码入口，恒为 `null` */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    get,
    getBatch,
    cancel: task.cancel,
    reset: task.reset,
  };
}
