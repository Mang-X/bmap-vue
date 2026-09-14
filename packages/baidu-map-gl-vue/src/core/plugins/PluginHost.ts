/**
 * PluginHost —— **global 作用域**插件资源的共享宿主（M8-PLUGIN-CORE / issue #42）
 *
 * ## 它解决什么
 *
 * `global` 作用域的插件脚本（内置的四个都是：`TrackAnimation` / `DrawingManager` /
 * `GeoUtils` / `Mapvgl`）都是 `<script>` 注入 + 挂一个 **文档级全局**。但在本票之前，
 * `PluginRegistry` 是**每个地图实例一份**，`whenPlugin` 又把地图自己的 `scope.signal`
 * 传给 `load()`。两个后果：
 *
 * 1. 同页面两张 `<BMap :plugins="['TrackAnimation']">` ⇒ 同一份脚本插两次；
 * 2. 地图 A 卸载 ⇒ A 的 scope abort ⇒ 如果 B 恰好复用同一条在飞加载，B 会跟着一起挂。
 *    「谁先谁后」决定 B 的成败，这本身就是 bug。
 *
 * 所以这里按资源的真实形状建模：**一份文档一份资源，宿主独占持有，消费者只登记兴趣**。
 *
 * ## 三条不变量
 *
 * - **共享**：同名只 `load()` 一次；后到的消费者直接拿同一实例；在飞期间来的消费者等同一 promise。
 * - **消费者取消只影响自身**：`acquire(..., signal)` 的 signal 只解绑**这一个**消费者
 *   （它自己的 promise 拒绝），共享任务保留。这与 AGENTS.md
 *   「组件取消等待 = 解绑消费者 + 丢弃回包；不等于终止上游加载」是同一条口径。
 * - **失败可重试**：失败条目**立刻从缓存移除**，下一次 `acquire` 真的重新加载。
 *   与同源参考实现 `huiyan-fe/react-bmap` 的 `loader/registry.ts` 同形
 *   （`promise.catch(() => globalRegistry.delete(loadKey))`）。
 *
 * ## 释放权
 *
 * **只有宿主 `dispose()` 有权释放 global 资源**，地图卸载一律不释放。原因不是偷懒：
 * 上游（四个 `BMapGLLib` / MapVGL 脚本）**没有卸载入口**，能做的只有「删 `<script>` + 抹全局」，
 * 而那会波及页面里其它已经拿到这个全局的代码 —— AGENTS.md 明令不得删除 / 改写上游注入的 script。
 *
 * `dispose()` 因此是**纪元重置**：换一个纪元 scope（在飞加载随之 abort、`setup` 的 disposer 随之执行）、
 * 让每个已就绪实例过一遍 `definition.dispose`、清空缓存与计数，之后仍可继续 `acquire`。
 *
 * ⚠️ **它不恢复「没加载过」的状态**（评审 #88 文档项）：`dispose()` 不会移除第三方脚本，也不会抹掉
 * `window.BMapGLLib.*`。于是内置脚本插件下一次 `acquire` 会直接命中 `loadScriptWithExport` 的
 * 「导出已存在 ⇒ 直接 resolve」短路：**复用同一个全局对象，既不重新拉脚本、也不重新初始化**。
 * 想要真正的干净起点只能刷新文档（或由宿主页面自己负责卸载那个全局）。
 *
 * ## 与 PluginRegistry 的分工
 *
 * `PluginRegistry` 管**每张地图**的账（谁在等、状态、错误、事件回执）；`PluginHost` 管
 * **跨地图共享的那一份全局资源**。`map` 作用域的插件完全不经宿主，由注册表按地图生命周期持有。
 * 二者的边界写在 ADR `2026-09-14-plugin-catalog-scope-scheduling` 决策 3。
 */
import { ResourceScope } from "../lifecycle/ResourceScope";
import type { BMapPluginDefinition, PluginContext } from "./PluginRegistry";
import { abortRace, pluginAbortError } from "./pluginAbort";

/**
 * 条目的载入状态。
 *
 * 刻意**没有** `error`：失败条目会被立刻从缓存移除（可重试），所以「失败的共享任务」不是一个
 * 可观察的长期状态。诊断用的原始错误由请求方记在自己的 `getError()` 里，那才是调用方能读到的地方。
 */
