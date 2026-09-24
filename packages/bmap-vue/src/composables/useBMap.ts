/**
 * 业务层公共 composable:useBMap / useMapReady / useBMapContext
 *
 * 让业务代码不再依赖“在哪个 initd callback 中全局 BMapGL 才存在”。
 */
import { computed, type ComputedRef, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../core/context/inject";
import type { MapReadyContext, MapRuntimeStatus } from "../core/context/types";

export function useBMapContext() {
  return useRequiredMapContext();
}

export function useMapReady(): ComputedRef<boolean> {
  const ctx = useRequiredMapContext();
  return computed(() => ctx.status.value === "ready");
}

export function useBMap() {
  const ctx = useRequiredMapContext();
  return {
    status: ctx.status,
    map: ctx.map,
    client: ctx.client,
    error: ctx.error,
    whenReady: ctx.whenReady,
  };
}

export type { MapReadyContext, MapRuntimeStatus };
