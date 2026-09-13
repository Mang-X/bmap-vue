/**
 * PluginRegistry
 *
 * 每地图实例的插件注册表:
 * - 插件名称去重
 * - 依赖拓扑排序与循环依赖检测
 * - idle/loading/ready/error/disposed 状态
 * - 同地图重复请求共用 Promise
 * - required/optional 插件失败策略
 * - 加载取消与 dispose
 * - 结构化 plugin:ready/plugin:error 事件
 */
import { ResourceScope, type Disposer } from "../lifecycle/ResourceScope";
import { BMapError } from "../errors/BMapError";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";

export type PluginStatus = "idle" | "loading" | "ready" | "error" | "disposed";

/** 插件加载上下文：raw `api` 仅供内置/高级插件使用 */
export interface PluginContext {
  readonly client: BMapClient | null;
  readonly map: MapHandle | null;
  readonly api: unknown;
}

export interface BMapPluginDefinition<Resource = unknown> {
  readonly name: string;
  readonly scope?: "global" | "map";
  readonly dependencies?: readonly string[];
  readonly required?: boolean;
  load(context: PluginContext, signal: AbortSignal): Promise<Resource>;
  setup?(resource: Resource, runtime: unknown): void | Disposer;
  dispose?(resource: Resource, runtime: unknown): void;
}

export interface PluginRecord<Resource = unknown> {
  name: string;
  status: PluginStatus;
  instance: Resource | null;
  definition: BMapPluginDefinition<Resource>;
  error?: unknown;
}

export interface PluginRegistry {
  register<Resource>(definition: BMapPluginDefinition<Resource>): void;
  whenPlugin<Resource = unknown>(name: string, signal?: AbortSignal): Promise<Resource>;
  getStatus(name: string): PluginStatus | undefined;
  /**
   * 该插件记录到的失败原因（没有失败过则 `undefined`）。
   *
   * 为什么需要它：**optional 插件失败时 `whenPlugin` 以 `undefined` resolve**（见
   * `loadPlugin` 的失败策略），调用方无法从返回值区分「成功拿到资源」与「失败被吞掉」。
   * 组件侧要如实回执 `plugin-error`，就得能从注册表取回原始错误 —— 否则只能自己造一个
   * 没有 `cause` 的替代错误，把诊断信息丢掉。
   */
  getError(name: string): unknown;
  dispose(): void;
}

export function createPluginRegistry(
  context: PluginContext | (() => PluginContext),
  events: { emit: (type: string, payload: unknown) => void },
  scope: ResourceScope,
): PluginRegistry {
  const records = new Map<string, PluginRecord>();
  const pending = new Map<string, Promise<unknown>>();
  const disposedNames = new Set<string>();

  const getContext =
    typeof context === "function"
      ? (context as () => PluginContext)
      : () => context as PluginContext;

  // 收集目标插件及其全部传递依赖(带循环防护)
  function collectDeps(
    name: string,
    acc = new Set<string>(),
    visiting = new Set<string>(),
  ): Set<string> {
    const def = records.get(name)?.definition;
    if (!def) return acc;
    if (visiting.has(name)) {
      throw new BMapError(
        "BMAP_PLUGIN_LOAD_FAILED",
        `Cyclic plugin dependency involving "${name}"`,
      );
    }
    visiting.add(name);
    acc.add(name);
    for (const dep of def.dependencies ?? []) {
      if (!records.has(dep)) {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          `Plugin "${name}" depends on missing plugin "${dep}"`,
        );
      }
      collectDeps(dep, acc, visiting);
    }
    visiting.delete(name);
    return acc;
  }

  // 拓扑排序 + 循环检测
  function topoSort(names: string[]): string[] {
    const visited = new Map<string, 0 | 1 | 2>(); // 0 unvisited, 1 visiting, 2 done
    const stack: string[] = [];
    const visit = (name: string) => {
      const state = visited.get(name) ?? 0;
      if (state === 2) return;
      if (state === 1)
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          `Cyclic plugin dependency involving "${name}"`,
        );
      visited.set(name, 1);
      const def = records.get(name)?.definition;
      if (def?.dependencies) {
        for (const dep of def.dependencies) visit(dep);
      }
      visited.set(name, 2);
      stack.push(name);
    };
    for (const n of names) visit(n);
    return stack;
  }

  // 按依赖拓扑序加载一组插件,保证依赖先于使用方就绪
  async function loadPluginsInOrder(names: string[]): Promise<void> {
    const ordered = topoSort(names);
    for (const name of ordered) {
      const record = records.get(name) as PluginRecord<any> | undefined;
      if (!record) continue;
      if (record.status === "ready") continue;
      await loadPlugin(record);
    }
  }

  async function loadPlugin<Resource>(record: PluginRecord<Resource>): Promise<Resource> {
    if (record.status === "ready") return record.instance as Resource;
    if (record.status === "loading" && pending.has(record.name)) {
      return pending.get(record.name) as Promise<Resource>;
    }
    record.status = "loading";
    const promise = record.definition
      .load(getContext(), scope.signal)
      .then((instance) => {
        record.instance = instance as Resource;
        record.status = "ready";
        if (record.definition.setup) {
          const disposer = record.definition.setup(instance, getContext());
          if (disposer) scope.add(disposer);
        }
        events.emit("plugin:ready", { name: record.name });
        return instance;
      })
      .catch((error) => {
        record.status = "error";
        record.error = error;
        pending.delete(record.name);
        events.emit("plugin:error", { name: record.name, error });
        if (record.definition.required !== false) throw error;
        return undefined as unknown as Resource;
      });
    pending.set(record.name, promise);
    return promise;
  }

  return {
    register(definition) {
      if (records.has(definition.name)) {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          `Plugin "${definition.name}" already registered`,
        );
      }
      records.set(definition.name, {
        name: definition.name,
        status: "idle",
        instance: null,
        definition,
      });
    },

    async whenPlugin(name, signal) {
      if (!records.has(name))
        throw new BMapError("BMAP_PLUGIN_LOAD_FAILED", `Plugin "${name}" is not registered`);
      const deps = collectDeps(name);
      await loadPluginsInOrder([...deps]);
      return loadPlugin(records.get(name) as PluginRecord<any>);
    },

    getStatus(name) {
      if (disposedNames.has(name)) return "disposed";
      return records.get(name)?.status;
    },

    getError(name) {
      return records.get(name)?.error;
    },

    dispose() {
      for (const record of [...records.values()].reverse()) {
        if (record.definition.dispose && record.instance != null) {
          try {
            record.definition.dispose(record.instance, getContext());
          } catch {
            // 忽略单个插件 dispose 错误
          }
        }
        record.status = "disposed";
        disposedNames.add(record.name);
      }
      pending.clear();
      records.clear();
    },
  };
}
