/**
 * useOverlayResource
 *
 * 通用 Overlay 生命周期 composable:
 * - map ready 后创建 SDK 实例
 * - `addToMap` 添加覆盖物并注册进 OverlayRegistry
 * - 通过 `createWatch` 注册字段级 watcher(SDK 就绪后进入 scope)
 * - 卸载时移除 + 销毁 + 释放全部资源
 * - SDK 就绪前卸载:不创建资源(竞态安全)
 */
import { onMounted, onUnmounted, shallowRef, markRaw, type ShallowRef } from "vue";
import { useRequiredMapContext } from "../../core/context/inject";
import { ResourceScope } from "../../core/lifecycle/ResourceScope";
import { BMapError } from "../../core/errors/BMapError";
import { logger } from "../../core/logger";
import type { OverlayHandle } from "../../driver/types/handles";
import type { MapReadyContext } from "../../core/context/types";

export interface OverlayLifecycle<Props, Resource> {
  /** 创建 SDK 实例(可为同步或异步) */
  create(
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): Resource | Promise<Resource>;
  /** 创建后添加到地图(用 true 语义 addOverlay),并注册 overlay */
  addToMap(
    resource: Resource,
    context: MapReadyContext,
    props: Readonly<Props>,
    scope: ResourceScope,
  ): void;
  /**
   * 在 setup 阶段同步注册的 watcher(保证响应式)。
   * 通过 getResource() 读取当前实例(可能为 null),getCtx() 读取 ready 上下文。
   * 全部 watcher 应返回停止函数或注册到该 composable 的 scope。
   */
  createWatchers?(
    getCtx: () => MapReadyContext | null,
    getResource: () => Resource | null,
    props: Readonly<Props>,
    addDisposer: (d: () => void) => void,
  ): void;
  /** 从地图移除并销毁 SDK 实例 */
  remove(resource: Resource, context: MapReadyContext): void;
}

export interface UseOverlayResourceResult<Resource> {
  resource: ShallowRef<Resource | null>;
  ready: Promise<MapReadyContext>;
  /** 用当前 props 重建覆盖物(适合 SDK 不可变对象,如 MapMask path 更新) */
  rebuild: () => Promise<void>;
  /**
   * 按**属性分类**应用一组更新(M3A2-OVERLAYS / #21):
   * - `mutable`: 经 `driver.overlays.setOptions` 就地更新;
   * - `recreate`: 触发 `rebuild()`(构造期属性,只有重建才生效);
   * - `unsupported`/未知: 交给 `setOptions`,由 Driver 决定(告警 no-op 或走 set<Key> 逃生口)。
   *
   * 更新走一条**按键合并的待办队列**（PR #61 两轮评审的收敛点）:
   * - 实例未挂载（重建/首建在飞）时到达的更新会合并待办，等挂载后再落；
   * - 同一批里若有 `recreate` 键，**先重建**、再把 mutable 落到**最终存活**的实例
   *   （否则 mutable 会写进一个马上被移除的中间实例）;
   * - 排空过程中新到的更新继续并入同一轮排空，因此**后到的值总是最后生效**
   *   （挂载回调里同步推的更新不会被更早排队的旧值覆盖）。
   *
   * 返回值：本次调用**发起**排空时等它跑完；已有排空在进行时立即返回（值已并入待办，
   * 会被那一轮消费）—— 不等待在飞的那一轮，避免被一次无关的异步创建卡住。
   *
   * 分类来自 Driver 的 `updatePolicy()`（单一事实源 `OVERLAY_DESCRIPTORS`），组件不自行探测
   * raw SDK 成员形状。注意 `rebuild()` 以**当前 props** 重建，因此 `recreate` 键的调用方要先把
   * 新值写进 props；`mutable` 键可以直接经本方法传值。
   */
  applyOptions: (options: Record<string, unknown>) => Promise<void>;
}

