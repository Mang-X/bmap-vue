/**
 * TargetContext
 *
 * 嵌套挂载目标的响应式表达:子资源应该挂到 Map/Marker/Clusterer/Overlay/Layer。
 * shallowRef 天然支持父资源稍晚就绪,子组件 watch target 即可原子挂载。
 */
import { inject, readonly, shallowRef, watch, type InjectionKey, type ShallowRef } from "vue";
import type { OverlayHandle, SdkHandle } from "../../driver/types/handles";

export type TargetKind = "map" | "marker" | "overlay" | "clusterer" | "layer";

export interface TargetContext {
  readonly kind: Readonly<ShallowRef<TargetKind>>;
  readonly target: Readonly<ShallowRef<SdkHandle<string> | null>>;
  add(resource: OverlayHandle): void;
  remove(resource: OverlayHandle): void;
}

export const targetContextKey: InjectionKey<TargetContext> = Symbol(
  "bmap-target-context",
);

/**
 * 读最近 TargetContext 的挂载目标:不在任何 target 下则为 null。
 * 用于 BContextMenu 等需要响应父 Marker 晚就绪的场景。
 */
export function useParentOverlayHandle(): ShallowRef<SdkHandle<string> | null> {
  const targetCtx = inject(targetContextKey, undefined);
  const out = shallowRef<SdkHandle<string> | null>(
    (targetCtx?.target.value as SdkHandle<string> | null) ?? null,
  );
  if (targetCtx) {
    watch(
      () => targetCtx.target.value,
      (v) => {
        out.value = (v as SdkHandle<string> | null) ?? null;
      },
      { immediate: true, flush: "sync" },
    );
  }
  return readonly(out) as ShallowRef<SdkHandle<string> | null>;
}
