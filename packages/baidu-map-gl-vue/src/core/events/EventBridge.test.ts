import { describe, it, expect, vi } from "vitest";
import { bindSdkEvent, bindSdkEvents, normalizeMapEvent } from "./EventBridge";

class FakeTarget {
  listeners = new Map<string, Set<(...args: any[]) => void>>();
  addEventListener(type: string, listener: (...args: any[]) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: (...args: any[]) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string, ...args: any[]) {
    for (const l of this.listeners.get(type) ?? []) l(...args);
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe("EventBridge", () => {
  it("bindSdkEvent returns a disposer that removes the listener", () => {
    const target = new FakeTarget();
    const dispose = bindSdkEvent(target, "click", () => {});
    expect(target.count("click")).toBe(1);
    dispose();
    expect(target.count("click")).toBe(0);
    dispose();
    expect(target.count("click")).toBe(0);
  });

  it("bindSdkEvents removes all events in reverse order", () => {
    const target = new FakeTarget();
    const dispose = bindSdkEvents(target, [
      ["click", () => {}],
      ["dblclick", () => {}],
    ]);
    expect(target.count("click")).toBe(1);
    expect(target.count("dblclick")).toBe(1);
    dispose();
    expect(target.count("click")).toBe(0);
    expect(target.count("dblclick")).toBe(0);
  });

  it("normalizeMapEvent wraps without mutating raw", () => {
    const raw = { type: "click", domEvent: { preventDefault: vi.fn(), stopPropagation: vi.fn() } };
    const wrapped = normalizeMapEvent(raw);
    expect(wrapped.raw).toBe(raw);
    wrapped.preventDefault();
    wrapped.stopPropagation();
    expect(raw.domEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(raw.domEvent.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("normalizeMapEvent handles missing domEvent", () => {
    const raw = { type: "moving" };
    const wrapped = normalizeMapEvent(raw);
    expect(() => wrapped.preventDefault()).not.toThrow();
    expect(() => wrapped.stopPropagation()).not.toThrow();
  });
});
