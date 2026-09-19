/**
 * LayerRegistry —— 每张地图一份的图层账本（M7-LAYERS / issue #40）
 *
 * 记四件事：**所有权（哪个实例）**、**type**、**handle**、**dispose**。
 * 与 `OverlayRegistry` 的分工在最后一条上，值得写清楚：
 *
 * `OverlayRegistry.dispose()` 只释放 owner scope（记录随 owner 消失），**不摘 SDK 资源**；
 * 这在「组件自己负责摘」的覆盖物路径上没问题——组件卸载会调 `map.removeOverlay`。图层的
 * 「Map 卸载前的清理」却是一条**跨 Facet 不变式**：`MapRuntime.dispose()` 必须在
 * `map.destroy()` **之前**把所有图层摘下来（否则 SDK 的异步瓦片 / raf 会在 destroy 之后
 * 访问已被释放的资源）。因此 `MapRuntime.dispose()` 调用本 Registry 的 `disposeAll()`，
 * 它按注册**逆序**（后挂的先摘）逐个 `LayerRecord.dispose()`；每条记录内部沿用 #22 的顺序：
 * **先释放实例 child scope（解绑业务监听）、再摘除 SDK 资源**——反过来会让 SDK 在
 * `removeLayer` 期间同步派发的事件打到已经开始拆解的业务回调上。与 `MapRuntime.dispose()`
 * 的调用时机配套：
 *
 * ```text
 * MapRuntime.dispose()
 *   ├─ 3. layers.disposeAll()   ← 每个 record：释放 child scope → removeLayer（逆序）
 *   └─ 4. map.destroy()
 * ```
 *
 * 记录本身是**幂等**的：`LayerRecord.dispose()` 可以被组件卸载、`replace()` 重建、Map 卸载
 * 三条路径中的任意一条触发，重复调用与交叉调用都只生效一次（与 `ResourceRegistration` 同形，
 * 便于直接交给 `useSdkResource` 的 `mount()` 返回值）。
 *
 * ## 为什么账本也能收留**原生数据图层**（M6-MARKER-POINTCOLLECTION / issue #34）
 *
 * `BPointShapeLayer` 用的是另一个 Facet（`NativeLayerDriver`，句柄品牌 `native-layer:*`），
 * 但它与底图图层有一条完全相同的约束：**必须在 `map.destroy()` 之前被摘掉**。而
 * `MapRuntime` 的释放顺序是「child registries（含本 Registry）→ `map.destroy()` → 根
 * `resources`」，根 scope 太晚、组件自持的 scope 只覆盖「组件卸载」这一条路径
 * （KeepAlive 停用 / 上下文 dispose 都到不了）。因此把 `kind` 放宽成两个 Facet 的并集，
 * 让原生数据图层走**同一条**「destroy 之前摘掉」的路，而不是新造一个只有一个月消费者的注册表。
 *
 * 两个 Facet 的 kind 名不重叠（底图：district / tile / traffic / geojson / dom / xyz / wms /
 * wmts / raster / panorama-coverage；原生：point / cluster / point-icon / point-shape / line /
 * fill / heatmap / track-line），`kind` 只作诊断标签，不参与所有权判定。
 */
import { logger } from "../logger";
import type { LayerHandle } from "../../driver/types/handles";
import type { LayerKind } from "../../driver/types/layers";
import type { NativeLayerHandle, NativeLayerKind } from "../../driver/types/native-layers";
import type { ResourceScope } from "../lifecycle/ResourceScope";

/** 账本里可以登记的图层种类（两个 Facet 的并集，见文件头）。 */
export type LayerLedgerKind = LayerKind | NativeLayerKind;

/** 账本里可以登记的句柄（两个 Facet 的并集，见文件头）。 */
export type LayerLedgerHandle = LayerHandle | NativeLayerHandle;

