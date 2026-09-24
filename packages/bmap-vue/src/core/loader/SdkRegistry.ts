/**
 * 进程级 SDK Registry —— 同一 realm 内的全局 SDK 冲突域
 *
 * `BMap`（JSAPI 4.0 的全局命名空间）是**进程级**全局资源，同一 realm 只能存在一份配置。
 * registry 因此以「冲突域（domain）」为单位共享，而不是让每个 Provider 各持一份缓存：
 *
 * - 域内**已就绪**或**正在加载**的配置构成占用：不兼容的请求在启动 loader **之前**
 *   就被拒绝，避免首次并发请求不同 AK / 版本时各自插入一个 script；
 * - 同一 fingerprint 只启动一次底层任务，但**每个消费者独立订阅**：`signal` 一一对应，
 *   取消某个消费者不影响其它消费者，只有最后一个消费者离开时才取消底层任务；
 * - 最后一个消费者取消时，按请求声明的 `cancellable` 分流：可取消的任务**同步**释放条目与
 *   配置占用（不等底层 Promise 异步收尾），因此「abort 之后同一同步回合内重试」既不会命中
 *   已取消的任务，也不会被过期占用挡住（旧任务的异步收尾带所有权检查，不会清掉新任务的状态）；
 *   **不可取消**的任务（官方 Loader）保留条目 + 占用 + 任务，只结算消费者——同指纹后来者复用
 *   原任务，另一份指纹继续冲突，直到任务真正成功 / 失败；
 * - 加载只接受**请求级 loader**，registry 不再持有具体加载实现，也不再读取
 *   `window` / `document`，因此 SSR 导入安全、可脱离 DOM 单测；
 * - **失败**后条目与占用一并释放，允许下一次重试，不残留半成品状态；**取消**则按请求声明的
 *   `cancellable` 分流（可取消 → 同步释放；不可取消 → 保留条目 / 占用 / 任务），见上一条。
 *
 * 域划分：所有 JSAPI 4.0 Provider 共用 `BMap` 域（见 `providers/namespace.ts`）。
 * 旧引擎时代那个独立的 `BMapGL` 域已随 `#26` 删除（同一个 realm 里不再有两份配置需要分开记账）。
 */
import { BMapError } from "../errors/BMapError";

/**
 * 请求级加载任务：`options` 已由 Provider 闭包捕获，因此同一 domain 可以服务
 * 多个语义不同的 Provider，而共享同一份「已加载配置」冲突判定。
 *
 * `signal` 是**聚合信号**：同配置的所有消费者都离开时才会 abort，由 registry 维护。
 */
export type SdkLoader<T = unknown> = (signal?: AbortSignal) => Promise<T>;

export interface SdkRegistryLoadRequest<T = unknown> {
  /** 参与复用与冲突判定的配置指纹（AK 必须已脱敏进哈希）。 */
  fingerprint: string;
  /** 真正的加载实现；只在无同指纹 in-flight / 已就绪结果时调用一次。 */
  loader: SdkLoader<T>;
  /**
   * 底层任务是否**能随聚合 signal 一起结束**（缺省 `true`）。
   *
   * 这一位决定「最后一个消费者离开时怎么处理条目」：
   * - `true`（自研 `ScriptLoader` 等）：同步释放条目与占用，并 abort 聚合 signal；
   *   调用方随后可以立刻重试（重试会起新任务）。
   * - `false`（官方 `@baidumap/jsapi-loader`——它没有公开取消接口）：**只拒绝消费者，
   *   保留 entry + occupancy + task**。同指纹后来者复用原任务，另一份指纹继续被冲突拒绝，
   *   直到该任务真正成功 / 失败。这样「已取消但仍在飞」的任务不会和另一份配置同时进入
   *   同一全局冲突域，也不会出现「任务成功了但域里没有它的记录」。
   *
   * 声明 `true` 的一方需要保证：聚合 signal abort 之后，该任务**不会**再成功结算。
   */
  cancellable?: boolean;
}

/**
 * 冲突处置：**只有一种** —— reject `BMAP_SDK_CONFIG_CONFLICT`。
 *
 * 历史注记（`#104` 第三批）：这里曾经有一个 `conflictPolicy: "throw" | "warn" | "ignore"`
 * 与配套的 `onConflict` 观测出口（ADR `2026-09-10-sdk-conflict-domain.md` 决策 6 的降级开关）。
 * 审计结果是 **REMOVE**：三个 Provider（官方 / 自研 script / 复用既有全局）**一律不传**它，
 * 仓库里只有 `SdkRegistry` 自己的单测可达 `warn` / `ignore` ⇒ 它是「没有人用的公共开关」，
 * 而它会随 `./core` 一起被冻结进 3.0 的公共声明面。`./core` 冻结前的复核（issue #104
 * 实施步骤 6）要求「内部判据不进入承诺」，因此在这里收成单一行为。
 *
 * 为什么不做成配置项而不是删掉：**冲突本身就是不可恢复的错误**（同一 realm 只能有一份
 * 全局 SDK，见本文件头）。`ignore` 让调用方拿到一份「不是自己请求的那份 SDK」，
 * 属于把不可解释的运行时状态合法化；要放宽也应该等出现第一个真实消费者时再按场景设计，
 * 而不是保留一个无人验证的分支（`#104` 的一条既有结论）。参考实现
 * `huiyan-fe/react-bmap`（`src/loader/registry.ts`）走的是「报告 + 复用已加载那份」，
 * 与本库的 `warn` / `ignore` 都不是同一个语义，因此不能拿它当保留这两个取值的理由。
 */
