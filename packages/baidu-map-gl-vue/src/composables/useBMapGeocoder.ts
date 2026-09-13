/**
 * useBMapGeocoder —— 地址解析坐标
 *
 * 基于 useBMapAsyncTask 的统一异步状态,支持:
 * - 单个地址解析
 * - 批量地址解析(部分失败可表达:每项 result/error)
 *
 * 需要 BMap child context(经 ctx.whenReady 获取 client)。
 */
import { computed } from "vue";
import { resolveMapContext } from "./resolveMapContext";
import { SERVICE_TIMEOUT_MS, useBMapAsyncTask, withServiceTimeout } from "./useBMapAsyncTask";
import { BMapError } from "../core/errors/BMapError";

export interface GeoPoint {
  lng: number;
  lat: number;
}

export interface GeocodeItemResult {
  address: string;
  point: GeoPoint | null;
  error?: unknown;
}

export function useBMapGeocoder(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useBMapAsyncTask<GeoPoint | null, [string, string]>({
    immediate: false,
    runner: async (_taskContext, address: string, city: string) => {
      if (!address)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: address");
      if (!city)
        throw new BMapError("BMAP_RESOURCE_CREATE_FAILED", "missing required params: city");
      const ready = await ctx.whenReady();
      const geocoder = ready.client.driver.services.createGeocoder();
      const raw = geocoder.raw as {
        getPoint(
          address: string,
          cb: (p: { lng: number; lat: number } | null) => void,
          city: string,
        ): void;
      };
      // 服务失败（如配额 302 / Referer 限制）时官方**只回 null**，且没有公开的错误码入口——
      // 服务端错误码在 JSONP 私有回调注册表里。R25-C / #72 的处置：不嗅探私有面、不编造精确
      // 错误码，把 null 如实归一成 `null`（调用方的 `isEmpty` 为 true），让「没有结果或服务当前
      // 不可用」保持可区分于「超时」（超时仍由 withServiceTimeout 报出）。
      const point = await withServiceTimeout<GeoPoint | null>(
        (done) => {
          const onResult = (p: { lng: number; lat: number } | null) => {
            if (p) {
              done({ lng: p.lng, lat: p.lat });
              return;
            }
            done(null);
          };
          raw.getPoint(address, onResult, city);
        },
        SERVICE_TIMEOUT_MS,
        "Geocoder.getPoint",
      );
      return point;
    },
  });

  /** 批量解析,部分失败保留每项结果 */
  async function getBatch(addresses: string[], city: string): Promise<GeocodeItemResult[]> {
    const results: GeocodeItemResult[] = [];
    for (const address of addresses) {
      try {
        const point = await task.execute(address, city);
        const error = task.error.value;
        if (error) throw error;
        results.push({ address, point });
      } catch (err) {
        results.push({ address, point: null, error: err });
      }
    }
    return results;
  }

  return {
    data: task.data,
    /** 定位结果别名(v2 习惯) */
    location: task.data,
    /** 点结果别名(模板 point?.lat 习惯) */
    point: task.data,
    result: task.data,
    error: task.error,
    isError: computed(() => task.status.value === "error"),
    isEmpty: computed(() => task.data.value === null),
    status: task.status,
    isLoading: task.isLoading,
    get: task.execute,
    getBatch,
    cancel: task.cancel,
    reset: task.reset,
  };
}
