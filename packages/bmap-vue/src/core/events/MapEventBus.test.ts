import { describe, it, expect, vi } from "vitest";
import { createMapEventBus } from "./MapEventBus";

describe("MapEventBus", () => {
  it("creates an independent emitter per call (no module singleton)", () => {
    const a = createMapEventBus();
    const b = createMapEventBus();
    const fn = vi.fn();
    a.on("resource:error", fn);
    b.emit("resource:error", { error: "x" });
    // b 独立,不触发 a 的 listener
    expect(fn).not.toHaveBeenCalled();
    a.emit("resource:error", { error: "x" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("clear() removes all listeners", () => {
    const bus = createMapEventBus();
    const fn = vi.fn();
    bus.on("plugin:ready", fn);
    bus.clear();
    bus.emit("plugin:ready", { name: "x" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("off() removes a single listener", () => {
    const bus = createMapEventBus();
    const fn = vi.fn();
    bus.on("plugin:error", fn);
    bus.off("plugin:error", fn);
    bus.emit("plugin:error", { name: "x", error: new Error() });
    expect(fn).not.toHaveBeenCalled();
  });
});
