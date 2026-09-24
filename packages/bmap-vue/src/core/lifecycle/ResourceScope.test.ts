/**
 * ResourceScope —— **最小外部资源内核**（#139）
 *
 * 本类不再管 Vue 的 effect 生命周期（`run()` 已删）。剩下的契约是**外部资源**的：
 * 幂等、逆序释放、单个 disposer 抛错不连坐、已释放时 `add` 立即执行、以及 fork 的
 * 父子释放顺序。Vue 侧「watcher 在组件卸载时会停」由
 * `useSdkResource.test.ts` / `useOverlayResource.test.ts` 各一条回归用例钉住——
 * 那才是「effect 交回 Vue」这条命题的断言位置。
 */
import { describe, it, expect, vi } from "vitest";
import { ResourceScope } from "./ResourceScope";
import { logger } from "../logger";

describe("ResourceScope", () => {
  it("is idempotent on dispose", () => {
    const scope = new ResourceScope();
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    scope.add(disposeA);
    scope.add(disposeB);

    scope.dispose();
    scope.dispose();
    scope.dispose();

    expect(disposeA).toHaveBeenCalledTimes(1);
    expect(disposeB).toHaveBeenCalledTimes(1);
  });

  it("aborts signal on dispose", () => {
    const scope = new ResourceScope();
    expect(scope.signal.aborted).toBe(false);
    scope.dispose();
    expect(scope.signal.aborted).toBe(true);
  });

  it("immediately executes disposer if already disposed", () => {
    const scope = new ResourceScope();
    scope.dispose();
    const fn = vi.fn();
    scope.add(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("disposes in reverse registration order", () => {
    const scope = new ResourceScope();
    const order: string[] = [];
    scope.add(() => order.push("a"));
    scope.add(() => order.push("b"));
    scope.add(() => order.push("c"));
    scope.dispose();
    expect(order).toEqual(["c", "b", "a"]);
  });

  it("add returns a remover that releases early and is safe to call twice", () => {
    const scope = new ResourceScope();
    const dispose = vi.fn();
    const remove = scope.add(dispose);
    expect(scope.size).toBe(1);

    remove();
    remove();
    expect(dispose, "remover 幂等").toHaveBeenCalledTimes(1);
    expect(scope.size, "提前摘除后不再计入账本").toBe(0);

    scope.dispose();
    expect(dispose, "已摘除的不再被 dispose 调到").toHaveBeenCalledTimes(1);
  });

  it("reports dispose errors via logger.warn without interrupting others", () => {
    // 「一个 disposer 抛错不得中断其余释放」是**行为契约**（逆序释放是确定的），
    // 删掉这条断言就等于没人再钉它——所以改成断言真正的告警通道 `logger.warn`。
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const scope = new ResourceScope({ label: "map-runtime" });
    const order: string[] = [];
    scope.add(() => order.push("a"));
    scope.add(() => {
      throw new Error("boom");
    });
    scope.add(() => order.push("c"));

    scope.dispose();

    expect(order, "坏掉的 disposer 不连坐其余释放").toEqual(["c", "a"]);
    expect(warn, "释放失败必须留下可观察信号（不静默泄漏）").toHaveBeenCalledTimes(1);
    // 告警文案点名 scope：否则「哪个 scope 释放失败」不可追。
    expect(String(warn.mock.calls[0]?.[0])).toContain("map-runtime");
    warn.mockRestore();
  });

  it("exposes label and size", () => {
    const scope = new ResourceScope({ label: "map-runtime" });
    expect(scope.label).toBe("map-runtime");
    expect(scope.size).toBe(0);
    scope.add(() => {});
    scope.add(() => {});
    expect(scope.size).toBe(2);
    scope.dispose();
    expect(scope.size).toBe(0);
  });

  it("fork links parent dispose and detaches on child dispose", () => {
    const parent = new ResourceScope({ label: "parent" });
    const child = parent.fork("child");
    expect(child.label).toBe("child");
    expect(parent.size).toBe(1);
    child.dispose();
    // 主动释放的 child 必须从父摘除：覆盖物/图层重建会反复 fork，不摘除则父的账本无界增长。
    expect(parent.size).toBe(0);
    parent.dispose();
  });

  it("child disposed when parent disposes", () => {
    const parent = new ResourceScope();
    const child = parent.fork();
    child.add(vi.fn());
    parent.dispose();
    expect(child.isDisposed).toBe(true);
  });

  it("fork on an already-disposed parent disposes the child synchronously", () => {
    const parent = new ResourceScope();
    parent.dispose();
    const child = parent.fork();
    // **同步**，而不是排一个 microtask：晚一拍会让「父没了 ⇒ 子也没了」出现可观察窗口。
    expect(child.isDisposed).toBe(true);
  });

  it("repeated fork/dispose cycles do not grow the parent's ledger", () => {
    // 钉住 fork() 覆盖 child.dispose 的**理由**（否则这条只是实现细节）：
    // 图层/覆盖物反复重建，父只 dispose 一次 ⇒ 不摘除的话这里会线性增长。
    const parent = new ResourceScope();
    for (let index = 0; index < 50; index += 1) {
      parent.fork(`instance-${index}`).dispose();
    }
    expect(parent.size, "完成的 child 不得留在父的 disposers 里").toBe(0);
  });

  it("dispose accepts a reason", () => {
    const scope = new ResourceScope();
    expect(() => scope.dispose("vue-scope-disposed")).not.toThrow();
    expect(scope.isDisposed).toBe(true);
  });
});