export interface LayerRecord {
  readonly id: symbol;
  /** 领域种类（账本的 `type` 维度）。 */
  readonly kind: LayerLedgerKind;
  readonly handle: LayerLedgerHandle;
  readonly disposed: boolean;
  /**
   * 资源**确认**的挂载状态（与 `useLayerResource` 的 `MountState` 同源；`detached` 由
   * 「已销账」表达，因此这里只有两态）。
   *
   * `remove` 抛错时**无法判断**副作用有没有发生 ⇒ `"unknown"`：资源可能已经不在地图上、
   * 也可能还在。调用方**不能**把它当成 `attached`（那会留下一份幻影所有权，之后没人再摘它），
   * 也不能当成已摘除（那会重复挂一份）。`unknown` 的收敛方式是**受控地再摘一次**：
   * 成功 ⇒ 确定已摘除；再失败 ⇒ 仍是 `unknown`（状态有界、可观测）。
   */
  readonly attachment: "attached" | "unknown";
  /**
   * **卸载路径**的释放：幂等、**吞错**（摘除失败只记日志），保证调用方一定走完。
   *
   * 适用：组件卸载、Map 卸载（`disposeAll()`）。那里没有「重试」的位置，也没人能承接异常，
   * 所以失败必须可观测而不是抛出。
   */
  dispose(): void;
  /**
   * **替换路径**的严格摘除：**quiesce（挡业务回调，可恢复）→ 摘除 SDK 资源（失败会抛）→ commit（解绑监听 + 销账）**。
   *
   * 三个阶段缺一不可：
   *
   * - **quiesce**：`remove()` 期间 SDK 可能同步派发事件，而资源此刻正在被拆（#22 的口径）；
   * - **remove 失败 ⇒ 状态标成 `unknown`**：`removeLayer` 允许「先产生副作用、再抛错」，因此失败
   *   之后**无法判断资源还在不在图上**。此时只能承诺「业务监听恢复」（`quiesce(false)`），
   *   **不能**承诺「资源恢复」—— 调用方必须按 `record.attachment === "unknown"` 分支，而不是
   *   把它当作「旧实例完整可用」；
   * - **commit 只在成功后**：失败时**不销账**（记录留在账本里，下一次 `dispose()` / `detach()`
   *   会**受控地再摘一次**把 `unknown` 收敛成确定状态），调用方据此**放弃这次替换**。
   *
   * 与 `dispose()` 的分工是一条硬约束：**只有「成功返回」能当作「确认摘掉」**。替换路径不能复用
   * 吞错的 `dispose()`，否则调用方会把「未知」当成「已完成」。
   */
  detach(): void;
}

export interface LayerRegistryInput {
  readonly kind: LayerLedgerKind;
  readonly handle: LayerLedgerHandle;
  /** 实例 child scope：业务监听器 / watcher / timer 都挂在这里。 */
  readonly scope: ResourceScope;
  /** 摘除 SDK 侧资源（`map.removeLayer`）。由调用方闭包捕获 target；重复调用必须安全。 */
  readonly remove: () => void;
  /**
   * **摘除期间的业务回调门**（可选）：`detach()` 会在 `remove` 之前打开、之后关闭。
   *
   * 存在的理由：`remove()` 可能「副作用发生前抛错」，而 `scope.dispose()` 是**不可逆**的 ——
   * 「先解绑监听、再摘资源」（#22 的既有顺序）在失败时会把旧实例留成「还在图上但已经点不动」。
   * 有了这道门，摘除期间业务回调照样不穿透，而失败时旧实例**完全恢复可用**（门关掉即可），
   * 调用方说的「保留旧实例」因此包含行为，而不只是画面。
   */
  readonly quiesce?: (active: boolean) => void;
}

export interface LayerRegistry {
  register(input: LayerRegistryInput): LayerRecord;
  /**
   * 摘除并释放**全部**图层（逆序）。
   *
   * 幂等；`MapRuntime.dispose()` 在 `map.destroy()` 之前调用它。
   */
  disposeAll(): void;
  /**
   * 当前由这张地图**拥有**的存活图层实例数（含暂时隐藏 / 摘下的实例）。
   *
   * 刻意**不是**「地图上此刻挂着几个图层」（attached count）：显隐在本库统一表达为挂载状态
   * （`visible=false` ⇒ `removeLayer`），而注册表只在**创建 / 销毁**时增删——因此
   * `size === 1` 与「地图上一个图层都没挂」完全可能同时成立。
   *
   * 需要 attached count 请读 SDK 侧（或替身的 `harness.attached('layer')`）；两个口径不要混用。
   */
  readonly size: number;
  /** 当前登记的种类（按登记顺序）：诊断与断言用。 */
  kinds(): LayerLedgerKind[];
}

