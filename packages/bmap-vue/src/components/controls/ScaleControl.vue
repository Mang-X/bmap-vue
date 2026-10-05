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
   * 分类层准备好了、出口没有。#165 Class 3 / TASK 2f 补上出口。
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

/**
 * 插槽契约（#188）。
 *
 * `defineSlots` 在这里不是可选的文档，而是**发布声明能否成立的前提**：不写它时
 * `vue-tsc` 会把插槽载荷 emit 成模块局部的 `declare var __VLS_1: {}`，
 * 而声明打包阶段（API Extractor rollup）只保留导出面可达的符号，那条 `var`
 * 会连同它的声明一起消失，留下一个对 `__VLS_1` 的 `typeof` **悬空引用** ——
 * 消费方开 `skipLibCheck: false` 立刻报 `TS2304`。
 * 写了它之后 Volar 把载荷**内联**进 `__VLS_Slots`，全程没有中间 `var`。
 * 详见 `components/map/Map.vue` 里同段注释（根因与实验记录都在那里）。
 *
 * 载荷是**空对象类型**而不是 `any`：本组件的内容插槽不传任何东西，
 * 写成 `any` 等于把插槽类型面放宽成「无推导」。
 *
 * 刻意用 `Record<never, never>` 而不是更常见的 `Record<string, never>`（#188 评审 P1）：
 * 后者带**字符串索引签名**，于是消费方写错插槽 prop 时 `const { typo } = props`
 * **不报错**（`typo` 只是 `never`，而 `never` 又可赋给任何目标），错误成员静默通过 ——
 * 与 #188 要恢复的「错误成员有预期诊断」正好相反。实测见
 * `fixtures/consumer/strict/probe.ts` 里的 `HasStringIndex` 判据。`Record<never, never>` 与 `{}`
 * 同样没有索引签名，`typo` 会真的报 `TS2339`；两者都是合法的 `defineSlots` 载荷。
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<never, never>): any;
}>();
defineOptions({ name: "ScaleControl" });
</script>

<template>
  <slot />
</template>
