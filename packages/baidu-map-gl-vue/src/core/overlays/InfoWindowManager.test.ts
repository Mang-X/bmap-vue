/**
 * InfoWindowManager：每张地图的归属账本（M5-INFOWINDOW / issue #32）
 *
 * 验收项「Manager 打开 B 后，A 的迟到 close 不能改变 B 的状态」的**第一半**在这里：
 * 账本必须先把「当前是谁」换掉、再通知被顶掉的那个 —— 反过来，被顶掉者在通知里做的收尾
 * 会把新主人误清掉。下面有一条用例专门锁这个顺序（`deactivate` 在通知里被调用时必须是 no-op）。
 */
import { describe, expect, it, vi } from "vitest";
import { createInfoWindowManager } from "./InfoWindowManager";
import type { InfoWindowHandle } from "../../driver/types/handles";

/** 只当作身份用的句柄（Manager 不读它的任何成员）。 */
function handleOf(name: string): InfoWindowHandle {
  return { name } as unknown as InfoWindowHandle;
}

describe("InfoWindowManager 归属判定", () => {
  it("register 之后还活着；dispose 幂等并把它从账本里摘掉", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const registration = manager.register({ resource: a, onSuperseded: () => {} });
    expect(manager.size).toBe(1);

    registration.dispose();
    expect(manager.size).toBe(0);
    expect(registration.disposed).toBe(true);
    registration.dispose();
    expect(manager.size, "重复释放不得把计数减成负数").toBe(0);
  });

  it("activate 顶掉上一个并通知它；被顶掉的 deactivate 不得清掉新主人", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const b = handleOf("b");
    /**
     * 通知期间**观察到**的当前项。
     *
     * 刻意记成读数、在 `activate` 之外断言：`activate` 对通知是 try/catch 的（通知失败不得
     * 打断顶替流程），写在回调里的断言会被那次 catch 吞掉 —— 那样「顺序反了」也照样绿。
     */
    const currentSeenAtNotify: Array<"a" | "b" | "none"> = [];
    const onSuperseded = vi.fn(() => {
      currentSeenAtNotify.push(
        manager.isCurrent(b) ? "b" : manager.isCurrent(a) ? "a" : "none",
      );
      // 被顶掉者在通知里收尾（真实组件就是这样：收敛状态 + 交还归属）
      manager.deactivate(a);
    });
    manager.register({ resource: a, onSuperseded });
    manager.register({ resource: b, onSuperseded: () => {} });

    manager.activate(a);
    expect(manager.current()).toBe(a);
    manager.activate(b);

    expect(onSuperseded).toHaveBeenCalledTimes(1);
    expect(currentSeenAtNotify, "通知时必须已经换过当前项（否则被顶掉者的收尾会清掉新主人）").toEqual([
      "b",
    ]);
    expect(manager.current(), "通知之后当前项仍是 b").toBe(b);
    expect(manager.isCurrent(a)).toBe(false);
    // 迟到的「被顶掉者的释放」不得影响新主人
    manager.deactivate(a);
    expect(manager.isCurrent(b)).toBe(true);
  });

  it("重复 activate 同一个实例不重复通知，也不清空当前项", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const onSuperseded = vi.fn();
    manager.register({ resource: a, onSuperseded });
    manager.activate(a);
    manager.activate(a);
    expect(onSuperseded).not.toHaveBeenCalled();
    expect(manager.current()).toBe(a);
  });

  it("未登记的实例不能抢走归属（打开失败被释放的实例不该顶掉别人）", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const ghost = handleOf("ghost");
    manager.register({ resource: a, onSuperseded: () => {} });
    manager.activate(a);
    manager.activate(ghost);
    expect(manager.current()).toBe(a);
  });

  it("通知抛错不得打断顶替流程（地图已经切到新的那一个了）", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const b = handleOf("b");
    manager.register({
      resource: a,
      onSuperseded: () => {
        throw new Error("boom");
      },
    });
    manager.register({ resource: b, onSuperseded: () => {} });
    manager.activate(a);
    expect(() => manager.activate(b)).not.toThrow();
    expect(manager.current()).toBe(b);
  });

  it("释放当前项时当前项归零；释放非当前项不动归属", () => {
    const manager = createInfoWindowManager();
    const a = handleOf("a");
    const b = handleOf("b");
    const ra = manager.register({ resource: a, onSuperseded: () => {} });
    manager.register({ resource: b, onSuperseded: () => {} });
    manager.activate(a);
    manager.activate(b);
    ra.dispose();
    expect(manager.current(), "释放被顶掉的那个不影响当前项").toBe(b);
    manager.deactivate(b);
    expect(manager.current()).toBeNull();
  });

  it("dispose 清空账本（随地图销毁）", () => {
    const manager = createInfoWindowManager();
    manager.register({ resource: handleOf("a"), onSuperseded: () => {} });
    manager.activate(handleOf("a"));
    manager.dispose();
    expect(manager.size).toBe(0);
    expect(manager.current()).toBeNull();
  });
});
