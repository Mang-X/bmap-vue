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
 * - `autoViewport` 直接用官方的构造选项名（#165 Class 1 之前本库的 prop 叫 `viewport`、
 *   由 Driver 别名改名才落到官方键上；现在公开面就是官方名，别名已删）；
 * - 显隐走挂载状态（`addLayer` / `removeLayer`）。
 *
 * 事件（`click` / `mouseover` / `mouseout`）**保留**：4.0.5 的 `DistrictLayer` 声明里没有
 * `addEventListener`，但既有实现、文档与官方 demo 都依赖这三个事件，删除它们是与本 issue
 * 无关的破坏性变更（依据与取舍见 ADR「已知限制」）。
 */
import { useLayerResource } from "../../core/composables/useLayerResource";
import { forwardCallback, pickLayerOptions } from "../../core/layers/LayerSpec";
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
  /**
   * 是否自动调整视野以适应行政区边界范围（官方 `DistrictLayerOptions.autoViewport`，
   * 官方 d.ts 标 `@default false`）。
   *
   * #165 Class 1 之前这里叫 `viewport`，由 Driver 做别名改名（`aliases: { viewport:
   * "autoViewport" }`）才落到官方键上——那是**已知的命名缺口**，不是有意的概念区分。
   * 现在公开 prop 直接叫官方名，别名**一并删除**（#165 §3.6 不留兼容别名）。
   */
  autoViewport?: boolean;
  /** 掩膜内的行政区代码（4.0 构造选项 `adcode`）。 */
  adcode?: string;
  /**
   * 行政区边界数据请求完成并绘制到地图后的回调
   * （官方 `DistrictLayerOptions.onComplete`，`layer/DistrictLayer.d.ts:180`）。
   *
   * 4.0 的 `DistrictLayer` **没有** `dataparsed` 事件面（这批图层的事件只有 `click` /
   * `mouseover` / `mouseout`），官方给的就只有这个构造选项回调——「边界什么时候画完」在本组件里
   * 唯一的官方入口是它。经 `forwardCallback` 包一层：SDK 手上的函数转发到**当前** prop，
   * 因此改这个回调不会重建图层。
   */
  onComplete?: () => void;
}

const props = withDefaults(defineProps<DistrictLayerProps>(), {
  kind: 0,
  visible: true,
  fillColor: "#fdfd27",
  fillOpacity: 1,
  strokeWeight: 1,
  strokeOpacity: 1,
  strokeColor: "#231cf8",
  autoViewport: false,
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
        // 回调型 option 经 `forwardCallback` 包一层：SDK 手上的函数**转发到当前 prop**，
        // 因此换回调不重建图层（口径同 XYZLayer / WMTSLayer 的 `xTemplate` 等）。
        // `undefined` 时**不放这个键**——给 SDK 一个 `undefined` 回调与「没传」不等价。
        ...(p.onComplete === undefined
          ? {}
          : { onComplete: forwardCallback(() => p.onComplete) }),
        ...pickLayerOptions(p, [
          "kind",
          "fillColor",
          "fillOpacity",
          "strokeColor",
          "strokeWeight",
          "strokeOpacity",
          "autoViewport",
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
defineOptions({ name: "DistrictLayer" });
</script>

<template>
  <slot />
</template>
