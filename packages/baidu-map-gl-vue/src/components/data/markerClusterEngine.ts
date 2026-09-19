/**
 * `markers` 聚合引擎（M6-POINT-CLUSTER / issue #35；由 #34 的 `BMarkerCluster` 平移而来）
 *
 * 先用 `gridCluster()` 做像素网格聚合，再用 `DataLayerManager` 把「簇 / 单点」落地成 Marker
 * （keyed diff + RAF 合帧 + 最新项账本）。不为每个点建 Vue 组件，也不为每个点建 watcher。
 *
 * ## 为什么它还在（而不是「原生可用就删掉」）
 *
 * issue #35 的范围纠正要求「fallback 只由真实缺口触发」，而实测（`scripts/probe-native-point-cluster.mts`）
 * 证明原生 `ClusterLayer` **可用** ⇒ 自动降级不成立，原生是默认路径。
 *
 * 这条引擎保留下来是因为它**多给一样东西**：`cluster-click` 能带回**簇内业务项**
 * （聚合在 JS 侧做，手上就有它们），而原生引擎只能给出 `pointCount` 这类元数据 ——
 * 官方没有公开「簇里有哪几个要素」的读回入口。因此它是一个**显式选择**（`engine: "markers"`），
 * 表达的是「我要业务项，接受每簇一个 Marker 的代价」，不是「原生坏了就用它兜着」。
 *
 * ## 两处与 #34 一脉相承的判定
 *
 * 1. **坏数据在聚合之前就过滤**：非法坐标进了聚合会把**整桶**的平均值污染成 `NaN`，
 *    于是一个坏点会让同桶里的好点一起消失。过滤规则与其它数据组件共用 `core/data/itemScan.ts`；
 * 2. **单点条目的 id 用业务 key**（`gridCluster` 的 `getKey`）：旧实现不传它，展开的单点拿到的是
 *    **桶内下标**（`"0"` / `"1"`…），两个不同桶的单点会撞成同一个 id ⇒ 只留下一个 marker（静默丢点）。
 */
import { DataLayerManager, type DataLayerHost } from "../../core/data/DataLayerManager";
import { gridCluster, type Cluster } from "../../core/data/gridCluster";
import { itemKeyReader, scanValidItems } from "../../core/data/itemScan";
import { createProblemReporter } from "../../core/data/problems";
import { BMapError } from "../../core/errors/BMapError";
import { devWarn, logger } from "../../core/logger";
import type { ClusterEngine, ClusterEngineInput } from "./clusterEngine";
import type { BMapDataProps, BMarkerClusterEngine } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";
import type { MarkerHandle } from "../../driver/types/handles";
import type { PointLike } from "../../core/data/points";

/** 引擎真正读的 props（`BMarkerClusterProps` 的结构子集）。 */
export interface MarkerClusterEngineProps<Item> extends BMapDataProps<Item> {
  /** 像素网格边长（聚合桶的边长），默认 `128`。 */
  readonly gridSize?: number;
  /** 达到该数量才聚合；不足的点展开为独立 item。 */
  readonly minClusterSize?: number;
  /** 聚合使用的 zoom；缺省时读取地图当前 zoom。 */
  readonly zoom?: number;
}

/** 聚合的输入单元：业务项 + **已校验**的坐标（一次校验，聚合不再重复读 `getPosition`）。 */
interface ClusterPoint<Item> {
  readonly item: Item;
  readonly point: PointLike;
}

