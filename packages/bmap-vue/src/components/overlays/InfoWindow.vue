<script setup lang="ts">
/**
 * InfoWindow —— 信息窗口（M5-INFOWINDOW / issue #32）
 *
 * 组件只做两件事：声明（`core/overlays/InfoWindowSpec.ts`）+ 渲染 slot；
 * 实例生命周期、收敛与尺寸重绘都在 `useInfoWindow` 里。
 *
 * 内容节点是 detached host：SDK 持有 host 元素，Vue `<Teleport>` 拥有它内部的渲染子树
 * （宿主页用 `[data-bmap-infowindow-content]` 定位它；`$attrs` 落在宿主内部的包装节点上）。
 * 打开状态的唯一主模型是 `v-model:open`，`v-model:show` 是兼容别名。
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

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<InfoWindowProps>(), {
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

const emit = defineEmits<InfoWindowEmits>();

/** 事件转发入口：动态名在这里集中收窄一次（不让 `as` 扩散到组件其它地方）。 */
const emitDynamic = emit as unknown as (name: string, payload?: unknown) => void;
const ctx = useRequiredMapContext();

const { host } = useInfoWindow(props, {
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
</script>

<template>
  <Teleport v-if="host" :to="host">
    <div class="b-info-window-content" v-bind="$attrs">
      <slot />
    </div>
  </Teleport>
</template>
