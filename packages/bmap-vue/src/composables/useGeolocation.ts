/**
 * useGeolocation —— 百度 SDK 定位
 *
 * 走 Driver 的归一化调用面（`driver.services.locate`）。`Geolocation` 是**公开带状态码**的服务
 * （`getStatus()` → `BMAP_STATUS_*`），因此失败时 `status` 是 `failed`，`error.code` 与
 * `sdkStatus` 都是官方那个码——不编造、不改写。
 *
 * 需要 Map 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 *
 * ## 与官方 `BMap.Geolocation` 的成员处置（issue #165）
 *
 * 官方声明的方法成员只有四个，逐个核对（反射断言见 `tests/behavior/useGeolocation.test.ts`）：
 *
 * | 官方成员 | 处置 |
 * | --- | --- |
 * | `getCurrentPosition(callback, opts?)` | **对齐**——同名，且接受官方 `PositionOptions`（可逐次覆盖） |
 * | `getStatus(): ServiceStatus` | **对齐**——Driver 的 `readServiceStatus` 真的读了它，落在 `sdkStatus` |
 * | `enableSDKLocation()` | **不暴露**，理由见下方「为什么没有 `enableSDKLocation` / `disableSDKLocation`」 |
 * | `disableSDKLocation()` | **不暴露**，同上 |
 *
 * 公开面**只有** `getCurrentPosition` 一个方法名：官方的回调形态由 `search` 那套
 * 「恒 resolve 的 Promise + 状态口径」承担（`result` 恒有值，不需要用回调读成败）。
 *
 * ## 为什么没有 `enableSDKLocation` / `disableSDKLocation`
 *
 * 两个理由，任一独立成立：
 *
 * 1. **语义已经被覆盖**。`SDKLocation` 是官方 `PositionOptions` 的**构造成员**（本库的
 *    `BMapGeolocationOptions` 逐个原样透传，见下），「是否开启 SDK 辅助定位」这个决定在**创建
 *    实例时**就已经做出；不设它即为关闭。要改这个决定，官方路径是换构造选项——本库换构造选项
 *    会重建实例（见 `serviceTask` 的 Client 缓存口径），代价是可控且有意义的。
 * 2. **方法形态在禁区里无法正确实现**。这两个方法作用在**某个具体 `Geolocation` 实例**上，而
 *    `useSimpleServiceTask` 走**无状态**实例通道——句柄不向 composable 暴露（`invalidateService`
 *    只在独占档有，见 `core/services/instanceChannel.ts`）。要在禁区里实现它，只能读 `handle.raw`
 *    （service composable 硬约束：禁止）或调一个尚不存在的 Driver 成员。
 *
 * 因此本库**不加**这两个方法：加一个空实现、或接受参数后静默忽略，都是  禁止的
 * 「制造支持外观的假支持」。需要改这个开关时，新建一个 hook 实例。
 */
import type { ServiceHandle } from "../driver/types/handles";
import type {
  GeolocationAddressInfo,
  GeolocationFix,
  GeolocationOptions,
} from "../driver/types/services";
import { resolveInternalMapContext } from "./resolveMapContext";
import { useSimpleServiceTask, type ServiceInvokeContext } from "./serviceTask";
import { jsapiV4ServicesOf } from "../core/services";

/**
 * 定位构造期选项 = 官方 `BMap.PositionOptions` 的**逐个**投影。
 *
 * 成员名与官方**完全一致**（含 `SDKLocation` 这个略反直觉的名字），不做「可读性改名」：
 * Driver 把这一份原样交给 `new Geolocation(options)`，改名的结果是 SDK 侧静默丢弃该选项——
 * 那是假支持，不是友好命名。（反射断言逐个比对官方声明，见 `useGeolocation.test.ts`。）
 */
export type BMapGeolocationOptions = GeolocationOptions;

