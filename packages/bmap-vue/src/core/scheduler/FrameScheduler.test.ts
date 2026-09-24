import { describe, it, expect, vi } from "vitest";
import { createFrameScheduler } from "./FrameScheduler";

function fakeRaf() {
  let callbacks: FrameRequestCallback[] = [];
  const raf = (cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length;
  };
  const cancelAnimationFrame = () => {
    callbacks = [];
  };
  const flush = () => {
    const cbs = callbacks;
    callbacks = [];
    for (const cb of cbs) cb(0);
  };
  return { raf, flush, cancelAnimationFrame };
}

describe("FrameScheduler", () => {
  it("coalesces same-key tasks within one frame", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a1"));
    s.schedule("a", () => run("a2"));
    s.schedule("a", () => run("a3"));
    flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a3");
  });

  it("runs different keys in the same frame", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("x", () => run("x"));
    s.schedule("y", () => run("y"));
    flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("cancel(key) removes a scheduled task", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.cancel("a");
    flush();
    expect(run).not.toHaveBeenCalled();
  });

  it("flush() runs immediately without waiting for next frame", () => {
    const { raf } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose() clears tasks and ignores future schedules", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.dispose();
    s.schedule("b", () => run("b"));
    flush();
    expect(run).not.toHaveBeenCalled();
  });
});

/**
 * `pause()` / `resume()`（M4-HANDLE-UX / #29）
 *
 * 暂停语义是「地图在后台 / 视口外时不提交合帧任务」的落点，因此两条都必须可断言：
 * 暂停期间**任何**已排或新排的任务都不执行（包括暂停没赶上取消的那一帧），恢复时**只**执行
 * 合并后的最后一次（与 `flush()` 同一口径）。
 */
describe("FrameScheduler pause/resume", () => {
  it("pause() 之后已排的帧不执行，任务仍保留到 resume()", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a1"));
    s.pause();
    flush();
    expect(run).not.toHaveBeenCalled();

    s.resume();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("a1");
  });

  it("暂停期间的新任务只保留最后一次，恢复时执行一次", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.pause();
    s.schedule("a", () => run("a1"));
    s.schedule("a", () => run("a2"));
    s.schedule("b", () => run("b1"));
    flush();
    expect(run).not.toHaveBeenCalled();

    s.resume();
    expect(run.mock.calls.map(([value]) => value).sort()).toEqual(["a2", "b1"]);
  });

  it("resume() 没有暂停过 / 没有待执行任务时是 no-op", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.resume();
    s.schedule("a", () => run("a"));
    s.resume();
    flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("pause() 期间 cancel(key) 仍然生效", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.pause();
    s.schedule("a", () => run("a"));
    s.cancel("a");
    s.resume();
    flush();
    expect(run).not.toHaveBeenCalled();
  });

  it("pause() 期间 flush() 仍然立即执行（显式 flush 优先于暂停）", () => {
    const { raf } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.schedule("a", () => run("a"));
    s.pause();
    s.flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose() 之后 resume() 不执行任何残留任务", () => {
    const { raf, flush } = fakeRaf();
    const s = createFrameScheduler(raf);
    const run = vi.fn();
    s.pause();
    s.schedule("a", () => run("a"));
    s.dispose();
    s.resume();
    flush();
    expect(run).not.toHaveBeenCalled();
  });
});
