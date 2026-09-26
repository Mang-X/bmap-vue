/**
 * 内部接线用的 `MapContext` 入口（issue #160）
 *
 * ## 为什么不放在 `resolveMapContext.ts` 里
 *
 * `resolveMapContext()` / `useMapContext()` 对外只返回窄面 `PublicMapContext`（见
 * `resolveMapContext.ts` 的文件头）。组件与 serviceTask 需要的**完整** `MapContext`
 * （`overlays` / `layers` / `resources` / `events`）是本库自己的运行时。
 *
 * 把它放在**独立模块**里，是因为 `./composables` 的入口用 `export * from` 逐个转出：
 * 只要 `resolveMapContext.ts` 里 `export` 了它，`dist/composables.d.ts` 就会把它连同
 * `MapContext` 与整条内层闭包（`MapRuntimeShape` → `MapDriver` / `OverlayDriver` /
 * `ServiceDriver` …，二十几个）一起写进公共声明，`check:api` 的 `ae-forgotten-export`
 * 随即逐个点名。独立模块不被入口转出，运行时依赖就留在库内。
 *
 * 因此：**新增需要完整上下文的库内代码时，从这里 import，不要从 `resolveMapContext` 转出。**
 */
import type { MapContext } from "../core/context/types";
import { resolveInternalMapContext as resolveInternal, toPublicMapContext as toPublic } from "./resolveMapContext";

/**
 * 解析当前地图上下文，**库内专用**（组件 / composable / serviceTask 用）。
 *
 * 收窄只发生在公共出口那侧（`resolveMapContext()` 返回 `PublicMapContext`）；运行时
 * 对象始终是完整 `MapContext`，所以这里直接透传，不做任何投影。
 */
export function resolveInternalMapContext(map?: unknown): MapContext {
  return resolveInternal(map);
}

/** 完整 `MapContext` → 对外窄面。`useMap()` / `resolveMapContext()` 都经它收口。 */
export function toPublicMapContext(context: MapContext): ReturnType<typeof toPublic> {
  return toPublic(context);
}


/**
 * 当前地图上下文（库内接线用，**完整** `MapContext`）。
 *
 * 组件、`serviceTask`、路线 / 服务 composable 都要读 `overlays` / `layers` /
 * `resources` / `events` —— 那是本库自己的运行时。对外的 `resolveMapContext()` /
 * `useMapContext()` 返回窄面 `PublicMapContext`（见 `resolveMapContext.ts`）。
 *
 * ⚠️ 门禁：本目录**不**允许出现官方 UI Kit 的任何痕迹。服务类 composable 走 headless
 * 请求通道、标准 UI 走官方 UI Kit，同一次交互只发一条请求 —— 这条分流由
 * `tests/behavior/useRoutes.test.ts` 断言（含正证），本文件是那条判定的对象之一。
 */
export type { MapContext, MapReadyContext, MapRuntimeShape } from "../core/context/types";

