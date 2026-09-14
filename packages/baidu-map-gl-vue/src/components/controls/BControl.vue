<script setup lang="ts">
import { watch, ref } from "vue";
import { useControlResource } from "../../core/composables/useControlResource";
import type { ResourceScope } from "../../core/lifecycle/ResourceScope";
import type { ControlHandle } from "../../driver/types/handles";

/**
 * BControl —— 自定义控件(slot DOM)
 *
 * 创建 BMap.Control,把 slot 容器 append 到地图容器,
 * anchor/offset/visible 与其他 Control 一致(useControlResource)。
 */

export interface BControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

const props = withDefaults(defineProps<BControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const containerRef = ref<HTMLElement | null>(null);

const { resource } = useControlResource<BControlProps, ControlHandle>(props, {
  create: (ctx, p) =>
    ctx.client.driver.controls.createCustomControl({
      anchor: p.anchor,
      offset: p.offset,
      render: (mapContainer) => {
        const containerEl = containerRef.value;
        if (!containerEl) return mapContainer;
        return mapContainer.appendChild(containerEl as Node) as HTMLElement;
      },
    }),
  addToMap: (res, ctx, p, scope: ResourceScope) => {
    if (props.visible) ctx.client.driver.controls.add({ kind: "map", handle: ctx.map }, res);
  },
  createWatchers(getCtx, getResource, p, addDisposer) {
    addDisposer(
      watch(
        () => p.visible,
        (v) => {
          const res = getResource();
          const ctx = getCtx();
          if (!res || !ctx) return;
          const controls = ctx.client.driver.controls;
          const target = { kind: "map" as const, handle: ctx.map };
          if (v) controls.add(target, res);
          else controls.remove(target, res);
        },
      ),
    );
  },
  remove: (res, ctx) => {
    ctx.client.driver.controls.remove({ kind: "map", handle: ctx.map }, res);
  },
});

defineOptions({ name: "BControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
