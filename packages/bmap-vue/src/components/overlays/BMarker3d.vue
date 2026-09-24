<script setup lang="ts">
import { watch } from "vue";
import { useOverlayResource, removeOverlay } from "../../core/composables/useOverlayResource";
import type { MapReadyContext } from "../../core/context/types";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { OverlayHandle } from "../../driver/types/handles";

/**
 * BMarker3d 迁移(adapter 模式)
 *
 * position/icon 更新走字段级 setter;height/size/fill 等属性同步。
 */
export interface Marker3dCustomIcon {
  anchor?: { x: number; y: number };
  imageOffset?: { x: number; y: number };
  imageSize: { width: number; height: number };
  imageUrl: string;
  printImageUrl?: string;
}
export type Marker3dShape = "BMAP_SHAPE_CIRCLE" | "BMAP_SHAPE_RECT";

export interface BMarker3dProps {
  position: { lng: number; lat: number };
  height: number;
  size?: number;
  shape?: Marker3dShape;
  fillColor?: string;
  fillOpacity?: number;
  icon?: Marker3dCustomIcon;
  enableMassClear?: boolean;
  visible?: boolean;
}

const props = withDefaults(defineProps<BMarker3dProps>(), {
  size: 50,
  shape: "BMAP_SHAPE_CIRCLE",
  fillColor: "#f00",
  fillOpacity: 0.8,
  enableMassClear: true,
  visible: true,
});

const emit = defineEmits<{
  click: [e: unknown];
  dblclick: [e: unknown];
  mousedown: [e: unknown];
  mouseup: [e: unknown];
  mouseout: [e: unknown];
  mouseover: [e: unknown];
  remove: [e: unknown];
  rightclick: [e: unknown];
}>();

const { resource } = useOverlayResource<BMarker3dProps, OverlayHandle>(
  props,
  {
    create: (ctx, p) =>
      ctx.client.driver.overlays.createMarker3D(p.position, p.height, {
        size: p.size,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        shape: p.shape,
        icon: p.icon,
        enableMassClear: p.enableMassClear,
      }),
    addToMap: (res, ctx, p, scope: ResourceScope) => {
      if (props.visible) ctx.client.driver.overlays.add({ kind: "map", handle: ctx.map }, res);
      const on = (name: string, h: (e: unknown) => void) => {
        scope.add(ctx.client.driver.events.on(res, name, h));
      };
      on("click", (e) => emit("click", e));
      on("dblclick", (e) => emit("dblclick", e));
      on("mousedown", (e) => emit("mousedown", e));
      on("mouseup", (e) => emit("mouseup", e));
      on("mouseout", (e) => emit("mouseout", e));
      on("mouseover", (e) => emit("mouseover", e));
      on("remove", (e) => emit("remove", e));
      on("rightclick", (e) => emit("rightclick", e));
    },
    createWatchers(getCtx, getResource, p, addDisposer) {
      addDisposer(
        watch(
          () => p.position,
          (pos) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            if (pos && typeof pos.lng === "number") ctx.client.driver.overlays.setPosition(res, pos);
          },
          { flush: "sync" },
        ),
      );
      addDisposer(
        watch(
          () => p.height,
          (h) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { height: h });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.fillColor,
          (c) => {
            const _v = c;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillColor: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.fillOpacity,
          (o) => {
            const _v = o;
            if (_v !== undefined) {
              const x = getResource();
              const ctx = getCtx();
              if (x && ctx) ctx.client.driver.overlays.setOptions(x, { fillOpacity: _v });
            }
          },
        ),
      );
      addDisposer(
        watch(
          () => p.icon,
          (icon) => {
            const res = getResource();
            const ctx = getCtx();
            if (res && ctx && icon) ctx.client.driver.overlays.setOptions(res, { icon });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.enableMassClear,
          (en) => {
            const r = getResource();
            const ctx = getCtx();
            if (r && ctx) ctx.client.driver.overlays.setOptions(r, { enableMassClear: en });
          },
        ),
      );
      addDisposer(
        watch(
          () => p.visible,
          (visible) => {
            const res = getResource();
            const ctx = getCtx();
            if (!res || !ctx) return;
            const overlays = ctx.client.driver.overlays;
            const target = { kind: "map" as const, handle: ctx.map };
            if (visible) overlays.add(target, res);
            else overlays.remove(target, res);
          },
        ),
      );
    },
    remove: (res, ctx) => removeOverlay(res, ctx),
  },
  "marker3d",
);

defineOptions({ name: "BMarker3d" });
</script>

<template>
  <slot />
</template>
