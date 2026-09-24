/**
 * Handle Registry（M3A2-01 / issue #19）
 *
 * 验收点：
 * - 同一 raw 对象返回**稳定** Handle（identity 不随调用次数变化）；
 * - raw ↔ Handle 双向可查；
 * - 跨 Client 的 Handle 被拒绝（句柄所有权可验证）；
 * - 同一 raw 被登记为不同类型属于内部不变式破坏，必须显式失败。
 */
import { describe, it, expect } from "vitest";
import { HANDLE_BRAND } from "../types/handles";
import { createJsapiV4HandleRegistry } from "./registry";

class RawMap {
  id = "m";
}

describe("createJsapiV4HandleRegistry", () => {
  it("同一 raw 对象返回稳定 Handle", () => {
    const registry = createJsapiV4HandleRegistry();
    const raw = new RawMap();
    const first = registry.adopt("map", raw);
    const second = registry.adopt("map", raw);
    expect(second).toBe(first);
    expect(first.raw).toBe(raw);
    expect(first[HANDLE_BRAND]).toBe("map");
  });

  it("不同 raw 对象得到不同 Handle", () => {
    const registry = createJsapiV4HandleRegistry();
    expect(registry.adopt("map", new RawMap())).not.toBe(registry.adopt("map", new RawMap()));
  });

  it("lookup 反查 raw → Handle；未登记返回 undefined", () => {
    const registry = createJsapiV4HandleRegistry();
    const raw = new RawMap();
    const handle = registry.adopt("map", raw);
    expect(registry.lookup(raw)).toBe(handle);
    expect(registry.lookup(new RawMap())).toBeUndefined();
  });

  it("resolve 取回 raw 并校验所有权", () => {
    const registry = createJsapiV4HandleRegistry();
    const raw = new RawMap();
    const handle = registry.adopt("map", raw);
    expect(registry.resolve(handle)).toBe(raw);
    expect(registry.owns(handle)).toBe(true);
  });

  it("同一 raw 被登记成不同类型时显式失败（不变式破坏）", () => {
    const registry = createJsapiV4HandleRegistry();
    const raw = new RawMap();
    registry.adopt("map", raw);
    expect(() => registry.adopt("overlay:marker", raw)).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("非对象 raw 被拒绝（WeakMap 无法以原始值作键）", () => {
    const registry = createJsapiV4HandleRegistry();
    expect(() => registry.adopt("map", "not-an-object")).toThrowError(
      expect.objectContaining({ code: "BMAP_INVALID_ARGUMENT" }),
    );
  });

  it("跨 Client 的 Handle 被拒绝", () => {
    const clientA = createJsapiV4HandleRegistry();
    const clientB = createJsapiV4HandleRegistry();
    const handleA = clientA.adopt("map", new RawMap());

    expect(clientA.owns(handleA)).toBe(true);
    expect(clientB.owns(handleA)).toBe(false);
    expect(() => clientB.resolve(handleA)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });

  it("伪造的 Handle（品牌对象但不经 adopt）被拒绝", () => {
    const registry = createJsapiV4HandleRegistry();
    const forged = Object.freeze({ [HANDLE_BRAND]: "map", raw: new RawMap() });
    expect(registry.owns(forged)).toBe(false);
    expect(() => registry.resolve(forged)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });

  it("两个 Client 各自登记同一 raw 时互不可见（不共享所有权）", () => {
    const clientA = createJsapiV4HandleRegistry();
    const clientB = createJsapiV4HandleRegistry();
    const raw = new RawMap();
    const handleA = clientA.adopt("map", raw);
    const handleB = clientB.adopt("map", raw);

    expect(handleA).not.toBe(handleB);
    expect(clientA.resolve(handleA)).toBe(raw);
    expect(clientB.resolve(handleB)).toBe(raw);
    expect(() => clientB.resolve(handleA)).toThrowError(
      expect.objectContaining({ code: "BMAP_HANDLE_FOREIGN" }),
    );
  });
});
