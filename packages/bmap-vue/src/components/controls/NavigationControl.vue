<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface NavigationControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  /**
   * 控件类型，官方 `BMAP_NAVIGATION_CONTROL_*`（LARGE / SMALL / PAN / ZOOM）。
   *
   * 填**常量名**（`"BMAP_NAVIGATION_CONTROL_LARGE"` …），控件边界有一张名字→数值表
   * （`NAVIGATION_TYPE_VALUES`）换算成官方的 `0 | 1 | 2 | 3`——上游
   * `NavigationControlOptions.type` 收的是**数字**。与 `anchor` 同一套做法（issue #175）。
   *
   * ⚠️ 直接填数字（`type="2"`）**不告警也不被换算**——`resolveType` 对非字符串原样放行
   * （`ControlOptions` 的索引签名本就是「4.0 自身构造选项」的逃生口）。而 `2` 恰好就是
   * `BMAP_NAVIGATION_CONTROL_PAN` 的值，所以它**可能**看起来是对的：
   * 数字与官方数值**巧合相同**时没有任何异常信号，一旦官方调整取值就静默错位。
   * 因此一律填常量名。
   *
   * 表**按族分开**，因此 `BMAP_MAPTYPE_CONTROL_*`（`<MapTypeControl>` 的取值）会告警并被忽略——
   * 两族的数值还撞（`PAN` 与 `MAP` 都是 `2`），误接受会静默换出别的控件的样式。
   */
  type?: string;
  /** 是否显示级别提示信息（官方 `showZoomInfo`，只有构造期生效） */
  showZoomInfo?: boolean;
  /** 控件是否集成定位功能（官方 `enableGeolocation`，只有构造期生效） */
  enableGeolocation?: boolean;
  visible?: boolean;
}

/**
 * NavigationControl —— 平移缩放控件（官方 `NavigationControl`）
 *
 * M7-CONTROL-PANORAMA / issue #41：`kind: "navigation"` 在 #22 已进 Driver 的能力面，本组件
 * 把它开放给使用者。
 *
 * `type` 是**可就地更新**的（官方 `setType`）；`showZoomInfo` / `enableGeolocation` 只有构造期
 * 生效，变化时统一 adapter 会**重建控件**并把新值交给构造期（真实 4.0 的 `setType` 要求控件
 * 已挂载，因此重建后的写入顺序始终是 create → add → setOptions）。
 */
const props = withDefaults(defineProps<NavigationControlProps>(), {
  anchor: "BMAP_ANCHOR_TOP_LEFT",
  offset: () => ({ x: 30, y: 10 }),
  // 两个布尔选项都显式给出官方声明的默认值（`@default true` / `@default false`）：
  // Vue 对布尔 prop 有「缺省即 false」的转换，不显式声明会让「用户显式传 false」与
  // 「用户没传」不可区分（见 `MapTypeControl` 的同一条注释）。
  showZoomInfo: true,
  enableGeolocation: false,
  visible: true,
});

const spec: ControlSpec<NavigationControlProps> = {
  kind: "navigation",
  // `undefined` 的键在 Driver 侧被跳过（不会把 SDK 默认值覆盖成 undefined）
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    type: p.type,
    showZoomInfo: p.showZoomInfo,
    enableGeolocation: p.enableGeolocation,
  }),
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
defineOptions({ name: "NavigationControl" });
</script>

<template>
  <slot />
</template>
