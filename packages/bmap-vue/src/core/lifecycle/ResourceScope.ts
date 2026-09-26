/**
 * ResourceScope —— **最小外部资源内核**（#139）
 *
 * 这个类只管**本库**必须负责的东西：SDK 事件监听、Observer、timer、RAF、动画、Overlay、
 * plugin，以及一个 `AbortSignal`。**Vue 的 effect 生命周期交回 Vue**：`watch` / `computed` /
 * `watchEffect` 在 setup 里建，组件卸载时 Vue 自己会停——把它们再登记进一个自建 scope
 * 只会让「谁负责停它」有两个答案。
 *
 * 为什么这不是「清理会漏」：本库真正会漏的是**非 Vue** 资源（SDK 监听、timer、RAF），
 * 那些 Vue 不知道、也不会停。判据是「Vue 会不会自己停它」——会的交回 Vue，不会的进这里。
 *
 * 两条例外都必须显式登记（这正是 `add()` 存在的原因）：
 *
 * - watcher 建在 `await` 之后的 async 钩子里时不在任何 effect scope 内（`getCurrentScope()`
 *   为 `null`），Vue 不会停它——`Autocomplete.vue` 的那两处是本仓的样板；
 * - `onWatcherCleanup` 之类的**手动 stop 句柄**同样只是普通 `Disposer`。
 *
 * 原则：
 * - `add(disposer)` 注册非 Vue 资源的释放函数，返回的 remover 立刻调用可提前释放；
 * - `dispose()` 先 abort signal，再按注册**逆序**释放 disposer；
 * - **一个 disposer 抛错不得中断其余释放**（销毁顺序是行为契约，坏掉一个不能连坐）；
 * - 幂等：重复 dispose 无副作用。
 */
import { logger } from "../logger";

export type Disposer = () => void;

export interface ResourceScopeOptions {
  /** 诊断标签：释放失败告警里点名是哪个 scope。 */
  label?: string;
}

export class ResourceScope {
  readonly controller = new AbortController();
  readonly label?: string;

  private readonly disposers = new Set<Disposer>();
  private _disposed = false;

  constructor(options: ResourceScopeOptions = {}) {
    this.label = options.label;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * 当前登记的释放函数**条数**。
   *
   * 这是**外部资源账本**，不是「effect 数量」：组件场景用它断言「卸载后没有遗留的
   * SDK 资源 disposer」（`tests/behavior/v3-component-scenarios.test.ts`），所以它
   * 必须精确反映 `disposers`，不能被任何内部记账抵消。
   */
  get size(): number {
    return this.disposers.size;
  }

  /** 注册一个释放函数；已释放时立即执行（不留悬挂资源，也不抛错） */
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

  /**
   * 从当前 scope fork 出独立 child scope；父 dispose 时联带 dispose child。
   *
   * child 一开始就是**独立**的（它自己的 `AbortController`、自己的 disposers），「父子关系」
   * 只体现为「父释放时顺带释放子」这一条链路——那正是外部资源的确定性释放顺序。
   */
  fork(label?: string): ResourceScope {
    const child = new ResourceScope({ label });
    if (this._disposed) {
      // 父已经释放：child 不该活下来。**同步**释放（而不是排一个 microtask）——
      // 晚一拍就会让「父没了 ⇒ 子也没了」这条不变式出现一个可观察的窗口。
      child.dispose("parent-already-disposed");
      return child;
    }
    const disposeChild: Disposer = () => child.dispose("parent-disposed");
    this.disposers.add(disposeChild);
    const originalChildDispose = child.dispose.bind(child);
    /**
     * 覆盖 child 的 `dispose` 以便**主动**释放时顺带从父摘除。
     *
     * 必须保留：覆盖物 / 图层在重建时反复 `fork()`，而父（组件级 scope）只 dispose 一次。
     * 不摘除的话，父的 `disposers` 会随重建次数**无界增长**——每一条都是一个已完成 child 的
     * `disposeChild`，`size` 账本随之失真，父释放时还要空跑 N 次幂等调用。
     *
     * 父联带调用时 `delete` 已经没有记录，属于 no-op。
     */
    child.dispose = (reason?: unknown) => {
      originalChildDispose(reason);
      this.disposers.delete(disposeChild);
    };
    return child;
  }

  dispose(reason?: unknown): void {
    if (this._disposed) return;
    this._disposed = true;

    // 1) 先 abort：让所有「监听 signal 而非监听事件」的在飞工作立刻知道该收手。
    try {
      this.controller.abort(reason);
    } catch {
      try {
        this.controller.abort();
      } catch {
        /* ignore */
      }
    }

    // 2) 按注册逆序释放非 Vue 资源。
    for (const disposer of [...this.disposers].reverse()) {
      try {
        disposer();
      } catch (error) {
        // 销毁错误不可静默丢失：**不中断**后续 disposer（释放顺序是行为契约），
        // 但必须留下可观察信号 —— 否则「某个 disposer 坏了」会退化成难查的资源泄漏。
        //
        // 这里**不**再套 try/catch：`logger.warn` 自身在输出边界隔离失败（#163），
        // 不会把异常抛回这里。日志是旁路——它自己坏掉时，丢一条日志远好过连坐剩余释放。
        logger.warn(`ResourceScope dispose failed${this.label ? ` (${this.label})` : ""}`, {
          error,
        });
      }
    }
    this.disposers.clear();
  }
}
