/**
 * 内部接线用的 `MapContext` 入口
 *
 * 对外的 `resolveMapContext()` / `useMapContext()` 只返回窄面 `PublicMapContext`；
 * 组件与 serviceTask 需要的**完整** `MapContext`（`overlays` / `layers` / `resources` /
 * `events`）是本库自己的运行时。
 *
 * ⚠️ 本模块**刻意独立**、不被 `./composables` 入口转出：`resolveMapContext.ts` 里
 * `export` 它就会把整条内层闭包（`MapRuntimeShape` → `MapDriver` / `OverlayDriver` …
 * 二十几个）写进 `dist/composables.d.ts`，`check:api` 的 `ae-forgotten-export` 会逐个点名。
 * **新增需要完整上下文的库内代码时，从这里 import。**
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
 * ⚠️ 本目录**不**允许出现官方 UI Kit 的任何痕迹：服务类 composable 走 headless 请求
 * 通道、标准 UI 走官方 UI Kit，同一次交互只发一条请求——分流由
 * `tests/behavior/useRoutes.test.ts` 断言。
 */
export type { MapContext, MapReadyContext, MapRuntimeShape } from "../core/context/types";