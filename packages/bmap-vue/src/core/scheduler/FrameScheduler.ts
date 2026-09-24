/**
 * FrameScheduler
 *
 * 通过 key 合并同一帧内的多次任务调度,同 key 每帧只执行最后一次。
 * 用于:
 * - 地图 viewport patch(center/zoom/heading/tilt 合并提交)
 * - mousemove/moving/dragging 事件合帧
 * - 批量 Overlay 更新
 * - InfoWindow redraw、resize
 *
 * 核心语义:
 * - `schedule(key, task)` 同一帧内同 key 只保留最后一次 task。
 * - `cancel(key)` 取消未执行的 key。
 * - `flush()` 立即执行本帧已排队的任务。
 * - `pause()` / `resume()` 暂停与恢复提交（M4-HANDLE-UX / #29，见下）。
 * - `dispose()` 清理全部待执行任务与 RAF。
 *
 * ## `pause()` / `resume()`（issue #29）
 *
 * 「地图在后台（document hidden）/ 离开视口时暂停高频计算」需要能**真的不提交**：
 * 暂停期间不排队帧、也不执行已经排上的帧，但**保留每个 key 的最后一次任务**，
 * 恢复时按 `flush()` 的口径一次提交。这样暂停不会丢数据（合帧本来就只保留最后一次），
 * 也不会为了「暂停」而让调用方各写一套缓冲。
 *
 * 三个刻意选择：
 * - **`pause()` 先取消已排的帧**：不占住 RAF 句柄（门禁里按「不排帧」断言）；
 * - **`runFrame()` 再判一次 `paused`**：即使取消没赶上（同一帧内 `schedule → pause` 的时序），
 *   那一帧也不提交任何任务 —— 只靠 `cancelFrame` 会留下依赖时序的漏洞；
 * - **`flush()` 不受暂停影响**：它是显式的「现在就要结果」，由调用方负责语义
 *   （`<Map>` 的合帧 checkResize 走 `schedule()` 而不是 `flush()`）。
 */
export interface FrameScheduler {
  schedule(key: PropertyKey, task: () => void): void;
  cancel(key: PropertyKey): void;
  flush(): void;
  /** 暂停提交：不排新帧、不执行已排帧，保留各 key 的最后一次任务。 */
  pause(): void;
  /** 恢复提交：立即执行暂停期间保留的任务（从未暂停过时是 no-op）。 */
  resume(): void;
  dispose(): void;
}

export function createFrameScheduler(
  raf?: (cb: FrameRequestCallback) => number,
): FrameScheduler {
  // SSR-safe:服务端无 requestAnimationFrame 时降级为 setTimeout(调用时判断,不在模块顶层访问 window)
  const requestFrame: (cb: FrameRequestCallback) => number =
    raf ??
    (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : ((cb) => setTimeout(() => cb(Date.now()), 16) as unknown as number));
  const cancelFrame: (id: number) => void =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : ((id) => clearTimeout(id));
  const pending = new Map<PropertyKey, () => void>();
  let frameId: number | null = null;
  let disposed = false;
  let paused = false;

  /** 执行并清空当前排队的任务（单任务错误不阻断其余任务）。 */
  const runPending = () => {
    const tasks = [...pending.values()];
    pending.clear();
    for (const task of tasks) {
      try {
        task();
      } catch {
        // 单任务错误不阻断本帧其余任务
      }
    }
  };

  const runFrame = () => {
    frameId = null;
    // 暂停期间到达的帧（`pause()` 与 `cancelFrame` 之间的时序）一律不提交
    if (disposed || paused) return;
    runPending();
  };

  const clearFrame = () => {
    if (frameId === null) return;
    cancelFrame(frameId);
    frameId = null;
  };

  return {
    schedule(key, task) {
      if (disposed) return;
      pending.set(key, task);
      if (paused) return;
      if (frameId === null) {
        frameId = requestFrame(runFrame);
      }
    },
    cancel(key) {
      if (pending.delete(key) && pending.size === 0) {
        clearFrame();
      }
    },
    flush() {
      clearFrame();
      runPending();
    },
    pause() {
      if (disposed || paused) return;
      paused = true;
      clearFrame();
    },
    resume() {
      if (disposed || !paused) return;
      paused = false;
      runPending();
    },
    dispose() {
      disposed = true;
      pending.clear();
      clearFrame();
    },
  };
}
