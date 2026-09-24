<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface MapTypeControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  /** 控件样式，官方 `BMAP_MAPTYPE_CONTROL_*`（MAP / DROPDOWN / HORIZONTAL，只有构造期生效） */
  type?: string;
  /** 展示的地图类型列表，官方 `BMAP_*_MAP`（只有构造期生效） */
  mapTypes?: readonly number[];
  /** 是否显示路网层（官方 `showStreetLayer(isShow)`，可就地更新） */
  showStreetLayer?: boolean;
  visible?: boolean;
}

/**
 * MapTypeControl —— 地图类型切换控件（官方 `MapTypeControl`）
 *
 * M7-CONTROL-PANORAMA / issue #41。
 *
 * 三个选项的落地方式刻意分两档，依据是官方 4.0.4 声明的实例方法表：
 * - `showStreetLayer` → `showStreetLayer(isShow)`：**唯一**的字段级 setter，就地更新
 *   （它的成员名不是 `set<Key>` 形状，因此必须显式登记进 Driver 的分类表，否则会被结构
 *   逃生口判成「没有入口」而静默丢弃）；
 * - `type` / `mapTypes` → 官方没有 setter，变化时重建控件，由构造期重新生效。
 *
 * `showStreetLayer` 的默认值刻意**显式写成 `true`**：Vue 对布尔 prop 有「缺省即 `false`」的
 * 转换（`resolvePropValue` 的 `isAbsent && !hasDefault`），不给默认值的话「用户显式传
 * `false`」与「用户没传」会变成同一个值——前者本该真的关掉路网层，却因为与默认值相同而
 * **永远不下发**。写 `true` 之后两种输入才有区别（ADR 的一贯口径：组件层显式声明默认值，
 * 不依赖 SDK 的隐式配置）。
 */
const props = withDefaults(defineProps<MapTypeControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_RIGHT",
  offset: () => ({ x: 10, y: 10 }),
  showStreetLayer: true,
  visible: true,
});

const spec: ControlSpec<MapTypeControlProps> = {
  kind: "map-type",
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    type: p.type,
    mapTypes: p.mapTypes,
    showStreetLayer: p.showStreetLayer,
  }),
};

useControlResource(props, spec);

defineOptions({ name: "MapTypeControl" });
</script>

<template>
  <slot />
</template>
