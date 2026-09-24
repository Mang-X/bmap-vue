/**
 * M3: MapContext provide/inject 接线
 *
 * parent 层(最近 BMap)创建 MapRuntime 并通过 mapContextKey provide,
 * 子组件通过 useRequiredMapContext 取得,取得不到时给出明确错误。
 */
import { inject, type InjectionKey, type ShallowRef } from "vue";
import { mapContextKey, type MapContext } from "./types";
import { BMapError } from "../errors/BMapError";

export function useRequiredMapContext(): MapContext {
  const ctx = inject(mapContextKey, undefined);
  if (!ctx) {
    throw new BMapError(
      "BMAP_PARENT_CONTEXT_MISSING",
      "Component must be a descendant of <BMap>. Use the component inside a <BMap> root.",
    );
  }
  return ctx;
}

export function useOptionalMapContext(): MapContext | undefined {
  return inject(mapContextKey, undefined);
}

export const mapContextInjectionKey: InjectionKey<MapContext> = mapContextKey;

export type { ShallowRef };
