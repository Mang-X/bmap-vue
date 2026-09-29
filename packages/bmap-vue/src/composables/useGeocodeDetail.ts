/**
 * useGeocodeDetail —— 坐标点反查地址详情（逆地址解析）
 *
 * 走 Driver 的归一化调用面（`driver.services.reverseGeocode`），不再读 `handle.raw`。
 * 结果里 **`addressComponents` 与 `surroundingPois` 都是真的投影过的字段**——`#38` 之前 Driver
 * 的 DTO 只暴露了 `poiCount`，结构化的地址与 POI 列表被静默丢弃。
 *
 * 命名对齐官方 `BMap.Geocoder`（#165）：动作叫 `getLocation`，结果**只有** `data` 一个读取口
 * （原 `result` 别名已删）。逆解析的官方成员名就是这个——正解析在 `useGeocoder().getPoint`。
 *
 * 需要 Map 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 */
import type { ServiceHandle } from "../driver/types/handles";
import type {
  GeocodedAddress,
  GeocodedAddressComponents,
  LocalSearchPoi,
  ServiceErrorInfo,
} from "../driver/types/services";
import { resolveInternalMapContext } from "./resolveMapContext";
import { useSimpleServiceTask } from "./serviceTask";
import { jsapiV4ServicesOf, runSequential, type BMapServiceStatus } from "../core/services";
import type { GeoPoint } from "./useGeocoder";

export interface GeocodeDetailAddressComponents {
  city: string;
  district: string;
  province: string;
  street: string;
  streetNumber: string;
}

export interface GeocodeDetailResult {
  point: GeoPoint;
  address: string;
  addressComponents: GeocodeDetailAddressComponents;
  /** 附近的 POI（领域投影，不只是坐标） */
  surroundingPois: readonly LocalSearchPoi[];
  business: string;
}

/** 批量反查里单项的结果（**部分成功**的载体）。 */
export interface GeocodeDetailItemResult {
  point: GeoPoint;
  detail: GeocodeDetailResult | null;
  status: BMapServiceStatus;
  error: ServiceErrorInfo | null;
}

/**
 * 把 Driver 的 `addressComponents`（缺项为 `null`）摊平成旧版形态（缺项为空串）。
 *
 * 旧版承诺「总有这五个字符串」，`docs/zh-CN/hooks/useGeocodeDetail.md` 的示例按它写，
 * 这里保持兼容；Driver 层则保留 `null`——只有 `null` 才表达「官方没给这个字段」。
 */
function toComponents(
  components: GeocodedAddressComponents | undefined,
): GeocodeDetailAddressComponents {
  return {
    city: components?.city ?? "",
    district: components?.district ?? "",
    province: components?.province ?? "",
    street: components?.street ?? "",
    streetNumber: components?.streetNumber ?? "",
  };
}

/** Driver 结果 → 对外详情形态（回包没有坐标时回退到请求坐标，而不是伪造 `0/0`）。 */
function toDetail(address: GeocodedAddress, requested: GeoPoint): GeocodeDetailResult {
  return {
    point: address.point ?? { lng: requested.lng, lat: requested.lat },
    address: address.address,
    addressComponents: toComponents(address.addressComponents),
    surroundingPois: address.surroundingPois,
    business: address.business ?? "",
  };
}

export function useGeocodeDetail(map?: unknown) {
  const ctx = resolveInternalMapContext(map);

  const task = useSimpleServiceTask<
    GeocodedAddress,
    ServiceHandle<"service:geocoder">,
    [GeoPoint],
    GeocodeDetailResult
  >(ctx, {
    capability: "service.geocoder",
    create: (context) => jsapiV4ServicesOf(context.client).createGeocoder(),
    invoke: (context, handle, point) =>
      jsapiV4ServicesOf(context.client).reverseGeocode(handle, { point }),
    project: (address, requested) => toDetail(address, requested),
  });

  /**
   * 坐标 → 地址详情（官方 `Geocoder#getLocation`）。
   *
   * **恒 resolve 成 `ServiceResult`**（与其它服务的动作一致）：失败/超时/取消都在返回值里，
   * 不 reject；`point` 非法时是 `failed(BMAP_INVALID_ARGUMENT)`，同样不抛错。
   *
   * 命名对齐官方（#165）：正解析在 `useGeocoder().getPoint`，逆解析在这里的 `getLocation`
   * ——官方 `Geocoder` 的两个成员各有一个同名入口，调用方不必记「哪个 hook 叫什么」。
   */
  const getLocation = (point: GeoPoint) => task.execute(point);

  /**
   * 批量反查：顺序执行、逐项保留结果与终态。
   *
   * 与 `getLocation()` 的区别是**不吞掉失败**——单项失败时 `detail` 为 `null`，调用方从
   * `status` / `error` 知道原因（「部分成功」的表达方式）。
   */
  function getBatch(points: readonly GeoPoint[]): Promise<GeocodeDetailItemResult[]> {
    return runSequential(points, async (point) => {
      const result = await task.execute(point);
      return {
        point,
        detail: result.data,
        // 用本次调用的结论，不回读 `task.status`（并发时它可能已属于另一次调用）
        status: result.status,
        error: result.error,
      };
    });
  }

  return {
    /** 逆地址解析的唯一结果读取口（地址详情） */
    data: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** `Geocoder#getLocation` 没有公开状态码入口，恒为 `null` */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    getLocation,
    getBatch,
    cancel: task.cancel,
    reset: task.reset,
  };
}
