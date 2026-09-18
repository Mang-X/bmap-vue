<script setup lang="ts">
/**
 * BInfoWindow —— 信息窗口（M5-INFOWINDOW / issue #32）
 *
 * 组件只做两件事：**声明**（`core/overlays/InfoWindowSpec.ts` 的属性面与落地方式）+ **渲染 slot**。
 * 状态机、每地图归属、实例创建 / 重建 / 释放、尺寸合帧重绘都在 `useInfoWindow` 里。
 *
 * ## 内容节点：detached host + Teleport
 *
 * SDK 持有 host 元素（`new BMap.InfoWindow(host, opts)`），Vue **Teleport** 拥有 host 内部的渲染
 * 子树。这样 SDK 搬动 host 时不会动到 Vue 管理的节点树 —— 旧实现把 Vue 渲染的 shell 交给 SDK 搬，
 * 节点引用与实际父节点会分叉（官方 React 库 v2 直接 `ReactDOM.render(children, host)` 之后从不
 * unmount，那条路径会永久泄漏一棵渲染树）。
 *
 * 宿主页可以从 `[data-bmap-infowindow-content]` 定位到这块 host（开放出来的唯一 DOM 契约，
 * 用于外部检查「内容是否可见 / 卸载后是否残留」）。`$attrs`（`class` / `style` / 自定义属性）
 * 落在 host 内部的包装节点上，与旧实现挂在 shell 上的观感一致。
 *
 * ## 打开状态的唯一主模型
 *
 * `v-model:open`。`v-model:show` 是 v2 迁移期的兼容别名（只被读取，使用时会打印一次集中告警），
 * 不构成第二份主状态 —— 见 issue #32 的非目标。
 *
 * 状态机语义、归属判定与验收读数见 ADR `2026-09-18-infowindow-host-and-ownership`。
 */
import { useInfoWindow } from "../../core/composables/useInfoWindow";
import { useRequiredMapContext } from "../../core/context/inject";
import type { BMapError } from "../../core/errors/BMapError";
import type { BInfoWindowProps } from "../../types/components";

export type { BInfoWindowProps };

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<BInfoWindowProps>(), {
  title: "",
  width: 0,
  height: 0,
  offset: () => ({ x: 0, y: 0 }),
  open: false,
  // `show: undefined` 让「没传」= 「不表态」：Vue 的布尔 prop 会「缺省即 false」，
  // 给一个 `undefined` 默认值即可关掉那次转换（`resolvePropValue` 的 `isAbsent && !hasDefault`）
  show: undefined,
  enableMaximize: false,
  enableAutoPan: true,
  enableCloseOnClick: false,
});

const emit = defineEmits<{
  "update:open": [v: boolean];
  "update:show": [v: boolean];
  open: [];
  close: [];
  /** 用户点了气泡上的关闭按钮（官方 `clickclose`）。 */
  clickclose: [e: unknown];
  /** 气泡被最大化（需 `enableMaximize`，官方 `maximize`）。 */
  maximize: [e: unknown];
  /** 气泡从最大化还原（官方 `restore`）。 */
  restore: [e: unknown];
  /** 实例被重建（构造期属性变化），载荷是新的实例代次。 */
  rebuild: [generation: number];
  /** 实例被释放，载荷是被释放的实例代次。 */
  destroy: [generation: number];
}>();

/** 事件转发入口：动态名在这里集中收窄一次（不让 `as` 扩散到组件其它地方）。 */
const emitDynamic = emit as unknown as (name: string, payload?: unknown) => void;
const ctx = useRequiredMapContext();

const { host } = useInfoWindow(props, {
  emit: emitDynamic,
  component: "BInfoWindow",
  /** 失败统一走组件既有的 `resource:error` 诊断通道（与其它覆盖物一致）。 */
  reportError: (error: BMapError) => {
    try {
      ctx.events.emit("resource:error", { error, component: "BInfoWindow" });
    } catch {
      /* 事件总线已停用时不再追究 */
    }
  },
});
</script>

<template>
  <Teleport v-if="host" :to="host">
    <div class="b-info-window-content" v-bind="$attrs">
      <slot />
    </div>
  </Teleport>
</template>
