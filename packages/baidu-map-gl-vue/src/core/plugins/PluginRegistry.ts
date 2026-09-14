/**
 * PluginRegistry
 *
 * 每地图实例的插件注册表:
 * - 插件名称去重
 * - 依赖拓扑排序（**按层并行**）与循环 / 缺失依赖检测
 * - idle/loading/ready/error/disposed 状态，且状态**可读**（`inspect`）而非只靠瞬时事件
 * - 同地图重复请求共用 Promise
 * - required/optional 插件失败策略（optional 失败 resolve `null`）
 * - **消费者取消只影响自身**：`whenPlugin(name, signal)` 的 signal 只解绑这一个等待者
 * - `global` / `map` 作用域分离：global 走共享宿主，map 随地图生命周期
 *
 * ## 作用域（M8-PLUGIN-CORE / issue #42）
 *
 * `scope` 字段此前**声明了但从未被读取**，于是「四个内置插件都是文档级脚本」这件事在运行时
 * 完全没有体现：每张地图各建一份注册表、各插一份 `<script>`，而且 `whenPlugin` 把地图自己的
 * `scope.signal` 传给 `load()`，导致一张地图卸载可能把另一张地图正在等的加载一起取消。
 *
 * | scope | 谁持有资源 | 谁有权释放 | 典型 |
 * | --- | --- | --- | --- |
 * | `"global"` | 进程级 `PluginHost` | 宿主 `dispose()`（测试/热更新） | 文档级脚本插件（内置四个） |
 * | `"map"`（**缺省**） | 本注册表 + 地图 `ResourceScope` | 随地图卸载 | 只服务单张地图的自定义插件 |
 *
 * 缺省取 `"map"` 是刻意的：不写 `scope` 的自定义插件保持「这张地图自己的事」这一既有语义，
 * 不会因为本票而突然变成跨地图共享。内置四个插件在 `builtins.ts` 里显式标了 `global`。
 *
 * 为什么地图卸载**不**释放 global 资源：上游（`BMapGLLib` / MapVGL 脚本）没有卸载入口，
 * 能做的只有「删 `<script>` + 抹全局」，而 AGENTS.md 明令不得删除 / 改写上游注入的 script。
 * 决策与取舍见 ADR `2026-09-14-plugin-catalog-scope-scheduling`。
 */
import { ResourceScope, type Disposer } from "../lifecycle/ResourceScope";
import { BMapError } from "../errors/BMapError";
import type { BMapClient } from "../../client/types";
import type { MapHandle } from "../../driver/types/handles";
import {
  getDefaultPluginHost,
  type PluginHost,
} from "./PluginHost";
import { abortRace, pluginAbortError } from "./pluginAbort";

export type PluginStatus = "idle" | "loading" | "ready" | "error" | "disposed";

/**
 * 插件资源的作用域。
 *
 * - `"global"`：文档级资源（注入 `<script>`、挂全局），跨地图共享，由 `PluginHost` 持有；
 * - `"map"`：只服务单张地图，随该地图的 `ResourceScope` 释放。**缺省值**。
 */
export type PluginScope = "global" | "map";

/** 插件加载上下文：raw `api` 仅供内置/高级插件使用 */
export interface PluginContext {
  readonly client: BMapClient | null;
  readonly map: MapHandle | null;
  readonly api: unknown;
}

export interface BMapPluginDefinition<Resource = unknown> {
  readonly name: string;
  /** 缺省 `"map"`（见文件头「作用域」表）。 */
  readonly scope?: PluginScope;
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
  /** 归一后的作用域（`undefined` 已按缺省 `"map"` 落定）。 */
  scope: PluginScope;
  /** 进入 `load()` 的累计次数：>1 即发生过失败重试。 */
  attempts: number;
  /** 当前仍在等待该插件的消费者数（消费者取消会让它下降）。 */
  consumers: number;
  error?: unknown;
}

/**
 * 注册表状态的**只读读数**。
 *
 * 为什么要有它（issue 实施步骤 5「状态可读取而非仅瞬时广播」）：`plugin:ready` / `plugin:error`
 * 是瞬时广播，错过就没了；而「这个插件现在是什么状态、试过几次、还有几个消费者在等」
 * 是排查问题时真正要问的三个问题。
 */
