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
import { DataLayerManager, type DataLayerHost, type DataLayerSync } from "../../core/data/DataLayerManager";
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
  /**
   * 摘除期间的业务回调门（`detach()` 打开）。与 `LayerRegistryInput.quiesce` 同一语义：
   * 摘除期间不穿透，失败后关掉门 ⇒ 旧引擎的**交互**恢复；已摘除的覆盖物是否还在图上无法判断，
   * 因此这里用 `unknown` 计数如实上报，而不是宣称「恢复完整」。
   */
  let quiescing = false;
  /** 上一次交给 `DataLayerManager` 的输入：部分摘除失败时用它把旧引擎**重放回完整状态**。 */
  let lastSync: DataLayerSync<Cluster<ClusterPoint<Item>>> | null = null;

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
            // 摘除期间不穿透（SDK 可能在 `removeOverlay` 里同步派发事件）
            if (quiescing) return;
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
        // ⚠️ 顺序：**先摘、后删 disposer**。反过来时一次抛错的 `removeOverlay` 会把 Marker
        // 留在图上却已经没人认领它的监听（与「记账晚于副作用」同源）。
        driver.overlays.remove(target, marker);
        clickDisposers.get(marker as object)?.();
        clickDisposers.delete(marker as object);
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
    const syncInput: DataLayerSync<Cluster<ClusterPoint<Item>>> = {
      items: clustered,
      getKey: (cluster) => cluster.id,
      getPosition: (cluster) => cluster.position,
      version: props.dataVersion,
    };
    // 记住这一份输入：部分摘除失败时要靠它把旧引擎重放回**完整**状态（见 `detach()`）
    lastSync = syncInput;
    manager.sync(syncInput);
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
      // 两阶段（quiesce → clear → commit）：
      // `removeMarker` 会删掉 click disposer、`clear()` 还会清 item index，都是**不可逆**的，
      // 所以先挡业务回调、只有确认摘净才让它们永久生效。
      quiescing = true;
      active.clear();
      if (active.size > 0) {
        // **有一部分摘不掉**。`removeOverlay` 允许「先产生副作用、再抛错」，因此这些资源的
        // 挂载态是 **unknown**：可能仍在图上、也可能已经不在。这里能做的与**不能**做的都要写清楚：
        //
        // - 能：把**确认摘掉**的那些用上一次输入重放一次补回来（重放只会补建已经不在 `resources`
        //   里的 key；未知的那些**保留所有权、不重建** —— 重建可能重复挂一份）；
        // - 不能：宣称「旧引擎恢复完整」。未知的那些是否在图上无从判断，因此如实上报数量。
        //
        // 也不做「再摘一次」的收敛：覆盖物的重复 `removeOverlay` 安全性本库**没有 live 取证**
        // （图层那边有 #98 的实测，见 ADR 决策 12b）。无证据就收敛 = 猜，所以这里停在上报 `unknown`。
        // 从**持久状态**读，而不是临时把 `size` 叫成 unknown：`clear()` 失败的那些已经在
        // `DataLayerManager.unknownKeys` 里留下记录，之后不会再被当成正常资源写。
        const unknown = active.unknownSize;
        let replayed = false;
        try {
          if (lastSync) {
            active.sync(lastSync);
            active.flush();
            replayed = true;
          }
        } catch (error) {
          // 重放失败也要把门关掉（否则旧引擎连点击都没了），并把这条信息交出去
          devWarn(
            `${input.label}: 换引擎时摘除未完成，且重放上次数据失败：` +
              `${(error as Error)?.message ?? String(error)}`,
          );
        } finally {
          quiescing = false;
        }
        throw new BMapError(
          "BMAP_SDK_CALL_FAILED",
          `${input.label}: ${unknown} 个 Marker 未能确认摘除（可能仍在图上）` +
            `${replayed ? "；确认摘掉的那些已按上次数据补建" : ""}，已放弃换引擎` +
            `。旧引擎的交互已恢复，但这 ${unknown} 个 Marker 的挂载态仍是 unknown`,
        );
      }
      active.dispose();
      manager = null;
      quiescing = false;
    },
  };
}
