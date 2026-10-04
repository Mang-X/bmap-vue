<script setup lang="ts">
/**
 * Marker —— 图像标注（M5-SPEC-MARKER / issue #30 的样板组件）
 *
 * 这个组件只做两件事：**声明 spec** + **渲染 slot**。
 * 创建 / 挂载 / 就地更新 / 重建 / 卸载、实例 child scope、Registry 记账、Target provide、
 * SDK 事件绑定全部由 `useOverlaySpec` 按声明驱动——组件里不再有生命周期代码，也不再手写 9 个
 * watcher。每个公开属性的更新策略（以及它与 Driver 属性描述符的对应）见 `./markerSpec.ts` 的表。
 *
 * ## 事件面（11 个，全部为规范名）
 *
 * 主事件面来自 `marker` 的事件矩阵（上游 `MarkerEventMap`），`markerSpec` 只覆盖 `dragend`
 * 的处置方式（先转发、再回写位置模型）。历史别名 `drag-end` 已随集中弃用层在 #136 删除——
 * 事件名只有上游 `MarkerEventMap` 的那一种拼写。
 *
 * #138：这一段的**类型声明**是生成物（`core/overlays/overlayEventEmits.generated.ts`），
 * 由事件矩阵 + 非 SDK 事件表 join 出来；组件里不再手抄键名。
 */
import { dynamicEmit } from "../../core/composables/dynamicEmit";
import { useOverlaySpec, type OverlayPositionModel } from "../../core/composables/useOverlaySpec";
// #138：事件面的**类型声明**由生成器从事件矩阵 + 非 SDK 事件表派生，
// 不再手抄（生成物由 `pnpm generate:overlay-emits` 产出，`--check` 守漂移）。
import type { MarkerEmits } from "../../core/overlays/overlayEventEmits.generated";
import { createMarkerSpec } from "./markerSpec";
import type { MarkerProps } from "../../types/components";

export type { MarkerProps };

const props = withDefaults(defineProps<MarkerProps>(), {
  offset: () => ({ x: 0, y: 0 }),
  visible: true,
  title: "",
  enableClicking: true,
  enableDragging: false,
  // ⚠️ **Vue Boolean-absent 陷阱**（#168 item 2）。
  //
  // `Boolean` 类型的 prop 在**未给**时，编译产物里的运行时值是 `false`（不是 `undefined`）。
  // 下面三项的官方默认**恰好都是 `false`**（官方 `MarkerOptions` 的
  // `@default false`），所以「未给 ⇒ `false`」与「官方默认 `false`」在**值**上一致——
  // 但一致的是**结果**，不是**来源**：这个 `false` 是 Vue 编出来的，不是 SDK 的默认。
  //
  // 为什么仍然显式写 `undefined`：`recreate` 类选项的判据是「变化即重建」。若某次渲染里
  // 这个键因为别的原因从 `false` 变成 `undefined`（例如父级显式传 `:raise-on-drag="undefined"`），
  // 就会触发一次**内容完全没变**的重建。把缺省钉成 `undefined`，「没给」就只有一个表示。
  //
  // `draggingCursor` 是 `string`（不是 Boolean）⇒ 没有这个陷阱，**不**在此声明。
  raiseOnDrag: undefined,
  isTop: undefined,
  restrictDraggingArea: undefined,
  // issue #165 第三批补的第四个「官方默认恰好是 false」的 `Boolean`：
  // `MarkerOptions.autoFollowHeadingChanged`（`@default false`，`overlay/MarkerOptions.d.ts:88`）。
  // 上面那段关于「值一致但来源不同」「显式 `undefined` 让『没给』只有一个表示」的推理逐字适用，
  // 因此不重复一遍。`startAnimation` / `label` **不是** `Boolean` ⇒ 没有这个陷阱。
  autoFollowHeadingChanged: undefined,
});

const emit = defineEmits<MarkerEmits>();

const emitDynamic = dynamicEmit(emit);

/**
 * 位置模型句柄：spec 的回调在**运行时**读取它（`dragend` 处理器在 setup 之后才被调用），
 * 因此可以在 spec 里先声明、拿到结果后再回填。
 */
let positionModel: OverlayPositionModel | null = null;

const markerSpec = createMarkerSpec({
  emit: emitDynamic,
  position: () => positionModel,
});

const { position, commands } = useOverlaySpec(props, markerSpec, { emit: emitDynamic });
positionModel = position;

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
defineOptions({ name: "Marker" });

/**
 * 命令面（#165 Class 3 / TASK 2）：官方**没有对应 prop** 的动作 + 读回族。
 *
 * 直接展开 `commands`（而不是挂成 `commands.xxx`）：调用方拿到的就是官方同名方法本身，
 * `marker.setRank(3)` / `circle.getRadius()` 与官方参考实现的形状一致。逐条依据与
 * 「刻意不做」的清单见 `../core/overlays/OverlaySpec.ts` 的 `expose` 与
 * `../core/overlays/overlayCommands.ts`。
 *
 * `commands` 为 `null` 时（该组件没有命令面）`defineExpose(undefined)` 等价于不 expose，
 * 因此**不要**为此写分支。
 */
defineExpose(commands ?? undefined);

</script>

<template>
  <slot />
</template>
