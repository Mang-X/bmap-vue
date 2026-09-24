<script setup lang="ts">
/**
 * DistrictLayer —— 行政区划图层（官方 `BMap.DistrictLayer`，4.0）
 *
 * M7-LAYERS（#40）把它从「每个组件自己写一套 create/add/remove/watch」迁到统一内核
 * （`useLayerResource` + `LayerSpec`）：props 的投影、就地更新与重建的判据、释放顺序
 * 与其他九个图层组件完全一致。
 *
 * 行为依据（`DistrictLayer` / `DistrictLayerOptions`）：
 * - 4.0 的 `DistrictLayer` **没有任何字段级 setter**（`strokeColor` / `fillColor` / `kind` 全是
 *   构造选项）⇒ 这些 props 变化时会**重建图层**（此前是静默不生效，见 PR 的迁移影响表）；
 * - `viewport` 在 4.0 的官方声明里叫 `autoViewport`，Driver 做显式改名（不依赖未声明的别名）；
 * - 显隐走挂载状态（`addLayer` / `removeLayer`）。
 *
 * 事件（`click` / `mouseover` / `mouseout`）**保留**：4.0.4 的 `DistrictLayer` 声明里没有
 * `addEventListener`，但既有实现、文档与官方 demo 都依赖这三个事件，删除它们是与本 issue
 * 无关的破坏性变更（依据与取舍见 ADR「已知限制」）。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { pickLayerOptions } from "../../core/layers/LayerSpec";
import type { DistrictTypeValue } from "../../types/components";

export type DistrictType = DistrictTypeValue;

export interface DistrictLayerProps {
  /** 是否挂在地图上（`false` = 摘掉）。 */
  visible?: boolean;
  /** 行政区名字（必填）。 */
  name: string;
  /** 行政区类型（省 / 市 / 县区）。 */
  kind?: DistrictType;
  fillColor?: string;
  fillOpacity?: number;
  strokeColor?: string;
  strokeWeight?: number;
  strokeOpacity?: number;
  /** 是否自动聚焦地图中心到该行政区。 */
  viewport?: boolean;
  /** 掩膜内的行政区代码（4.0 构造选项 `adcode`）。 */
  adcode?: string;
}

const props = withDefaults(defineProps<DistrictLayerProps>(), {
  kind: 0,
  visible: true,
  fillColor: "#fdfd27",
  fillOpacity: 1,
  strokeWeight: 1,
  strokeOpacity: 1,
  strokeColor: "#231cf8",
  viewport: false,
});

const emit = defineEmits<{
  click: [e: unknown];
  mouseover: [e: unknown];
  mouseout: [e: unknown];
}>();

// `name` 是必填 props：投影时（即创建前）就显式失败，错误经 `resource:error` 交出，
// 而不是创建一个没有区划范围的空图层。
useLayerResource<DistrictLayerProps>(props, {
  component: "DistrictLayer",
  toSpec: (p) => {
    if (!p.name) throw new Error("DistrictLayer props.name is required");
    return {
      kind: "district",
      visible: p.visible,
      // 统一槽位：`district` 没有 opacitiy / zIndex 语义（官方只有 fillOpacity /
      // strokeOpacity），因此这里只表态 `visible`。
      options: {
        name: `(${p.name})`,
        ...pickLayerOptions(p, [
          "kind",
          "fillColor",
          "fillOpacity",
          "strokeColor",
          "strokeWeight",
          "strokeOpacity",
          "viewport",
          "adcode",
        ]),
      },
    };
  },
  bind: ({ handle, context, scope }) => {
    const events = context.client.driver.events;
    scope.add(events.on(handle, "click", (e) => emit("click", e)));
    scope.add(events.on(handle, "mouseover", (e) => emit("mouseover", e)));
    scope.add(events.on(handle, "mouseout", (e) => emit("mouseout", e)));
  },
});

defineOptions({ name: "DistrictLayer" });
</script>

<template>
  <slot />
</template>
