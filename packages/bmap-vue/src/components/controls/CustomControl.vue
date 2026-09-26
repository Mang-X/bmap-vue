<script setup lang="ts">
import { ref } from "vue";
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface CustomControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
}

/**
 * CustomControl —— 自定义控件（slot DOM）
 *
 * 走 `ControlSpec(kind: "custom")`：DOM 由 `render(props)` 产出的工厂负责，创建 / 挂载 /
 * 卸载 / anchor / offset / visible 与其它控件完全一致（M7-CONTROL-PANORAMA / issue #41）。
 * `createCustomControl` 的 `render` 只接收地图 DOM 容器，SDK 细节留在 Driver 内。
 */
const props = withDefaults(defineProps<CustomControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  // 控件留白口径：`offset` 是**相对锚点**的留白，不是相对容器另一侧的边距。
  // 全库统一 18px（与 `LocationControl` / `CityListControl` 一致）——
  // 此前这里是 83，对一个 32px 宽的缩放按钮而言等于把它甩到容器中间。
  offset: () => ({ x: 18, y: 18 }),
  visible: true,
});

const containerRef = ref<HTMLElement | null>(null);

const spec: ControlSpec<CustomControlProps> = {
  kind: "custom",
  options: (p) => ({ anchor: p.anchor, offset: p.offset }),
  render: () => (mapContainer: HTMLElement) => {
    const containerEl = containerRef.value;
    if (!containerEl) return mapContainer;
    return mapContainer.appendChild(containerEl as Node) as HTMLElement;
  },
};

useControlResource(props, spec);

defineOptions({ name: "CustomControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
