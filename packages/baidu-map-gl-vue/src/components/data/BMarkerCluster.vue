<script setup lang="ts" generic="Item">
/**
 * BMarkerCluster —— 网格聚合（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * 一个组件管理整批点：先用 `gridCluster()` 做像素网格聚合，再用同一个 `DataLayerManager`
 * 把「簇 / 单点」落地成 Marker（keyed diff + RAF 合帧 + 最新项账本）。不为每个点建 Vue 组件，
 * 也不为每个点建 watcher。
 *
 * ## 与 #34 的收口对应的三处
 *
 * 1. **取数面与 `BMarkerList` 完全一致**（`data` / `itemKey` / `getPosition` / `dataVersion` /
 *    `visible`），业务数据可以在两个组件之间平移；
 * 2. **坏数据在聚合之前就过滤**：非法坐标进了聚合会把**整桶**的平均值污染成 `NaN`，
 *    于是一个坏点会让同桶里的好点一起消失。过滤规则与其它数据组件共用
 *    `core/data/itemScan.ts`（同一份判定，含「已校验的坐标」）；
 * 3. **单点条目的 id 用业务 key**（`gridCluster` 的 `getKey`）：旧实现不传它，展开的单点拿到的是
 *    **桶内下标**（`"0"` / `"1"`…），两个不同桶的单点会撞成同一个 id ⇒ 只留下一个 marker
 *    （静默丢点）。传业务 key 之后，单点的 id 稳定且唯一，跨帧 diff 也能复用同一个 marker。
 */
import { onMounted, onUnmounted, onScopeDispose, watch } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { DataLayerManager, type DataLayerHost } from "../../core/data/DataLayerManager";
import { gridCluster, type Cluster } from "../../core/data/gridCluster";
import { itemKeyReader, scanValidItems } from "../../core/data/itemScan";
import { createProblemReporter } from "../../core/data/problems";
import { devWarn, logger } from "../../core/logger";
import type { BMarkerClusterProps } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";
import type { MarkerHandle } from "../../driver/types/handles";
import type { PointLike } from "../../core/data/points";

const props = withDefaults(defineProps<BMarkerClusterProps<Item>>(), {
  // 与 BMarkerList 同源：Boolean prop 不给显式默认值会被 Vue 隐式转成 `false`。
  visible: true,
  gridSize: 128,
  minClusterSize: 3,
});

const emit = defineEmits<{
  /** 聚合簇被点击（`size >= minClusterSize`）；载荷是**最新**的簇对象（`points` 是业务项）。 */
  "cluster-click": [cluster: Cluster<Item>];
  /** 未聚合的单点被点击；载荷是**最新**的业务 item。 */
  "item-click": [item: Item];
}>();

/** 聚合的输入单元：业务项 + **已校验**的坐标（一次校验，聚合不再重复读 `getPosition`）。 */
interface ClusterPoint<Item> {
  readonly item: Item;
  readonly point: PointLike;
}

const ctx = useRequiredMapContext();
const scope = new ResourceScope();
let manager: DataLayerManager<Cluster<ClusterPoint<Item>>, MarkerHandle> | null = null;
let readyCtx: MapReadyContext | null = null;

/** 点击回调的 disposer（Handle 被 freeze ⇒ WeakMap 记账）。 */
const clickDisposers = new WeakMap<object, () => void>();
const reports = createProblemReporter("BMarkerCluster", (message) => devWarn(message));
/** 读地图 zoom 失败只告警一次（兜底是显示优化，不该刷屏）。 */
let warnedZoomRead = false;


function buildHost(c: MapReadyContext): DataLayerHost<Cluster<ClusterPoint<Item>>, MarkerHandle> {
  const driver = c.client.driver;
  const target = { kind: "map" as const, handle: c.map };
  return {
    createMarker: (cluster, point) => {
      // 簇 marker 带计数 label（官方 `MarkerOptions.title`）
      const marker = driver.overlays.createMarker(point, { title: String(cluster.size) });
      driver.overlays.add(target, marker);
      clickDisposers.set(
        marker as object,
        driver.events.on(marker, "click", () => {
          // 数据可能已经重算过聚合 ⇒ 读账本里的**最新**簇，而不是创建时闭包里的那个
          const latest = manager?.latestOf(marker) ?? cluster;
          if (latest.size >= props.minClusterSize) {
            // 载荷投影回业务项：聚合的输入单元（`ClusterPoint`）是实现细节，不进公开事件面
            emit("cluster-click", {
              ...latest,
              points: latest.points.map((entry) => entry.item),
            });
          } else emit("item-click", latest.points[0]!.item);
        }),
      );
      return marker;
    },
    removeMarker: (marker) => {
      clickDisposers.get(marker as object)?.();
      clickDisposers.delete(marker as object);
      driver.overlays.remove(target, marker);
    },
    updatePosition: (marker, point) => driver.overlays.setPosition(marker, point),
    setVisible: (marker, visible) => driver.overlays[visible ? "show" : "hide"](marker),
  };
}

function resolveZoom(c: MapReadyContext): number {
  if (props.zoom != null) return props.zoom;
  try {
    const zoom = c.client.driver.map.getZoom(c.map);
    if (typeof zoom === "number") return zoom;
  } catch (error) {
    // 读不到就用兜底值（聚合是显示优化，不该因为读 zoom 失败而整层不显示），但**不静默**：
    // 「聚合结果为什么和平常不一样」需要一个可追的线索。
    if (!warnedZoomRead) {
      warnedZoomRead = true;
      devWarn(
        `[BMarkerCluster] 读取地图 zoom 失败，本次聚合用兜底值 8：${(error as Error)?.message ?? String(error)}`,
      );
    }
  }
  return 8;
}

function applyData(): void {
  if (!manager || !readyCtx) return;
  // 先过滤坏数据（非法坐标会让整桶的平均值变成 NaN），再做聚合。
  const readKey = itemKeyReader(props.itemKey);
  const valid = scanValidItems(props.data, {
    getKey: readKey,
    getPosition: props.getPosition,
    onProblem: (problem) => reports.report(problem),
  });
  const clustered = gridCluster<ClusterPoint<Item>>(
    valid.map((entry) => ({ item: entry.item, point: entry.point })),
    (entry: ClusterPoint<Item>) => entry.point,
    {
      gridSize: props.gridSize,
      minClusterSize: props.minClusterSize,
      zoom: resolveZoom(readyCtx),
      // 展开的单点用业务 key 当 id（缺省是**桶内下标**，不同桶会撞 id ⇒ 静默丢点）
      getKey: (entry: ClusterPoint<Item>) => readKey(entry.item),
    },
  );
  manager.sync({
    items: clustered,
    getKey: (cluster) => cluster.id,
    getPosition: (cluster) => cluster.position,
    version: props.dataVersion,
  });
  manager.flush();
  reports.flush();
}

onMounted(async () => {
  const c = await ctx.whenReady(scope.signal);
  if (scope.isDisposed) return;
  readyCtx = c;
  manager = new DataLayerManager<Cluster<ClusterPoint<Item>>, MarkerHandle>(buildHost(c), {
    label: "BMarkerCluster",
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

watch(
  () => [props.data, props.dataVersion, props.gridSize, props.minClusterSize, props.zoom],
  () => applyData(),
  { deep: false, flush: "sync" },
);

watch(
  () => props.visible,
  (visible) => manager?.setVisible(visible),
  { flush: "sync" },
);

onScopeDispose(() => {
  manager?.dispose();
  manager = null;
});

defineOptions({ name: "BMarkerCluster" });
</script>

<template>
  <slot />
</template>
