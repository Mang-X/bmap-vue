/**
 * useBMapAreaBoundary —— 区域边界
 *
 * 走 Driver 的归一化调用面（`driver.services.queryBoundary`）。`Boundary#get` 回包的两个公开
 * 视图都在 Driver 的 DTO 里（`raw` 点串 + `rings` 坐标环），本 composable 对外的
 * `boundaries` 用的是**官方原样的点串**——`B*` 覆盖物的 `isBoundary` 直接吃它，文档示例
 * （`docs/examples/overlay/polygon/boundaries.vue`）依赖的正是这个形态。
 *
 * 需要 BMap 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 */
import { computed, type ComputedRef } from "vue";
import type { ServiceHandle } from "../driver/types/handles";
import type { BoundaryRings } from "../driver/types/services";
import { resolveMapContext } from "./resolveMapContext";
import { useBMapServiceTask } from "./useBMapServiceTask";
import { jsapiV4ServicesOf } from "../core/services";

/** 官方边界点串数组（每项形如 `"lng,lat;lng,lat;…"`）。 */
export type AreaBoundary = string[];

export function useBMapAreaBoundary(map?: unknown) {
  const ctx = resolveMapContext(map);

  const task = useBMapServiceTask<
    BoundaryRings,
    ServiceHandle<"service:boundary">,
    [string],
    AreaBoundary
  >(ctx, {
      capability: "service.boundary" as const,
      create: (context) => jsapiV4ServicesOf(context.client).createBoundary(),
      invoke: (context, handle: ServiceHandle<"service:boundary">, area: string) =>
        jsapiV4ServicesOf(context.client).queryBoundary(handle, { name: area }),
      // 对外的 `boundaries` 保持「官方点串」形态：`isBoundary` 的覆盖物读它，
      // 换成正例化的坐标环会是一次静默的破坏性变更。
      project: (rings: BoundaryRings): AreaBoundary => [...rings.raw],
    },
  );

  /** 区域边界数据；未取到（含失败 / 空结果）时是空数组，与 v2/v3 既有行为一致。 */
  const boundaries: ComputedRef<AreaBoundary> = computed(() => task.data.value ?? []);

  const get = (area: string) => task.execute(area);

  return {
    data: task.data,
    boundaries,
    error: task.error,
    isError: task.isError,
    isEmpty: task.isEmpty,
    status: task.status,
    /** `Boundary#get` 没有公开状态码入口，恒为 `null` */
    sdkStatus: task.sdkStatus,
    isLoading: task.isLoading,
    supported: task.supported,
    get,
    cancel: task.cancel,
    reset: task.reset,
  };
}
