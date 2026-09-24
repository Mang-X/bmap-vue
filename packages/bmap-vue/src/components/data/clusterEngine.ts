/**
 * 聚合引擎的**内部契约**（M6-POINT-CLUSTER / issue #35）
 *
 * `BMarkerCluster` 有两个引擎，它们的资源形态完全不同：
 *
 * | 引擎 | 落地成什么 | 说明 |
 * | --- | --- | --- |
 * | `native` | 一个 v4 原生 `ClusterLayer`（WebGL） | 默认；官方扩展 API |
 * | `markers` | 网格聚合 + 每簇 / 每单点一个 SDK Marker | 显式选择；能拿到簇内业务项 |
 *
 * 两个引擎的**调用方视角**是一样的（`mount` → `sync` → `dispose`），差异收在各自的实现里。
 * 这份接口刻意做成「普通对象 + 显式生命周期」而不是 composable：`engine` 变化要能在一个组件的
 * 生命周期内**换掉整个引擎**（旧引擎先释放、新引擎再挂载），而 `onMounted` / `onUnmounted`
 * 这类钩子做不到「中途停掉一个」。SFC 只负责「等待地图就绪 → 选引擎 → 把 props 变化分发下去」。
 */
import type { BMapClusterChange, BMapClusterPick, BMarkerClusterEngine } from "../../types/components";
import type { MapReadyContext } from "../../core/context/types";
import type { PointLike } from "../../core/data/points";

/** 一种聚合产物的领域读数（两个引擎都从这里投影出 `cluster-click` 的载荷）。 */
export interface ClusterReadout<Item> {
  /** 稳定标识（native = 官方 `clusterId`；markers = 网格 id）。 */
  readonly id: string;
  /** 簇内点数。 */
  readonly size: number;
  /** 簇位置。 */
  readonly position: PointLike;
  /** 簇内业务项；该引擎拿不到时为 `null`（见 `BMapClusterPick.items`）。 */
  readonly items: Item[] | null;
}

export interface ClusterEngineInput<Item> {
  /** 地图就绪上下文（由 SFC 在 `whenReady` 之后交出）。 */
  readonly ready: MapReadyContext;
  /** 资源的诊断标签（账本 / 告警用）。 */
  readonly label: string;
  /** 报告坏数据等问题（SFC 已经接好 `devWarn` 与聚合）。 */
  readonly onProblem: (message: string) => void;
  /** 簇被点击。 */
  readonly onClusterClick: (readout: ClusterReadout<Item>) => void;
  /** 未聚合的单点被点击（载荷是**最新**业务项）。 */
  readonly onItemClick: (item: Item) => void;
  /**
   * 聚合结果变化（两个引擎都提供）。
   *
   * 这是**读数转发**而不是状态镜像：原生引擎转发 SDK 的 `change` 事件、markers 引擎在自己
   * 重算之后给出同一份读数。本库不把它存在组件状态里，也不据此推导任何业务行为
   * （ownership-first：组件拥有的只有 props）。
   */
  readonly onChange: (change: ClusterChangeReadout) => void;
}

/** 一次聚合结果的读数（两种引擎的公共面）。 */
export interface ClusterChangeReadout {
  readonly clusters: number;
  readonly singles: number;
  /** 本次聚合使用的 zoom；引擎不提供时为 `null`（不编一个数字）。 */
  readonly zoom: number | null;
}

/**
 * 一个聚合引擎。
 *
 * 四个方法都是**幂等**的：`dispose()` 可以被组件卸载、引擎切换两条路径触发；`sync()` 允许
 * 在未挂载时被调用（SFC 在就绪之前不会调它，但不要依赖这一点）。
 *
 * **失败一律抛出**（不在引擎内部吞掉）：SFC 把它们统一转成 `resource:error`。
 * 引擎各自报错会让「谁负责把错误交给用户」有两个答案，而原生聚合是**异步注入**的扩展 API
 * （`BMAP_CAPABILITY_UNSUPPORTED` 是预期内的失败），这条路径必须只有一个出口。
 */
export interface ClusterEngine<Item> {
  readonly kind: BMarkerClusterEngine;
  /** 建立资源（创建 + 挂载 + 首次交付数据）。 */
  mount(): void;
  /** props 变化后的收敛（数据 / 聚合参数 / 可见性）。 */
  sync(): void;
  /** 显示 / 隐藏（两个引擎都实现「隐藏 ≠ 摘掉」）。 */
  setVisible(visible: boolean): void;
  /**
   * **卸载路径**的释放：best-effort、幂等、不抛（组件卸载 / 组件销毁）。
   *
   * 那里没有「重试」的位置，也没人能承接异常 ⇒ 失败必须可观测（日志 / `resource:error`）
   * 而不是抛出。
   */
  dispose(): void;
  /**
   * **换引擎路径**的严格释放：旧资源**未确认摘除时抛错**。
   *
   * 调用方（SFC）必须据此**放弃这次换引擎并保留旧引擎**——否则旧的还在图上、新的又挂上去，
   * 两套资源同图（而且旧的那份再也没人认领）。与 `dispose()` 的分工同 `LayerRecord`：
   * `removeLayer` 允许「先产生副作用、再抛错」，所以只有「成功返回」能当作「确认摘掉」。
   */
  detach(): void;
}

/** 供两个引擎共用的「载荷组装」——两种引擎的 `cluster-click` 只有 `items` 一项不同。 */
export function toClusterPick<Item>(
  engine: BMarkerClusterEngine,
  readout: ClusterReadout<Item>,
): BMapClusterPick<Item> {
  return {
    engine,
    id: readout.id,
    size: readout.size,
    position: { lng: readout.position.lng, lat: readout.position.lat },
    items: readout.items,
  };
}

/** 同上的「聚合结果」投影（`cluster-change` 的载荷）。 */
export function toClusterChange(
  engine: BMarkerClusterEngine,
  readout: ClusterChangeReadout,
): BMapClusterChange {
  return { engine, clusters: readout.clusters, singles: readout.singles, zoom: readout.zoom };
}
