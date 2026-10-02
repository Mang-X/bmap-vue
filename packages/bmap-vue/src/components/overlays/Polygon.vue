<script setup lang="ts">
/**
 * Polygon —— 多边形（M5-VECTORS / issue #31 迁移到 OverlaySpec）
 *
 * 组件只做两件事：**声明 spec** + **渲染 slot**。`points`（根引用 + `pathVersion`）、填充/描边、
 * `isBoundary`（构造期 → 变化即重建）、`enableEditing`（成对开关）全部由 `polygonSpec` 声明。
 *
 * 事件面（17 个）与 Polyline 相同（上游同为 `GraphEventMap`）；`defineEmits` 与矩阵的一致性由
 * `overlay-suite.test.ts` 的门禁锁定。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec } from "../../core/composables/useOverlaySpec";
import type { PolygonEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { PolygonProps } from "../../types/components";
import { createPolygonSpec } from "./polygonSpec";

export type { PolygonProps };

const props = withDefaults(defineProps<PolygonProps>(), {
  strokeColor: "#000000",
  strokeWeight: 2,
  strokeOpacity: 0.9,
  strokeStyle: "solid",
  fillColor: "#000000",
  fillOpacity: 0.5,
  isBoundary: false,
  enableMassClear: true,
  enableEditing: false,
  visible: true,
  // ⚠️ **Vue Boolean-absent 陷阱**（issue #165 图形族补齐）。
  //
  // `enableClicking` / `linkRight` 的**官方默认是 `true`**（官方 `PolygonOptions` 的
  // `@default true`：`enableClicking`「是否响应点击事件」）。`Boolean` 类型的 prop 在**未给**时，
  // 编译产物里的运行时值是 `false`——与官方默认**相反**。因此显式写 `undefined`
  // （**不是** `true`）：`undefined` 让该键**不进入**构造选项，SDK 沿用它自己的 `true`。
  //
  // `strokeLineCap` / `strokeLineJoin` / `coordType` / `dashArray` **不是** `Boolean`
  // ⇒ 没有这个陷阱，**不**在此声明。
  enableClicking: undefined,
  linkRight: undefined,
});

const emit = defineEmits<PolygonEmits>();

const emitDynamic = dynamicEmit(emit);

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
 * 可选签名（`default?`）保持插槽可省略 —— 消费方不传内容插槽是合法的。
 */
defineSlots<{
  default?(props: Record<string, never>): any;
}>();
defineOptions({ name: "Polygon" });

const { commands } = useOverlaySpec(props, createPolygonSpec(), { emit: emitDynamic });
/**
 * 命令面（#165 Class 3 / TASK 2）：官方**没有对应 prop** 的动作 + 读回族。
 *
 * 直接展开 `commands`（而不是挂成 `commands.xxx`）：调用方拿到的就是官方同名方法本身
 * （`polyline.setPositionAt(i, pt)` / `circle.getRadius()`），与官方参考实现的形状一致。
 * 逐条依据与「刻意不做」的清单见 `core/overlays/OverlaySpec.ts` 的 `expose` 与
 * `core/overlays/overlayCommands.ts`。
 *
 * `commands` 为 `null` 时（该组件没有命令面）`defineExpose(undefined)` 等价于不 expose，
 * 因此**不要**为此写分支。
 */
defineExpose(commands ?? undefined);

</script>

<template>
  <slot />
</template>
