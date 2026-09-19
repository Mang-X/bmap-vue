<script setup lang="ts" generic="Item">
/**
 * BMarkerCluster —— 空间聚合（M6-POINT-CLUSTER / issue #35）
 *
 * 默认走 **v4 原生 `ClusterLayer`**（一个 WebGL 图层承载全部点与簇）；`engine: "markers"` 时
 * 退到「网格聚合 + 每簇 / 每单点一个 SDK Marker」。两种引擎的边界写在组件文档
 * `docs/zh-CN/components/data.md`，内部契约在 `./clusterEngine.ts`。
 *
 * ## 为什么默认是原生（而不是「原生可用就删掉自研」）
 *
 * issue #35 的开工前范围纠正规定：**不因为「理论上可能缺失」就自动进入自研 fallback**，
 * 原生层是默认路径。本库为此专门取了一次证（`scripts/probe-native-point-cluster.mts`，
 * 真实 AK + headless Chrome）：原生 `ClusterLayer` 的构造 / 挂载 / `setData` / 聚簇产出
 * （`change` 事件 `{ clusters, singles, zoom }`）/ 簇命中 / 单点命中**全部可用** ⇒
 * 「原生缺了、要用自研兜底」这条缺口**不成立**。
 *
 * ## 那 `engine: "markers"` 为什么还留着
 *
 * 因为它**多给一样东西**：`cluster-click` 里能带回**簇内的业务项**。原生引擎拿不到 ——
 * 官方在命中载荷里只给簇的元数据（`clusterId` / `pointCount` / `bbox`），
 * `getClusterLayer().getItems()` 也只有簇级条目（实测，见 ADR）。所以它是**显式选择**
 * （「我要业务项，接受每簇一个 Marker 的代价」），不是「原生坏了就用它兜着」。
 *
 * ## 一次点击会给到两个事件的哪几个
 *
 * | 命中 | 事件 | 载荷 |
 * | --- | --- | --- |
 * | 簇 | `cluster-click` | `BMapClusterPick<Item>`：`engine` / `id` / `size` / `position` / `items` |
 * | 未聚合的单点 | `item-click` | **最新**的业务 item |
 *
 * `items` 在 `native` 引擎下是 `null`（拿不到）、在 `markers` 引擎下是业务项数组。
 * 用 `null` 而不是空数组，是为了让「这一层拿不到」与「这一簇确实是空的」在类型上就分得开。
 *
 * ## 资源与释放
 *
 * 两个引擎都把资源挂进**地图的图层账本**（`ctx.layers`），因此 `MapRuntime.dispose()` 会在
 * `map.destroy()` **之前**收掉它们；自定义 Context 没有账本时退化为组件自持账本
 * （只保证「组件卸载」这一条路径）。
 */
