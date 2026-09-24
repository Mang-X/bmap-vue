/**
 * SharedLoadTask
 *
 * 一次底层 script 加载任务的共享单元（M3A1-LOADER / issue #16）：
 * - 同配置的并发消费者共用一个 `<script>`，只插入一次；
 * - 每个消费者持有自己的 `AbortSignal`，取消互不影响；
 * - 最后一个消费者离开时取消尚未完成的底层任务，允许后续重试；
 * - success / error / timeout / abort 统一释放 script、callback、listener 与 timer。
 *
 * 模式由显式的 `mode` 决定，不再依据 `callbackName` 是否存在隐式推断：
 * - `load`：以 script `load` 事件作为就绪信号；
 * - `jsonp`：挂载全局回调作为就绪信号，`callbackName` 必须与 URL 中回调参数一致。
 *
 * 初始化（含回调安装）具备异常安全性：同步异常统一转为 `BMapError` 进入 `fail()`，
 * 不会把任务留在 `loading` 状态。
 */
import { BMapError } from "../errors/BMapError";
import { redactAk } from "../logger";
import { maskUserinfo, readUrlUserinfo } from "./url";

export type ScriptLoaderMode = "load" | "jsonp";

export interface ScriptLoaderBaseOptions {
  /** script src（相对路径由调用方经 url.ts 基于 document.baseURI 解析）。 */
  src: string;
  timeout?: number;
  nonce?: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  referrerPolicy?: ReferrerPolicy;
  /** 成功后是否保留 script 元素；默认 `keep`（百度主 SDK 行为）。失败一律移除。 */
  retention?: "keep" | "remove-after-load";
  /**
   * 从全局读取导出对象；JSONP 回调带实参时以实参优先。
   *
   * 它只是**取值**的兜底，不是必经的校验步骤——回调带实参时根本不会执行。
   * 需要「脚本加载成功 ≠ SDK 可用」的把关时请用 `assertReady`。
   */
  exportGetter?: () => unknown;
  /**
   * 成功前校验（必经）：结果已确定（回调实参优先，否则 `exportGetter`）但**尚未提交成功**。
   *
   * 抛出即视为本次加载失败：不写成功缓存、移除 script、任务进入失败路径，因此可重试。
   */
  assertReady?: (result: unknown) => void;
}

export interface ScriptLoadModeOptions extends ScriptLoaderBaseOptions {
  mode: "load";
}

export interface ScriptJsonpModeOptions extends ScriptLoaderBaseOptions {
  mode: "jsonp";
  /** 本次 script URL 的回调参数值，同时是挂载到 `window` 的全局函数名。 */
  callbackName: string;
  /** 回调参数名，默认 `callback`；仅参与去重 key 计算。 */
  callbackParam?: string;
}

export type ScriptLoaderOptions = ScriptLoadModeOptions | ScriptJsonpModeOptions;

export interface SharedLoadTaskHooks {
  onSuccess?(result: unknown): void;
  onFailure?(error: unknown): void;
  onCancelled?(): void;
}

export type SharedLoadTaskState = "idle" | "loading" | "settled";

interface Consumer {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
}

/* -------------------------------------------------------------------------- */
/* 全局回调注册表                                                              */
/* -------------------------------------------------------------------------- */

interface CallbackEntry {
  /** 当前在管的同名回调，按安装顺序排列（可能来自多个并发任务）。 */
  slots: Array<(...args: unknown[]) => void>;
  /** 第一个 Loader 任务接管前，该全局名上的“外部原值”。 */
  foreign: { had: boolean; value: unknown };
}

/**
 * 多个任务可能使用同名回调（例如不同 URL 但相同的 callback 名）。
 * 仅保存一个 previous 引用会在交叠失败时把已失效的 handler 重新挂回全局，
 * 因此按名字维护安装栈。
 *
 * 关键不变式：条目只在**仍有在管槽位**时存在。外部脚本接管该全局名后，原任务
 * 释放时既不触碰外部值，也必须把自己的记录回收掉；下次安装会重新捕获当前外部
 * 值作为 `foreign`，而不会沿用过期条目。
 */
const callbackRegistry = new Map<string, CallbackEntry>();

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * 安装回调并登记所有权。
 * 赋值失败（如只读全局属性）会抛错，此时**不做任何登记**，由调用方进入失败路径。
 */
function installGlobalCallback(
  target: Record<string, unknown>,
  name: string,
  handler: (...args: unknown[]) => void,
): void {
  const existing = callbackRegistry.get(name);
  let entry = existing;
  if (!entry) {
    entry = { slots: [], foreign: { had: hasOwn(target, name), value: target[name] } };
  } else if (!entry.slots.some((installed) => installed === target[name])) {
    // 当前全局值不属于任何在管任务 → 说明被外部脚本接管过；
    // 以当前值作为新的“外部原值”，不能继续沿用过期条目里的 foreign。
    entry.foreign = { had: hasOwn(target, name), value: target[name] };
  }
  // 只读属性会抛 TypeError；此处尚未写入任何注册记录。
  target[name] = handler;
  if (!existing) callbackRegistry.set(name, entry);
  entry.slots.push(handler);
}

