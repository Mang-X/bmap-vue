/**
 * useBMapGeolocation —— 百度 SDK 定位
 *
 * 走 Driver 的归一化调用面（`driver.services.locate`）。`Geolocation` 是**公开带状态码**的服务
 * （`getStatus()` → `BMAP_STATUS_*`），因此失败时 `status` 是 `failed`，`error.code` 与
 * `sdkStatus` 都是官方那个码——不编造、不改写。
 *
 * 需要 BMap 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 */
import type { ServiceHandle } from "../driver/types/handles";
import type { GeolocationAddressInfo, GeolocationFix } from "../driver/types/services";
import { resolveMapContext } from "./resolveMapContext";
import { useBMapServiceTask, type BMapServiceInvokeContext } from "./useBMapServiceTask";
import { jsapiV4ServicesOf } from "../core/services";

export interface BMapGeolocationOptions {
  /** 是否启用安卓定位 SDK 辅助定位（官方 `GeolocationOptions.SDKLocation`） */
  enableSDKLocation?: boolean;
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

export interface BMapGeoResult {
  point: { lng: number; lat: number };
  accuracy: number | null;
  address: GeolocationAddressInfo | null;
  /** SDK 公开的状态码文本；`success` 时恒为 `BMAP_STATUS_SUCCESS` */
  status: "BMAP_STATUS_SUCCESS";
  source: "baidu-sdk";
  timestamp: number;
}

export function useBMapGeolocation(options: BMapGeolocationOptions = {}, map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useBMapServiceTask<
    GeolocationFix,
    ServiceHandle<"service:geolocation">,
    [],
    BMapGeoResult
  >(ctx, {
      capability: "service.geolocation" as const,
      // 构造选项只在创建实例时给一次：官方入口是「构造选项 + getCurrentPosition(options)」
      create: (context: BMapServiceInvokeContext) =>
        jsapiV4ServicesOf(context.client).createGeolocation({
          enableSDKLocation: options.enableSDKLocation,
          enableHighAccuracy: options.enableHighAccuracy,
          timeout: options.timeout,
          maximumAge: options.maximumAge,
        }),
      invoke: (context: BMapServiceInvokeContext, handle: ServiceHandle<"service:geolocation">) =>
        jsapiV4ServicesOf(context.client).locate(handle, {
          enableHighAccuracy: options.enableHighAccuracy,
          timeout: options.timeout,
          maximumAge: options.maximumAge,
          SDKLocation: options.enableSDKLocation,
        }),
      // Driver 只投影 SDK 回包内容；`status` / `source` / `timestamp` 是**调用侧**的事实
      // （定位成功的时刻、来源），由这里补上——放在 Driver 里会逼它编造「回包时间」。
      project: (fix: GeolocationFix): BMapGeoResult => ({
        point: fix.point,
        accuracy: fix.accuracy,
        address: fix.address,
        status: "BMAP_STATUS_SUCCESS",
        source: "baidu-sdk",
        timestamp: Date.now(),
      }),
    },
  );

  const locate = () => task.execute();

  return {
    data: task.data,
    /** 定位结果别名(v2 习惯) */
    location: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** 官方 `BMAP_STATUS_*` 状态码（失败时带上失败码） */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    locate,
    /** v2 习惯别名 */
    get: locate,
    cancel: task.cancel,
    reset: task.reset,
  };
}
