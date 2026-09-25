/**
 * 业务层公共 composable:useMap / useMapReady / useMapContext
 *
 * 让业务代码不再依赖「全局 SDK 在什么时机才挂上」。
 */
import { computed, type ComputedRef, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import type { MapReadyContext } from "../core/context/types";

export function useMapContext() {
  return useRequiredMapContext();
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