/**
 * 释放回调所有权（任务成功 / 失败 / 取消时调用）。
 *
 * 两件事必须分开处理：
 * 1. 回收自己的注册记录 —— 无论是否还拥有全局值，都要移除槽位并在没有在管任务时
 *    删除条目，避免过期 `foreign` 影响下一次安装；
 * 2. 只有在**自己仍是全局值的所有者**时，才回退到仍存活的槽位 / 外部原值 / 删除。
 */
function releaseGlobalCallback(
  target: Record<string, unknown>,
  name: string,
  handler: (...args: unknown[]) => void,
): void {
  const entry = callbackRegistry.get(name);
  if (!entry) {
    // 未经注册表安装（例如全局被外部替换过）：保守地只清理自己。
    if (target[name] === handler) delete target[name];
    return;
  }

  const wasOwner = target[name] === handler;
  const index = entry.slots.indexOf(handler);
  if (index >= 0) entry.slots.splice(index, 1);

  if (wasOwner) {
    const next = entry.slots[entry.slots.length - 1];
    if (next) {
      target[name] = next;
    } else if (entry.foreign.had) {
      target[name] = entry.foreign.value;
    } else {
      delete target[name];
    }
  }

  if (entry.slots.length === 0) {
    // 已无在管槽位：删除条目，让下一次安装重新捕获当前（可能已被外部替换的）原值。
    callbackRegistry.delete(name);
  }
}

/** 仅测试使用：清空回调注册表。 */
export function resetGlobalCallbackRegistryForTests(): void {
  callbackRegistry.clear();
}

/* -------------------------------------------------------------------------- */
/* SharedLoadTask                                                              */
/* -------------------------------------------------------------------------- */

function createAbortError(): BMapError {
  return new BMapError("BMAP_PROVIDER_ABORTED", "SDK load aborted");
}

export class SharedLoadTask {
  private readonly consumers = new Set<Consumer>();
  private state: SharedLoadTaskState = "idle";
  private succeeded = false;
  private result: unknown;
  private error: unknown;
  private started = false;

  private script: HTMLScriptElement | null = null;
  private timeoutId: number | undefined;
  private detachScriptListeners: (() => void) | undefined;

  private callbackTarget: Record<string, unknown> | null = null;
  private callbackKey: string | undefined;
  private installedCallback: ((...args: unknown[]) => void) | undefined;

  constructor(
    private readonly options: ScriptLoaderOptions,
    private readonly hooks: SharedLoadTaskHooks = {},
  ) {}

  /** 当前活跃消费者数量（取消或已结算的消费者会被移除）。 */
  get consumerCount(): number {
    return this.consumers.size;
  }

  get isSettled(): boolean {
    return this.state === "settled";
  }

  get status(): SharedLoadTaskState {
    return this.state;
  }

  /**
   * 为单个消费者登记等待。
   * `signal` 只影响该消费者；abort 不会波及同一任务上的其它消费者。
   */
  subscribe(signal?: AbortSignal): Promise<unknown> {
    // 已取消的 signal 优先于已结算结果：命中也必须拒绝当前消费者。
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (this.state === "settled") {
      return this.succeeded ? Promise.resolve(this.result) : Promise.reject(this.error);
    }

    return new Promise<unknown>((resolve, reject) => {
      const consumer: Consumer = { resolve, reject, signal, settled: false };
      consumer.onAbort = () => {
        if (consumer.settled) return;
        consumer.settled = true;
        this.releaseConsumer(consumer);
        reject(createAbortError());
        // 最后一个消费者离开且底层仍在进行时，取消底层任务以便后续重试。
        if (this.consumers.size === 0 && this.state === "loading") {
          this.cancelUnderlying();
        }
      };
      signal?.addEventListener("abort", consumer.onAbort, { once: true });
      this.consumers.add(consumer);
      if (!this.started) this.begin();
    });
  }

  private releaseConsumer(consumer: Consumer): void {
    if (consumer.onAbort) consumer.signal?.removeEventListener("abort", consumer.onAbort);
    this.consumers.delete(consumer);
  }

  private settleConsumer(consumer: Consumer, ok: boolean, value: unknown): void {
    if (consumer.settled) return;
    consumer.settled = true;
    this.releaseConsumer(consumer);
    if (ok) consumer.resolve(value);
    else consumer.reject(value);
  }

