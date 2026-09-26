/**
 * 业务层公共 composable:useMap / useMapReady / useMapContext
 *
 * 让业务代码不再依赖「全局 SDK 在什么时机才挂上」。
 */
import { computed, type ComputedRef, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import type { MapReadyContext } from "../core/context/types";
import type { PublicMapContext } from "./resolveMapContext";
import { toPublicMapContext } from "./internalMapContext";

/**
 * 当前地图上下文。
 *
 * 返回**窄面**（`PublicMapContext`）而不是内部 `MapContext`（issue #160）：后者带着
 * `overlays` / `layers` / `resources` / `events` 一整套运行时，随返回值进公共声明会把
 * 二十几个内部类型报成「未导出」。字段取值一字不变，只是「调用方看得见什么」收窄了。
 */
export function useMapContext(): PublicMapContext {
  return toPublicMapContext(useRequiredMapContext());
}

export function useMapReady(): ComputedRef<boolean> {
  const ctx = useRequiredMapContext();
  return computed(() => ctx.status.value === "ready");
}

export function useMap() {
  const ctx = useRequiredMapContext();
  return {
    status: ctx.status,
    map: ctx.map,
    client: ctx.client,
    error: ctx.error,
    whenReady: ctx.whenReady,
  };
}

export type { MapReadyContext };
