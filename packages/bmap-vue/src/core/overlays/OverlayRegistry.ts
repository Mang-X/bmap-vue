/**
 * OverlayRegistry —— 每张地图的覆盖物注册表
 *
 * 记账模型（M5-SPEC-MARKER / issue #30 定型）：
 *
 * - **所有者是实例 scope，不是注册表**。`registerResource()` 返回一个自带 `dispose()` 的一等
 *   registration，并把「从表里摘除」这条 detach 交给**实例 scope**；scope 释放（重建 / 卸载）
 *   时记录自动消失，调用方不必记得再调一次 `unregister`。
 * - **注册表不持有释放历史**。此前还有一条 `register(type, instance, owner?)` 的旧 API：它把
 *   owner scope 的所有权反过来交给注册表（`dispose()` 会去释放别人的 scope），并且把 detach
 *   闭包挂在记录的私有字段 `__detach` 上供 `unregister` 取用——那正好是「历史 disposer 闭包」
 *   的形态，而且没有任何生产消费者。旧 API 与那个私有字段一起删除。
 * - 因此 `dispose()` 只**清空记录**：owner scope 由拥有它的组件释放，注册表不越权。
 */
import type { ResourceScope } from "../lifecycle/ResourceScope";

export interface OverlayRecord<Resource = unknown> {
  readonly id: symbol;
  readonly type: string;
  readonly instance: Resource;
  /** 拥有这条记录的实例 scope（诊断用；它才是释放的责任方）。 */
  readonly owner: ResourceScope;
}

/**
 * 一等注册凭据：**自带走**。
 *
 * `dispose()` 幂等，并且同时做两件事：把记录从表里摘掉、把 detach 从 owner scope 摘掉
 * （后者防止「注册 → 释放 → 再注册」反复堆积 scope 里的失效闭包）。
 */
export interface ResourceRegistration<Resource = unknown> {
  readonly id: symbol;
  readonly type: string;
  readonly resource: Resource;
  readonly disposed: boolean;
  dispose(): void;
}

export interface ResourceRegistrationInput<Resource = unknown> {
  type: string;
  resource: Resource;
  /** 拥有这条记录的实例 scope。 */
  scope: ResourceScope;
  /** 从地图上移除实例（由调用方给出；注册表只管记账，不碰 Driver）。 */
  remove: (resource: Resource) => void;
}

export interface OverlayRegistry {
  /**
   * 登记一个覆盖物实例，返回自带 `dispose` 的 registration；记录的生命周期与 `scope` 绑定。
   */
  registerResource<Resource>(input: ResourceRegistrationInput<Resource>): ResourceRegistration<Resource>;
  get(id: symbol): OverlayRecord | undefined;
  getByType<Resource = unknown>(type: string): OverlayRecord<Resource>[];
  /** 同步 registry 以反映 `map.clearOverlays()` 清除的全部 overlay（只清记录，不调 SDK）。 */
  clearAll(): void;
  /** 清空记录。**不**释放 owner scope —— 释放责任在拥有实例的组件，见模块注释。 */
  dispose(): void;
  get size(): number;
}

export function createOverlayRegistry(): OverlayRegistry {
  const records = new Map<symbol, OverlayRecord>();

  return {
    registerResource<Resource>(
      input: ResourceRegistrationInput<Resource>,
    ): ResourceRegistration<Resource> {
      const id = Symbol(input.type);
      const rec: OverlayRecord<Resource> = {
        id,
        type: input.type,
        instance: input.resource,
        owner: input.scope,
      };
      records.set(id, rec);

      let disposed = false;
      // scope 释放时自动摘除记录（SDK 侧的 remove 由调用方显式 dispose 时执行）
      const detach = () => {
        records.delete(id);
      };
      // `add()` 在 scope 已释放时会立即执行 detach —— 那是正确语义：记录不会活在注册表里
      const removeDetach = input.scope.add(detach);

      return {
        id,
        type: input.type,
        resource: input.resource,
        get disposed() {
          return disposed;
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          try {
            input.remove(input.resource);
          } finally {
            records.delete(id);
            removeDetach();
          }
        },
      };
    },

    get(id) {
      return records.get(id);
    },

    getByType(type) {
      return [...records.values()].filter((record) => record.type === type) as OverlayRecord<any>[];
    },

    clearAll() {
      // 模拟 map.clearOverlays：移除全部记录（不逐个调 SDK remove —— SDK 已经清过了）
      records.clear();
    },

    dispose() {
      records.clear();
    },

    get size() {
      return records.size;
    },
  };
}
