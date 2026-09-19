/**
 * InfoWindowManager —— **每张地图**的气泡归属账本（M5-INFOWINDOW / issue #32）
 *
 * 官方 4.0 的约束是：**一张地图同时只有一个气泡处于打开状态**
 * （`map.openInfoWindow(infoWnd, point)` 会把当前那个顶掉）。这个「谁当前开着」的事实
 * 官方不给读回入口——`map.getInfoWindow()` 是**异步生效**的（同一 tick 里刚 open 完仍是
 * `null`），因此本库必须自己记账。
 *
 * 账本只有两项：**注册表**（这张地图上还活着几个气泡）+ **当前项**（观测到实际打开的那一个）。
 * 它只管资源所有权，不判断「哪条回包属于哪次命令」（见 ADR 决策 0）。
 *
 * `activate()` 的调用时机：打开命令成功之后，以及观测到 SDK 的 `open` / `close` / `clickclose` 时。
 * 顺序是**先换当前项、再通知被顶掉的那个** —— 被顶掉者在通知里会收敛自己并置「不抢回来」，
 * 顺序反了会把新主人误清掉。被顶掉的一方不得调 `closeInfoWindow()`（那是地图级入口，会关掉新气泡）。
 */
import { logger } from "../logger";
import type { InfoWindowHandle } from "../../driver/types/handles";

/** 一等注册凭据：与实例 scope 绑定，`dispose()` 幂等。 */
export interface InfoWindowRegistration {
  readonly id: symbol;
  readonly resource: InfoWindowHandle;
  readonly disposed: boolean;
  dispose(): void;
}

export interface InfoWindowRegistrationInput {
  readonly resource: InfoWindowHandle;
  /**
   * 被同一张地图上**别的**气泡顶掉时调用。
   *
   * 契约：只允许收敛自己的状态；**不得**调 `map.closeInfoWindow()` 之类的 map 级 API
   * （那会关掉新的那个）。
   */
  readonly onSuperseded: () => void;
}

export interface InfoWindowManager {
  /** 登记一个存活的气泡实例。 */
  register(input: InfoWindowRegistrationInput): InfoWindowRegistration;
  /**
   * 声明「本次打开成功了」：本实例成为这张地图的当前气泡，上一个会被通知顶掉。
   *
   * 刻意在**打开成功之后**调用：过早声明会在打开失败时白白顶掉别人。
   */
  activate(resource: InfoWindowHandle): void;
  /** 本实例已关闭。只有当它确实是当前项时才清除记账（被顶掉的那个不该清掉新主人）。 */
  deactivate(resource: InfoWindowHandle): void;
  /** 这张地图当前的气泡（没有则为 `null`）。 */
  current(): InfoWindowHandle | null;
  isCurrent(resource: InfoWindowHandle): boolean;
  /** 还活着的气泡实例数（卸载后必须归零，见验收「卸载后无残留」）。 */
  readonly size: number;
  /** 清空账本。不触碰 SDK —— 释放责任在拥有实例的组件。 */
  dispose(): void;
}

export function createInfoWindowManager(): InfoWindowManager {
  const alive = new Map<InfoWindowHandle, { onSuperseded: () => void }>();
  let currentHandle: InfoWindowHandle | null = null;

  return {
    register(input) {
      const id = Symbol("info-window");
      alive.set(input.resource, { onSuperseded: input.onSuperseded });
      let disposed = false;
      return {
        id,
        resource: input.resource,
        get disposed() {
          return disposed;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          alive.delete(input.resource);
          if (currentHandle === input.resource) currentHandle = null;
        },
      };
    },

    activate(resource) {
      // 已经登记过才认：没登记的实例（例如创建失败后被释放的）不该抢走归属
      if (!alive.has(resource)) return;
      const previous = currentHandle;
      if (previous === resource) return;
      // 先换当前项，再通知被顶掉的那个 —— 见模块注释的顺序要求
      currentHandle = resource;
      if (!previous) return;
      const displaced = alive.get(previous);
      if (!displaced) return;
      try {
        displaced.onSuperseded();
      } catch (error) {
        // 通知失败**不得**打断顶替流程：地图已经切到新的那一个了，回滚当前项只会让账本与地图相反。
        // 但也不静默：这条回调里出错意味着某个气泡的状态机卡在过去（它自己会经 `resource:error`
        // 报一次，这里留一条兜底痕迹，便于区分「没有通知」与「通知里抛了」）。
        logger.warn(
          `InfoWindowManager.activate: 通知被顶掉的气泡失败（顶替已经完成）: ${
            (error as Error)?.message ?? String(error)
          }`,
        );
      }
    },

    deactivate(resource) {
      if (currentHandle === resource) currentHandle = null;
    },

    current: () => currentHandle,
    isCurrent: (resource) => currentHandle === resource,
    get size() {
      return alive.size;
    },

    dispose() {
      alive.clear();
      currentHandle = null;
    },
  };
}
