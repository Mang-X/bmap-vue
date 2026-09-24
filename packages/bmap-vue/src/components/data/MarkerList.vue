<script setup lang="ts" generic="Item">
/**
 * MarkerList —— 逐项 Marker 列表（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * **每一项一个 SDK Marker**，配 `DataLayerManager` 做 keyed diff + RAF 合帧 + 最新项账本。
 * 适合中小规模、需要逐点交互的数据；大规模散点请用 `BPointShapeLayer`（单个批量 SDK 资源）。
 *
 * ## 三条语义
 *
 * 1. **业务类型随组件走**（SFC generic）：`data: readonly Item[]` 决定 `Item`，
 *    `@item-click` 的载荷就是 `Item` —— 不退化成 `any` / `unknown`（消费方 fixture 用
 *    `vue-tsc` 钉住，见 `fixtures/consumer/src/index.ts`）；
 * 2. **点击回传最新业务项**：事件发生在回调注册之后的任意时刻，因此回调读的是
 *    `DataLayerManager` 的账本（`latestOf(marker)`），而不是创建那一刻闭包里的旧对象；
 * 3. **不逐项建 Vue 组件、不逐项建 watcher**：diff 与合帧都在一个管理器里完成
 *    （非目标：「不为每个数据项绑定独立 Vue watcher」）。
 *
 * ## 数据面
 *
 * - `data` 只按**引用**比较；原地改内容（`list[0].lng = 1`）请递增 `dataVersion`；
 * - 同一引用 + 同一 `dataVersion` ⇒ 不产生任何 SDK 调用；
 * - 坏数据（缺 key / 非法坐标 / 重复 key）跳过并给出开发期告警（判定见 `core/data/itemScan.ts`）；
 * - `visible=false` 用覆盖物的 `show/hide`（与 `Marker` 的显隐口径一致：SDK 无该能力时告警）。
 */
import { onMounted, onUnmounted, onScopeDispose, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { DataLayerManager, type DataLayerHost } from "../../core/data/DataLayerManager";
import { createProblemReporter } from "../../core/data/problems";
import { itemKeyReader } from "../../core/data/itemScan";
import { devWarn, logger } from "../../core/logger";
import type { MarkerListProps } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";
import type { MarkerHandle } from "../../driver/types/handles";

const props = withDefaults(defineProps<MarkerListProps<Item>>(), {
  // 布尔 prop 必须给显式默认值：Vue 对 `Boolean` 有「缺省即 false」的转换
  // （`resolvePropValue` 里 `isAbsent && !hasDefault ⇒ false`），不给默认值会让
  // 「没传 visible」变成「隐藏整层」（ADR 2026-09-17 决策 5 的同一条理由）。
  visible: true,
});

const emit = defineEmits<{
  /** 某个 Marker 被点击；载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let manager: DataLayerManager<Item, MarkerHandle> | null = null;
let readyCtx: MapReadyContext | null = null;

/** 点击回调的 disposer（Handle 被 freeze，不可附加属性 ⇒ 用 WeakMap 记账）。 */
const clickDisposers = new WeakMap<object, () => void>();

/** 坏数据只报一次/一类（逐条打日志会把控制台刷满，反而看不见问题）。 */
const reports = createProblemReporter("MarkerList", (message) => devWarn(message));

function buildHost(c: MapReadyContext): DataLayerHost<Item, MarkerHandle> {
  const driver = c.client.driver;
  const target = { kind: "map" as const, handle: c.map };
  return {
    createMarker: (item, point) => {
      const marker = driver.overlays.createMarker(point);
      driver.overlays.add(target, marker);
      clickDisposers.set(
        marker as object,
        driver.events.on(marker, "click", () => {
          // 读账本而不是闭包里的 `item`：数据可能已经换过引用（这是「点击返回最新业务 item」的落点）。
          emit("item-click", manager?.latestOf(marker) ?? item);
        }),
      );
      return marker;
    },
    removeMarker: (marker) => {
      // 先解绑事件委托，再由 Map 摘除资源（顺序与 OverlaySpec / LayerRegistry 同一口径）
      clickDisposers.get(marker as object)?.();
      clickDisposers.delete(marker as object);
      driver.overlays.remove(target, marker);
    },
    updatePosition: (marker, point) => driver.overlays.setPosition(marker, point),
    // 覆盖物继承基类的 `show/hide`；Driver 在 SDK 缺成员时返回 false，由管理器告警（不假装成功）。
    setVisible: (marker, visible) => driver.overlays[visible ? "show" : "hide"](marker),
  };
}

onMounted(async () => {
  const c = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = c;
  manager = new DataLayerManager<Item, MarkerHandle>(buildHost(c), {
    label: "MarkerList",
    onProblem: (problem) => reports.report(problem),
    warn: (message) => logger.warn(message),
  });
  manager.setVisible(props.visible);
  applyData();
});

onUnmounted(() => {
  manager?.dispose();
  manager = null;
  readyCtx = null;
  scope.dispose();
});

function applyData(): void {
  if (!manager || !readyCtx) return;
  manager.sync({
    items: props.data,
    // 取值器只解析一次：`itemKeyReader` 是三个数据组件与 GeoJSON 适配层共用的那一份实现
    getKey: itemKeyReader(props.itemKey),
    getPosition: props.getPosition,
    version: props.dataVersion,
  });
  manager.flush();
  reports.flush();
}

/** data 变化 ⇒ 重新 diff；dataVersion 变化 ⇒ 即使引用不变也重新读一遍。 */
watch(
  () => [props.data, props.dataVersion],
  () => applyData(),
  { deep: false, flush: "sync" },
);

/** `visible` 变化 ⇒ 全员显隐（不动实例与账本：隐藏不是「删掉」）。 */
watch(
  () => props.visible,
  (visible) => manager?.setVisible(visible),
  { flush: "sync" },
);

onScopeDispose(() => {
  manager?.dispose();
  manager = null;
});

defineOptions({ name: "MarkerList" });
</script>

<template>
  <slot />
</template>
