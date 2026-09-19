<script setup lang="ts">
/**
 * BTrackLineLayer —— 原生轨迹线图层（官方 4.0 扩展 API `TrackLine`）—— **基线**
 *
 * ## 能力面（为什么只有两个 prop）
 *
 * `TrackLine` 属官方**扩展 API**：`@baidumap/jsapi-v4-types@4.0.4` **没有**类声明，官方明确
 * 「首次加载时可视化实现是异步注入的」。驱动登记面里它只有 **`setData`**，因此本组件只声明
 * `data` 与 `visible`：
 *
 * - `data`：官方 `TrackLine` 只接收**单条 `LineString` Feature**（形状由调用方保证；本库不做
 *   GeoJSON 校验——那属于数据适配层，而该 kind 没有任何可核对的声明来支撑「什么算合法」）；
 * - `visible`：用**挂上 / 摘掉**表达（没有 `setVisible`），重新可见时会换实例；
 * - **没有** style / opacity / zIndex / 缩放范围：驱动登记面里没有这些入口，声明了也只是静默忽略。
 *
 * ## 刻意**未**实现：播放控制与页面可见性联动
 *
 * issue #36 的原始范围含「暂停 / 恢复 / 停止 + 页面可见性联动」，而 2026-09-19 的范围纠正把边界
 * 写死了，本组件按纠正后的边界**不做**这些：
 *
 * - 播放控制方法名（`start` / `pause` / `resume` / `stop` …）在**官方类型包里没有声明**，
 *   只有运行时可能存在。在拿到真实运行时的读数之前不猜方法名（「所有新增 capability/清理判据先有
 *   真实 SDK 证据」）；
 * - 也不建一套「idle / running / paused / stopped / hidden」的**内部状态机**去镜像 SDK 的播放状态
 *   ——那是仓库存量同类机制被审计的对象（#104），且与「官方原生能力先用」的原则冲突；
 * - 页面 hidden 时**不**自动改写业务播放意图（自动 pause/resume 若要改变用户可观察状态，必须是
 *   显式 opt-in，不是基础默认）。
 *
 * 因此本组件**不依赖**旧的 `BMapGLLib.TrackAnimation` 插件，也不触碰它的任何私有字段。
 * 取证与落地留给后续票（欠账登记在 ADR `2026-09-19-native-data-layer-components`）。
 */
import { useVisualLayer } from "./useVisualLayer";
import type { BTrackLineLayerProps } from "../../types/components";

const props = withDefaults(defineProps<BTrackLineLayerProps>(), {
  visible: true,
});

/** 只装配生命周期；播放控制未实现（见文件头），因此没有可 expose 的命令面。 */
useVisualLayer<BTrackLineLayerProps>(props, {
  kind: "track-line",
  component: "BTrackLineLayer",
  // 该 kind 没有拾取面 ⇒ 不绑事件
});

defineOptions({ name: "BTrackLineLayer" });
</script>

<template>
  <slot />
</template>