export function createMarkerClusterEngine<Item>(
  input: ClusterEngineInput<Item>,
  props: MarkerClusterEngineProps<Item>,
  defaults: { gridSize: number; minClusterSize: number },
): ClusterEngine<Item> {
  const { ready, onClusterClick, onItemClick, onChange } = input;
  const readyCtx: MapReadyContext = ready;
  const reports = createProblemReporter(input.label, (message) => devWarn(message));
  let manager: DataLayerManager<Cluster<ClusterPoint<Item>>, MarkerHandle> | null = null;
  /** 已确认生效的显隐（只在 `setVisible` 成功返回后推进；失败 ⇒ 下一次收敛重试）。 */
  let appliedVisible: boolean | null = null;

  /** 点击回调的 disposer（Handle 被 freeze ⇒ WeakMap 记账）。 */
  const clickDisposers = new WeakMap<object, () => void>();
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
            if (latest.size >= minClusterSize()) {
              onClusterClick({
                id: latest.id,
                size: latest.size,
                position: latest.position,
                // 载荷投影回业务项：聚合的输入单元（`ClusterPoint`）是实现细节，不进公开事件面
                items: latest.points.map((entry) => entry.item),
              });
            } else {
              const only = latest.points[0];
              if (only) onItemClick(only.item);
            }
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

  const minClusterSize = (): number => props.minClusterSize ?? defaults.minClusterSize;

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
          `${input.label} 读取地图 zoom 失败，本次聚合用兜底值 8：${(error as Error)?.message ?? String(error)}`,
        );
      }
    }
    return 8;
  }

  function applyData(): void {
    if (!manager) return;
    // 先过滤坏数据（非法坐标会让整桶的平均值变成 NaN），再做聚合。
    const readKey = itemKeyReader(props.itemKey);
    const valid = scanValidItems(props.data, {
      getKey: readKey,
      getPosition: props.getPosition,
      onProblem: (problem) => reports.report(problem),
    });
    const zoom = resolveZoom(readyCtx);
    const clustered = gridCluster<ClusterPoint<Item>>(
      valid.map((entry) => ({ item: entry.item, point: entry.point })),
      (entry: ClusterPoint<Item>) => entry.point,
      {
        gridSize: props.gridSize ?? defaults.gridSize,
        minClusterSize: minClusterSize(),
        zoom,
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
    // 与原生引擎同名同形的读数（原生转发 SDK 的 `change`，这里在重算之后给出同一份）
    onChange({
      clusters: clustered.filter((entry) => entry.clustered).length,
      singles: clustered.filter((entry) => !entry.clustered).length,
      zoom,
    });
  }

  const kind: BMarkerClusterEngine = "markers";

  /**
   * 显隐的**唯一**写入点（props watcher 与 `sync()` 都走它）。
   *
   * `appliedVisible` 只在成功后推进：失败的显隐不是「已完成」，下一次收敛会重试
   * （否则一次 SDK 异常会把声明与画面永久分叉）。
   */
  function applyVisible(): void {
    if (!manager) return;
    const desired = props.visible !== false;
    if (appliedVisible === desired) return;
    manager.setVisible(desired);
    appliedVisible = desired;
  }

  return {
    kind,
    mount() {
      manager = new DataLayerManager<Cluster<ClusterPoint<Item>>, MarkerHandle>(buildHost(readyCtx), {
        label: input.label,
        onProblem: (problem) => reports.report(problem),
        warn: (message) => logger.warn(message),
      });
      applyVisible();
      applyData();
    },
    sync() {
      applyData();
      // 未生效的显隐在这里被补上（`appliedVisible` 只在成功后推进）
      applyVisible();
    },
    setVisible() {
      applyVisible();
    },
    dispose() {
      manager?.dispose();
      manager = null;
    },
    detach() {
      const active = manager;
      if (!active) return;
      active.clear();
      // `clear()` 逐条隔离、不抛错：摘不掉的条目会**保留所有权** ⇒ 计数没归零就是「未确认摘净」。
      // 此时抛错且**不清理本引擎状态**，调用方会放弃换引擎并保留旧引擎（下一次还能再试）。
      if (active.size > 0) {
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `${input.label}: 还有 ${active.size} 个 Marker 未能摘除，无法确认旧引擎已释放`,
        );
      }
      active.dispose();
      manager = null;
    },
  };
}