export interface SdkRegistryOptions {
  /** 冲突域名称，用于错误信息与诊断。 */
  readonly domain?: string;
}

/** 域内一次共享加载任务的内部状态（不对外暴露：诊断请用 `size` / `activeFingerprint`）。 */
interface RegistryEntry {
  status: "loading" | "ready";
  /** 仍在等待该任务的消费者数量；归零且未结算时取消底层任务。 */
  consumers: number;
  /** 聚合取消信号：传给 loader，最后一个消费者离开时 abort。 */
  readonly controller: AbortController;
  /** 共享任务（每个 fingerprint 只启动一次）。 */
  task: Promise<unknown>;
  settled: boolean;
  result?: unknown;
  /** 底层任务是否可随之取消；`false` 时最后一个消费者离开也不释放条目与占用。 */
  readonly cancellable: boolean;
}

const DEFAULT_DOMAIN = "default";

const PROCESS_SDK_REGISTRY_SYMBOL = Symbol.for("bmap-vue.sdk-registry");

type GlobalWithRegistry = typeof globalThis & {
  [PROCESS_SDK_REGISTRY_SYMBOL]?: Map<string, SdkRegistry>;
};

/**
 * 取消类错误（消费者取消 / 聚合 signal 已 abort）：只拒绝该消费者，不影响同任务上的其它消费者。
 * Provider 的同步捷径（`reuseExistingJsapiV4`）复用同一错误口径，避免出现第二个 `BMAP_PROVIDER_ABORTED` 文案。
 */
export function createConsumerAbortError(): BMapError {
  return new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted by consumer");
}

/**
 * 取同一 realm 内某个冲突域共享的 registry。
 *
 * `options` 只在**首次创建**该域时生效；后续调用复用既有实例，避免不同 Provider
 * 用各自的 domain 互相覆盖。
 */
export function getProcessSdkRegistry(
  domain: string = DEFAULT_DOMAIN,
  options: SdkRegistryOptions = {},
): SdkRegistry {
  const globalObject = globalThis as GlobalWithRegistry;
  let byDomain = globalObject[PROCESS_SDK_REGISTRY_SYMBOL];
  if (!byDomain) {
    byDomain = new Map<string, SdkRegistry>();
    globalObject[PROCESS_SDK_REGISTRY_SYMBOL] = byDomain;
  }
  const existing = byDomain.get(domain);
  if (existing) return existing;
  const created = new SdkRegistry({ domain, ...options });
  byDomain.set(domain, created);
  return created;
}

/** 仅测试使用：重置进程级 registry（所有冲突域）。 */
export function resetProcessSdkRegistryForTests(): void {
  delete (globalThis as GlobalWithRegistry)[PROCESS_SDK_REGISTRY_SYMBOL];
}

