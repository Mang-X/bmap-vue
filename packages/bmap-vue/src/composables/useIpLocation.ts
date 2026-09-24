/**
 * useIpLocation —— IP 定位（拿到当前城市）
 *
 * 走 Driver 的归一化调用面（`driver.services.locateCity`）。`LocalCity` 失败时只回 `null`、
 * **没有公开错误码入口**，因此「查不到城市」与「服务当前不可用」都是 `empty`（`status` 为
 * `empty`、`isEmpty` 为 `true`）——本库不嗅探私有面去「还原」精确错误码。
 *
 * 需要 Map 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 */
import type { ServiceHandle } from "../driver/types/handles";
import type { LocalCityFix } from "../driver/types/services";
import { resolveMapContext } from "./resolveMapContext";
import { useServiceTask } from "./useServiceTask";
import { jsapiV4ServicesOf } from "../core/services";

export interface BMapIpLocationResult {
  /** 城市名（官方 `LocalCityResult.name`） */
  name: string;
  /**
   * 城市中心点。
   *
   * 官方声明为可选；`renderOptions.map` 缺失时运行时也不保证给（SDK 未给出时为 `null`，
   * 不伪造 `{0,0}`）。
   */
  point: { lng: number; lat: number } | null;
  /** 城市层级（官方 `LocalCityResult.level`；未传 `renderOptions.map` 时官方默认给 5） */
  level: number | null;
}

export function useIpLocation(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useServiceTask<
    LocalCityFix,
    ServiceHandle<"service:local-city">,
    [],
    BMapIpLocationResult
  >(ctx, {
      capability: "service.local-city" as const,
      create: (context) => jsapiV4ServicesOf(context.client).createLocalCity(),
      invoke: (context, handle: ServiceHandle<"service:local-city">) =>
        jsapiV4ServicesOf(context.client).locateCity(handle),
      project: (fix: LocalCityFix): BMapIpLocationResult => ({
        name: fix.name,
        point: fix.center,
        level: fix.level,
      }),
    },
  );

  const get = () => task.execute();

  return {
    location: task.data,
    data: task.data,
    result: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** `LocalCity` 没有公开状态码，恒为 `null` */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    get,
    cancel: task.cancel,
    reset: task.reset,
  };
}