export interface PluginInspection {
  readonly name: string;
  readonly scope: PluginScope;
  readonly required: boolean;
  readonly status: PluginStatus;
  readonly attempts: number;
  readonly consumers: number;
  readonly error?: unknown;
}

export interface PluginRegistry {
  register<Resource>(definition: BMapPluginDefinition<Resource>): void;  /**
   * 等待插件就绪。
   *
   * - 成功 → 资源实例（**void 插件**的 `undefined` 也是合法成功值）；
   * - optional 插件失败 → `null`（不是 `undefined`：`undefined` 是 void 插件的合法返回值，
   *   用它表达失败会让两种语义撞车，评审 #85 P1-2）；
   * - required 插件失败 → 抛原始错误；
   * - `signal` abort → 抛 `BMAP_PROVIDER_ABORTED`，**只影响本次等待**。
   */
  whenPlugin<Resource = unknown>(name: string, signal?: AbortSignal): Promise<Resource | null>;
  getStatus(name: string): PluginStatus | undefined;
  /**
   * 该插件记录到的失败原因（没有失败过则 `undefined`）。
   *
   * 为什么需要它：**optional 插件失败时 `whenPlugin` 以 `null` resolve**（见 `loadPlugin` 的
   * 失败策略），调用方无法从返回值区分「成功拿到资源」与「失败被吞掉」。组件侧要如实回执
   * `plugin-error`，就得能从注册表取回原始错误 —— 否则只能自己造一个没有 `cause` 的替代错误。
   *
   * 重试成功后会**清空**：留着旧错误会让调用方以为「刚加载好的插件其实还在错」。
   */
  getError(name: string): unknown;
  /** 状态读数（含 scope / attempts / consumers）；未注册的名字返回 `undefined`。 */
  inspect(name: string): PluginInspection | undefined;
  dispose(): void;
}

export interface CreatePluginRegistryOptions {
  /**
   * `global` 作用域插件的共享宿主。缺省用进程级默认宿主（见 `PluginHost`）。
   *
   * 传入自有宿主是为了测试与多租户隔离；正常用法不需要传。
   */
  host?: PluginHost;
}

/** 注册期校验：JS 调用方是 scope 与 name 的唯一防线（类型检查挡不住 `as any` 与纯 JS）。 */
function assertPluginDefinition(definition: BMapPluginDefinition<unknown>): void {
  if (typeof definition.name !== "string" || definition.name.length === 0) {
    throw new BMapError("BMAP_INVALID_ARGUMENT", "Plugin definition requires a non-empty name");
  }
  const scope = definition.scope;
  if (scope !== undefined && scope !== "global" && scope !== "map") {
    throw new BMapError(
      "BMAP_INVALID_ARGUMENT",
      `Plugin "${definition.name}" has an invalid scope "${String(scope)}"; expected "global" or "map"`,
      { plugin: definition.name },
    );
  }
}

/** 未注册的名字：与「认得名字但加载失败」必须分开，重试前者的语义没有意义。 */
function unknownPluginError(name: string): BMapError {
  return new BMapError("BMAP_PLUGIN_UNKNOWN", `Plugin "${name}" is not registered`, {
    plugin: name,
  });
}

/**
 * 注册表的内部记录：比公开的 `PluginRecord` 多一个**在飞 promise**。
 *
 * 放在内部类型而不是公开类型上，是因为「同一次加载的 promise 是谁」属于实现细节；
 * 对外要暴露的是 `inspect()` 那组读数。
 */
interface InternalPluginRecord extends PluginRecord {
  promise: Promise<unknown> | null;
}

