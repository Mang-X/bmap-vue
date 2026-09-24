/**
 * usePanoramaService —— 全景数据检索（官方 `BMap.PanoramaService`）
 *
 * M7-CONTROL-PANORAMA / issue #41 实施步骤 5「实现 PanoramaService callback 状态层」。
 *
 * 不自己写请求框架：超时 / 空结果 / 迟到回调 / 取消 / 先到者胜全部由 Driver 的
 * `createServiceCall` 负责，本文件只声明「这个服务是什么」（与其余七个服务 composable
 * 共用 `useServiceTask`）。
 *
 * 两处口径：
 * - **官方只有两个检索入口**（`getPanoramaById` / `getPanoramaByLocation`）。参考实现
 *   `huiyan-fe/react-bmap` 额外暴露了 `getPanoramaByPOIId`，但 `@baidumap/jsapi-v4-types@4.0.4`
 *   里**没有**这个成员——按仓库既有口径（不为上游没有的成员建模）**不暴露**。
 * - 「查不到全景」是 `empty` 而不是 `failed`：官方在查不到时回调参数是 `null`（不是错误），
 *   `empty` 与 `failed` 的区别正是调用方能不能重试。
 *
 * 需要 Map 上下文：`<Map>` 子树，或（client-only 服务）`<BMapProvider>` 子树——本服务
 * **不需要地图实例**，也不需要 `<Panorama>`（检索回来的 id 可以交给任何查看器使用）。
 */
import type { PanoramaDataInfo, PanoramaServiceHandle } from "../driver/types/panorama";
import type { Point } from "../driver/types/geometry";
import { jsapiV4PanoramaOf } from "../core/panorama";
import { resolveMapContext } from "./resolveMapContext";
import { useServiceTask } from "./useServiceTask";

/** 一次检索请求（内部判别式联合：两种检索只差参数形状，共用同一份状态）。 */
type PanoramaSearchRequest =
  | { readonly mode: "id"; readonly id: string }
  | { readonly mode: "location"; readonly position: Point; readonly radius?: number };

export function usePanoramaService(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useServiceTask<
    PanoramaDataInfo,
    PanoramaServiceHandle,
    [PanoramaSearchRequest]
  >(ctx, {
    capability: "panorama.service",
    create: (context) => jsapiV4PanoramaOf(context.client).createService(),
    invoke: (context, handle, request) => {
      const driver = jsapiV4PanoramaOf(context.client);
      return request.mode === "id"
        ? driver.findById(handle, request.id)
        : // `radius` 省略时不给：官方的重载是 `(point, cb)` 与 `(point, radius, cb)`，
          // 传 `undefined` 与省略在真实 SDK 上是两条不同的调用路径。
          driver.findByLocation(handle, request.position, request.radius);
    },
  });

  /** 按全景 id 检索；查不到时 `status === "empty"` 且 `data === null`。 */
  const findById = (id: string) => task.execute({ mode: "id", id });

  /** 按坐标检索（半径默认 50 米，由 SDK 决定）。 */
  const findByLocation = (position: Point, radius?: number) =>
    task.execute({ mode: "location", position, radius });

  return {
    data: task.data,
    /** 结果别名（模板里 `result?.description` 的习惯） */
    result: task.data,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** SDK 公开的状态码；官方该服务没有状态码入口，恒为 `null`（不伪装成 0） */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    findById,
    findByLocation,
    cancel: task.cancel,
    reset: task.reset,
  };
}
