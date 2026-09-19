import { describe, it, expect, vi } from "vitest";
import { watch, ref, nextTick } from "vue";
import { ResourceScope } from "./ResourceScope";

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

  it("stops Vue watchers created inside scope", async () => {
    const scope = new ResourceScope();
    const source = ref(0);
    const onFn = vi.fn();

    scope.run(() => {
      watch(source, () => onFn(), { flush: "sync" });
    });

    source.value = 1;
    expect(onFn).toHaveBeenCalledTimes(1);

    scope.dispose();
    source.value = 2;
    expect(onFn).toHaveBeenCalledTimes(1); // watcher 已停止
  });

  it("registers DOM event listeners and removes them on dispose", () => {
    const scope = new ResourceScope();
    const target = document.createElement("div");
    const listener = vi.fn();
    scope.addEventListener(target, "click", listener);

    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1);

    scope.dispose();
    target.dispatchEvent(new Event("click"));
    expect(listener).toHaveBeenCalledTimes(1); // 已移除
  });

  it("throws when running after dispose", () => {
    const scope = new ResourceScope();
    scope.dispose();
    expect(() => scope.run(() => 1)).toThrow("ResourceScope has been disposed");
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

  it("registers observer and disconnects on dispose", () => {
    const scope = new ResourceScope();
    const observer = { disconnect: vi.fn() };
    scope.observe(observer);
    expect(observer.disconnect).not.toHaveBeenCalled();
    scope.dispose();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
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

  it("reports dispose errors via onDisposeError without interrupting others", () => {
    const seen: unknown[] = [];
    const scope = new ResourceScope({
      onDisposeError: (e) => seen.push(e),
    });
    const order: string[] = [];
    scope.add(() => order.push("a"));
    scope.add(() => {
      throw new Error("boom");
    });
    scope.add(() => order.push("c"));
    scope.dispose();
    expect(order).toEqual(["c", "a"]);
    expect(seen).toHaveLength(1);
  });

  it("fork links parent dispose and detaches on child dispose", () => {
    const parent = new ResourceScope({ label: "parent" });
    const child = parent.fork("child");
    expect(child.label).toBe("child");
    expect(parent.size).toBe(1);
    child.dispose();
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

  it("aborts when parentSignal aborts", async () => {
    const parent = new ResourceScope();
    const child = new ResourceScope({ parentSignal: parent.signal });
    expect(child.isDisposed).toBe(false);
    parent.dispose("test");
    await Promise.resolve();
    expect(child.isDisposed).toBe(true);
  });

  it("dispose accepts a reason", () => {
    const scope = new ResourceScope();
    expect(() => scope.dispose("vue-scope-disposed")).not.toThrow();
    expect(scope.isDisposed).toBe(true);
  });
});
