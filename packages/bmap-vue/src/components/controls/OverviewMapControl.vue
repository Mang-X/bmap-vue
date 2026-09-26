<script setup lang="ts">
import { useControlResource, type ControlSpec } from "../../core/controls";

export interface OverviewMapControlProps {
  anchor?: string;
  offset?: { x: number; y: number };
  /** 缩略地图尺寸（官方 `size`，领域口径是 Pixel；可就地更新，走 `setSize()`） */
  size?: { x: number; y: number };
  /** 挂载后的开合状态（官方 `isOpen`，只有构造期生效） */
  isOpen?: boolean;
  /** 鹰眼与主图的缩放级别差（官方 `zoomInterval`，只有构造期生效） */
  zoomInterval?: number;
  /** 鹰眼与主图之间的空隙像素（官方 `padding`，只有构造期生效） */
  padding?: number;
  visible?: boolean;
}

/**
 * OverviewMapControl —— 缩略地图控件 / 鹰眼（官方 `OverviewMapControl`）
 *
 * M7-CONTROL-PANORAMA / issue #41。
 *
 * `isOpen` 刻意走**重建**：官方只提供 `changeView()` 的**切换**语义（没有幂等 `setOpen`），
 * 就地更新会变成「点两次才回到目标状态」。重建时把 `isOpen` 交给构造期是最确定的表达，
 * 代价是控件内部状态重置——所以不要让它频繁抖动（Driver 的 `setOptions` 对构造期项会告警
 * 一次并把决定留给调用方，统一 adapter 的选择就是重建）。
 */
const props = withDefaults(defineProps<OverviewMapControlProps>(), {
  anchor: "BMAP_ANCHOR_BOTTOM_RIGHT",
  offset: () => ({ x: 0, y: 0 }),
  // 官方声明的默认值（`@default false`）：显式写出，避免 Vue 的布尔转换让「用户显式传
  // false」与「用户没传」不可区分（见 `MapTypeControl` 的同一条注释）。
  isOpen: false,
  visible: true,
});

/**
 * 事件面（issue #165 Class 3 / TASK 4：官方 3 个，此前 **0** 个）。
 *
 * `viewchanged` 是**唯一**能观察这个控件自身开合状态的方式——官方
 * `OverviewMapControl#isOpen(): boolean` 只能**轮询**，而 `isOpen` prop 又是**构造期**的
 * （Driver 归类 `recreate`，理由是官方只有 `changeView()` 的**切换**语义、没有幂等
 * `setOpen`）。也就是说此前「鹰眼被用户点开了」这个事实在本库**完全不可观测**。
 *
 * 逐条依据（`@baidumap/jsapi-v4-types@4.0.4` 的 `control/OverviewMapControl.d.ts`）：
 * - `viewchanged: { type: string; target: OverviewMapControl; isOpen: boolean }`
 * - `viewchanging: { type: string; target: OverviewMapControl }`
 * - `resize: { type: string; target: OverviewMapControl }`
 *
 * 三个都**原样转发**（官方没有给载荷归一化的依据，本库也不复刻一份 `target` 的形状；
 * `viewchanged` 的 `isOpen` 已是布尔，在类型上够用）。
 *
 * ⚠️ **不**据此回写 `isOpen` prop：那是构造期字段，官方没有 `setOpen`。命令与状态仍是两件事
 * ——要用命令驱动就经 `./advanced` 的 `unwrapRaw()` 调 `changeView()`，官方「只有切换、
 * 没有设置」这条限制不变。
 */
const emit = defineEmits<{
  /** 官方 `isOpen` 读不到时为 `null`（不拿 `false` 冒充「读到了：关着」）。 */
  viewchanged: [event: { isOpen: boolean } | null];
  viewchanging: [event: unknown];
  resize: [event: unknown];
}>();

/**
 * 从归一化事件里取出官方的 `{ isOpen: boolean }`。
 *
 * 控件事件与地图 / 覆盖物事件走**同一条** `normalizeDriverEvent` 路径（`driver/jsapi-v4/events.ts`），
 * 它按**地图**事件的形状重建载荷——而 `isOpen` 不在那套形状里，直接读事件顶层会是
 * `undefined`。`raw` 逃生口正是为此存在的（见 `driver/types/events.ts` 的 `DriverEvent.raw`）。
 *
 * `isOpen` 读不到时为 `null`（而不是 `false`）：`false` 是一个**断言**，而我们并不知道。
 * 归一化**不修改** `raw`，因此从它取到的就是官方原样。
 */
function readViewChanged(event: unknown): { isOpen: boolean } | null {
  const raw = (event as { raw?: unknown } | null)?.raw;
  const record = (raw ?? event) as Record<string, unknown> | null;
  if (!record || typeof record !== "object" || typeof record.isOpen !== "boolean") return null;
  return { isOpen: record.isOpen };
}

const spec: ControlSpec<OverviewMapControlProps> = {
  kind: "overview",
  events: () => [
    ["viewchanged", (event: unknown) => emit("viewchanged", readViewChanged(event))],
    ["viewchanging", (event: unknown) => emit("viewchanging", event)],
    ["resize", (event: unknown) => emit("resize", event)],
  ],
  options: (p) => ({
    anchor: p.anchor,
    offset: p.offset,
    size: p.size,
    isOpen: p.isOpen,
    zoomInterval: p.zoomInterval,
    padding: p.padding,
  }),
};

useControlResource(props, spec);

defineOptions({ name: "OverviewMapControl" });
</script>

<template>
  <slot />
</template>
