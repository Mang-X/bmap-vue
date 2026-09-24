/**
 * ResourceScope
 *
 * 统一管理 Vue 副作用(watch/computed)、SDK 事件、Observer、RAF、timer、
 * Overlay、plugin 和 AbortSignal。所有副作用必须进入 scope,禁止
 * "创建后由组件作者记得清理" 的松散模式。
 *
 * 原则:
 * - `run(factory)` 在受控 effectScope 中执行,管理 Vue watcher/computed。
 * - `add(disposer)` 注册非 Vue 资源的释放函数。
 * - `dispose()` 先停 effectScope,再按注册逆序释放 disposer。
 * - 幂等:重复 dispose 无副作用。
 */
import { effectScope, type EffectScope } from "vue";
import { logger } from "../logger";

export type Disposer = () => void;

export interface DisposeContext {
  label?: string;
  reason?: unknown;
}

export interface ResourceScopeOptions {
  label?: string;
  parentSignal?: AbortSignal;
  onDisposeError?: (error: unknown, context: DisposeContext) => void;
}

export class ResourceScope {
  readonly controller = new AbortController();
  readonly label?: string;

  private readonly effects: EffectScope;
  private readonly disposers = new Set<Disposer>();
  private readonly options: ResourceScopeOptions;
  private _disposed = false;
  private parentDetach: Disposer | null = null;

  constructor(options: ResourceScopeOptions = {}) {
    this.options = options;
    this.label = options.label;
    this.effects = effectScope(true);
    if (options.parentSignal) {
      if (options.parentSignal.aborted) {
        queueMicrotask(() => {
          if (!this._disposed) this.dispose(options.parentSignal?.reason);
        });
      } else {
        const onParentAbort = () => {
          options.parentSignal?.removeEventListener("abort", onParentAbort);
          if (!this._disposed) this.dispose(options.parentSignal?.reason ?? "parent-signal-aborted");
        };
        options.parentSignal.addEventListener("abort", onParentAbort, { once: true });
        this.parentDetach = () => options.parentSignal?.removeEventListener("abort", onParentAbort);
      }
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get size(): number {
    return this.disposers.size;
  }

  /** 在被管理的作用域内执行 factory;
   * 允许返回 void(watch/computed 等注册副作用即已纳入 scope)。 */
  run<T>(factory: () => T): T {
    if (this._disposed) {
      throw new Error("ResourceScope has been disposed");
    }
    return this.effects.run(factory) as T;
  }

  /** 注册一个释放函数;已释放时立即执行 */
  add(disposer: Disposer): Disposer {
    if (this._disposed) {
      disposer();
      return disposer;
    }
    this.disposers.add(disposer);
    return () => {
      if (this.disposers.delete(disposer)) {
        disposer();
      }
    };
  }

  /** 在 DOM EventTarget 上注册监听并纳入 scope */
  addEventListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ): void {
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  /** 注册一个 Observer,scope 释放时断开 */
  observe(observer: { disconnect(): void }): Disposer {
    return this.add(() => observer.disconnect());
  }

  /** 从父集合摘除指定 disposer（用于 fork child 主动释放后避免父堆积） */
  remove(disposer: Disposer): void {
    this.disposers.delete(disposer);
  }

  /** 从当前 scope fork 出独立 child scope；父 dispose 时联带 dispose child */
  fork(label?: string): ResourceScope {
    const child = new ResourceScope({
      label,
      parentSignal: this.signal,
      onDisposeError: this.options.onDisposeError,
    });
    if (this._disposed) {
      child.dispose("parent-already-disposed");
      return child;
    }
    const disposeChild: Disposer = () => child.dispose("parent-disposed");
    this.disposers.add(disposeChild);
    const originalChildDispose = child.dispose.bind(child);
    // 覆盖实例 dispose：主动释放时顺带从父摘除，避免父 disposers 堆积；
    // 父 dispose 联带调用时 remove 已无记录，属于 no-op。
    child.dispose = (reason?: unknown) => {
      originalChildDispose(reason);
      this.disposers.delete(disposeChild);
    };
    return child;
  }

  dispose(reason?: unknown): void {
    if (this._disposed) return;
    this._disposed = true;

    // 1) 先停 Vue watcher/computed
    try {
      this.controller.abort(reason);
    } catch {
      try {
        this.controller.abort();
      } catch {
        /* ignore */
      }
    }
    this.effects.stop();
    this.parentDetach?.();
    this.parentDetach = null;

    // 2) 按注册逆序释放非 Vue 资源
    for (const disposer of [...this.disposers].reverse()) {
      try {
        disposer();
      } catch (error) {
        // 销毁错误不可静默丢失:不中断后续 disposer,经 onDisposeError/logger 记录
        try {
          if (this.options.onDisposeError) {
            this.options.onDisposeError(error, { label: this.label, reason });
          } else {
            logger.warn(`ResourceScope dispose failed${this.label ? ` (${this.label})` : ""}`, {
              error: (error as Error)?.message ?? String(error),
            });
          }
        } catch {
          /* 记录回调本身错误不得中断释放 */
        }
      }
    }
    this.disposers.clear();
  }
}
