/**
 * useAreaBoundary —— 区域边界
 *
 * 走 Driver 的归一化调用面（`driver.services.queryBoundary` / `parseBoundaryString`）。
 * `Boundary#get` 回包的两个公开视图都在 Driver 的 DTO 里（`raw` 点串 + `rings` 坐标环），
 * 本 composable 对外的 `boundaries` 用的是**官方原样的点串**——`B*` 覆盖物的 `isBoundary`
 * 直接吃它，文档示例（`docs/examples/overlay/polygon/boundaries.vue`）依赖的正是这个形态。
 *
 * 官方的**两个成员**都有出口：`get(area)`（`Boundary#get`）与 `parsebdStr(str)`
 * （`Boundary#parsebdStr`，本地解析混淆坐标串，不发网络请求）。两者回包同形，共用一份 `data`。
 *
 * 需要 Map 上下文；本服务只需要 Client（`<BMapProvider>` 子树亦可）。
 */
import { computed, type ComputedRef } from "vue";
import type { ServiceHandle } from "../driver/types/handles";
import type { BoundaryRings } from "../driver/types/services";
import { resolveInternalMapContext } from "./resolveMapContext";
import { useSimpleServiceTask } from "./serviceTask";
import { jsapiV4ServicesOf } from "../core/services";

/** 官方边界点串数组（每项形如 `"lng,lat;lng,lat;…"`）。 */
export type AreaBoundary = string[];

/**
 * 边界服务的两个官方成员各发一种请求：`Boundary#get(name)` 与 `Boundary#parsebdStr(str)`。
 *
 * 两者回包同形（`BoundaryResult`），因此共用一个任务与一份 `data` —— `parsebdStr` 的结果同样
 * 落在 `data` / `boundaries` 上，语义与官方「两个成员都产出 `BoundaryResult`」一致。
 */
type AreaBoundaryRequest =
  | { readonly kind: "get"; readonly name: string }
  | { readonly kind: "parse"; readonly str: string };

export function useAreaBoundary(map?: unknown) {
  const ctx = resolveInternalMapContext(map);

  const task = useSimpleServiceTask<
    BoundaryRings,
    ServiceHandle<"service:boundary">,
    [AreaBoundaryRequest],
    AreaBoundary
  >(ctx, {
      capability: "service.boundary" as const,
      create: (context) => jsapiV4ServicesOf(context.client).createBoundary(),
      invoke: (context, handle: ServiceHandle<"service:boundary">, request: AreaBoundaryRequest) => {
        const services = jsapiV4ServicesOf(context.client);
        return request.kind === "get"
          ? services.queryBoundary(handle, { name: request.name })
          : services.parseBoundaryString(handle, { str: request.str });
      },
      // 对外的 `boundaries` 保持「官方点串」形态：`isBoundary` 的覆盖物读它，
      // 换成正例化的坐标环会是一次静默的破坏性变更。
      project: (rings: BoundaryRings): AreaBoundary => [...rings.raw],
    },
  );

  /** 区域边界数据；未取到（含失败 / 空结果）时是空数组，与既有行为一致。 */
  const boundaries: ComputedRef<AreaBoundary> = computed(() => task.data.value ?? []);

  const get = (area: string) => task.execute({ kind: "get", name: area });

  /** 解析混淆后的百度坐标串（官方 `Boundary#parsebdStr`），结果落在同一份 `data` / `boundaries`。 */
  const parsebdStr = (str: string) => task.execute({ kind: "parse", str });

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
    parsebdStr,
    cancel: task.cancel,
    reset: task.reset,
  };
}
