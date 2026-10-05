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
defineOptions({ name: "CustomControl", inheritAttrs: false });
</script>

<template>
  <div style="display: none">
    <div ref="containerRef" v-bind="$attrs">
      <slot />
    </div>
  </div>
</template>