export class SdkRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  /** 域内已就绪的配置指纹；`undefined` 表示本域尚未成功加载过任何配置。 */
  private loadedFingerprint: string | undefined;
  /** 域内正在加载、尚未就绪的配置指纹：首次并发不同配置时用它做占用判定。 */
  private occupiedFingerprint: string | undefined;
  private readonly domain: string;

  constructor(options: SdkRegistryOptions = {}) {
    this.domain = options.domain ?? DEFAULT_DOMAIN;
  }

  /** 域内已就绪的配置指纹，用于诊断与测试断言。 */
  get activeFingerprint(): string | undefined {
    return this.loadedFingerprint;
  }

  get size(): number {
    return this.entries.size;
  }

  /**
   * 在域内加载：
   * - 与域内已就绪 / 正在加载的配置冲突 → reject `BMAP_SDK_CONFIG_CONFLICT`（唯一处置，
   *   见 `SdkRegistryOptions` 的历史注记）；
   * - 同指纹已有任务 → 以独立消费者身份加入（`signal` 只影响自己）；
   * - 否则启动请求级 loader，成功后登记为域内已就绪配置。
   */
  load<T>(request: SdkRegistryLoadRequest<T>, signal?: AbortSignal): Promise<T> {
    const fingerprint = request.fingerprint;

    // 占用 = 已就绪配置 or 正在加载的配置：后者保证「首次并发不同配置」也会冲突。
    const active = this.loadedFingerprint ?? this.occupiedFingerprint;
    if (active !== undefined && active !== fingerprint) {
      // 保持「返回 rejected Promise」语义：调用方 `await` 即可捕获。
      return Promise.reject(this.conflictError(fingerprint));
    }

    const existing = this.entries.get(fingerprint);
    if (existing?.settled) {
      // 已就绪结果可复用；但已取消的 signal 依然拒绝当前消费者，且不清除共享结果。
      if (signal?.aborted) return Promise.reject(createConsumerAbortError());
      return Promise.resolve(existing.result as T);
    }

    if (signal?.aborted) return Promise.reject(createConsumerAbortError());

    const entry = existing ?? this.start<T>(request, fingerprint);
    return this.subscribe(entry, fingerprint, signal) as Promise<T>;
  }

  /** 移除全部条目（测试 / 强制重新加载用）；不改变域内已就绪配置。 */
  clear(): void {
    this.entries.clear();
  }

  /** 启动共享任务，并同步占用冲突域（必须发生在启动 loader 之前）。 */
  private start<T>(request: SdkRegistryLoadRequest<T>, fingerprint: string): RegistryEntry {
    const controller = new AbortController();
    const entry: RegistryEntry = {
      status: "loading",
      consumers: 0,
      controller,
      task: Promise.resolve(),
      settled: false,
      cancellable: request.cancellable !== false,
    };
    this.entries.set(fingerprint, entry);
    this.occupiedFingerprint ??= fingerprint;

    entry.task = Promise.resolve()
      .then(() => request.loader(controller.signal))
      .then(
        (result) => {
          this.settle(entry, fingerprint, true, result);
          return result;
        },
        (error: unknown) => {
          this.settle(entry, fingerprint, false, error);
          throw error;
        },
      );
    // 消费者可能已全部离开（任务被取消）：避免无人观察的 rejection 冒泡为 unhandled。
    void entry.task.catch(() => {});
    return entry;
  }

  private settle(entry: RegistryEntry, fingerprint: string, ok: boolean, value: unknown): void {
    // 只有仍是该指纹当前任务的 entry 才有权更新域状态：任务可能已被取消并被新任务取代，
    // 此时异步 settle 不得清掉新任务的占用、也不得登记过期结果。
    const isCurrent = this.entries.get(fingerprint) === entry;
    entry.settled = true;
    if (ok) {
      entry.status = "ready";
      entry.result = value;
      // 「域内已就绪配置」按**任务是否真的成功**登记：不可取消的底层任务（官方 Loader）在
      // 消费者全部离开后仍会完成，此时全局 SDK 确实已按这份指纹就绪，登记它才能让后续
      // 「另一份配置」的请求被挡住。可取消的任务若在其 signal abort 后仍然成功（违反
      // `cancellable: true` 的约定），同样是既成事实，一样登记——**真实成功永远不被遗忘**。
      //
      // 域内同一时刻只可能有一份配置真正就绪，`??=` 让第一个真实成功者留下记录。
      this.loadedFingerprint ??= fingerprint;
    } else if (isCurrent) {
      // 失败后移除，允许下次重试。
      this.entries.delete(fingerprint);
    }
    if (isCurrent && this.occupiedFingerprint === fingerprint) {
      this.occupiedFingerprint = undefined;
    }
  }

  /**
   * 同步释放一个**可取消**任务的条目与占用：**不能**等底层 Promise 异步 settle。
   * 否则「abort 之后同一同步回合内重试」会命中已取消的 entry，或被尚未释放的占用挡住。
   *
   * 不可取消的任务不会走到这里（见 `SdkRegistryLoadRequest.cancellable`）。
   */
  private cancelEntry(entry: RegistryEntry, fingerprint: string): void {
    entry.settled = true;
    if (this.entries.get(fingerprint) === entry) this.entries.delete(fingerprint);
    if (this.occupiedFingerprint === fingerprint) this.occupiedFingerprint = undefined;
    // 聚合信号驱动底层任务取消（ScriptLoader 会据此取消共享 script）。
    entry.controller.abort();
  }

  /**
   * 为单个消费者登记等待。`signal` 只影响该消费者；
   * 同一任务上的最后一个消费者离开时，才按 `cancellable` 决定是否同步释放 entry / 占用
   * 并取消底层任务（不可取消的任务保留一切，只把消费者结算掉）。
   */
  private subscribe(
    entry: RegistryEntry,
    fingerprint: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    entry.consumers++;
    return new Promise<unknown>((resolve, reject) => {
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", onAbort);
        entry.consumers--;
        if (entry.consumers === 0 && !entry.settled && entry.cancellable) {
          this.cancelEntry(entry, fingerprint);
        }
      };
      const onAbort = () => {
        if (done) return;
        release();
        reject(createConsumerAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.task.then(
        (result) => {
          if (done) return;
          release();
          resolve(result);
        },
        (error: unknown) => {
          if (done) return;
          release();
          reject(error);
        },
      );
    });
  }

  /** 构造冲突错误：唯一处置，直接 reject。 */
  private conflictError(requested: string): BMapError {
    const active = (this.loadedFingerprint ?? this.occupiedFingerprint) as string;
    // 「active」既可能是已就绪配置，也可能是仍在加载的配置。指纹内 AK 与代理入口凭据都已哈希，
    // 消息不会泄漏它们（这也是 `fingerprintConfig` / `fingerprintApiUrl` 只留哈希的原因）。
    const message = `SDK config conflict in ${this.domain}: requested ${requested}, already active ${active}`;
    return new BMapError("BMAP_SDK_CONFIG_CONFLICT", message);
  }
}