export function createLayerRegistry(): LayerRegistry {
  const records = new Map<symbol, LayerRecord>();

  const registry: LayerRegistry = {
    register(input) {
      const id = Symbol("layer");
      let disposed = false;
      /** 确认的挂载态；`remove` 抛错后置 `unknown`（见 `LayerRecord.attachment`）。 */
      let attachment: "attached" | "unknown" = "attached";
      /**
       * 解绑业务监听（不可逆，只做一次）。抽成函数是因为两条释放路径都要用它，
       * 而它们的唯一区别在**摘除失败之后**怎么处理（吞错 vs 抛出 + 不销账）。
       */
      const unbind = (reason: string): void => {
        if (input.scope.isDisposed) return;
        try {
          input.scope.dispose(reason);
        } catch (error) {
          // 单个 scope 的释放错误不得挡住 SDK 摘除，但不能静默（与 MapRuntime 对
          // `map.destroy` 失败的口径一致：至少要让它可观测）。
          logger.warn(`LayerRegistry: 释放图层 child scope 失败（kind=${input.kind}）`, {
            error: (error as Error)?.message ?? String(error),
          });
        }
      };
      const record: LayerRecord = {
        id,
        kind: input.kind,
        handle: input.handle,
        get disposed() {
          return disposed;
        },
        get attachment() {
          return attachment;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          records.delete(id);
          // 顺序与 #22 的口径一致：**先解绑业务事件**（释放 child scope），再由 Map 摘除
          // SDK 资源。反过来会让 SDK 在 `removeLayer` 期间同步派发的事件打到已经在拆解的
          // 业务回调上（`tileload` 一类事件在真实 SDK 上就是这样）。
          unbind("layer-disposed");
          try {
            input.remove();
          } catch (error) {
            // 摘除失败不抛出：调用方（组件卸载 / Map 卸载）都要继续走完。但它是**资源可能
            // 仍在图上**的信号，必须可观测（SDK 侧不会再有第二次机会告诉你），同时把挂载态
            // 如实标成 `unknown`（诊断读数与「这条记录到底确认摘掉了没有」共用同一个事实）。
            attachment = "unknown";
            logger.warn(`LayerRegistry: 摘除图层失败（kind=${input.kind}），SDK 资源可能仍在图上`, {
              error: (error as Error)?.message ?? String(error),
            });
          }
        },
        detach() {
          if (disposed) return;
          // 两阶段（quiesce → remove → commit）：`scope.dispose()` 不可逆，所以**先不**解绑，
          // 而是把业务回调挡在门外；只有 `remove()` 成功返回才永久解绑并销账。
          input.quiesce?.(true);
          try {
            // `attachment === "unknown"` 时这一次调用同时承担**收敛**职责：成功 ⇒ 它确实已经不在
            // 图上；失败 ⇒ 仍未确认（按下面的 `unknown` 处理）。用的是仓库既有的前提 P ——
            // 「对已经摘掉的图层重复 `removeLayer` 是安全的」，已由 issue #98 的 live 探针实测成立
            // （同 `useLayerResource.syncMounted` 的收敛，见 ADR 决策 12b）。即使前提在某个 kind /
            // 版本上不成立，退化也有界：再抛错就仍是 `unknown`，绝不会因为「猜它已经下去了」而多挂一份。
            input.remove();
          } catch (error) {
            // `removeLayer` 允许「先产生副作用、再抛错」⇒ 此刻**资源可能已不在图上**。
            // 因此这里只能承诺「监听恢复」，不能承诺「资源恢复」：状态如实标成 `unknown`。
            attachment = "unknown";
            // 门关掉：失败后旧实例**可能仍在图上、也可能已不在**，但业务监听这一侧是可恢复的
            // （还在图上就还能点，已经不在就不可能有事件）—— 两种情况下恢复监听都是正确的一侧。
            input.quiesce?.(false);
            throw error;
          }
          unbind("layer-detached");
          input.quiesce?.(false);
          disposed = true;
          records.delete(id);
        },
      };
      records.set(id, record);
      return record;
    },

    disposeAll() {
      // 逆序：后挂的先摘（与 ResourceScope 的 disposer 顺序同源）
      for (const record of [...records.values()].reverse()) {
        record.dispose();
      }
      records.clear();
    },

    get size() {
      return records.size;
    },

    kinds() {
      return [...records.values()].map((record) => record.kind);
    },
  };
  return registry;
}
