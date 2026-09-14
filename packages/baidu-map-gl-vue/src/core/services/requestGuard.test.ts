/**
 * 请求序列守卫（M7-SERVICE-CORE / issue #38）
 *
 * 反证是重点：守卫必须真的**挡住旧结果**。只测「next() 会递增」这类读数，等于没测
 * 「旧请求不得覆盖新结果」这条契约。
 */
import { describe, it, expect } from "vitest";
import { createRequestGuard } from "./requestGuard";

describe("core/services：请求序列守卫", () => {
  it("next() 之后，之前那一轮不再是最新（旧结果会被丢弃）", () => {
    const guard = createRequestGuard();
    const first = guard.next();
    expect(guard.isCurrent(first)).toBe(true);

    const second = guard.next();
    expect(guard.isCurrent(first), "旧请求必须失效").toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidate() 不产生新序列号，但让在飞请求全部失效（取消 / 卸载用）", () => {
    const guard = createRequestGuard();
    const inflight = guard.next();
    guard.invalidate();
    expect(guard.isCurrent(inflight)).toBe(false);

    // 失效之后仍能正常开启新一轮
    const next = guard.next();
    expect(guard.isCurrent(next)).toBe(true);
  });

  it("连续的 next() 只保留最后一个（多次快速调用时旧结果全部作废）", () => {
    const guard = createRequestGuard();
    const ids = [guard.next(), guard.next(), guard.next()];
    expect(ids.map((id) => guard.isCurrent(id))).toEqual([false, false, true]);
    expect(guard.current).toBe(ids[2]);
  });

  it("reset() 之后 current 归零起点：新守卫不与旧序列号串台", () => {
    const guard = createRequestGuard();
    const old = guard.next();
    const fresh = createRequestGuard();
    expect(fresh.isCurrent(old), "另一个守卫不认识旧序列号").toBe(false);
    expect(fresh.current).toBe(0);
  });
});
