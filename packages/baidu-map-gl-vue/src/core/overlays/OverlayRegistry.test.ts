import { describe, it, expect } from "vitest";
import { createOverlayRegistry } from "./OverlayRegistry";
import { ResourceScope } from "../lifecycle/ResourceScope";

/**
 * OverlayRegistry（M5-SPEC-MARKER / #30 定型）
 *
 * 记账模型：**所有者是实例 scope**。registration 自带 `dispose`，并把「从表里摘除」交给 scope；
 * 因此这里同时验证「显式释放」与「scope 释放」两条路径，以及「反复注册 / 释放不堆积」。
 */
describe("OverlayRegistry", () => {
  it("registers and queries by type, returning a first-class registration", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    const marker = { id: "m1" };
    const registration = reg.registerResource({
      type: "marker",
      resource: marker,
      scope,
      remove: () => {},
    });

    expect(reg.size).toBe(1);
    expect(reg.get(registration.id)?.type).toBe("marker");
    expect(reg.get(registration.id)?.instance).toBe(marker);
    expect(reg.getByType("marker")).toHaveLength(1);
    expect(registration.resource).toBe(marker);
    expect(registration.disposed).toBe(false);
  });

  it("dispose removes the record and calls remove exactly once", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    const removed: unknown[] = [];
    const registration = reg.registerResource({
      type: "marker",
      resource: { id: "m1" },
      scope,
      remove: (resource) => removed.push(resource),
    });

    registration.dispose();
    expect(registration.disposed).toBe(true);
    expect(reg.size).toBe(0);
    expect(removed).toHaveLength(1);
    // 幂等：重复 dispose 不再触发 SDK 侧 remove
    registration.dispose();
    expect(removed).toHaveLength(1);
  });

  it("scope disposal detaches the record without calling remove", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    const removed: unknown[] = [];
    reg.registerResource({
      type: "marker",
      resource: {},
      scope,
      remove: (resource) => removed.push(resource),
    });

    scope.dispose("instance-replaced");
    expect(reg.size).toBe(0);
    // scope 释放只是记账摘除：SDK 侧的移除由 registration.dispose() 负责
    expect(removed).toHaveLength(0);
  });

  it("does not accumulate disposer closures across register/dispose cycles", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    for (let i = 0; i < 100; i++) {
      const registration = reg.registerResource({
        type: "marker",
        resource: { i },
        scope,
        remove: () => {},
      });
      registration.dispose();
    }
    expect(reg.size).toBe(0);
    // scope 里不能留下 100 个「已经失效的 detach」闭包（旧实现把 detach 挂在记录上，
    // 只能靠 unregister 手动摘，漏一次就永久堆积）
    expect(scope.size).toBe(0);
  });

  it("replaces the record of an instance on rebuild (size stays 1)", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    let previous = reg.registerResource({
      type: "marker",
      resource: { gen: 1 },
      scope,
      remove: () => {},
    });
    for (let gen = 2; gen <= 100; gen++) {
      previous.dispose();
      previous = reg.registerResource({
        type: "marker",
        resource: { gen },
        scope,
        remove: () => {},
      });
      expect(reg.size).toBe(1);
    }
    expect(reg.getByType("marker")[0]?.instance).toEqual({ gen: 100 });
  });

  it("clearAll simulates map.clearOverlays and dispose only clears records", () => {
    const reg = createOverlayRegistry();
    const scope = new ResourceScope();
    reg.registerResource({ type: "marker", resource: {}, scope, remove: () => {} });
    reg.registerResource({ type: "polygon", resource: {}, scope, remove: () => {} });
    reg.clearAll();
    expect(reg.size).toBe(0);

    reg.registerResource({ type: "marker", resource: {}, scope, remove: () => {} });
    reg.dispose();
    expect(reg.size).toBe(0);
    // 释放责任在拥有实例的组件：注册表不越权释放别人的 scope
    expect(scope.isDisposed).toBe(false);
    scope.dispose();
  });
});
