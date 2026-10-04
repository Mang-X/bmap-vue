<script setup lang="ts">
/**
 * InfoWindow —— 信息窗口（M5-INFOWINDOW / issue #32）
 *
 * 组件只做两件事：声明（`core/overlays/InfoWindowSpec.ts`）+ 渲染 slot；
 * 实例生命周期、收敛与尺寸重绘都在 `useInfoWindow` 里。
 *
 * 内容节点是 detached host：SDK 持有 host 元素，Vue `<Teleport>` 拥有它内部的渲染子树
 * （宿主页用 `[data-bmap-infowindow-content]` 定位它；`$attrs` 落在宿主内部的包装节点上）。
 * 打开状态的唯一主模型是 `v-model:open`。
 *
 * 契约见 ADR `2026-09-18-infowindow-host-and-ownership`。
 *
 * #138：事件面的类型声明是生成物（`core/overlays/overlayEventEmits.generated.ts`）。
 * `<InfoWindow>` 不走 `useOverlaySpec`，事件由 `useInfoWindow` 原样转发，因此它的载荷**不**按
 * 事件矩阵的档声明——理由与逐条依据见生成脚本里的 `PAYLOAD_OVERRIDES_BY_KIND`。
 */
import { useInfoWindow } from "../../core/composables/useInfoWindow";
import { useRequiredMapContext } from "../../core/context/inject";
import type { BMapError } from "../../core/errors/BMapError";
import type { InfoWindowEmits } from "../../core/overlays/overlayEventEmits.generated";
import type { InfoWindowProps } from "../../types/components";

export type { InfoWindowProps };

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
defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<InfoWindowProps>(), {
  title: "",
  width: 0,
  height: 0,
  offset: () => ({ x: 0, y: 0 }),
  open: false,
  enableMaximize: false,
  enableAutoPan: true,
  enableCloseOnClick: false,
});

const emit = defineEmits<InfoWindowEmits>();

/** 事件转发入口：动态名在这里集中收窄一次（不让 `as` 扩散到组件其它地方）。 */
const emitDynamic = emit as unknown as (name: string, payload?: unknown) => void;
const ctx = useRequiredMapContext();

const { host, commands } = useInfoWindow(props, {
  emit: emitDynamic,
  component: "InfoWindow",
  /** 失败统一走组件既有的 `resource:error` 诊断通道（与其它覆盖物一致）。 */
  reportError: (error: BMapError) => {
    try {
      ctx.events.emit("resource:error", { error, component: "InfoWindow" });
    } catch {
      /* 事件总线已停用时不再追究 */
    }
  },
});

/**
 * 命令面（#165 Class 3 / TASK 2c）：`getTitle` / `getContent` / `isOpen` / `getOffset` /
 * `maximize` / `restore`。
 *
 * 前四个是**读回**（`open` prop 表达的是意图，官方只有实例上的 `isOpen()` 才回答
 * 「现在真的开着吗」）；后两个是**动作**——`enableMaximize` 只是「允许最大化」，不触发它。
 *
 * 释放 / 未就绪 / 已被同图另一个气泡顶掉时**显式抛 `BMAP_RESOURCE_DISPOSED`**（见
 * `useInfoWindow.requireInfoWindow` 的逐条依据），绝不静默 no-op。
 */
defineExpose(commands);
</script>

<template>
  <Teleport v-if="host" :to="host">
    <div class="b-info-window-content" v-bind="$attrs">
      <slot />
    </div>
  </Teleport>
</template>
