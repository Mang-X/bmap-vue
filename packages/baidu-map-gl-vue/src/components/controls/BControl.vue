<script setup lang="ts">
import { ref } from "vue";
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface BControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * BControl —— 自定义控件（slot DOM）
 *
 * 走 `ControlSpec(kind: "custom")`：DOM 由 `render(props)` 产出的工厂负责，创建 / 挂载 /
 * 卸载 / anchor / offset / visible 与其它控件完全一致（M7-CONTROL-PANORAMA / issue #41）。
 * `createCustomControl` 的 `render` 只接收地图 DOM 容器，SDK 细节留在 Driver 内。
 */
const props = withDefaults(defineProps<BControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 83, y: 18 }),
  visible: true,
});

const containerRef = ref<HTMLElement | null>(null);

const spec: ControlSpec<BControlProps> = {
  kind: "custom",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
  render: () => (mapContainer: HTMLElement) => {
    const containerEl = containerRef.value;
    if (!containerEl) return mapContainer;
    return mapContainer.appendChild(containerEl as Node) as HTMLElement;
  },
};

useControlResource(props, spec);

defineOptions({ name: "BControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