export type PluginHostEntryStatus = "loading" | "ready";

/** 宿主条目的可读读数（不是瞬时事件；可在任意时刻轮询）。 */
export interface PluginHostEntryInspection {
  readonly name: string;
  readonly status: PluginHostEntryStatus;
  /** 进入 `load()` 的累计次数：>1 即发生过失败重试。 */
  readonly attempts: number;
  /** 当前仍在等待该资源的消费者数（跨注册表）。消费者取消会让它下降。 */
  readonly consumers: number;
}

export interface PluginHost {
  /**
   * 取用某个 global 作用域插件的资源：首次触发加载，随后共享。
   *
   * `context` 取**发起这次加载的那个消费者**的上下文。对内置的脚本插件（`load` 忽略 context）
   * 没有影响；自定义 global 插件若依赖 context，要知道共享任务只记录第一个消费者的上下文。
   */
  acquire(
    name: string,
    definition: BMapPluginDefinition<unknown>,
    context: PluginContext,
    signal?: AbortSignal,
  ): Promise<unknown>;
  inspect(name: string): PluginHostEntryInspection | undefined;
  /**
   * 释放当前持有的全部 global 资源并回到**干净纪元**（之后仍可 acquire）。
   *
   * 注意它不恢复「没加载过」的状态：第三方脚本与 `window.BMapGLLib.*` 都留在原地，
   * 内置脚本插件下一次 acquire 会复用已存在的全局（见文件头「释放权」）。
   */
  dispose(): void;
}

interface HostEntry {
  readonly name: string;
  status: PluginHostEntryStatus;
  instance: unknown;
  attempts: number;
  consumers: number;
  task: Promise<unknown> | null;
  readonly definition: BMapPluginDefinition<unknown>;
  readonly context: PluginContext;
}