export interface BMapGeoResult {
  point: { lng: number; lat: number };
  accuracy: number | null;
  address: GeolocationAddressInfo | null;
  /** SDK 公开的状态码文本；`success` 时恒为 `BMAP_STATUS_SUCCESS` */
  status: "BMAP_STATUS_SUCCESS";
  source: "baidu-sdk";
  /**
   * 设备定位时刻（官方 `GeolocationResult.timestamp`），**不是**结果到达调用方的时刻。
   *
   * 官方把它标成可选，回包没带时这里就是 `null`——不用 `Date.now()` 兜底：那会把
   * 「什么时候看到结果」冒充成「什么时候定位的」，两者在缓存命中时可差很远。
   */
  timestamp: number | null;
  /** 海拔（米）；设备不支持时为 `null`（同官方） */
  altitude: number | null;
  /** 海拔精度（米）；设备不支持时为 `null`（同官方） */
  altitudeAccuracy: number | null;
  /** 设备朝向（正北顺时针角度）；设备不支持时为 `null`（同官方） */
  heading: number | null;
  /** 移动速度（米/秒）；设备不支持时为 `null`（同官方） */
  speed: number | null;
}

export function useGeolocation(options: BMapGeolocationOptions = {}, map?: unknown) {
  const ctx = resolveInternalMapContext(map);

  const task = useSimpleServiceTask<
    GeolocationFix,
    ServiceHandle<"service:geolocation">,
    [GeolocationOptions?],
    BMapGeoResult
  >(ctx, {
      capability: "service.geolocation" as const,
      // 构造选项只在创建实例时给一次：官方入口是「构造选项 + getCurrentPosition(options)」
      // 这里原样透传（含官方键名 `SDKLocation`）：**不能**把 `enableSDKLocation` 之类的
      // 「可读性改名」透给 SDK——SDK 侧只认官方键名，改名等于静默丢弃该选项。
      create: (context: ServiceInvokeContext) =>
        jsapiV4ServicesOf(context.client).createGeolocation({ ...options }),
      invoke: (
        context: ServiceInvokeContext,
        handle: ServiceHandle<"service:geolocation">,
        override?: GeolocationOptions,
      ) =>
        jsapiV4ServicesOf(context.client).locate(
          handle,
          // 逐次选项**覆盖**构造选项（官方 `getCurrentPosition(callback, opts?)` 的第二个参数
          // 就是这一层）；没传的项落回构造期的取值。两个对象各自都是**稀疏**的，因此
          // 「覆盖」必须按字段判定——整体替换会让不传的项退化成 SDK 的默认值，
          // 表现为「构造时设的 timeout 突然不生效」。
          { ...options, ...override },
        ),
      // `status` / `source` 是**调用侧**的事实（公开状态码文本、来源），由这里补上；
      // 其余字段（`timestamp` / `altitude` / `heading` / `speed` / `address`）一律
      // 来自 Driver 对 SDK 回包的投影——包括 `timestamp`：它是官方的「设备定位时刻」，
      // 之前在这里写 `Date.now()` 是编造一个回包里没有的值。
      project: (fix: GeolocationFix): BMapGeoResult => ({
        point: fix.point,
        accuracy: fix.accuracy,
        address: fix.address,
        status: "BMAP_STATUS_SUCCESS",
        source: "baidu-sdk",
        timestamp: fix.timestamp,
        altitude: fix.altitude,
        altitudeAccuracy: fix.altitudeAccuracy,
        heading: fix.heading,
        speed: fix.speed,
      }),
    },
  );

  return {
    data: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** 官方 `Geolocation#getStatus()` 的返回值（`BMAP_STATUS_*`；拿不到时为 `null`） */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    /**
     * 官方 `Geolocation#getCurrentPosition(callback, opts?)` 的 Promise 形态。
     *
     * `opts` 是官方 `PositionOptions` 的子集，**逐次覆盖**构造期取值。
     */
    getCurrentPosition: task.execute,
    cancel: task.cancel,
    reset: task.reset,
  };
}