  /**
   * 初始化底层 script。
   *
   * 清理函数与超时器都在可能抛错的操作（回调安装、appendChild）之前登记，
   * 同步异常统一转为 `BMapError` 进入 `fail()`，保证任务不会卡在 `loading`。
   */
  private begin(): void {
    this.started = true;
    this.state = "loading";

    try {
      if (typeof document === "undefined" || typeof window === "undefined") {
        this.fail(new BMapError("BMAP_SDK_LOAD_FAILED", "SDK load requires a browser environment"));
        return;
      }

      const script = document.createElement("script");
      script.src = this.options.src;
      script.type = "text/javascript";
      script.async = true;
      if (this.options.integrity) script.integrity = this.options.integrity;
      if (this.options.crossOrigin) script.crossOrigin = this.options.crossOrigin;
      if (this.options.referrerPolicy) script.referrerPolicy = this.options.referrerPolicy;
      if (this.options.nonce) script.nonce = this.options.nonce;
      this.script = script;

      const onLoad = () => this.succeed(undefined);
      const onError = () =>
        this.fail(
          new BMapError(
            "BMAP_SDK_LOAD_FAILED",
            // 入口 URL 可能自带 `ak=` 或 userinfo（企业自托管入口很常见，含 HTTP 认证），
            // 失败文案同样不得把它们带出去。这里没有「已知 AK」可用（Loader 只拿到 src），
            // 因此 AK 走 `ak=` 模式脱敏、userinfo 走形状 + 已知值两条。
            redactAk(
              maskUserinfo(
                `Failed to load script: ${this.options.src}`,
                readUrlUserinfo(this.options.src),
              ),
              null,
            ),
          ),
        );
      // 先登记释放路径，再执行可能抛错的安装动作。
      this.detachScriptListeners = () => {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      };
      script.addEventListener("error", onError);

      if (this.options.timeout) {
        const timeout = this.options.timeout;
        this.timeoutId = window.setTimeout(() => {
          this.fail(
            new BMapError("BMAP_SDK_LOAD_TIMEOUT", `SDK load timed out after ${timeout}ms`),
          );
        }, timeout);
      }

      if (this.options.mode === "jsonp") {
        this.installJsonpCallback(this.options.callbackName);
      } else {
        script.addEventListener("load", onLoad);
      }

      document.body.appendChild(script);
    } catch (cause) {
      this.fail(
        cause instanceof BMapError
          ? cause
          : new BMapError("BMAP_SDK_LOAD_FAILED", "Failed to initialize SDK script loading", {
              cause,
            }),
      );
    }
  }

  private installJsonpCallback(callbackName: string): void {
    const target = window as unknown as Record<string, unknown>;
    const handler = (...args: unknown[]) => this.succeed(args[0]);
    // 赋值失败时不登记，避免残留无法释放的所有权记录。
    installGlobalCallback(target, callbackName, handler);
    this.callbackTarget = target;
    this.callbackKey = callbackName;
    this.installedCallback = handler;
  }

  private succeed(callbackResult: unknown): void {
    if (this.state === "settled") return;
    let result = callbackResult;
    // JSONP 回调不带实参时回退到 exportGetter（例如读取全局 SDK 命名空间）。
    if (result === undefined && this.options.exportGetter) {
      try {
        result = this.options.exportGetter();
      } catch (cause) {
        // exportGetter 抛出的 BMapError 已带明确原因，直接透传，避免包一层后丢失细节。
        this.fail(
          cause instanceof BMapError
            ? cause
            : new BMapError("BMAP_SDK_LOAD_FAILED", "SDK export getter failed", { cause }),
        );
        return;
      }
    }
    // 成功前校验是**必经**的（与 exportGetter 的兜底取值定位不同）：无论结果来自回调
    // 实参还是 exportGetter 都会执行，因此「脚本加载成功但 SDK 不可用」不会先写入成功缓存
    // （否则重试会命中缓存）。需要「就绪」把关的调用方应把校验放在 `assertReady`。
    if (this.options.assertReady) {
      try {
        this.options.assertReady(result);
      } catch (cause) {
        this.fail(
          cause instanceof BMapError
            ? cause
            : new BMapError("BMAP_SDK_LOAD_FAILED", "SDK ready assertion failed", { cause }),
        );
        return;
      }
    }
    this.state = "settled";
    this.succeeded = true;
    this.result = result;
    this.cleanup();
    // 先让缓存层记录结果，再唤醒消费者，避免消费者重入时读到已失效的 in-flight。
    this.hooks.onSuccess?.(result);
    for (const consumer of [...this.consumers]) this.settleConsumer(consumer, true, result);
    this.consumers.clear();
  }

  private fail(error: unknown): void {
    if (this.state === "settled") return;
    this.state = "settled";
    this.succeeded = false;
    this.error = error;
    this.cleanup();
    this.hooks.onFailure?.(error);
    for (const consumer of [...this.consumers]) this.settleConsumer(consumer, false, error);
    this.consumers.clear();
  }

  /** 所有消费者都已离开：取消底层 script，无需再向任何人 reject。 */
  private cancelUnderlying(): void {
    if (this.state === "settled") return;
    this.state = "settled";
    this.succeeded = false;
    this.error = createAbortError();
    this.cleanup();
    this.hooks.onCancelled?.();
  }

  private cleanup(): void {
    if (this.timeoutId !== undefined) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.detachScriptListeners?.();
    this.detachScriptListeners = undefined;

    const script = this.script;
    this.script = null;
    if (script && (!this.succeeded || this.options.retention === "remove-after-load")) {
      script.remove();
    }

    const target = this.callbackTarget;
    const key = this.callbackKey;
    const installed = this.installedCallback;
    this.callbackTarget = null;
    this.callbackKey = undefined;
    this.installedCallback = undefined;
    if (target && key && installed) {
      releaseGlobalCallback(target, key, installed);
    }
  }
}