export function createPluginRegistry(
  context: PluginContext | (() => PluginContext),
  events: { emit: (type: string, payload: unknown) => void },
  scope: ResourceScope,
  options: CreatePluginRegistryOptions = {},
): PluginRegistry {
  const records = new Map<string, InternalPluginRecord>();
  const host = options.host ?? getDefaultPluginHost();

  /**
   * 本注册表自己的取消信号。
   *
   * 与 `scope.signal` 的分工：`scope` 由地图（`MapRuntime`）持有，而 `plugins.dispose()` 在
   * `resources.dispose()` **之前**被调用，中间没有 abort。没有这个内部信号的话，
   * 「注册表已销毁、但消费者还在等一个不会有人管的加载」就会挂住。
   *
   * 同时注册到 `scope` 上：地图 scope 释放时也把它 abort 掉（双向收口，不需要调用方记得两件事）。
   */
  const abort = new AbortController();
  scope.add(() => abort.abort("map-scope-disposed"));
  let disposed = false;

  const getContext =
    typeof context === "function" ? (context as () => PluginContext) : () => context;

  /** 收集目标插件的全部传递依赖（**不含目标自己**），并在过程中检测循环与缺失。 */
  function collectDependencies(
    name: string,
    acc = new Set<string>(),
    visiting = new Set<string>(),
  ): Set<string> {
    const record = records.get(name);
    const definition = record?.definition;
    if (!definition) return acc;
    if (visiting.has(name)) {
      throw new BMapError(
        "BMAP_PLUGIN_LOAD_FAILED",
        `Cyclic plugin dependency involving "${name}"`,
        { plugin: name },
      );
    }
    visiting.add(name);
    acc.add(name);
    for (const dep of definition.dependencies ?? []) {
      if (!records.has(dep)) {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          `Plugin "${name}" depends on missing plugin "${dep}"`,
          { plugin: name },
        );
      }
      collectDependencies(dep, acc, visiting);
    }
    visiting.delete(name);
    return acc;
  }

  /**
   * 把依赖闭包按深度分层：同层之间没有依赖关系，可以并行。
   *
   * 层内保持**发现顺序**，让加载顺序可复现（用例才敢断言顺序）。循环与缺失依赖已在
   * `collectDependencies` 里被挡掉，这里不需要再判一次。
   */
  function dependencyLayers(target: string): string[][] {
    const closure = collectDependencies(target);
    closure.delete(target);
    const inClosure = new Set(closure);
    const depth = new Map<string, number>();
    const compute = (name: string): number => {
      const cached = depth.get(name);
      if (cached !== undefined) return cached;
      // 先落一个保守值：即使上游哪天漏了循环检测，也不会在这里无限递归
      depth.set(name, 0);
      let value = 0;
      for (const dep of records.get(name)?.definition.dependencies ?? []) {
        if (!inClosure.has(dep)) continue;
        value = Math.max(value, compute(dep) + 1);
      }
      depth.set(name, value);
      return value;
    };

    const layers: string[][] = [];
    for (const name of closure) {
      const level = compute(name);
      (layers[level] ??= []).push(name);
    }
    return layers.filter((layer): layer is string[] => Array.isArray(layer));
  }

  /** `global` 作用域走共享宿主；其余由本注册表按地图生命周期持有。 */
  function loadOwnedResource(record: InternalPluginRecord): Promise<unknown> {
    if (record.scope === "global") {
      return host.acquire(record.name, record.definition, getContext());
    }
    return Promise.resolve(record.definition.load(getContext(), scope.signal)).then((instance) => {
      if (record.definition.setup) {
        const disposer = record.definition.setup(instance, getContext());
        if (disposer) scope.add(disposer);
      }
      return instance;
    });
  }

  /**
   * 启动一次加载。
   *
   * `loadOwnedResource` 必须**在 try 里调用**：`definition.load()` 是调用方提供的函数，
   * 同步抛错（例如 `load(ctx) { if (!ctx.map) throw ... }` 这种没有 async 的写法）是完全可能的。
   * 不接住它的话，异常会直接穿透 `loadPlugin` —— 不走 optional→`null`、不记 `record.error`、
   * 不发 `plugin:error`，而 `record.status` 会永久停在 `loading`。那不是「隔离」，
   * 是把一个可诊断的失败变成一个卡住的状态。
   */
  function startLoad(record: InternalPluginRecord): Promise<unknown> {
    try {
      return loadOwnedResource(record);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function loadPlugin(record: InternalPluginRecord): Promise<unknown> {
    if (record.status === "ready") return Promise.resolve(record.instance);
    if (record.status === "loading" && record.promise) return record.promise;
    if (disposed) {
      return Promise.reject(
        new BMapError("BMAP_RESOURCE_DISPOSED", `Plugin registry disposed; "${record.name}"`, {
          plugin: record.name,
        }),
      );
    }

    record.status = "loading";
    record.attempts += 1;
    const promise = startLoad(record)
      .then((instance) => {
        record.instance = instance;
        record.status = "ready";
        // 成功必须把上一次的错误清掉：留着它，`getStatus() === "ready"` 与
        // `getError() === 上次的 boom` 就同时成立，调用方会以为「刚加载好的插件其实还在错」。
        // 这里刻意**不在重试开始时就清**：那次失败是已经结算过的事实，重试还没结算完就抹掉
        // 等于丢诊断信息。清的时机只有两个 —— 本次成功（这里），或本次失败（下方 catch 覆盖）。
        record.error = undefined;
        events.emit("plugin:ready", { name: record.name });
        return instance;
      })
      .catch((error: unknown) => {
        record.status = "error";
        record.error = error;
        record.promise = null;
        events.emit("plugin:error", { name: record.name, error });
        if (record.definition.required !== false) throw error;
        // optional 失败：`null`（不是 `undefined` —— 那是 void 插件的合法返回值）
        return null;
      });
    record.promise = promise;
    return promise;
  }

  return {
    register(definition) {
      assertPluginDefinition(definition as BMapPluginDefinition<unknown>);
      if (records.has(definition.name)) {
        throw new BMapError(
          "BMAP_PLUGIN_LOAD_FAILED",
          `Plugin "${definition.name}" already registered`,
          { plugin: definition.name },
        );
      }
      records.set(definition.name, {
        name: definition.name,
        status: "idle",
        instance: null,
        definition,
        scope: definition.scope ?? "map",
        attempts: 0,
        consumers: 0,
        promise: null,
      });
    },

    async whenPlugin<Resource = unknown>(
      name: string,
      signal?: AbortSignal,
    ): Promise<Resource | null> {
      const record = records.get(name);
      if (!record) throw unknownPluginError(name);
      if (disposed) {
        throw new BMapError("BMAP_RESOURCE_DISPOSED", `Plugin registry disposed; "${name}"`, {
          plugin: name,
        });
      }
      // 已 abort 的消费者：立刻拒绝，且**不启动任何加载**（不该产生无人等待的请求）
      if (signal?.aborted) throw pluginAbortError(name, signal.reason);

      record.consumers += 1;
      try {
        // 依赖按层并行；目标留到最后单独加载一次 —— 不能把目标自己放进依赖集合，
        // 否则 optional 失败时目标会被真的加载第二次（一次 CDN 失败产生两次请求与两次
        // script 注入机会，并重复发 plugin:error；评审 #85 P1-1）。
        const run = async (): Promise<unknown> => {
          for (const layer of dependencyLayers(name)) {
            await Promise.all(layer.map((dep) => loadPlugin(records.get(dep) as InternalPluginRecord)));
          }
          return loadPlugin(record);
        };
        // 取消只结算**这一次等待**：底层共享任务保留（`abortRace` 不会去动它）
        return (await abortRace(run(), [signal, abort.signal], name)) as Resource | null;
      } finally {
        record.consumers -= 1;
      }
    },

    getStatus(name) {
      return records.get(name)?.status;
    },

    getError(name) {
      return records.get(name)?.error;
    },

    inspect(name) {
      const record = records.get(name);
      if (!record) return undefined;
      return {
        name: record.name,
        scope: record.scope,
        required: record.definition.required !== false,
        status: record.status,
        attempts: record.attempts,
        consumers: record.consumers,
        error: record.error,
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // 先让仍在等待的消费者结算（内部信号），再按注册逆序释放本注册表持有的资源。
      abort.abort("plugin-registry-disposed");
      for (const record of [...records.values()].reverse()) {
        // `global` 资源的释放权在宿主手里，这里**不能**碰它（否则一张地图卸载会拆掉
        // 另一张地图正在用的全局脚本）。注册表只把状态收口成 disposed。
        if (record.scope === "map" && record.definition.dispose && record.instance != null) {
          try {
            record.definition.dispose(record.instance, getContext());
          } catch {
            // 忽略单个插件 dispose 错误
          }
        }
        record.status = "disposed";
        record.promise = null;
        // 刻意**不**把 `consumers` 清零：还在等的消费者会在自己的 `finally` 里递减，
        // 这里先清零会让它们把计数减成负数，`inspect()` 于是读到一个不可能的值。
        // 让计数如实反映「还有几个等待者没结算」即可。
      }
    },
  };
}