export function createPluginHost(label = "plugin-host"): PluginHost {
  const entries = new Map<string, HostEntry>();
  /**
   * 名字 → 累计进入 `load()` 的次数。
   *
   * 单独一张表而不是只看条目的字段：**失败条目会被移除**，只放在条目上时「重试过一次」这件事
   * 会随着旧条目一起消失，于是「重试真的发生了」不可观察。这张表活到宿主 dispose（纪元重置）。
   */
  const attempts = new Map<string, number>();
  /**
   * 纪元号：每次 `dispose()` 自增。
   *
   * 在飞任务在 `start()` 时记下自己属于哪个纪元，结算时比对。不对就说明这是**上一个纪元**的迟到
   * 结果 —— 它不得写进当前纪元的条目、不得按名字操作这张表，但也不该被静默丢掉（评审 #88 P1-2）。
   */
  let epochNumber = 0;
  // 纪元 scope：持有 setup 登记的 disposer，并给在飞加载提供 abort 信号。
  // dispose 时整体替换成一个新的（而不是「一次性用掉」），这样宿主可以继续被使用。
  let scope = new ResourceScope({ label });

  function start(entry: HostEntry, epochScope: ResourceScope, myEpoch: number): Promise<unknown> {
    const attempt = (attempts.get(entry.name) ?? 0) + 1;
    attempts.set(entry.name, attempt);
    entry.attempts = attempt;
    let task: Promise<unknown>;
    try {
      task = Promise.resolve(entry.definition.load(entry.context, epochScope.signal));
    } catch (error) {
      task = Promise.reject(error);
    }
    const settled = task
      .then((instance) => {
        if (myEpoch !== epochNumber) {
          // 上一个纪元的迟到成功：它已经从 entries 摘除，也不在 dispose 时的 ready 快照里
          // ⇒ 不就地释放就是一个没有任何所有者的孤儿资源。
          //
          // 释放是 **identity 作用域**的：只有当这个实例**不是**当前纪元正在用的那个时才释放。
          // 自定义 definition 完全可能 `load` 出同一个单例，那时释放它等于拆掉新纪元正在用的东西。
          if (entries.get(entry.name)?.instance !== instance) {
            try {
              entry.definition.dispose?.(instance, entry.context);
            } catch {
              // 释放失败不得影响结算路径
            }
          }
          return instance;
        }
        entry.instance = instance;
        entry.status = "ready";
        if (entry.definition.setup) {
          const disposer = entry.definition.setup(instance, entry.context);
          if (disposer) epochScope.add(disposer);
        }
        return instance;
      })
      .catch((error: unknown) => {
        entry.task = null;
        // 只删**自己**那一条：dispose 之后同名的新条目可能已经建好，按名字删会把它一起删掉 ——
        // 于是新纪元在飞/已成功的条目查不到，第三次 acquire 又会重复加载（global 去重失效）。
        if (entries.get(entry.name) === entry) entries.delete(entry.name);
        throw error;
      });
    entry.task = settled;
    // 消费者可能在结算前全部取消 ⇒ 这条 promise 没有人接。先标记为已处理，
    // 避免 unhandledRejection 噪声；真正的错误仍由各消费者各自收到。
    void settled.catch(() => {});
    return settled;
  }

  async function acquire(
    name: string,
    definition: BMapPluginDefinition<unknown>,
    context: PluginContext,
    signal?: AbortSignal,
  ): Promise<unknown> {
    // 已 abort 的消费者不启动加载：不该产生一个没有任何人等待的请求。
    if (signal?.aborted) throw pluginAbortError(name, signal.reason);

    const epochScope = scope;
    let entry = entries.get(name);
    if (!entry) {
      entry = {
        name,
        status: "loading",
        instance: null,
        attempts: 0,
        consumers: 0,
        task: null,
        definition,
        context,
      };
      entries.set(name, entry);
      start(entry, epochScope, epochNumber);
    }
    entry.consumers += 1;
    try {
      const task =
        entry.status === "ready"
          ? Promise.resolve(entry.instance)
          : (entry.task as Promise<unknown>);
      return await abortRace(task, [signal, epochScope.signal], name);
    } finally {
      entry.consumers -= 1;
    }
  }

  return {
    acquire,
    inspect(name) {
      const entry = entries.get(name);
      if (!entry) return undefined;
      return {
        name: entry.name,
        status: entry.status,
        attempts: attempts.get(name) ?? entry.attempts,
        consumers: entry.consumers,
      };
    },
    dispose() {
      // 1) 摘出这一轮的条目，并**先清空缓存**：dispose 期间到来的 acquire 必须落到新纪元，
      //    而不是复用一份正在被释放的实例。逆序（后进的先释放）与 ResourceScope 一致。
      const held = [...entries.values()].reverse();
      const ready = held.filter((entry) => entry.status === "ready");
      entries.clear();
      attempts.clear();
      // 2) 换纪元 + 停掉在飞加载（在飞的消费者随之结算），并跑 `setup` 登记的 disposer。
      //    纪元号必须在这里自增：仍在飞的旧任务结算时要靠它认出自己已经过期。
      epochNumber += 1;
      const epochScope = scope;
      scope = new ResourceScope({ label });
      epochScope.dispose("plugin-host-disposed");
      // 3) 最后把已就绪的实例交给插件自己的 dispose —— 宿主是这个资源的合法所有者
      for (const entry of ready) {
        try {
          entry.definition.dispose?.(entry.instance, entry.context);
        } catch {
          // 单个插件的 dispose 失败不得影响其余释放
        }
      }
    },
  };
}

/**
 * 进程级默认宿主。
 *
 * 为什么是**模块级单例**而不是「每个 Client 一份」：被共享的资源是 `window.BMapGLLib.*`
 * 这类**文档级全局**，同一份文档里的两套 Client（例如两个 `<BMapProvider>`）看到的是同一个全局。
 * 按 Client 分桶只会让「同一份脚本被加载两次」这个 bug 从「跨地图」缩小到「跨 Provider」。
 */
let defaultHost: PluginHost | null = null;

export function getDefaultPluginHost(): PluginHost {
  if (!defaultHost) defaultHost = createPluginHost("plugin-host:default");
  return defaultHost;
}

/**
 * 释放并复位默认宿主（测试 / 热更新用）。
 *
 * 纪元重置：清掉宿主缓存的 global 资源并让在飞加载结算，之后默认宿主仍可继续使用。
 * **不会**卸载第三方脚本或抹掉它挂的全局（上游没有卸载入口），所以它不是「让内置插件回到
 * 没加载过」的手段 —— 详见文件头「释放权」。
 */
export function disposeDefaultPluginHost(): void {
  defaultHost?.dispose();
}
