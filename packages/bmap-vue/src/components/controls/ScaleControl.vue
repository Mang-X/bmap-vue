<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

/**
 * 比例尺的单位（官方 `LengthUnit`）。
 *
 * 取值域**逐字**取自 `@baidumap/jsapi-v4-types@4.0.5` 的 `const/LengthUnit.d.ts`：
 * `type LengthUnit = 'metric' | 'us'`（官方常量 `BMAP_UNIT_METRIC` / `BMAP_UNIT_IMPERIAL`）。
 *
 * 刻意**不**复刻成自己的枚举对象：那会让「官方加一个新单位」变成一次库内改���，
 * 而一个字符串联合在官方加值时是**编译期**提醒（而不是运行时静默传一个官方不认的字符串）。
 */
export type ScaleControlUnit = "metric" | "us";

export interface ScaleControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  visible?: boolean;
  /**
   * 比例尺单位。**可就地更新**（官方 `ScaleControl#setUnit(unit: LengthUnit): void`，
   * `control/ScaleControl.d.ts`）。
   *
   * 此前 Driver 的 `CONTROL_OPTION_SPECS.scale.unit` 已经登记成
   * `{ policy: "mutable", setter: "setUnit" }`，而组件**没有**这个 prop——
   * 分类层准备好了、出口没有。 / TASK 2f 补上出口。
   *
   * 不给默认值：`undefined` = 不表态（官方 `ScaleControlOptions` 里**没有** `unit`，
   * 默认由 SDK 自己决定，本库不猜——与图层 `border` 那条同款理由）。
   */
  unit?: ScaleControlUnit;
}

/**
 * ScaleControl —— 比例尺控件
 *
 * 统一 ControlSpec（M7-CONTROL-PANORAMA / issue #41）：anchor / offset / visible 都随
 * props 即时下发。
 */
const props = withDefaults(defineProps<ScaleControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_LEFT",
  offset: () => ({ x: 10, y: 10 }),
  visible: true,
});

const spec: ControlSpec<ScaleControlProps> = {
  kind: "scale",
  // `unit` 进 options 袋：Driver 的 `CONTROL_OPTION_SPECS.scale.unit` 已登记成
  // `mutable` + `setUnit`，因此统一 adapter 会走**就地 `setOptions`**（不重建控件）。
  options: (p) => ({ anchor: p.anchor, offset: p.offset, unit: p.unit }),
};

useControlResource(props, spec);

defineOptions({ name: "ScaleControl" });
</script>

<template>
  <slot />
</template>
