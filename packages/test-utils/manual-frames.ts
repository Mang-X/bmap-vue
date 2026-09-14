/**
 * 手动帧队列（M4-EVENTS / issue #28 的测试基建）
 *
 * `FrameScheduler` 在**创建时**读一次全局 `requestAnimationFrame`，因此只要在挂载之前把全局换成
 * 手动队列，组件里那份合帧器就会把任务排进队列、等 `flush()` 才执行——「一帧最多提交一次」这条
 * 断言于是有了确定性（不依赖 happy-dom 的 RAF 时序，也不用真的等 16ms）。
 *
 * 用法：
 * ```ts
 * const frames = createManualFrames()
 * beforeEach(() => { frames.install(); harness.reset() })
 * afterEach(() => frames.restore())
 * // 两个 moving 事件在同一帧 → flush 一次只投递最后一个
 * harness.dispatch('moving', { point: A }); harness.dispatch('moving', { point: B })
 * frames.flush()
 * ```
 */
export interface ManualFrames {
  /** 安装手动队列（幂等）：替换全局 `requestAnimationFrame` / `cancelAnimationFrame`。 */
  install(): void;
  /** 执行当前队列里的全部回调（模拟「下一帧」），返回执行的个数。 */
  flush(): number;
  /** 当前还在排队、尚未执行的帧回调数。 */
  pending(): number;
  /** 恢复原始全局实现。 */
  restore(): void;
}

type Raf = (callback: FrameRequestCallback) => number;
type Caf = (handle: number) => void;

export function createManualFrames(): ManualFrames {
  const queue = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  let installed = false;
  let original: { raf: Raf | undefined; caf: Caf | undefined } = { raf: undefined, caf: undefined };

  return {
    install(): void {
      if (installed) return;
      installed = true;
      original = {
        raf: globalThis.requestAnimationFrame as Raf | undefined,
        caf: globalThis.cancelAnimationFrame as Caf | undefined,
      };
      (globalThis as { requestAnimationFrame: Raf }).requestAnimationFrame = (callback) => {
        const handle = nextHandle++;
        queue.set(handle, callback);
        return handle;
      };
      (globalThis as { cancelAnimationFrame: Caf }).cancelAnimationFrame = (handle) => {
        queue.delete(handle);
      };
    },
    flush(): number {
      const pending = [...queue.values()];
      queue.clear();
      const timestamp = 16;
      for (const callback of pending) callback(timestamp);
      return pending.length;
    },
    pending(): number {
      return queue.size;
    },
    restore(): void {
      if (!installed) return;
      installed = false;
      queue.clear();
      if (original.raf) {
        (globalThis as { requestAnimationFrame: Raf }).requestAnimationFrame = original.raf;
      } else {
        delete (globalThis as { requestAnimationFrame?: Raf }).requestAnimationFrame;
      }
      if (original.caf) {
        (globalThis as { cancelAnimationFrame: Caf }).cancelAnimationFrame = original.caf;
      } else {
        delete (globalThis as { cancelAnimationFrame?: Caf }).cancelAnimationFrame;
      }
    },
  };
}