import { onMounted, onScopeDispose, onUnmounted, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { createLayerRegistry, type LayerRegistry } from "../../core/layers/LayerRegistry";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import { devWarn } from "../../core/logger";
import {
  toClusterChange,
  toClusterPick,
  type ClusterChangeReadout,
  type ClusterEngine,
  type ClusterReadout,
} from "./clusterEngine";
import { createMarkerClusterEngine } from "./markerClusterEngine";
import { createNativeClusterEngine } from "./nativeClusterEngine";
import type { BMapClusterChange, BMapClusterPick, BMarkerClusterProps } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";

const props = withDefaults(defineProps<BMarkerClusterProps<Item>>(), {
  // 布尔 / 字符串 / 数字三类都要显式表态：
  // - 布尔不给默认值会被 Vue 隐式转成 `false`；
  // - `engine` 的缺省语义是 `"native"`（原生层是默认路径），必须写在 props 层；
  // - 其余可选值给 `default: undefined` —— 它让「用户没传」与「传了」在运行时可区分，
  //   而这正是下面「选项与 engine 不匹配要告警」需要的区别（`undefined` 由各引擎自己兜底）。
  visible: true,
  engine: "native",
  fitViewOnClick: undefined,
  gridSize: undefined,
  minClusterSize: undefined,
  zoom: undefined,
  clusterRadius: undefined,
  clusterMinPoints: undefined,
  clusterMinZoom: undefined,
  clusterMaxZoom: undefined,
  singleStyle: undefined,
});

const emit = defineEmits<{
  /** 簇被点击。`items` 只在 `engine: "markers"` 下是业务项数组。 */
  "cluster-click": [pick: BMapClusterPick<Item>];
  /** 聚合结果读数（两个引擎同名同形：`{ engine, clusters, singles, zoom }`）。 */
  "cluster-change": [change: BMapClusterChange];
  /** 未聚合的单点被点击（载荷是**最新**的业务 item）。 */
  "item-click": [item: Item];
}>();

const ctx = useRequiredMapContext();
const scope = new ResourceScope({ label: "BMarkerCluster" });
/** 组件自持的账本（自定义 Context 不提供 `layers` 时用，随组件作用域释放）。 */
const ownRegistry: LayerRegistry = createLayerRegistry();
const registryOf = (): LayerRegistry => ctx.layers ?? ownRegistry;
onScopeDispose(() => {
  if (!ctx.layers) ownRegistry.disposeAll();
});

let readyCtx: MapReadyContext | null = null;
let engine: ClusterEngine<Item> | null = null;
/** 当前引擎的 kind（emit 时用它标注载荷；`engine` 变化会连带换掉它）。 */
let engineKind: ClusterEngine<Item>["kind"] | null = null;
/** 选项与 engine 不匹配只告警一次（同一次会话里刷屏没有信息量）。 */
const warnedOptions = new Set<string>();

function warnOptionMismatch(): void {
  const mismatched =
    props.engine === "native"
      ? [
          ["gridSize", props.gridSize],
          ["minClusterSize", props.minClusterSize],
          ["zoom", props.zoom],
        ]
      : [
          ["clusterRadius", props.clusterRadius],
          ["clusterMinPoints", props.clusterMinPoints],
          ["clusterMinZoom", props.clusterMinZoom],
          ["clusterMaxZoom", props.clusterMaxZoom],
          ["fitViewOnClick", props.fitViewOnClick],
          ["singleStyle", props.singleStyle],
        ];
  for (const [name, value] of mismatched) {
    if (value === undefined || warnedOptions.has(String(name))) continue;
    warnedOptions.add(String(name));
    devWarn(
      `[BMarkerCluster] ${String(name)} 只对 engine="${props.engine === "native" ? "markers" : "native"}" 生效，` +
        `当前 engine="${props.engine}" ⇒ 本次改动静默不生效（本库不把它悄悄切到另一条路径上）`,
    );
  }
}

function createEngine(c: MapReadyContext): ClusterEngine<Item> {
  const shared = {
    ready: c,
    label: "BMarkerCluster",
    onProblem: (message: string) => devWarn(`[BMarkerCluster] ${message}`),
    // 载荷由 `toClusterPick` 统一投影（两种引擎只有 `items` 一项不同）；`engineKind` 在
    // 回调触发时读的是**当前**引擎，因此换引擎之后事件不会带着旧引擎的名字。
    onClusterClick: (readout: ClusterReadout<Item>) =>
      emit("cluster-click", toClusterPick(engineKind ?? props.engine, readout)),
    onItemClick: (item: Item) => emit("item-click", item),
    onChange: (change: ClusterChangeReadout) =>
      emit("cluster-change", toClusterChange(engineKind ?? props.engine, change)),
  };
  return props.engine === "markers"
    ? createMarkerClusterEngine<Item>(shared, props, { gridSize: 128, minClusterSize: 3 })
    : createNativeClusterEngine<Item>({ ...shared, registry: registryOf() }, props);
}

/**
 * 引擎的失败出口。
 *
 * 两个引擎的 `mount()` / `sync()` **一律抛出**（见 `clusterEngine.ts` 的契约），由这里统一转成
 * `resource:error`。这条路径不是可选的：原生聚合是**异步注入**的扩展 API，
 * `BMAP_CAPABILITY_UNSUPPORTED` 是预期内的失败 —— 它必须出现在 `resource:error` 上，
 * 而不是变成一个冒到 `onMounted` 外的 unhandled rejection。
 */
function reportError(error: unknown): void {
  const wrapped =
    error instanceof BMapError ? error : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error });
  ctx.events.emit("resource:error", { error: wrapped, component: "BMarkerCluster" });
}

/** props 变化后的收敛：数据 / 可见性就地更新，`engine` 变化则整体换引擎。 */
function sync(): void {
  const c = readyCtx;
  if (!c) return; // 还没就绪：创建时会读到最新的 props
  warnOptionMismatch();
  try {
    if (engine && engineKind !== props.engine) {
      engine.dispose();
      engine = null;
      engineKind = null;
    }
    if (!engine) {
      engine = createEngine(c);
      engineKind = engine.kind;
      engine.mount();
      return;
    }
    engine.sync();
  } catch (error) {
    reportError(error);
  }
}

onMounted(async () => {
  const c = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = c;
  sync();
});

onUnmounted(() => {
  engine?.dispose();
  engine = null;
  engineKind = null;
  readyCtx = null;
  scope.dispose();
});

watch(
  () => [
    props.engine,
    props.data,
    props.dataVersion,
    props.itemKey,
    props.getPosition,
    props.gridSize,
    props.minClusterSize,
    props.zoom,
    props.clusterRadius,
    props.clusterMinPoints,
    props.clusterMinZoom,
    props.clusterMaxZoom,
    props.fitViewOnClick,
    props.singleStyle,
  ],
  () => sync(),
  { deep: false, flush: "sync" },
);

watch(
  () => props.visible,
  (visible) => {
    // 未就绪时不用管：`mount()` 会读到最新的 props
    engine?.setVisible(visible);
  },
  { flush: "sync" },
);

defineOptions({ name: "BMarkerCluster" });
</script>

<template>
  <slot />
</template>