export function useOverlayResource<Props, Resource>(
  props: Readonly<Props>,
  lifecycle: OverlayLifecycle<Props, Resource>,
  overlayType = "overlay",
): UseOverlayResourceResult<Resource> {
  const ctx = useRequiredMapContext();
  const componentScope = new ResourceScope();
  let instanceScope: ResourceScope | null = null;
  const resource = shallowRef<Resource | null>(null);
  let readyCtx: MapReadyContext | null = null;
  let disposed = false;
  let createToken = 0;
  /**
   * 尚未应用到「存活实例」的更新，**按键合并**（同键后写覆盖先写）。
   *
   * 三类来源共用它：重建/首建在飞时到达的更新、挂载回调里同步推送的更新、排空过程中新到的更新。
   * 只有「新值优先」这一条不变式，才能保证最终实例与最新 props 一致（PR #61 两轮评审的 P2）。
   */
  let pendingApply: Record<string, unknown> | null = null;
  /** 是否正在排空待办（防重入：排空过程中新到的更新由同一轮循环继续消费） */
  let draining = false;

  const ensureInstanceScope = () => {
    if (!instanceScope || instanceScope.isDisposed) {
      instanceScope = componentScope.fork("overlay-instance");
    }
    return instanceScope;
  };

  // 在 setup 同步注册响应式 watcher(避免 async 续体丢失响应式)
  // watcher 本体进入 componentScope（跨 rebuild 存活），通过 getResource 读取当前实例
  lifecycle.createWatchers?.(
    () => readyCtx,
    () => resource.value,
    props,
    (d) => componentScope.add(d),
  );

  onMounted(async () => {
    const token = ++createToken;
    try {
      const ready = await ctx.whenReady(componentScope.signal);
      if (componentScope.isDisposed || disposed || token !== createToken) return;
      readyCtx = ready;

      // 每个实例独立 child scope；create/addToMap 的监听与资源进入 instanceScope
      const scope = ensureInstanceScope();
      const created = await lifecycle.create(ready, props, scope);
      if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
        lifecycle.remove(created, ready);
        return;
      }
      const raw: Resource = created;
      resource.value = markRaw(raw as object) as Resource;
      lifecycle.addToMap(created, ready, props, scope);
      // 首建期间累积的更新在这里排空（挂载回调若也推了更新，合并时「新值优先」）
      await drainAppliedUpdates();
    } catch (error) {
      if (!componentScope.signal.aborted && !disposed) {
        ctx.events.emit("resource:error", {
          error:
            error instanceof BMapError
              ? error
              : new BMapError("BMAP_RESOURCE_CREATE_FAILED", String(error), { cause: error }),
          component: (props as any)?.__componentName,
        });
      }
    }
  });

  onUnmounted(() => {
    disposed = true;
    const current = resource.value;
    if (current && readyCtx) {
      try {
        lifecycle.remove(current, readyCtx);
      } catch {
        // SDK teardown can fail after the map has already been disposed.
      }
    }
    resource.value = null;
    pendingApply = null;
    instanceScope?.dispose();
    instanceScope = null;
    componentScope.dispose();
  });

  /** 用当前 props 重建覆盖物(remove 旧 + create 新 + add) */
  const rebuild = async () => {
    if (!readyCtx || disposed) return;
    const ready = readyCtx;
    const old = resource.value;
    if (old) {
      try {
        lifecycle.remove(old, ready);
      } catch {
        /* 忽略移除错误 */
      }
      resource.value = null;
    }
    // 废弃旧 instanceScope，重 fork 新实例 scope，避免复用同一 scope 堆积 listener
    instanceScope?.dispose();
    instanceScope = componentScope.fork("overlay-instance");
    const scope = instanceScope;
    const token = ++createToken;
    const created = await lifecycle.create(ready, props, scope);
    if (scope.isDisposed || componentScope.isDisposed || disposed || token !== createToken) {
      try {
        lifecycle.remove(created, ready);
      } catch {
        /* 忽略清理错误 */
      }
      return;
    }
    resource.value = markRaw(created as object) as Resource;
    lifecycle.addToMap(created, ready, props, scope);
    // 排空待办；**不 await** 以免与「由排空驱动的 rebuild」互相等待（此时另一轮排空会把新值消费掉）
    void drainAppliedUpdates();
  };

  /**
   * 把**更早取出的旧批次**放回待办。
   *
   * 展开顺序必须是「已有队列在后」：`batch` 是先前从队列里取走的那一批，而 `pendingApply` 里可能
   * 已经积压了等待期间到达的**更新**的值；反过来展开会让旧值覆盖新值，与「新值优先」相反
   * （PR #61 第三轮评审 P2：重建被另一轮重建取代时，旧批次重新入队会翻上新值）。
   *
   * 注意与 `applyOptions()` 的入队方向相反：那里 `options` 才是新到的更新，所以放最后。
   */
  const requeueStaleBatch = (batch: Record<string, unknown>): void => {
    pendingApply = { ...batch, ...(pendingApply ?? {}) };
  };

  /**
   * 把一批已合并的更新落到**当前存活实例**上。
   *
   * 顺序刻意是「先重建、再就地更新」：一批里如果同时含构造期属性与 mutable 属性，
   * mutable 的值必须落在**最终存活**的实例上，否则会写进一个马上被移除的中间实例
   * （PR #61 复审 P2-2）。
   */
  const applyBatch = async (batch: Record<string, unknown>): Promise<void> => {
    if (!readyCtx || disposed) return;
    const current = resource.value;
    if (!current) {
      // 防御分支：当前排空循环已保证有存活实例，这里只兜住未来调用方的变化
      requeueStaleBatch(batch);
      return;
    }
    const overlays = readyCtx.client.driver.overlays;
    const inPlace: Record<string, unknown> = {};
    let needsRebuild = false;
    for (const [key, value] of Object.entries(batch)) {
      if (overlays.updatePolicy(current as OverlayHandle, key) === "recreate") {
        needsRebuild = true;
        continue;
      }
      inPlace[key] = value;
    }
    if (needsRebuild) await rebuild();
    const target = resource.value;
    if (!target) {
      // 重建被取代/未产出实例：整批放回（新值优先），等下一次挂载后重试
      requeueStaleBatch(batch);
      return;
    }
    if (Object.keys(inPlace).length === 0) return;
    try {
      overlays.setOptions(target as OverlayHandle, inPlace);
    } catch (error) {
      // 不静默吞：字段级更新失败时必须留下可观测的痕迹
      logger.warn(
        `useOverlayResource.applyOptions: 字段级更新失败: ${
          (error as Error)?.message ?? String(error)
        }`,
      );
    }
  };

  /**
   * 排空待办：**单飞 + while**。
   *
   * 排空过程中新到的更新会继续合并进 `pendingApply`，由同一轮循环继续消费 —— 因此旧批永远
   * 不会覆盖后到的新值（PR #61 复审 P2-1：挂载回调里同步推的更新曾被旧队列回放覆盖）。
   *
   * 返回值语义刻意**不等待在飞的那一轮**：调用方的值已经并入待办、一定会被那一轮消费；
   * 如果在飞时也去 await，`await applyOptions()` 就会被一次无关的异步创建卡住（甚至与
   * 由排空驱动的 rebuild 互相等待）。只有**发起**这一轮的调用方需要等它跑完。
   */
  const drainAppliedUpdates = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pendingApply && resource.value && !disposed) {
        const batch = pendingApply;
        pendingApply = null;
        await applyBatch(batch);
      }
    } finally {
      draining = false;
    }
  };

  /**
   * 按属性分类应用一组更新（对外入口）：
   * - 合并进待办（同键后写覆盖先写）；
   * - 没有存活实例时等待下一次挂载后排空；
   * - 排空时**先重建**（若有构造期属性）、再把 mutable 落到存活实例。
   */
  const applyOptions = async (options: Record<string, unknown>): Promise<void> => {
    if (!readyCtx || disposed) return;
    // 这里 `options` 才是新到的更新，所以放在最后展开（与 requeueStaleBatch 方向相反）
    pendingApply = { ...(pendingApply ?? {}), ...options };
    await drainAppliedUpdates();
  };

  return {
    resource,
    ready: ctx.whenReady(componentScope.signal),
    rebuild,
    applyOptions,
  };
}

/** 通用的 overlay 移除 helper:经 Driver 从地图 removeOverlay */
export function removeOverlay(resource: unknown, ctx: MapReadyContext) {
  ctx.client.driver.overlays.remove({ kind: "map", handle: ctx.map }, resource as OverlayHandle);
}
